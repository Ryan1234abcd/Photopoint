// Physical dimensions of the corrected plane (mm)
const PLANE_HALF_Z  = 12.5;  // half-width in Z axis (25 mm total)
const PLANE_HALF_Y  = 75;    // half-height in Y axis (150 mm total)
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

  initThree();
  resizeCanvas();
  render2D();
  updateShimMesh();

  window.addEventListener('resize', onResize);
}

// ─────────────────────────────────────────────
// 2D CANVAS
// ─────────────────────────────────────────────

function resizeCanvas() {
  const section = document.getElementById('canvas2d-section');
  canvas2d.width  = Math.floor(section.clientWidth);
  canvas2d.height = Math.floor(section.clientHeight);
}

function render2D() {
  const W = canvas2d.width;
  const H = canvas2d.height;

  ctx2d.clearRect(0, 0, W, H);
  ctx2d.fillStyle = '#1a1a1a';
  ctx2d.fillRect(0, 0, W, H);

  if (state.photo) {
    ctx2d.drawImage(state.photo, 0, 0, W, H);
  } else {
    ctx2d.fillStyle = '#666';
    ctx2d.font = '15px system-ui, sans-serif';
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillText('Upload a photo to begin', W / 2, H / 2);
    ctx2d.textAlign = 'start';
    ctx2d.textBaseline = 'alphabetic';
  }

  drawOutline(W, H);
}

function drawOutline(W, H) {
  const rollRad  = state.rollDeg * Math.PI / 180;
  // 60° of yaw maps to full canvas width; provides ~W/12 px shift per degree
  const yawPx    = state.yawDeg * W / 60;

  ctx2d.save();

  // Canvas transforms are applied in reverse order to drawn shapes.
  // Net result: shape is rotated around (0, H/2), then translated by yawPx.
  ctx2d.translate(yawPx, 0);        // 2) yaw: shift outline along x
  ctx2d.translate(0, H / 2);        // pivot to canvas left-centre
  ctx2d.rotate(rollRad);            // 1) roll: rotate around (0, H/2)
  ctx2d.translate(0, -H / 2);

  // Corrected-frame outline
  ctx2d.strokeStyle = '#00e676';
  ctx2d.lineWidth   = 2;
  ctx2d.strokeRect(0, 0, W, H);

  // Corner tick marks for easier alignment
  const tick = Math.min(W, H) * 0.045;
  ctx2d.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx2d.lineWidth   = 1.5;
  for (const [cx, cy] of [[0, 0], [W, 0], [W, H], [0, H]]) {
    const sx = cx === 0 ? 1 : -1;
    const sy = cy === 0 ? 1 : -1;
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
  const container = document.getElementById('three-container');
  const W = container.clientWidth  || 400;
  const H = container.clientHeight || 400;

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(W, H);
  renderer.setClearColor(0x1a1a1a);
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();

  // Camera — positioned to give a clear 3/4 view of the shim
  threeCamera = new THREE.PerspectiveCamera(45, W / H, 0.1, 2000);
  threeCamera.position.set(120, 80, 220);
  threeCamera.lookAt(0, 0, 0);

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const light1 = new THREE.DirectionalLight(0xffffff, 0.9);
  light1.position.set(200, 150, 100);
  scene.add(light1);
  const light2 = new THREE.DirectionalLight(0xffffff, 0.35);
  light2.position.set(-100, -80, 200);
  scene.add(light2);

  // Axes: X=red (camera direction), Y=green (vertical), Z=blue (platen width)
  scene.add(new THREE.AxesHelper(70));

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

  const pos = new Float32Array(tris.length * 9);
  const nor = new Float32Array(tris.length * 9);

  tris.forEach(([v1, v2, v3], i) => {
    const n = computeTriangleNormal(v1, v2, v3);
    const b = i * 9;
    pos[b]   = v1.x; pos[b+1] = v1.y; pos[b+2] = v1.z;
    pos[b+3] = v2.x; pos[b+4] = v2.y; pos[b+5] = v2.z;
    pos[b+6] = v3.x; pos[b+7] = v3.y; pos[b+8] = v3.z;
    nor[b]   = n.x;  nor[b+1] = n.y;  nor[b+2] = n.z;
    nor[b+3] = n.x;  nor[b+4] = n.y;  nor[b+5] = n.z;
    nor[b+6] = n.x;  nor[b+7] = n.y;  nor[b+8] = n.z;
  });

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('normal',   new THREE.BufferAttribute(nor, 3));
  return geom;
}

function updateShimMesh() {
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

  // Solid mesh
  shimGroup.add(new THREE.Mesh(bufGeom, new THREE.MeshPhongMaterial({
    color:    0x3b82f6,
    specular: 0x7fb3f5,
    shininess: 50,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide
  })));

  // Wireframe edges
  shimGroup.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(bufGeom),
    new THREE.LineBasicMaterial({ color: 0x93c5fd })
  ));

  scene.add(shimGroup);
}

function onThreeResize() {
  const container = document.getElementById('three-container');
  const W = container.clientWidth;
  const H = container.clientHeight;
  if (!W || !H) return;
  renderer.setSize(W, H);
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

function onRollChange(delta) {
  state.rollDeg = clamp(state.rollDeg + delta, -MAX_ANGLE, MAX_ANGLE);
  rollValueEl.textContent = fmt(state.rollDeg);
  render2D();
  updateShimMesh();
}

function onYawChange(delta) {
  state.yawDeg = clamp(state.yawDeg + delta, -MAX_ANGLE, MAX_ANGLE);
  yawValueEl.textContent = fmt(state.yawDeg);
  render2D();
  updateShimMesh();
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
