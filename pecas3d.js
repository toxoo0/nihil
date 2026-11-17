// Peças 3D da nihil: forma gerada da foto, tecido simulado, cabide, linha e texturas.
// Usado pela vitrine da home (vitrine.js) e pela tela de jogo (selecao.js).
//
// Cada peça vem de modelos-3d/pecas/pecas.json. Por padrão ela é gerada da foto de frente
// (malha inflada + simulação de tecido). Para usar um modelo do Blender, acrescente na peça:
//   "model": "pecas/nome.glb"      (caminho relativo a modelos-3d/)
//   "modelScale": 1                (opcional; sem ele o modelo é escalado pela largura da foto)
// O modelo deve olhar para +Z (frente do Blender, -Y, exportada em glTF) com Y para cima.
import * as THREE from 'three';
import Delaunator from 'delaunator';

export const MANIFEST = 'modelos-3d/pecas/pecas.json';
export const BASE = 'modelos-3d/';

// Medidas reais por tipo (metros). Peito = axila a axila com a peça deitada.
export const KINDS = {
  camiseta:      { label: 'Camiseta boxy', chest: 0.56, hanger: 0.17, neck: 0.085, depth: 0.017 },
  camisa:        { label: 'Camisa',      chest: 0.58, hanger: 0.18, neck: 0.08,  depth: 0.016 },
  'baby-tee':    { label: 'Baby tee',    chest: 0.38, hanger: 0.12, neck: 0.065, depth: 0.011 },
  'manga-longa': { label: 'Manga longa', chest: 0.60, hanger: 0.18, neck: 0.075, depth: 0.024 },
  // Acessórios: pendem de uma linha amarrada na arara (line = comprimento da linha).
  // Nos acessórios, "chest" é a largura real da peça na foto. rigid = sem tecido (round: borda arredondada, bend: raio da curva).
  touca:         { label: 'Touca', chest: 0.25, hanger: 0.05, depth: 0.012, memory: 0.08, line: 0.3, slope: 0.004, taper: 0.03, istep: 0.012, acc: true },
  // Calças: "chest" é a largura do cós; começam mostrando o verso (startBack).
  calca:         { label: 'Calça', chest: 0.46, hanger: 0.2, neck: 0.08, depth: 0.02, slope: 0, startBack: true, clips: true },
  bone:          { label: 'Cap',   chest: 0.26, depth: 0.03, round: 0.05, bend: 0.22, line: 0.3, istep: 0.01, rigid: true, acc: true },
};

export const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

export const RAIL_Y = 1.6, RAIL_R = 0.0125;
export const COLLAR_Y = -0.094;
const SLOPE = 0.03;
export const FIXED = 1 / 60;
const ITER = 10;
const WIND = reduce ? 0 : 0.07;
const MEMORY = 0.025;
const INERTIA = reduce ? 0 : 0.3;   // quanto do tranco do trilho o tecido sente
const ROCK = reduce ? 0 : 0.5;      // quanto o cabide balança no gancho
const SPRING = 38, DAMP = 10.5;     // deslize no trilho
// A frente é o único lado com detalhe real: a peça nunca gira mais que ~26° e a câmera fica sempre na frente.
export const YAW_MAX = 0.46;

// Nitidez das texturas: o renderer de cada página informa o máximo do aparelho.
let maxAniso = 1;
export function setAnisotropy(n) { maxAniso = n; }

// ── Materiais e utilidades ──────────────────────────
export const steel = new THREE.MeshStandardMaterial({ color: 0xcfccc6, metalness: 1, roughness: 0.3, envMapIntensity: 1 });
export const smooth = (t) => t * t * (3 - 2 * t);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Malha de jérsei repetível, usada como relevo.
const WEAVE = (() => {
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d');
  const img = x.createImageData(s, s);
  for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
    const rib = 0.5 + 0.5 * Math.sin((i / s) * Math.PI * 2 * 16);
    const row = 0.5 + 0.5 * Math.sin((j / s) * Math.PI * 2 * 24 + rib * 1.6);
    const v = 110 + rib * 70 + row * 40 + (Math.random() - 0.5) * 50;
    const k = (j * s + i) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = v; img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();

export function fabricMaterial(map, W, H) {
  const bump = WEAVE.clone();
  bump.repeat.set(W * 34, H * 34);
  bump.needsUpdate = true;
  return new THREE.MeshPhysicalMaterial({
    map,
    roughness: 0.9, metalness: 0, bumpMap: bump, bumpScale: 1.2,
    sheen: 0.15, sheenRoughness: 0.75, sheenColor: new THREE.Color(0xffffff),
    envMapIntensity: 0.25,
  });
}


// ── Cabide e linha ──────────────────────────────────
const hookGeo = (() => {
  const R = RAIL_R + 0.0034;
  const pts = [new THREE.Vector3(0, -0.072, 0), new THREE.Vector3(0, -0.05, 0.0015), new THREE.Vector3(0, -0.03, 0.009)];
  for (let a = -40; a <= 215; a += 15) {
    const t = (a * Math.PI) / 180;
    pts.push(new THREE.Vector3(0, R * Math.sin(t), R * Math.cos(t)));
  }
  pts.push(new THREE.Vector3(0, -0.019, -0.0125));
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 90, 0.0027, 10, false);
})();
const hookTip = new THREE.SphereGeometry(0.0027, 10, 8);
const neckLen = -0.072 - (COLLAR_Y - 0.006);
const neckGeo = new THREE.CylinderGeometry(0.0027, 0.0027, neckLen, 10);
const clipGeo = new THREE.BoxGeometry(0.024, 0.032, 0.014);
export const clipMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, metalness: 0.8, roughness: 0.4 });
export const RING_TILT = 0.22, RING_OPACITY = 0.35;
// Cordão dos acessórios: ~9 mm, para ter pelo menos um pixel e meio de largura no cenário pixelado
// (mais fino que isso ele some aos pedaços). Cinza-escuro, um pouco mais claro que preto, para ler no azul.
export const THREAD_R = 0.0045;
export const thread = new THREE.MeshStandardMaterial({ color: 0x2b2924, roughness: 0.9, metalness: 0 });
const knotGeo = new THREE.TorusGeometry(RAIL_R + THREAD_R, THREAD_R * 1.15, 8, 24);

// ── Forma: contorno da foto, suavizado e preenchido com triângulos regulares ──
// A malha termina exatamente no contorno: a silhueta é geometria de verdade, não um recorte de transparência.
const PX = 0.0025;     // resolução do raster, metros por pixel
const BSTEP = 0.008;   // espaçamento dos pontos no contorno
const ISTEP = 0.02;    // espaçamento dos pontos dentro da peça

function chamfer(sh, src) {
  const { cw, ch } = sh;
  const g = new Float32Array(cw * ch);
  for (let k = 0; k < g.length; k++) g[k] = src(k) ? 0 : 1e6;
  const r = (k, u, w) => { if (g[u] + w < g[k]) g[k] = g[u] + w; };
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const k = y * cw + x;
    if (x > 0) r(k, k - 1, 1);
    if (y > 0) { r(k, k - cw, 1); if (x > 0) r(k, k - cw - 1, 1.414); if (x < cw - 1) r(k, k - cw + 1, 1.414); }
  }
  for (let y = ch - 1; y >= 0; y--) for (let x = cw - 1; x >= 0; x--) {
    const k = y * cw + x;
    if (x < cw - 1) r(k, k + 1, 1);
    if (y < ch - 1) { r(k, k + cw, 1); if (x < cw - 1) r(k, k + cw + 1, 1.414); if (x > 0) r(k, k + cw - 1, 1.414); }
  }
  return g;
}

// Contorno externo de um raster binário (vizinhança de Moore).
function traceOutline(fab, w, h) {
  let sx = -1, sy = -1;
  outer: for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (fab[y * w + x]) { sx = x; sy = y; break outer; }
  if (sx < 0) return [];
  const D = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && fab[y * w + x] === 1;
  const out = [[sx, sy]];
  let cx = sx, cy = sy, start = 6;
  for (let guard = 0; guard < w * h; guard++) {
    let moved = false;
    for (let k = 0; k < 8; k++) {
      const d = (start + k) % 8;
      const nx = cx + D[d][0], ny = cy + D[d][1];
      if (at(nx, ny)) { cx = nx; cy = ny; start = (d + 6) % 8; moved = true; break; }
    }
    if (!moved || (cx === sx && cy === sy)) break;
    out.push([cx, cy]);
  }
  return out;
}

export function buildShape(img, W, istep = ISTEP) {
  const H = (W * img.naturalHeight) / img.naturalWidth;
  const cw = Math.round(W / PX), ch = Math.round(H / PX);
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, cw, ch);
  const ad = cx.getImageData(0, 0, cw, ch).data;
  const fab = new Uint8Array(cw * ch);
  for (let k = 0; k < cw * ch; k++) fab[k] = ad[k * 4 + 3] >= 128 ? 1 : 0;
  const sh = { W, H, cw, ch, ad, fab };
  const toX = (px) => (px / cw - 0.5) * W, toY = (py) => -(py / ch) * H;
  const pxOf = (x) => clamp(Math.round((x / W + 0.5) * cw), 0, cw - 1);
  const pyOf = (y) => clamp(Math.round((-y / H) * ch), 0, ch - 1);
  sh.at = (x, y) => fab[pyOf(y) * cw + pxOf(x)] === 1;
  sh.k = (x, y) => pyOf(y) * cw + pxOf(x);

  // Contorno: traça, suaviza em ~2 cm, reamostra por igual.
  const raw = traceOutline(fab, cw, ch);
  const n = raw.length, R = 4;
  const sm = [];
  for (let i = 0; i < n; i++) {
    let ax = 0, ay = 0, aw = 0;
    for (let d = -R; d <= R; d++) {
      const p = raw[(i + d + n) % n], w = R + 1 - Math.abs(d);
      ax += p[0] * w; ay += p[1] * w; aw += w;
    }
    sm.push([toX(ax / aw + 0.5), toY(ay / aw + 0.5)]);
  }
  const pts = [sm[0].slice()];
  let carry = 0;
  for (let i = 0; i < n; i++) {
    const a = sm[i], b = sm[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let s = BSTEP - carry;
    while (s <= L) { const t = s / L; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); s += BSTEP; }
    carry = L - (s - BSTEP);
  }
  const f0 = pts[0], fl = pts[pts.length - 1];
  if (Math.hypot(f0[0] - fl[0], f0[1] - fl[1]) < BSTEP * 0.5) pts.pop();
  sh.nb = pts.length;

  // Interior: grade intercalada, afastada do contorno.
  const dIn = chamfer(sh, (k) => fab[k] === 0);
  const minD = (0.6 * istep) / PX, rowH = istep * 0.866;
  for (let r = 0, y = -rowH * 0.5; y > -H; y -= rowH, r++) {
    for (let x = -W / 2 + (r % 2 ? istep / 2 : 0); x < W / 2; x += istep) {
      const k = sh.k(x, y);
      if (fab[k] && dIn[k] >= minD) pts.push([x, y]);
    }
  }
  const N = (sh.N = pts.length);
  const coords = new Float64Array(N * 2);
  pts.forEach((p, i) => { coords[i * 2] = p[0]; coords[i * 2 + 1] = p[1]; });
  const T = new Delaunator(coords).triangles;
  const tris = [];
  const maxE = istep * 2.6;
  for (let t = 0; t < T.length; t += 3) {
    let a = T[t], b = T[t + 1], c = T[t + 2];
    const [ax, ay] = pts[a], [bx, by] = pts[b], [qx, qy] = pts[c];
    if (Math.max(Math.hypot(ax - bx, ay - by), Math.hypot(bx - qx, by - qy), Math.hypot(qx - ax, qy - ay)) > maxE) continue;
    if (!sh.at((ax + bx + qx) / 3, (ay + by + qy) / 3)) continue;
    const area = (bx - ax) * (qy - ay) - (qx - ax) * (by - ay);
    if (Math.abs(area) < 1e-9) continue;
    if (area < 0) { const s = b; b = c; c = s; }
    tris.push(a, b, c);
  }
  sh.tris = Uint16Array.from(tris);
  sh.trisBack = new Uint16Array(tris.length);
  for (let t = 0; t < tris.length; t += 3) { sh.trisBack[t] = tris[t]; sh.trisBack[t + 1] = tris[t + 2]; sh.trisBack[t + 2] = tris[t + 1]; }

  sh.rest = new Float32Array(N * 3);
  sh.uv = new Float32Array(N * 2);
  pts.forEach(([x, y], i) => {
    sh.rest[i * 3] = x; sh.rest[i * 3 + 1] = y;
    sh.uv[i * 2] = x / W + 0.5; sh.uv[i * 2 + 1] = 1 + y / H;
  });
  sh.used = new Uint8Array(N);
  for (const v of tris) sh.used[v] = 1;

  const topRow = new Int32Array(cw).fill(-1);
  for (let x = 0; x < cw; x++) for (let y = 0; y < ch; y++) if (fab[y * cw + x]) { topRow[x] = y; break; }
  sh.topRow = topRow;
  sh.topYAt = (x) => { const tr = topRow[pxOf(x)]; return tr < 0 ? NaN : -(tr / ch) * H; };
  let collar = -Infinity;
  for (let x = -0.035; x <= 0.035; x += PX) { const t = sh.topYAt(x); if (!isNaN(t)) collar = Math.max(collar, t); }
  sh.collar = isFinite(collar) ? collar : 0;
  return sh;
}

// Esticamento em cada aresta da malha, mais um par de dobra através de cada aresta interna.
function shapeConstraints(sh, squeeze) {
  const { tris, rest } = sh;
  const edges = new Map();
  for (let t = 0; t < tris.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = tris[t + e], b = tris[t + ((e + 1) % 3)], c = tris[t + ((e + 2) % 3)];
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      const rec = edges.get(key);
      if (rec) rec[3] = c; else edges.set(key, [Math.min(a, b), Math.max(a, b), c, -1]);
    }
  }
  const ca = [], cb = [], cr = [], ck = [];
  const add = (a, b, k) => {
    const f = squeeze(a, b);
    ca.push(a); cb.push(b);
    cr.push(Math.hypot((rest[a * 3] - rest[b * 3]) * f, rest[a * 3 + 1] - rest[b * 3 + 1]));
    ck.push(k);
  };
  for (const [a, b, c, d] of edges.values()) {
    add(a, b, 1);
    if (d >= 0) add(c, d, 0.9);
  }
  return { ca: Uint16Array.from(ca), cb: Uint16Array.from(cb), cr: Float32Array.from(cr), ck: Float32Array.from(ck) };
}

function solve(pos, inv, A, B, R, K) {
  for (let c = 0, n = A.length; c < n; c++) {
    const ia = A[c], ib = B[c];
    const wa = inv[ia], wb = inv[ib], ws = wa + wb;
    if (ws === 0) continue;
    const a = ia * 3, b = ib * 3;
    const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (L < 1e-9) continue;
    const s = (K[c] * (L - R[c])) / (L * ws);
    pos[a] += dx * s * wa; pos[a + 1] += dy * s * wa; pos[a + 2] += dz * s * wa;
    pos[b] -= dx * s * wb; pos[b + 1] -= dy * s * wb; pos[b + 2] -= dz * s * wb;
  }
}

function clothMesh(sh, index, mat, parent, uv = sh.uv) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sh.N * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = true;
  m.frustumCulled = false;
  m.matrixAutoUpdate = false;
  parent.add(m);
  return m;
}

// ── Cabide: desliza no trilho, balança no gancho, gira um pouco para a câmera ──
// Tudo é calculado no espaço do próprio cabide; o deslize só move o grupo inteiro.
export class Hanger {
  constructor(piece, index) {
    this.piece = piece;
    this.index = index;
    this.kind = KINDS[piece.kind];
    this.W = (piece.chest ?? this.kind.chest) / piece.chestFrac;
    // Peça com foto de trás ("back" no pecas.json): gira inteira e mostra o verso de verdade.
    this.twoSided = !!piece.back;
    this.startBack = this.twoSided && !!(piece.startBack ?? this.kind.startBack);

    this.rig = new THREE.Group();
    this.swing = new THREE.Group();
    this.yawG = new THREE.Group();
    this.rig.add(this.swing);
    this.swing.add(this.yawG);
    this.rig.position.y = RAIL_Y;
    this.rig.visible = false;
    // Topo da peça, abaixo do trilho: a gola nas roupas, a ponta da linha nos acessórios.
    this.top = this.kind.line ? -this.kind.line : COLLAR_Y;
    if (this.kind.line) {
      // Acessório: só uma linha amarrada na arara.
      const line = new THREE.Mesh(new THREE.CylinderGeometry(THREAD_R, THREAD_R, this.kind.line, 10), thread);
      line.position.y = -this.kind.line / 2;
      const knot = new THREE.Mesh(knotGeo, thread);
      knot.rotation.y = Math.PI / 2;
      this.swing.add(line, knot);
    } else {
      const hook = new THREE.Mesh(hookGeo, steel);
      hook.castShadow = true;
      this.swing.add(hook);
      const tip = new THREE.Mesh(hookTip, steel);
      tip.position.set(0, -0.019, -0.0125);
      this.swing.add(tip);
      const neck = new THREE.Mesh(neckGeo, steel);
      neck.position.y = -0.072 - neckLen / 2;
      neck.castShadow = true;
      this.yawG.add(neck);
    }
    // Meia largura do cabide: nas calças, acompanha o cós de cada peça.
    this.hw = this.kind.clips ? (piece.chest ?? this.kind.chest) / 2 - 0.012 : this.kind.hanger;
    if (this.kind.clips) {
      // Cabide de calça: barrinha com duas presilhas segurando as pontas do cós.
      const hw = this.hw;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 2 * hw + 0.05, 12), steel);
      bar.rotation.z = Math.PI / 2;
      bar.position.y = COLLAR_Y + 0.006;
      bar.castShadow = true;
      this.yawG.add(bar);
      for (const sx of [-1, 1]) {
        const clip = new THREE.Mesh(clipGeo, clipMat);
        clip.position.set(sx * (hw - 0.015), COLLAR_Y - 0.006, 0);
        clip.castShadow = true;
        this.yawG.add(clip);
      }
    }
    this.drop = 0.8;   // do trilho até a barra da peça; cada tipo calcula o seu

    this.M = new THREE.Matrix4();
    this.x = this.vx = this.tx = this.ax = 0;
    this.th = this.thv = 0;
    this.yaw = this.yawv = this.tyaw = 0;
    this.state = 'off';
    this.shownAt = 0;
  }

  show(x, yaw) {
    this.rig.visible = true;
    this.x = this.tx = x; this.vx = 0; this.ax = 0;
    this.th = this.thv = 0;
    this.yaw = this.tyaw = yaw; this.yawv = 0;
    this.applyRig();
    this.place();
  }

  hide() {
    this.rig.visible = false;
    this.state = 'off';
  }

  applyRig() {
    this.rig.position.x = this.x;
    this.swing.rotation.z = this.th;
    this.yawG.rotation.y = this.yaw;
    this.swing.updateMatrix();
    this.yawG.updateMatrix();
    this.M.multiplyMatrices(this.swing.matrix, this.yawG.matrix);
  }

  dynamics(dt) {
    const ax = SPRING * (this.tx - this.x) - DAMP * this.vx;
    this.vx += ax * dt;
    this.x += this.vx * dt;
    this.ax = ax;
    const L = this.kind.line ? this.kind.line + 0.1 : 0.36;
    const drive = clamp(ax, -6, 6) * ROCK;
    this.thv += (-(9.81 / L) * Math.sin(this.th) - 2.6 * this.thv - (drive * Math.cos(this.th)) / L) * dt;
    this.th += this.thv * dt;
    const ay = 30 * (this.tyaw - this.yaw) - 7 * this.yawv;
    this.yawv += ay * dt;
    this.yaw = this.twoSided ? this.yaw + this.yawv * dt : clamp(this.yaw + this.yawv * dt, -YAW_MAX, YAW_MAX);
    this.applyRig();
  }

  // Círculo em perspectiva em volta da peça: mostra que ela tem dois lados e, arrastado, gira a peça.
  // O ponto marca para onde a frente está virada.
  addRing(R) {
    const g = (this.ring = new THREE.Group());
    g.position.y = -this.drop * 0.55;
    g.rotation.x = RING_TILT;
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: RING_OPACITY, depthWrite: false });
    const line = new THREE.Mesh(new THREE.TorusGeometry(R, 0.0024, 6, 160), this.ringMat);
    line.rotation.x = Math.PI / 2;
    this.knob = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.ringPick = new THREE.Mesh(new THREE.TorusGeometry(R, 0.06, 6, 48), new THREE.MeshBasicMaterial({ visible: false }));
    this.ringPick.rotation.x = Math.PI / 2;
    this.ringR = R;
    g.add(line, this.knob, this.ringPick);
    this.rig.add(g);
  }

  updateRing() {
    if (!this.ring) return;
    this.knob.position.set(Math.sin(this.yaw) * this.ringR, 0, Math.cos(this.yaw) * this.ringR);
  }

  place() {}
  simulate() {}
  updateMesh() {}
}

// ── Peça gerada da foto: tecido firme pendurado pelos ombros ──
export class ClothGarment extends Hanger {
  constructor(piece, index, img, tex, backTex, backImg) {
    super(piece, index);
    const kind = this.kind, W = this.W;
    const sh = buildShape(img, W, kind.istep);
    const { N, rest, H, cw, fab } = sh;
    this.sh = sh; this.N = N;
    const hw = this.hw;

    // Calças: a foto nem sempre tem o cós no meio (pernas abertas). Acha o cós (o topo da silhueta)
    // e centraliza a peça nele, para o cabide ficar no meio e as duas presilhas pegarem as pontas.
    let ox = 0, collar = sh.collar;
    if (kind.clips) {
      let minRow = Infinity;
      for (let x = 0; x < cw; x++) if (sh.topRow[x] >= 0) minRow = Math.min(minRow, sh.topRow[x]);
      const tol = Math.round(0.05 / PX);
      let c0 = cw, c1 = -1;
      for (let x = 0; x < cw; x++) if (sh.topRow[x] >= 0 && sh.topRow[x] <= minRow + tol) { c0 = Math.min(c0, x); c1 = Math.max(c1, x); }
      ox = ((c0 + c1) / 2 / cw - 0.5) * W;
      collar = -(minRow / sh.ch) * H;
    }

    const top = this.top, slope = kind.slope ?? SLOPE, taper = kind.taper ?? 0.09;
    const shift = top - collar;
    for (let v = 0; v < N; v++) rest[v * 3 + 1] += shift;
    const topY = (x) => sh.topYAt(x) + shift;

    // Cabide: segura os pontos do contorno ao longo dos ombros que ele cobre, caindo até as pontas.
    const pins = [];
    for (let v = 0; v < sh.nb; v++) {
      const x = rest[v * 3], y = rest[v * 3 + 1];
      if (Math.abs(x - ox) <= hw && y >= topY(x) - (kind.clips ? 0.03 : 0.007)) pins.push(v);
    }
    this.pins = Uint16Array.from(pins);
    this.pinLocal = new Float32Array(pins.length * 3);
    pins.forEach((p, k) => {
      const x = rest[p * 3] - ox;
      this.pinLocal[k * 3] = x;
      // Presilhas seguram o cós reto, na altura da barra; cabide de camiseta cai até as pontas.
      this.pinLocal[k * 3 + 1] = kind.clips ? top : rest[p * 3 + 1] - slope * (x / hw) ** 2;
    });

    // Volume: a distância até o contorno define a espessura. Na região do cabide a linha dos ombros
    // não conta como borda; fora dela, conta. As duas se misturam em ~12 cm para não marcar um vinco
    // no ombro (visível nas peças largas, de ombro caído).
    const BLEND = 0.12;
    const spanPx = (x) => Math.abs((x / cw - 0.5) * W - ox) <= hw + BLEND;
    const dSpan = chamfer(sh, (k) => {
      if (fab[k]) return false;
      const x = k % cw, y = (k / cw) | 0;
      return !(spanPx(x) && sh.topRow[x] >= 0 && y < sh.topRow[x]);
    });
    const dFull = chamfer(sh, (k) => fab[k] === 0);
    const thick = (this.thick = new Float32Array(N));
    for (let v = 0; v < N; v++) {
      const x = rest[v * 3], y = rest[v * 3 + 1];
      const w = 1 - smooth(clamp((Math.abs(x - ox) - hw) / BLEND, 0, 1));
      const s = smooth(clamp((topY(x) - y) / taper, 0, 1));
      if (v < sh.nb) { thick[v] = y >= topY(x) - 0.012 ? 0.0025 * w : 0; continue; }
      const k = sh.k(x, y - shift);
      const sd = (Math.min(dFull[k], 1e4) * (1 - w) + Math.min(dSpan[k], 1e4) * w) * PX;
      const t = kind.depth * (1 - Math.exp(-sd / 0.05));
      thick[v] = t + (0.0025 + (t - 0.0025) * s - t) * w;
    }

    const squeeze = (a, b) => 1 - 0.015 * smooth(clamp((top - (rest[a * 3 + 1] + rest[b * 3 + 1]) / 2) / H, 0, 1));
    const c = shapeConstraints(sh, squeeze);
    this.ca = c.ca; this.cb = c.cb; this.cr = c.cr; this.ck = c.ck;

    const inv = (this.inv = new Float32Array(N));
    for (let v = 0; v < N; v++) inv[v] = sh.used[v] ? 1 : 0;
    for (const p of pins) inv[p] = 0;

    // Amarras: nenhum ponto se afasta mais que 3% do pino mais próximo (o tecido não estica no tranco).
    const len = (a, b) => Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1]);
    const tv = [], tp = [], tl = [];
    for (let v = 0; v < N; v++) {
      if (!inv[v]) continue;
      let best = -1, bd = 1e9;
      for (const p of pins) { const dd = len(v, p); if (dd < bd) { bd = dd; best = p; } }
      if (best >= 0) { tv.push(v); tp.push(best); tl.push(bd * 1.03); }
    }
    this.tv = Uint16Array.from(tv); this.tp = Uint16Array.from(tp); this.tl = Float32Array.from(tl);
    if (ox) for (let v = 0; v < N; v++) rest[v * 3] -= ox;
    this.rest = rest;
    this.memory = piece.memory ?? kind.memory ?? MEMORY;
    let minY = 0;
    for (let v = 0; v < N; v++) if (sh.used[v]) minY = Math.min(minY, rest[v * 3 + 1]);
    this.drop = -minY;
    this.slab = 0.05;

    this.pos = new Float32Array(N * 3);
    this.prev = new Float32Array(N * 3);
    this.nrm = new Float32Array(N * 3);
    this.front = clothMesh(sh, sh.tris, fabricMaterial(tex, W, H), this.rig);
    // Peça de dois lados: o verso recebe a foto de trás, encaixada no contorno da frente.
    const backUV = this.twoSided && backImg ? mapBackUV(sh, img, backImg) : sh.uv;
    this.back = clothMesh(sh, sh.trisBack, fabricMaterial(backTex, W, H), this.rig, backUV);
    if (this.twoSided) this.addRing(W / 2 + 0.07);
  }

  place() {
    const { N, rest, pos } = this;
    const e = this.M.elements;
    for (let v = 0; v < N; v++) {
      const o = v * 3;
      const lx = rest[o], ly = rest[o + 1];
      const depth = clamp((this.top - ly) / 0.5, 0, 1);
      const lz = (Math.sin(lx * 52 + this.index * 2.1) * 0.002 + Math.sin(lx * 23 - this.index) * 0.0015) * depth;
      pos[o] = e[0] * lx + e[4] * ly + e[8] * lz;
      pos[o + 1] = e[1] * lx + e[5] * ly + e[9] * lz;
      pos[o + 2] = e[2] * lx + e[6] * ly + e[10] * lz;
    }
    this.prev.set(pos);
    for (let s = 0; s < 30; s++) this.simulate(FIXED, s * FIXED, 0.9);
    this.updateMesh();
  }

  simulate(dt, t, damp = 0.992) {
    const { pos, prev, inv, N } = this;
    const dt2 = dt * dt;
    const ph = this.index * 1.7;
    const push = -clamp(this.ax, -8, 8) * INERTIA;
    const wx = WIND * (Math.sin(t * 0.7 + ph) * 0.6 + Math.sin(t * 1.9 + ph * 0.6) * 0.4);
    const wz = WIND * 0.5 * Math.sin(t * 1.13 + ph * 1.3);
    for (let v = 0; v < N; v++) {
      if (inv[v] === 0) continue;
      const o = v * 3;
      const x = pos[o], y = pos[o + 1], z = pos[o + 2];
      const rip = 1 + 0.25 * Math.sin(y * 9 - t * 2.3 + z * 5);
      pos[o] += (x - prev[o]) * damp + (wx * rip + push) * dt2;
      pos[o + 1] += (y - prev[o + 1]) * damp - 9.81 * dt2;
      pos[o + 2] += (z - prev[o + 2]) * damp + wz * rip * dt2;
      prev[o] = x; prev[o + 1] = y; prev[o + 2] = z;
    }
    const e = this.M.elements;
    const pl = this.pinLocal, pins = this.pins;
    for (let k = 0; k < pins.length; k++) {
      const o = pins[k] * 3, lx = pl[k * 3], ly = pl[k * 3 + 1];
      pos[o] = e[0] * lx + e[4] * ly;
      pos[o + 1] = e[1] * lx + e[5] * ly;
      pos[o + 2] = e[2] * lx + e[6] * ly;
    }
    for (let it = 0; it < ITER; it++) solve(pos, inv, this.ca, this.cb, this.cr, this.ck);
    // Memória de forma: puxa de leve de volta às proporções da foto, carregadas pelo cabide.
    const rest = this.rest, mem = this.memory;
    for (let v = 0; v < N; v++) {
      if (inv[v] === 0) continue;
      const o = v * 3, lx = rest[o], ly = rest[o + 1];
      pos[o] += (e[0] * lx + e[4] * ly - pos[o]) * mem;
      pos[o + 1] += (e[1] * lx + e[5] * ly - pos[o + 1]) * mem;
      pos[o + 2] += (e[2] * lx + e[6] * ly - pos[o + 2]) * mem;
    }
    const TV = this.tv, TP = this.tp, TL = this.tl;
    for (let k = 0; k < TV.length; k++) {
      const v = TV[k] * 3, q = TP[k] * 3;
      const dx = pos[v] - pos[q], dy = pos[v + 1] - pos[q + 1], dz = pos[v + 2] - pos[q + 2];
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L > TL[k]) {
        const s = TL[k] / L;
        pos[v] = pos[q] + dx * s; pos[v + 1] = pos[q + 1] + dy * s; pos[v + 2] = pos[q + 2] + dz * s;
      }
    }
    // Mantém o tecido numa faixa fina em volta do plano do cabide.
    const nxw = Math.sin(this.yaw), nzw = Math.cos(this.yaw);
    const tilt = Math.sin(this.th), lim = this.slab;
    for (let v = 0; v < N; v++) {
      if (inv[v] === 0) continue;
      const o = v * 3;
      const dd = (pos[o] + pos[o + 1] * tilt) * nxw + pos[o + 2] * nzw;
      const over = dd > lim ? dd - lim : dd < -lim ? dd + lim : 0;
      if (over !== 0) { pos[o] -= nxw * over * 0.7; pos[o + 2] -= nzw * over * 0.7; }
    }
  }

  updateMesh() {
    const { N, pos, thick, nrm } = this;
    const T = this.sh.tris;
    nrm.fill(0);
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      nrm[a] += nx; nrm[a + 1] += ny; nrm[a + 2] += nz;
      nrm[b] += nx; nrm[b + 1] += ny; nrm[b + 2] += nz;
      nrm[c] += nx; nrm[c + 1] += ny; nrm[c + 2] += nz;
    }
    const F = this.front.geometry.attributes.position.array;
    const Bk = this.back.geometry.attributes.position.array;
    for (let v = 0; v < N; v++) {
      const o = v * 3;
      const l = Math.hypot(nrm[o], nrm[o + 1], nrm[o + 2]) || 1;
      const s = thick[v] / l;
      const ox = nrm[o] * s, oy = nrm[o + 1] * s, oz = nrm[o + 2] * s;
      F[o] = pos[o] + ox; F[o + 1] = pos[o + 1] + oy; F[o + 2] = pos[o + 2] + oz;
      Bk[o] = pos[o] - ox; Bk[o + 1] = pos[o + 1] - oy; Bk[o + 2] = pos[o + 2] - oz;
    }
    for (const m of [this.front, this.back]) {
      m.geometry.attributes.position.needsUpdate = true;
      m.geometry.computeVertexNormals();
    }
  }
}

// ── Verso de peças com foto de trás ──
// Cada fileira da frente é ligada à fileira na mesma altura relativa da foto de trás, espelhada
// (de costas, a esquerda vira direita) e esticada entre as bordas externas da silhueta.
function rowExtents(img, w = 512) {
  const h = Math.round((w * img.naturalHeight) / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const L = new Float32Array(h).fill(-1), R = new Float32Array(h).fill(-1);
  // G1/G2: bordas internas das pernas (fim da esquerda, começo da direita) onde elas já se separam
  const G1 = new Float32Array(h).fill(-1), G2 = new Float32Array(h).fill(-1);
  const minGap = Math.round(w * 0.03);
  let top = -1, bot = -1;
  for (let y = 0; y < h; y++) {
    let run = 0, best = 0, bestEnd = -1;
    for (let i = 0; i < w; i++) {
      if (d[(y * w + i) * 4 + 3] > 128) {
        if (L[y] < 0) L[y] = i;
        else if (run > best) { best = run; bestEnd = i; }
        R[y] = i; run = 0;
      } else if (L[y] >= 0) run++;
    }
    if (best >= minGap) { G1[y] = bestEnd - best - 1; G2[y] = bestEnd; }
    if (L[y] >= 0) { if (top < 0) top = y; bot = y; }
  }
  // fileiras vazias herdam a vizinha; depois suaviza ~1% da altura para a borda não tremer
  for (let y = top + 1; y <= bot; y++) if (L[y] < 0) { L[y] = L[y - 1]; R[y] = R[y - 1]; }
  const S = Math.max(2, Math.round(h * 0.01));
  const sm = (A, gap) => {
    const o = new Float32Array(h).fill(-1);
    for (let y = top; y <= bot; y++) {
      if (gap && A[y] < 0) continue;
      let a = 0, n = 0;
      for (let k = Math.max(top, y - S); k <= Math.min(bot, y + S); k++) if (A[k] >= 0) { a += A[k]; n++; }
      o[y] = a / n;
    }
    return o;
  };
  return { w, h, top, bot, L: sm(L), R: sm(R), G1: sm(G1, true), G2: sm(G2, true) };
}

function mapBackUV(sh, frontImg, backImg) {
  const F = rowExtents(frontImg), B = rowExtents(backImg);
  const uv = new Float32Array(sh.N * 2);
  const span = (x, a, b) => clamp((x - a) / Math.max(1, b - a), 0, 1);
  for (let v = 0; v < sh.N; v++) {
    const u = sh.uv[v * 2], tv = sh.uv[v * 2 + 1];
    const rf = clamp(Math.round((1 - tv) * F.h), F.top, F.bot);
    const t = (rf - F.top) / Math.max(1, F.bot - F.top);
    const rb = clamp(Math.round(B.top + t * (B.bot - B.top)), B.top, B.bot);
    const xf = u * F.w;
    let xb;
    if (F.G1[rf] >= 0 && B.G1[rb] >= 0 && (xf <= F.G1[rf] || xf >= F.G2[rf])) {
      // Pernas separadas nas duas fotos: cada perna da frente vai para a mesma perna vista de costas.
      if (xf <= F.G1[rf]) xb = B.R[rb] - span(xf, F.L[rf], F.G1[rf]) * (B.R[rb] - B.G2[rb]);
      else xb = B.G1[rb] - span(xf, F.G2[rf], F.R[rf]) * (B.G1[rb] - B.L[rb]);
    } else {
      xb = B.R[rb] - span(xf, F.L[rf], F.R[rf]) * (B.R[rb] - B.L[rb]);
    }
    uv[v * 2] = (xb + 0.5) / B.w;
    uv[v * 2 + 1] = 1 - (rb + 0.5) / B.h;
  }
  return uv;
}

// Foto sobre a própria cor média: onde o encaixe tocar a borda transparente, aparece essa cor.
export function bleedTexture(img) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const probe = document.createElement('canvas');
  probe.width = 24; probe.height = Math.max(2, Math.round((24 * h) / w));
  const px = probe.getContext('2d', { willReadFrequently: true });
  px.drawImage(img, 0, 0, probe.width, probe.height);
  const pd = px.getImageData(0, 0, probe.width, probe.height).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let k = 0; k < pd.length; k += 4) if (pd[k + 3] > 200) { r += pd[k]; g += pd[k + 1]; b += pd[k + 2]; n++; }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = n ? `rgb(${(r / n) | 0},${(g / n) | 0},${(b / n) | 0})` : '#888';
  x.fillRect(0, 0, w, h);
  x.drawImage(img, 0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
}

// ── Peça rígida da foto (boné): sem simulação de tecido, então sem dobras ──
// Volume com borda arredondada e uma leve curva de copa; balança e gira inteira na linha.
export class ReliefGarment extends Hanger {
  constructor(piece, index, img, tex, backTex) {
    super(piece, index);
    const kind = this.kind, W = this.W;
    const sh = buildShape(img, W, kind.istep);
    const { N, rest, H, cw, fab } = sh;

    // A linha prende no ponto mais alto da silhueta (o topo da copa), não no meio da foto.
    let minRow = Infinity;
    for (let x = 0; x < cw; x++) if (sh.topRow[x] >= 0) minRow = Math.min(minRow, sh.topRow[x]);
    let sx = 0, n = 0;
    for (let x = 0; x < cw; x++) if (sh.topRow[x] >= 0 && sh.topRow[x] <= minRow + 3) { sx += x; n++; }
    const ax = (sx / n / cw - 0.5) * W, ay = -(minRow / sh.ch) * H;

    const dIn = chamfer(sh, (k) => fab[k] === 0);
    const R = kind.round, bend = kind.bend;
    const F = new Float32Array(N * 3), B = new Float32Array(N * 3);
    for (let v = 0; v < N; v++) {
      const o = v * 3;
      const x0 = rest[o], y0 = rest[o + 1];
      const sd = v < sh.nb ? 0 : Math.min(dIn[sh.k(x0, y0)], 1e4) * PX;
      const e = 1 - Math.min(sd / R, 1);
      const t = kind.depth * Math.sqrt(1 - e * e);
      const x = x0 - ax, y = y0 - ay + this.top;
      const z = -(x0 * x0) / (2 * bend);
      F[o] = x; F[o + 1] = y; F[o + 2] = z + t;
      B[o] = x; B[o + 1] = y; B[o + 2] = z - t * 0.6;
    }
    const mesh = (pos, index, map) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(sh.uv, 2));
      g.setIndex(new THREE.BufferAttribute(index, 1));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, fabricMaterial(map, W, H));
      m.castShadow = m.receiveShadow = true;
      this.yawG.add(m);
      return m;
    };
    this.front = mesh(F, sh.tris, tex);
    this.back = mesh(B, sh.trisBack, backTex);
    let minY = 0;
    for (let v = 0; v < N; v++) if (sh.used[v]) minY = Math.min(minY, F[v * 3 + 1]);
    this.drop = -minY;
  }
}

// ── Peça vinda de um .glb (Blender): rígida, mas balança e gira no mesmo cabide ──
export class ModelGarment extends Hanger {
  constructor(piece, index, model) {
    super(piece, index);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    model.scale.multiplyScalar(piece.modelScale ?? this.W / (size.x || 1));
    model.updateMatrixWorld(true);
    box.setFromObject(model);
    const c = box.getCenter(new THREE.Vector3());
    model.position.x -= c.x;
    model.position.z -= c.z;
    model.position.y += this.top - box.max.y;
    this.drop = -(box.min.y + this.top - box.max.y);
    model.traverse((m) => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
    this.yawG.add(model);
  }
}

// ── Texturas ────────────────────────────────────────
export const loadImg = (src) => new Promise((res, rej) => {
  const im = new Image();
  im.onload = () => res(im);
  im.onerror = () => rej(new Error(src));
  im.src = src;
});

export function frontTexture(img) {
  const t = new THREE.Texture(img);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  t.needsUpdate = true;
  return t;
}

// Costas: a própria foto bem borrada, nunca mostrada de frente.
export function backTexture(img) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const probe = document.createElement('canvas');
  probe.width = 24; probe.height = Math.max(2, Math.round((24 * h) / w));
  const px = probe.getContext('2d', { willReadFrequently: true });
  px.drawImage(img, 0, 0, probe.width, probe.height);
  const pd = px.getImageData(0, 0, probe.width, probe.height).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let k = 0; k < pd.length; k += 4) if (pd[k + 3] > 200) { r += pd[k]; g += pd[k + 1]; b += pd[k + 2]; n++; }
  const mean = n ? `rgb(${(r / n) | 0},${(g / n) | 0},${(b / n) | 0})` : '#888';
  const small = document.createElement('canvas');
  small.width = 14; small.height = Math.max(2, Math.round((14 * h) / w));
  const sx = small.getContext('2d');
  sx.fillStyle = mean; sx.fillRect(0, 0, small.width, small.height);
  sx.drawImage(img, 0, 0, small.width, small.height);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  x.drawImage(small, 0, 0, w, h);
  x.fillStyle = 'rgba(20,18,16,0.12)';
  x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(img, 0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export async function loadModels(pieces) {
  const want = pieces.filter((p) => p.model);
  if (!want.length) return {};
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const out = {};
  await Promise.all(want.map(async (p) => {
    try { out[p.key] = (await loader.loadAsync(BASE + p.model)).scene; }
    catch (e) { console.warn(`Modelo de "${p.name}" não carregou; usando a foto.`, e); }
  }));
  return out;
}
