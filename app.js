// Physical dimensions of the corrected plane (mm)
const PLANE_HALF_Z  = 15;    // half-width in Z axis (30 mm total)
const PLANE_HALF_Y  = 61;    // half-height in Y axis (122 mm total)
const MIN_THICKNESS = 2;     // minimum shim thickness perpendicular to face (mm)
const MAX_ANGLE     = 10;    // maximum roll/yaw correction (degrees)

// Debossed recess on the front face
const DEBOSS_HALF_Z = 12;    // half-width of recess (24 mm total)
const DEBOSS_HALF_Y = 58.5;  // half-height of recess (117 mm total)
const DEBOSS_DEPTH  = 2;     // depth of recess perpendicular to front face (mm)

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

  const pivotX = px + pw;   // right edge — attachment side for right-hand mount
  const pivotY = py + ph / 2;

  ctx2d.save();
  ctx2d.translate(-yawPx, 0);            // negate: right-side mount inverts yaw direction
  ctx2d.translate(pivotX, pivotY);
  ctx2d.rotate(-rollRad);                // negate: right-side mount inverts roll direction
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

// Rotation around X axis
function rotX(v, phi) {
  const c = Math.cos(phi), s = Math.sin(phi);
  return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
}

// ─────────────────────────────────────────────
// SHIM GEOMETRY
// ─────────────────────────────────────────────

// Outer corrected-plane vertices on the X/Y plane (z=0), centred at origin.
// Shim mounts on the right-hand side of the frame; platen face points +Z toward post.
// V0=top-front  V1=top-back  V2=bottom-back  V3=bottom-front
const BASE_VERTS = [
  vec3( PLANE_HALF_Z,  PLANE_HALF_Y, 0),
  vec3(-PLANE_HALF_Z,  PLANE_HALF_Y, 0),
  vec3(-PLANE_HALF_Z, -PLANE_HALF_Y, 0),
  vec3( PLANE_HALF_Z, -PLANE_HALF_Y, 0)
];

// Inner boundary of the debossed recess (same plane, smaller extent)
const INNER_BASE_VERTS = [
  vec3( DEBOSS_HALF_Z,  DEBOSS_HALF_Y, 0),
  vec3(-DEBOSS_HALF_Z,  DEBOSS_HALF_Y, 0),
  vec3(-DEBOSS_HALF_Z, -DEBOSS_HALF_Y, 0),
  vec3( DEBOSS_HALF_Z, -DEBOSS_HALF_Y, 0)
];

function computeCorrectedVertices(rollDeg, yawDeg) {
  const theta = yawDeg  * Math.PI / 180;
  const phi   = rollDeg * Math.PI / 180;
  // Negate both angles: right-side mount inverts the sense of both corrections.
  // +roll → thicker at bottom; +yaw → thicker at front (camera-forward side).
  const xf    = v => rotX(rotY(v, -theta), -phi);
  return {
    outer: BASE_VERTS.map(xf),
    inner: INNER_BASE_VERTS.map(xf)
  };
}

// Returns { front, inner, deboss, back, normal } or null if geometry is degenerate.
function computeShimGeometry(rollDeg, yawDeg) {
  const { outer: front, inner } = computeCorrectedVertices(rollDeg, yawDeg);

  // Unit normal of the corrected plane; must point toward the post (+Z)
  let n = normalize(cross(sub(front[1], front[0]), sub(front[3], front[0])));
  if (n.z < 0) n = vec3(-n.x, -n.y, -n.z);

  // Guard: degenerate if the plane faces nearly edge-on
  if (n.z < 0.01) return null;

  // Deboss floor: inner boundary shifted DEBOSS_DEPTH mm behind the front face
  const deboss = inner.map(v => addScaled(v, n, -DEBOSS_DEPTH));

  // Base-plane z-position guaranteeing minimum perpendicular thickness = MIN_THICKNESS.
  const minZ = Math.min(...front.map(v => v.z));
  const c    = minZ - MIN_THICKNESS * n.z;

  // Project each outer front vertex onto the base plane along the inward normal
  const back = front.map(v => {
    const t = (c - v.z) / n.z;
    return addScaled(v, n, t);
  });

  return { front, inner, deboss, back, normal: n };
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
  const { front: V, inner: I, deboss: D, back: B } = shimGeom;

  // 80-byte header + 4-byte count + 28 triangles × 50 bytes = 1484 bytes
  const buf = new ArrayBuffer(1484);
  const dv  = new DataView(buf);

  const header = 'Photopoint Shim Generator';
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));

  dv.setUint32(80, 28, true);

  let off = 84;

  // Front ring (outer frame strip, normal ≈ +n̂)
  off = writeTriangle(dv, off, V[0], V[1], I[1]);
  off = writeTriangle(dv, off, V[0], I[1], I[0]);
  off = writeTriangle(dv, off, V[1], V[2], I[2]);
  off = writeTriangle(dv, off, V[1], I[2], I[1]);
  off = writeTriangle(dv, off, V[2], V[3], I[3]);
  off = writeTriangle(dv, off, V[2], I[3], I[2]);
  off = writeTriangle(dv, off, V[3], V[0], I[0]);
  off = writeTriangle(dv, off, V[3], I[0], I[3]);

  // Step walls (recess sides; top/right/bottom/left)
  off = writeTriangle(dv, off, I[0], D[1], I[1]);  // top  (+Y)
  off = writeTriangle(dv, off, I[0], D[0], D[1]);
  off = writeTriangle(dv, off, I[1], D[2], I[2]);  // right (+Z)
  off = writeTriangle(dv, off, I[1], D[1], D[2]);
  off = writeTriangle(dv, off, I[2], D[3], I[3]);  // bottom (−Y)
  off = writeTriangle(dv, off, I[2], D[2], D[3]);
  off = writeTriangle(dv, off, I[3], D[0], I[0]);  // left  (−Z)
  off = writeTriangle(dv, off, I[3], D[3], D[0]);

  // Deboss floor (normal ≈ +n̂, faces into recess)
  off = writeTriangle(dv, off, D[0], D[1], D[2]);
  off = writeTriangle(dv, off, D[0], D[2], D[3]);

  // Back face (normal ≈ −X, faces post)
  off = writeTriangle(dv, off, B[1], B[0], B[3]);
  off = writeTriangle(dv, off, B[1], B[3], B[2]);

  // Outer sides (top / right / bottom / left)
  off = writeTriangle(dv, off, V[0], B[0], B[1]);  // top  (+Y)
  off = writeTriangle(dv, off, V[0], B[1], V[1]);
  off = writeTriangle(dv, off, V[1], B[2], V[2]);  // right (+Z)
  off = writeTriangle(dv, off, V[1], B[1], B[2]);
  off = writeTriangle(dv, off, V[2], B[2], B[3]);  // bottom (−Y)
  off = writeTriangle(dv, off, V[2], B[3], V[3]);
  off = writeTriangle(dv, off, V[3], B[0], V[0]);  // left  (−Z)
  off = writeTriangle(dv, off, V[3], B[3], B[0]);

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

  // Camera — 3/4 view from front-right-top to show face and side of shim
  threeCamera = new THREE.PerspectiveCamera(45, W / H, 0.1, 2000);
  threeCamera.position.set(80, 80, 220);
  threeCamera.lookAt(0, 0, 0);

  // Lighting (kept for any future lit materials)
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));

  // Post-face reference plane on the X/Y plane (z=0) — shim mounts against this face
  const refGeom = new THREE.PlaneGeometry(40, 130); // 40mm wide (X) × 130mm tall (Y)
  const refMat  = new THREE.MeshBasicMaterial({
    color: 0x888888, transparent: true, opacity: 0.2, side: THREE.DoubleSide
  });
  scene.add(new THREE.Mesh(refGeom, refMat));

  // Grid lines on reference plane
  scene.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(refGeom),
    new THREE.LineBasicMaterial({ color: 0x555555 })
  ));

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
  const { front: V, inner: I, deboss: D, back: B } = shimGeom;

  // 28 triangles with CCW winding for correct outward normals (verified analytically)
  const tris = [
    // Front ring (outer frame, normal ≈ +n̂)
    [V[0], V[1], I[1]],  [V[0], I[1], I[0]],  // top strip
    [V[1], V[2], I[2]],  [V[1], I[2], I[1]],  // right strip
    [V[2], V[3], I[3]],  [V[2], I[3], I[2]],  // bottom strip
    [V[3], V[0], I[0]],  [V[3], I[0], I[3]],  // left strip
    // Step walls (recess sides)
    [I[0], D[1], I[1]],  [I[0], D[0], D[1]],  // top  (+Y)
    [I[1], D[2], I[2]],  [I[1], D[1], D[2]],  // right (+Z)
    [I[2], D[3], I[3]],  [I[2], D[2], D[3]],  // bottom (−Y)
    [I[3], D[0], I[0]],  [I[3], D[3], D[0]],  // left  (−Z)
    // Deboss floor
    [D[0], D[1], D[2]],  [D[0], D[2], D[3]],
    // Back face
    [B[1], B[0], B[3]],  [B[1], B[3], B[2]],
    // Outer sides
    [V[0], B[0], B[1]],  [V[0], B[1], V[1]],  // top  (+Y)
    [V[1], B[2], V[2]],  [V[1], B[1], B[2]],  // right (+Z)
    [V[2], B[2], B[3]],  [V[2], B[3], V[3]],  // bottom (−Y)
    [V[3], B[0], V[0]],  [V[3], B[3], B[0]],  // left  (−Z)
  ];

  // Per-face RGB colours (two triangles per face → colour repeated)
  //                  R       G       B
  const FACE_RGB = [
    [0.478, 0.722, 1.000],  // front ring top strip
    [0.478, 0.722, 1.000],
    [0.478, 0.722, 1.000],  // front ring right strip
    [0.478, 0.722, 1.000],
    [0.478, 0.722, 1.000],  // front ring bottom strip
    [0.478, 0.722, 1.000],
    [0.478, 0.722, 1.000],  // front ring left strip
    [0.478, 0.722, 1.000],
    [0.361, 0.627, 0.941],  // step top  (+Y)
    [0.361, 0.627, 0.941],
    [0.239, 0.490, 0.831],  // step right (+Z)
    [0.239, 0.490, 0.831],
    [0.133, 0.345, 0.659],  // step bottom (−Y)
    [0.133, 0.345, 0.659],
    [0.188, 0.439, 0.753],  // step left  (−Z)
    [0.188, 0.439, 0.753],
    [0.420, 0.690, 0.980],  // deboss floor (recessed, lighter than ring)
    [0.420, 0.690, 0.980],
    [0.082, 0.176, 0.353],  // back face (darkest)
    [0.082, 0.176, 0.353],
    [0.361, 0.627, 0.941],  // outer top  (+Y)
    [0.361, 0.627, 0.941],
    [0.239, 0.490, 0.831],  // outer right (+Z)
    [0.239, 0.490, 0.831],
    [0.133, 0.345, 0.659],  // outer bottom (−Y)
    [0.133, 0.345, 0.659],
    [0.188, 0.439, 0.753],  // outer left  (−Z)
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
