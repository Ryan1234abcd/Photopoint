// Physical dimensions of the corrected plane (mm)
const PLANE_HALF_Z  = 11;  // half-width in Z axis (25 mm total)
const PLANE_HALF_Y  = 57.5;    // half-height in Y axis (150 mm total)
const MIN_THICKNESS = 2;     // minimum shim thickness perpendicular to face (mm)
const MAX_ANGLE     = 10;    // maximum roll/yaw correction (degrees)

// === STATE ===

const state = {
  rollDeg: 0,
  yawDeg:  0,
  photo:   null   // HTMLImageElement | null
};

// === DOM REFERENCES ===

let canvas2d, ctx2d, rollValueEl, yawValueEl;

// === THREE.JS GLOBALS ===

let renderer, scene, threeCamera, controls, shimGroup;

// ─────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', init);

function init() {
  canvas2d    = document.getElementById('canvas2d');
  ctx2d       = canvas2d.getContext('2d');
  rollValueEl = document.getElementById('rollValue');
  yawValueEl  = document.getElementById('yawValue');

  document.getElementById('uploadBtn').addEventListener('click', () =>
    document.getElementById('fileInput').click()
  );
  document.getElementById('fileInput').addEventListener('change', onFileChange);
  document.getElementById('downloadBtn').addEventListener('click', onDownloadSTL);

  document.getElementById('rollMinus').addEventListener('click', () => onRollChange(-0.5));
  document.getElementById('rollPlus' ).addEventListener('click', () => onRollChange( 0.5));
  document.getElementById('yawMinus' ).addEventListener('click', () => onYawChange(-0.5));
  document.getElementById('yawPlus'  ).addEventListener('click', () => onYawChange( 0.5));

  window.addEventListener('resize', onResize);

  // Defer visual init until after the browser has computed layout,
  // so clientWidth/Height are non-zero for both canvases.
  requestAnimationFrame(() => {
    initThree();
    resizeCanvas();
    render2D();
    updateShimMesh();
  });
}

// ─────────────────────────────────────────────
// 2D CANVAS
// ─────────────────────────────────────────────

function resizeCanvas() {
  const section = document.getElementById('canvas2d-section');
  const dpr = window.devicePixelRatio || 1;
  // Set buffer at native resolution; CSS keeps canvas at 100%×100% of section.
  canvas2d.width  = Math.floor(section.clientWidth  * dpr);
  canvas2d.height = Math.floor(section.clientHeight * dpr);
}

// Photo is drawn with 15% padding inside the canvas so the corrected-frame
// outline has room to extend visibly beyond the photo boundary.
const PHOTO_PAD = 0.15;

function getPhotoRect(W, H) {
  return {
    x: Math.round(W * PHOTO_PAD),
    y: Math.round(H * PHOTO_PAD),
    w: Math.round(W * (1 - 2 * PHOTO_PAD)),
    h: Math.round(H * (1 - 2 * PHOTO_PAD))
  };
}

function render2D() {
  const dpr = window.devicePixelRatio || 1;
  // Work in CSS pixels; the DPR scale maps them to physical pixels.
  const W = canvas2d.width  / dpr;
  const H = canvas2d.height / dpr;
  if (!W || !H) return;

  ctx2d.clearRect(0, 0, canvas2d.width, canvas2d.height);
  ctx2d.save();
  ctx2d.scale(dpr, dpr);  // all subsequent coordinates are CSS pixels

  ctx2d.fillStyle = '#1a1a1a';
  ctx2d.fillRect(0, 0, W, H);

  const { x, y, w, h } = getPhotoRect(W, H);

  if (state.photo) {
    ctx2d.drawImage(state.photo, x, y, w, h);
  } else {
    ctx2d.strokeStyle = '#444';
    ctx2d.lineWidth = 1;
    ctx2d.strokeRect(x, y, w, h);
    ctx2d.fillStyle = '#666';
    ctx2d.font = '13px system-ui, sans-serif';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillText('Upload a photo to begin', x + w / 2, y + h / 2);
    ctx2d.textAlign = 'start';
    ctx2d.textBaseline = 'alphabetic';
  }

  drawOutline(W, H);   // called inside the DPR-scaled save block
  ctx2d.restore();
}

function drawOutline(W, H) {
  // All coordinates here are CSS pixels (DPR scale already active from render2D).
  const { x: px, y: py, w: pw, h: ph } = getPhotoRect(W, H);
  const rollRad = state.rollDeg * Math.PI / 180;
  const yawPx   = state.yawDeg * pw / 60;

  const pivotX = px;
  const pivotY = py + ph / 2;

  ctx2d.save();
  ctx2d.translate(yawPx, 0);
  ctx2d.translate(pivotX, pivotY);
  ctx2d.rotate(rollRad);
  ctx2d.translate(-pivotX, -pivotY);

  // ── Fine grid (light grey, every 1/10 of frame) ─────────────
  ctx2d.strokeStyle = 'rgba(200,200,200,0.2)';
  ctx2d.lineWidth   = 0.5;
  ctx2d.beginPath();
  for (let i = 1; i <= 9; i++) {
    const gx = px + pw * i / 10;
    const gy = py + ph * i / 10;
    ctx2d.moveTo(gx, py);  ctx2d.lineTo(gx, py + ph);
    ctx2d.moveTo(px, gy);  ctx2d.lineTo(px + pw, gy);
  }
  ctx2d.stroke();

  // ── Rule-of-thirds grid ──────────────────────────────────
  ctx2d.strokeStyle = 'rgba(0,230,118,0.35)';
  ctx2d.lineWidth   = 0.75;
  ctx2d.beginPath();
  for (let i = 1; i <= 2; i++) {
    const gx = px + pw * i / 3;
    const gy = py + ph * i / 3;
    ctx2d.moveTo(gx, py);  ctx2d.lineTo(gx, py + ph);  // vertical
    ctx2d.moveTo(px, gy);  ctx2d.lineTo(px + pw, gy);  // horizontal
  }
  ctx2d.stroke();

  // ── Outline border ───────────────────────────────────────
  ctx2d.strokeStyle = '#00e676';
  ctx2d.lineWidth   = 1;
  ctx2d.strokeRect(px, py, pw, ph);

  // ── Corner tick marks ────────────────────────────────────
  const tick = Math.min(pw, ph) * 0.05;
  ctx2d.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx2d.lineWidth   = 0.75;
  for (const [cx, cy] of [[px, py], [px + pw, py], [px + pw, py + ph], [px, py + ph]]) {
    const sx = cx === px ? 1 : -1;
    const sy = cy === py ? 1 : -1;
    ctx2d.beginPath();
    ctx2d.moveTo(cx + sx * tick, cy);
    ctx2d.lineTo(cx, cy);
    ctx2d.lineTo(cx, cy + sy * tick);
    ctx2d.stroke();
  }

  ctx2d.restore();
}

// ─────────────────────────────────────────────
// 3D GEOMETRY HELPERS
// ─────────────────────────────────────────────

function vec3(x, y, z)  { return { x, y, z }; }
function sub(a, b)       { return vec3(a.x - b.x, a.y - b.y, a.z - b.z); }
function addScaled(v, n, t) {
  return vec3(v.x + n.x * t, v.y + n.y * t, v.z + n.z * t);
}

function cross(a, b) {
  return vec3(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x
  );
}

function normalize(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len < 1e-10) return vec3(1, 0, 0);
  return vec3(v.x / len, v.y / len, v.z / len);
}

// Rotation around Y axis
function rotY(v, theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

// Rotation around Z axis
function rotZ(v, phi) {
  const c = Math.cos(phi), s = Math.sin(phi);
  return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z);
}

// ─────────────────────────────────────────────
// SHIM GEOMETRY
// ─────────────────────────────────────────────

// Initial corrected-plane vertices on the Y/Z plane (x=0), centred at origin.
// V0=top-left  V1=top-right  V2=bottom-right  V3=bottom-left
const BASE_VERTS = [
  vec3(0,  PLANE_HALF_Y, -PLANE_HALF_Z),
  vec3(0,  PLANE_HALF_Y,  PLANE_HALF_Z),
  vec3(0, -PLANE_HALF_Y,  PLANE_HALF_Z),
  vec3(0, -PLANE_HALF_Y, -PLANE_HALF_Z)
];

function computeCorrectedVertices(rollDeg, yawDeg) {
  const theta = yawDeg  * Math.PI / 180;
  const phi   = rollDeg * Math.PI / 180;
  // Apply yaw first, then roll
  return BASE_VERTS.map(v => rotZ(rotY(v, theta), phi));
}

// Returns { front, back, normal } or null if geometry is degenerate.
function computeShimGeometry(rollDeg, yawDeg) {
  const front = computeCorrectedVertices(rollDeg, yawDeg);

  // Unit normal of the corrected plane; must point toward the camera (+X)
  let n = normalize(cross(sub(front[1], front[0]), sub(front[3], front[0])));
  if (n.x < 0) n = vec3(-n.x, -n.y, -n.z);

  // Guard: degenerate if the plane faces nearly sideways
  if (n.x < 0.01) return null;

  // Base-plane x-position that guarantees minimum perpendicular thickness = MIN_THICKNESS.
  // Thickness at vertex i = |t_i| where t_i = (c - Vi.x) / n.x.
  // At the shallowest vertex (min x): t = -MIN_THICKNESS, so c = min_x - MIN_THICKNESS * n.x.
  const minX = Math.min(...front.map(v => v.x));
  const c    = minX - MIN_THICKNESS * n.x;

  // Project each front vertex onto the base plane along the inward normal
  const back = front.map(v => {
    const t = (c - v.x) / n.x;
    return addScaled(v, n, t);
  });

  return { front, back, normal: n };
}

// ─────────────────────────────────────────────
// STL GENERATION
// ─────────────────────────────────────────────

function computeTriangleNormal(v1, v2, v3) {
  return normalize(cross(sub(v2, v1), sub(v3, v1)));
}

// Writes one STL triangle (50 bytes) at byte offset; returns next offset.
function writeTriangle(dv, offset, v1, v2, v3) {
  const n = computeTriangleNormal(v1, v2, v3);
  for (const val of [n.x, n.y, n.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z, v3.x, v3.y, v3.z]) {
    dv.setFloat32(offset, val, true);
    offset += 4;
  }
  dv.setUint16(offset, 0, true);
  return offset + 2;
}

function generateSTL(shimGeom) {
  const { front: F, back: B } = shimGeom;

  // 80-byte header + 4-byte triangle count + 12 triangles × 50 bytes = 684 bytes
  const buf = new ArrayBuffer(684);
  const dv  = new DataView(buf);

  const header = 'Photopoint Shim Generator';
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));

  dv.setUint32(80, 12, true); // 12 triangles

  let off = 84;

  // Front face  (outward normal ≈ +n̂, toward camera)
  off = writeTriangle(dv, off, F[0], F[1], F[2]);
  off = writeTriangle(dv, off, F[0], F[2], F[3]);

  // Back face   (outward normal ≈ −X, toward post)
  off = writeTriangle(dv, off, B[1], B[0], B[3]);
  off = writeTriangle(dv, off, B[1], B[3], B[2]);

  // Top side    (outward normal ≈ +Y)  — connects V0'–V1' to W0–W1
  off = writeTriangle(dv, off, F[0], B[0], B[1]);
  off = writeTriangle(dv, off, F[0], B[1], F[1]);

  // Right side  (outward normal ≈ +Z)  — connects V1'–V2' to W1–W2
  off = writeTriangle(dv, off, F[1], B[2], F[2]);
  off = writeTriangle(dv, off, F[1], B[1], B[2]);

  // Bottom side (outward normal ≈ −Y)  — connects V2'–V3' to W2–W3
  off = writeTriangle(dv, off, F[2], B[2], B[3]);
  off = writeTriangle(dv, off, F[2], B[3], F[3]);

  // Left side   (outward normal ≈ −Z)  — connects V3'–V0' to W3–W0
  off = writeTriangle(dv, off, F[3], B[0], F[0]);
  off = writeTriangle(dv, off, F[3], B[3], B[0]);

  return buf;
}

function onDownloadSTL() {
  const geom = computeShimGeometry(state.rollDeg, state.yawDeg);
  if (!geom) {
    alert('Shim geometry is degenerate — please reduce the angle.');
    return;
  }
  const blob = new Blob([generateSTL(geom)], { type: 'application/octet-stream' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `shim_roll${state.rollDeg.toFixed(1)}_yaw${state.yawDeg.toFixed(1)}.stl`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
// THREE.JS SCENE
// ─────────────────────────────────────────────

function initThree() {
  if (typeof THREE === 'undefined') {
    document.getElementById('three-container').innerHTML =
      '<p style="color:#888;padding:20px;text-align:center">3D preview unavailable<br>(Three.js failed to load)</p>';
    return;
  }

  const container = document.getElementById('three-container');

  // Renderer — canvas fills container via CSS; buffer is sized in onThreeResize.
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x1a1a1a);
  // Make the canvas fill its container without Three.js fighting CSS.
  Object.assign(renderer.domElement.style, {
    display: 'block', width: '100%', height: '100%'
  });
  container.appendChild(renderer.domElement);

  // Size the internal buffer now (may be 0 if layout isn't done yet — rAF fixes it).
  const W = container.clientWidth  || 600;
  const H = container.clientHeight || 400;
  renderer.setSize(W, H, false); // false = don't override the CSS style we set above

  scene = new THREE.Scene();

  // Camera — positioned to give a clear 3/4 view of the shim
  threeCamera = new THREE.PerspectiveCamera(45, W / H, 0.1, 2000);
  threeCamera.position.set(120, 80, 220);
  threeCamera.lookAt(0, 0, 0);

  // Lighting (kept for any future lit materials)
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));

  // Post-face reference plane at x≈0 (the Y/Z plane the shim mounts against)
  const refGeom = new THREE.PlaneGeometry(60, 200); // 60mm wide (Z) × 200mm tall (Y)
  const refMat  = new THREE.MeshBasicMaterial({
    color: 0x888888, transparent: true, opacity: 0.2, side: THREE.DoubleSide
  });
  const refMesh = new THREE.Mesh(refGeom, refMat);
  refMesh.rotation.y = Math.PI / 2; // rotate from X/Y plane to Y/Z plane
  scene.add(refMesh);

  // Grid lines on reference plane
  const refEdges = new THREE.EdgesGeometry(refGeom);
  const refLines = new THREE.LineSegments(
    refEdges,
    new THREE.LineBasicMaterial({ color: 0x555555 })
  );
  refLines.rotation.y = Math.PI / 2;
  scene.add(refLines);

  // Orbit controls
  controls = new THREE.OrbitControls(threeCamera, renderer.domElement);
  controls.enableDamping  = true;
  controls.dampingFactor  = 0.08;
  controls.target.set(0, 0, 0);

  new ResizeObserver(() => onThreeResize()).observe(container);

  // Belt-and-suspenders: fire resize on next two frames to handle timing edge cases.
  requestAnimationFrame(() => { onThreeResize(); requestAnimationFrame(onThreeResize); });

  animate();
}

// Builds a flat-shaded BufferGeometry for the shim from explicit triangle list.
function buildShimBufferGeometry(shimGeom) {
  const { front: F, back: B } = shimGeom;

  // 12 triangles with CCW winding for correct outward normals (verified analytically)
  const tris = [
    [F[0], F[1], F[2]],  // front ×2
    [F[0], F[2], F[3]],
    [B[1], B[0], B[3]],  // back ×2
    [B[1], B[3], B[2]],
    [F[0], B[0], B[1]],  // top ×2
    [F[0], B[1], F[1]],
    [F[1], B[2], F[2]],  // right ×2
    [F[1], B[1], B[2]],
    [F[2], B[2], B[3]],  // bottom ×2
    [F[2], B[3], F[3]],
    [F[3], B[0], F[0]],  // left ×2
    [F[3], B[3], B[0]],
  ];

  // Per-face RGB colours simulating light from upper-front.
  // Two triangles per face → same colour repeated.
  //                  R       G       B
  const FACE_RGB = [
    [0.478, 0.722, 1.000],  // front  (brightest — faces viewer)
    [0.478, 0.722, 1.000],
    [0.082, 0.176, 0.353],  // back   (darkest — faces post)
    [0.082, 0.176, 0.353],
    [0.361, 0.627, 0.941],  // top
    [0.361, 0.627, 0.941],
    [0.239, 0.490, 0.831],  // right
    [0.239, 0.490, 0.831],
    [0.133, 0.345, 0.659],  // bottom
    [0.133, 0.345, 0.659],
    [0.188, 0.439, 0.753],  // left
    [0.188, 0.439, 0.753],
  ];

  const pos = new Float32Array(tris.length * 9);
  const col = new Float32Array(tris.length * 9);

  tris.forEach(([v1, v2, v3], i) => {
    const b = i * 9;
    const [r, g, bc] = FACE_RGB[i];
    pos[b]   = v1.x; pos[b+1] = v1.y; pos[b+2] = v1.z;
    pos[b+3] = v2.x; pos[b+4] = v2.y; pos[b+5] = v2.z;
    pos[b+6] = v3.x; pos[b+7] = v3.y; pos[b+8] = v3.z;
    for (let v = 0; v < 3; v++) {
      col[b + v*3]     = r;
      col[b + v*3 + 1] = g;
      col[b + v*3 + 2] = bc;
    }
  });

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('color',    new THREE.BufferAttribute(col, 3));
  return geom;
}

function updateShimMesh() {
  if (!scene) return;
  if (shimGroup) {
    scene.remove(shimGroup);
    shimGroup.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
    shimGroup = null;
  }

  const geom = computeShimGeometry(state.rollDeg, state.yawDeg);
  if (!geom) return;

  shimGroup = new THREE.Group();

  const bufGeom = buildShimBufferGeometry(geom);

  shimGroup.add(new THREE.Mesh(bufGeom, new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.FrontSide
  })));

  scene.add(shimGroup);
}

function onThreeResize() {
  if (!renderer) return;
  const container = document.getElementById('three-container');
  const W = container.clientWidth;
  const H = container.clientHeight;
  if (!W || !H) return;
  renderer.setSize(W, H, false); // don't override the 100%/100% CSS style
  threeCamera.aspect = W / H;
  threeCamera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, threeCamera);
}

// ─────────────────────────────────────────────
// FILE UPLOAD
// ─────────────────────────────────────────────

function onFileChange(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img   = new Image();
    img.onload  = () => { state.photo = img; render2D(); };
    img.src     = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ─────────────────────────────────────────────
// ANGLE CONTROLS
// ─────────────────────────────────────────────

let shimTimer = null;

// Rebuild the 3D mesh 1 second after the last angle change.
function scheduleShimUpdate() {
  if (shimTimer) clearTimeout(shimTimer);
  shimTimer = setTimeout(() => { shimTimer = null; updateShimMesh(); }, 200);
}

function onRollChange(delta) {
  state.rollDeg = clamp(state.rollDeg + delta, -MAX_ANGLE, MAX_ANGLE);
  rollValueEl.textContent = fmt(state.rollDeg);
  render2D();
  scheduleShimUpdate();
}

function onYawChange(delta) {
  state.yawDeg = clamp(state.yawDeg + delta, -MAX_ANGLE, MAX_ANGLE);
  yawValueEl.textContent = fmt(state.yawDeg);
  render2D();
  scheduleShimUpdate();
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function fmt(deg)          { return deg.toFixed(1) + '°'; }

// ─────────────────────────────────────────────
// RESIZE
// ─────────────────────────────────────────────

function onResize() {
  resizeCanvas();
  render2D();
  onThreeResize();
}
