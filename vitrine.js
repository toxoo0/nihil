// Vitrine da home: todas as peças em grade (fileiras e colunas), cada uma em 3D. O cabide e a linha
// existem (a peça balança e se move igual à tela de jogo), mas ficam invisíveis: só a roupa aparece.
// Passar o cursor aproxima a peça; nas peças de dois lados, uma barra frente/verso gira a peça.
//
// Um único canvas fixo cobre a tela; cada peça é desenhada no retângulo do seu espaço na grade
// (viewport + scissor), então a grade é HTML normal e rola como qualquer página.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  MANIFEST, BASE, KINDS, RAIL_Y, FIXED, reduce, setAnisotropy,
  ClothGarment, ReliefGarment, ModelGarment, steel, thread, clipMat,
  loadImg, loadModels, frontTexture, backTexture, bleedTexture, clamp, smooth,
} from './pecas3d.js';

const grid = document.getElementById('vitrine');
const tiposEl = document.getElementById('tipos');
const statusEl = document.getElementById('vitrine-status');
const canvas = document.getElementById('vitrine-stage');
const coarse = matchMedia('(pointer: coarse)').matches;

const TOP_INSET = 16;       // px do topo do espaço até o topo da peça (gola, cós ou copa)
const PAD_X = 0.08;         // folga dos lados, em fração da largura do espaço
const PAD_B = 0.11;         // folga embaixo (a peça cresce para baixo com o cursor)
const MAX_UP = 1.45;        // peças pequenas (boné, touca) crescem no máximo isso além da escala típica
// Camisetas boxy e camisas aparecem com o mesmo peito na tela; as baby tees, um pouco menores.
const SHIRTS = new Set(['camiseta', 'camisa']);
const BABY = 0.8;           // peito da baby tee na tela em relação ao das boxy/camisa (na real ~0,7)
const ZOOM = 1.14;          // quanto a peça cresce com o cursor em cima
const TURN_S = 2.6;         // segundos para a peça de dois lados virar de lado (sem pressa)
const SPILL_X = 0.12, SPILL_B = 0.16;   // a peça pode passar um pouco do espaço (ao crescer, e a sombra)

// ── Renderer e cena (uma peça visível por vez) ──────
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) {
  canvas.hidden = true;   // sem 3D: as fotos continuam na grade
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 40);
const garments = [];
const cells = [];
let PIECES = [], assets = {}, models = {};
let focused = -1;
let archiveEl = null;   // divisão "Archive" entre as peças à venda e o mostruário
let tipo = '';          // tipo de peça mostrado ('' = todas)

// Nomes curtos dos tipos na lista da lateral, na ordem em que aparecem.
const TIPOS = [
  ['camiseta', 'Camiseta'], ['baby-tee', 'Baby tee'], ['camisa', 'Camisa'], ['manga-longa', 'Manga longa'],
  ['calca', 'Calça'], ['touca', 'Touca'], ['bone', 'Cap'],
];
let sRef = 300;   // escala típica (px por metro), para limitar o tamanho das peças pequenas

if (renderer) {
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.toneMappingExposure = 0.8;
  renderer.autoClear = false;
  setAnisotropy(renderer.capabilities.getMaxAnisotropy());

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  // Estúdio claro: a mesma luz da tela de jogo, com a sombra caindo perto, num fundo branco.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe4ded3, 0.75));
  const key = new THREE.SpotLight(0xfff6ea, 32, 0, 0.5, 0.9, 2);
  key.position.set(-1.25, RAIL_Y + 1.5, 2.7);
  key.target.position.set(0.05, RAIL_Y - 0.45, -0.4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 4;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.camera.near = 1.5;
  key.shadow.camera.far = 7;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xf0f3ff, 0.6);
  fill.position.set(2.5, 1.8, 1.5);
  scene.add(fill);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.ShadowMaterial({ color: 0x1d1a16, opacity: 0.13 }));
  wall.position.set(0, RAIL_Y - 1, -0.16);
  wall.receiveShadow = true;
  scene.add(wall);
}

// ── Grade ───────────────────────────────────────────
function buildGrid() {
  grid.innerHTML = '';
  // Peças à venda primeiro; o resto vira archive (mostruário, esgotado). Só existe divisão quando
  // alguma peça está marcada como disponível no pecas.json ("disponivel": true).
  const temVenda = PIECES.some((p) => p.disponivel);
  archiveEl = null;
  PIECES.forEach((p, i) => {
    const kind = KINDS[p.kind];
    const esgotada = temVenda && !p.disponivel;
    if (esgotada && !archiveEl) {
      archiveEl = document.createElement('li');
      archiveEl.className = 'archive';
      archiveEl.innerHTML = '<h2>Archive</h2>';
      grid.append(archiveEl);
    }
    const li = document.createElement('li');
    li.className = esgotada ? 'peca esgotada' : 'peca';
    li.dataset.tipo = p.kind;
    const stage = document.createElement('div');
    stage.className = 'peca-palco';
    // A foto fica no lugar até a peça 3D ficar pronta (e para sempre, se o 3D não abrir).
    const im = document.createElement('img');
    im.className = 'peca-foto';
    im.src = BASE + (p.back && (p.startBack ?? kind.startBack) ? p.back : p.file);
    im.alt = p.name;
    im.decoding = 'async';
    stage.append(im);
    // Peça de dois lados: barra frente/verso. O pino mostra para onde a peça está virada; arrastar gira.
    let giro = null;
    if (p.back) {
      giro = document.createElement('div');
      giro.className = 'giro';
      giro.tabIndex = 0;
      giro.setAttribute('role', 'slider');
      giro.setAttribute('aria-label', `Girar ${p.name}`);
      giro.setAttribute('aria-valuemin', '0');
      giro.setAttribute('aria-valuemax', '180');
      giro.innerHTML = '<span class="giro-rot">frente</span><span class="giro-barra"><span class="giro-pino"></span></span><span class="giro-rot">verso</span>';
      stage.append(giro);
    }
    const info = document.createElement('div');
    info.className = 'peca-info';
    const name = document.createElement('h2');
    name.className = 'peca-nome';
    name.textContent = p.name;
    const meta = document.createElement('p');
    meta.className = 'peca-meta';
    meta.textContent = `${kind.label} · ${p.edition === 'serie' ? 'Série' : '1of1'} · ${p.sizes || 'Único'}`;
    let buy;
    if (!esgotada && p.loja) {
      buy = document.createElement('a');
      buy.href = p.loja;
      buy.target = '_blank';
      buy.rel = 'noopener';
      buy.textContent = 'Comprar';
      buy.setAttribute('aria-label', `Comprar ${p.name}`);
    } else {
      buy = document.createElement('span');
      buy.textContent = esgotada ? 'Esgotado' : 'Comprar';
    }
    buy.className = esgotada ? 'peca-comprar' : 'peca-comprar disponivel';
    info.append(name, meta, buy);
    li.append(stage, info);
    grid.append(li);

    const cell = { li, stage, giro, zoom: 1, s: 0, vis: false, lastX: null, turn: null, manual: false };
    cells[i] = cell;
    if (giro) bindGiro(i, cell);
    // Cursor em cima: a peça cresce e vira um pouco para o cursor.
    stage.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') setFocus(i); });
    stage.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { setFocus(-1); cell.lastX = null; } });
    stage.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const g = garments[i];
      if (!g) return;
      const r = stage.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width;
      if (!g.twoSided) g.tyaw = (u - 0.5) * 0.7;
      // Passar o cursor de lado empurra o cabide, como esbarrar na roupa.
      if (cell.lastX !== null) g.thv += clamp((e.clientX - cell.lastX) * 0.004, -0.25, 0.25);
      cell.lastX = e.clientX;
    });
    li.addEventListener('focusin', () => setFocus(i));
    li.addEventListener('focusout', () => setFocus(-1));
  });
}

// ── Tipos na lateral: mostra só as peças de um tipo ──
function buildTipos() {
  if (!tiposEl) return;
  const presentes = TIPOS.filter(([k]) => PIECES.some((p) => p.kind === k));
  tiposEl.innerHTML = '';
  for (const [k, nome] of [['', 'All'], ...presentes]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = nome;
    b.dataset.tipo = k;
    b.setAttribute('aria-pressed', String(k === tipo));
    b.addEventListener('click', () => setTipo(k));
    tiposEl.append(b);
  }
}

function setTipo(k) {
  tipo = k;
  setFocus(-1);
  for (const b of tiposEl.children) b.setAttribute('aria-pressed', String(b.dataset.tipo === k));
  cells.forEach((c, i) => { c.li.hidden = !!k && PIECES[i].kind !== k; });
  // A divisão "Archive" só aparece em All; num tipo, "Disponível" e "Esgotado" já separam as peças.
  if (archiveEl) archiveEl.hidden = !!k;
  // A grade encolhe: volta para o começo dela, para não cair no meio do nada.
  const top = grid.getBoundingClientRect().top + scrollY - 130;
  if (scrollY > top) scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
}

// Lado da peça como ângulo: 0 = frente, π = verso. O alvo é o equivalente mais perto de onde ela
// está, para girar pelo caminho curto.
function near(g, a) { return a + 2 * Math.PI * Math.round((g.tyaw - a) / (2 * Math.PI)); }

// Gira devagar até um lado (curva suave), em vez de pular para o alvo.
function turnTo(i, a) {
  const g = garments[i], c = cells[i];
  if (!g) return;
  const to = near(g, a);
  c.turn = { from: g.tyaw, to, t0: performance.now() / 1000, dur: reduce ? 0.01 : TURN_S * Math.abs(to - g.tyaw) / Math.PI };
}

function bindGiro(i, cell) {
  const bar = cell.giro.querySelector('.giro-barra');
  // Posição na barra (0 frente, 1 verso) para ângulo; o pino mostra (1 - cos) / 2, o lado que aparece.
  const setFrom = (clientX) => {
    const g = garments[i];
    if (!g) return;
    const r = bar.getBoundingClientRect();
    const u = clamp((clientX - r.left) / r.width, 0, 1);
    cell.manual = true;
    cell.turn = null;
    g.tyaw = near(g, Math.acos(1 - 2 * u));
  };
  let drag = false;
  cell.giro.addEventListener('pointerdown', (e) => {
    drag = true;
    cell.giro.setPointerCapture(e.pointerId);
    cell.giro.classList.add('arrastando');
    setFrom(e.clientX);
    e.preventDefault();
  });
  cell.giro.addEventListener('pointermove', (e) => { if (drag) setFrom(e.clientX); });
  const end = () => { drag = false; cell.giro.classList.remove('arrastando'); };
  cell.giro.addEventListener('pointerup', end);
  cell.giro.addEventListener('pointercancel', end);
  // Teclado: setas giram aos poucos; Home e End vão para a frente e o verso.
  cell.giro.addEventListener('keydown', (e) => {
    const g = garments[i];
    if (!g || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    cell.manual = true;
    const side = e.key === 'Home' ? 0 : e.key === 'End' ? Math.PI : null;
    const now = Math.acos(clamp(Math.cos(g.tyaw), -1, 1));
    turnTo(i, side ?? clamp(now + (e.key === 'ArrowRight' ? 1 : -1) * Math.PI / 8, 0, Math.PI));
  });
}

function baseYaw(g) { return g.startBack ? Math.PI : 0; }

function setFocus(i) {
  if (i === focused) return;
  const old = garments[focused];
  // Ao sair, a peça volta ao lado inicial (se a pessoa não escolheu um lado pela barra).
  if (old && old.twoSided && !cells[focused].manual) turnTo(focused, baseYaw(old));
  else if (old && !old.twoSided) old.tyaw = 0;
  focused = i;
  // Peça de dois lados (calças) vira devagar e mostra o outro lado enquanto o cursor está em cima.
  const g = garments[i];
  if (g && g.twoSided && !cells[i].manual) turnTo(i, baseYaw(g) + Math.PI);
}

// ── Peças ───────────────────────────────────────────
function createGarment(i) {
  const p = PIECES[i];
  const a = assets[p.key];
  const g = models[p.key] ? new ModelGarment(p, i, models[p.key])
    : KINDS[p.kind].rigid ? new ReliefGarment(p, i, a.img, a.tex, a.back)
    : new ClothGarment(p, i, a.img, a.tex, a.backPhoto || a.back, a.backImg);
  if (g.ring) g.ring.visible = false;
  // Cabide, linha e presilhas continuam lá (a física é a mesma), só não aparecem nem fazem sombra.
  g.rig.traverse((o) => { if (o.isMesh && (o.material === steel || o.material === thread || o.material === clipMat)) o.visible = false; });
  scene.add(g.rig);
  g.show(0, baseYaw(g));
  g.rig.visible = false;
  garments[i] = g;
  cells[i].li.classList.add('pronta');
  fitAll();
}

// Escala de cada peça: cabe no espaço (largura da foto, do topo visível até a barra), sem as
// pequenas ficarem enormes. O topo de todas fica na mesma altura, então a fileira se alinha.
// g.top é o topo da peça abaixo do gancho (a gola; nos acessórios, a ponta da linha).
function fitOf(i, w, h) {
  const g = garments[i];
  const fx = (w * (1 - 2 * PAD_X)) / g.W;
  const fy = (h * (1 - PAD_B) - TOP_INSET) / (g.drop + g.top);
  return Math.min(fx, fy);
}

function fitAll() {
  // Todos os espaços têm o mesmo tamanho: mede um que esteja na tela (os escondidos pelo filtro medem 0).
  const st = cells.find((c) => c && !c.li.hidden)?.stage;
  const r = st && st.getBoundingClientRect();
  if (!r || !r.width) return;
  const chest = (i) => PIECES[i].chest ?? KINDS[PIECES[i].kind].chest;
  const fits = [];
  let C = Infinity;   // peito em px comum às camisetas e camisas: o maior que deixa todas caberem
  garments.forEach((g, i) => {
    if (!g) return;
    const c = cells[i], k = PIECES[i].kind;
    c.fit = fitOf(i, r.width, r.height);
    if (!KINDS[k].acc) fits.push(c.fit);
    if (SHIRTS.has(k)) C = Math.min(C, c.fit * chest(i));
    else if (k === 'baby-tee') C = Math.min(C, (c.fit * chest(i)) / BABY);
  });
  if (fits.length) {
    fits.sort((a, b) => a - b);
    sRef = fits[fits.length >> 1];
  }
  // Camisetas, camisas e baby tees em escala real entre si; calças e acessórios ocupam o espaço.
  garments.forEach((g, i) => {
    if (!g) return;
    const c = cells[i], k = PIECES[i].kind;
    if (Number.isFinite(C) && SHIRTS.has(k)) c.s = C / chest(i);
    else if (Number.isFinite(C) && k === 'baby-tee') c.s = (BABY * C) / chest(i);
    else c.s = Math.min(c.fit, sRef * MAX_UP);
  });
}

// ── Desenho ─────────────────────────────────────────
function resize() {
  if (!renderer) return;
  renderer.setSize(innerWidth, innerHeight, false);
  fitAll();
}
addEventListener('resize', resize);

let last = performance.now() / 1000, acc = 0, simT = 0;
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now() / 1000;
  const dt = Math.min(0.1, now - last);
  last = now;
  if (document.body.dataset.view !== 'home' || document.hidden) return;

  const vh = innerHeight;
  // Só as peças na tela andam e são desenhadas.
  const rects = cells.map((c, i) => {
    if (!garments[i]) return null;
    const r = c.stage.getBoundingClientRect();
    c.vis = r.bottom + r.height * SPILL_B > 0 && r.top < vh;
    return r;
  });

  acc += dt;
  let steps = 0;
  while (acc >= FIXED && steps < 6) {
    simT += FIXED;
    garments.forEach((g, i) => { if (g && cells[i].vis) { g.dynamics(FIXED); g.simulate(FIXED, simT); } });
    acc -= FIXED; steps++;
  }
  if (steps === 6) acc = 0;

  const k = 1 - Math.exp(-dt * (reduce ? 30 : 9));
  // Giros em andamento e o pino da barra (mostra o lado que está aparecendo).
  cells.forEach((c, i) => {
    const g = garments[i];
    if (!g) return;
    if (c.turn) {
      const t = clamp((now - c.turn.t0) / c.turn.dur, 0, 1);
      g.tyaw = c.turn.from + (c.turn.to - c.turn.from) * smooth(t);
      if (t >= 1) c.turn = null;
    }
    if (c.giro && c.vis) {
      const u = (1 - Math.cos(g.yaw)) / 2;
      c.giro.style.setProperty('--u', u.toFixed(4));
      c.giro.setAttribute('aria-valuenow', String(Math.round(u * 180)));
    }
  });
  renderer.setScissorTest(false);
  renderer.clear(true, true, true);
  renderer.setScissorTest(true);
  // A peça em foco por último, por cima das vizinhas quando cresce.
  const order = garments.map((_, i) => i).filter((i) => garments[i] && cells[i].vis);
  order.sort((a, b) => (a === focused) - (b === focused));
  for (const i of order) {
    const g = garments[i], c = cells[i], r = rects[i];
    c.zoom += ((i === focused ? ZOOM : 1) - c.zoom) * k;
    g.updateMesh();
    drawPiece(g, c, r);
  }
  renderer.setScissorTest(false);
}

function drawPiece(g, c, r) {
  // Retângulo de desenho: o espaço da peça, um pouco mais largo e mais baixo (zoom e sombra).
  const x0 = r.left - r.width * SPILL_X, w = r.width * (1 + 2 * SPILL_X);
  const y0 = r.top, h = r.height * (1 + SPILL_B);
  const yGL = innerHeight - (y0 + h);
  renderer.setViewport(x0, yGL, w, h);
  renderer.setScissor(x0, yGL, w, h);

  // Câmera de frente; s = px por metro. O topo da peça cai em TOP_INSET px do topo, em qualquer zoom.
  const s = c.s * c.zoom;
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const dist = h / s / (2 * Math.tan(fov / 2));
  camera.aspect = w / h;
  camera.position.set(0, RAIL_Y + g.top - (h / 2 - TOP_INSET) / s, dist);
  camera.updateProjectionMatrix();

  g.rig.visible = true;
  renderer.render(scene, camera);
  g.rig.visible = false;
}

// ── Início ──────────────────────────────────────────
async function boot() {
  PIECES = (await (await fetch(MANIFEST)).json()).filter((p) => KINDS[p.kind]);
  // Disponíveis primeiro (na ordem do pecas.json), depois o archive.
  PIECES = [...PIECES.filter((p) => p.disponivel), ...PIECES.filter((p) => !p.disponivel)];
  buildGrid();
  buildTipos();
  if (statusEl) statusEl.hidden = true;
  if (!renderer) return;
  resize();

  const [imgs, mdl] = await Promise.all([Promise.all(PIECES.map((p) => loadImg(BASE + p.file))), loadModels(PIECES)]);
  models = mdl;
  PIECES.forEach((p, k) => { assets[p.key] = { img: imgs[k], tex: frontTexture(imgs[k]), back: backTexture(imgs[k]) }; });
  await Promise.all(PIECES.filter((p) => p.back).map(async (p) => {
    const im = await loadImg(BASE + p.back);
    assets[p.key].backImg = im;
    assets[p.key].backPhoto = bleedTexture(im);
  }));
  requestAnimationFrame(loop);

  // Monta as peças aos poucos, primeiro as que estão na tela, para a página não travar.
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 30));
  const next = () => {
    const vh = innerHeight;
    const todo = PIECES.map((_, i) => i).filter((i) => !garments[i]);
    if (!todo.length) return;
    const dist = (i) => { const r = cells[i].stage.getBoundingClientRect(); return r.bottom < 0 ? -r.bottom : r.top > vh ? r.top - vh : 0; };
    todo.sort((a, b) => dist(a) - dist(b) || a - b);
    createGarment(todo[0]);
    idle(next);
  };
  next();
}

boot().catch((e) => {
  console.error(e);
  if (statusEl) { statusEl.hidden = false; statusEl.textContent = 'Não foi possível carregar as peças.'; }
});
