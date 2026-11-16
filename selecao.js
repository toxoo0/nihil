// Tela de seleção das peças nihil (modo arcade): uma peça por vez no centro, entrando e saindo
// pelo trilho como numa tela de escolha de personagem. As peças 3D vêm de pecas3d.js; a foto
// (.webp) continua sendo usada no retrato da fileira.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  MANIFEST, BASE, KINDS, RAIL_Y, RAIL_R, COLLAR_Y, FIXED, RING_OPACITY,
  ClothGarment, ReliefGarment, ModelGarment, setAnisotropy,
  loadImg, loadModels, frontTexture, backTexture, bleedTexture,
  steel, thread, clipMat, smooth, clamp,
} from './pecas3d.js';

const $ = (id) => document.getElementById(id);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

const FPS = 30, FRAME = 1 / FPS - 0.002;   // limite de quadros desenhados
const MAX_STEPS = 12;                       // até 0,2 s de física por quadro
const YAW_IN = 0.42, YAW_OUT = 0.34;
const CAM_DIST = 3.2;
const ATTRACT = 6.5;     // segundos de cada peça no modo automático
const IDLE_AFTER = 14;   // o modo automático volta depois disso sem interação

// ── Renderer e cena ─────────────────────────────────
const DPR = Math.min(devicePixelRatio, coarse ? 1.25 : 1.5);
const canvas = $('stage');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) {
  $('loader').textContent = 'Seu navegador não conseguiu abrir a cena 3D.';
  throw e;
}
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(DPR);
setAnisotropy(renderer.capabilities.getMaxAnisotropy());
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// Tone mapping linear: o ACES lavava os tons pastel das fotos. Exposição baixa para o branco não estourar.
renderer.toneMapping = THREE.LinearToneMapping;
renderer.toneMappingExposure = 0.72;

// ── Pixelado: estética de jogo antigo ───────────────
// Tudo em volta da roupa (fundo, arara, cabide, sombra) é desenhado numa imagem pequena e ampliado
// sem suavizar, com a paleta reduzida, pontilhado e linhas de varredura leves. A roupa é desenhada
// por cima em resolução cheia: a estampa continua nítida e a peça ganha destaque.
// Tecla P liga e desliga; ?pixel=0 abre sem o efeito; ?px=2 (ou 4…) força o tamanho do pixel.
const retro = {
  on: new URLSearchParams(location.search).get('pixel') !== '0',
  pix: 3,
  force: Number(new URLSearchParams(location.search).get('px')) || 0,
  target: new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }),
  scene: new THREE.Scene(),
  cam: new THREE.Camera(),
  depthOnly: new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }),
};
retro.target.texture.minFilter = retro.target.texture.magFilter = THREE.NearestFilter;
retro.uniforms = {
  tScene: { value: retro.target.texture },
  low: { value: new THREE.Vector2(1, 1) },     // resolução da imagem pequena
  screen: { value: new THREE.Vector2(1, 1) },  // tamanho da tela em px CSS
  gxp: { value: 0.5 },                         // centro do brilho do fundo (onde a peça fica)
  levels: { value: 28 },
};
{
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: retro.uniforms,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D tScene;
      uniform vec2 low, screen;
      uniform float gxp, levels;
      varying vec2 vUv;
      // Matriz de Bayer 4×4: o pontilhado ordenado dos jogos antigos.
      float b2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
      float bayer(vec2 a) { return b2(0.5 * a) * 0.25 + b2(a); }
      // O mesmo degradê do fundo do CSS (linear a 112° + brilho em elipse atrás da peça), em sRGB.
      vec3 backdrop(vec2 p) {
        vec2 dir = vec2(0.92718, 0.37461);
        float L = screen.x * dir.x + screen.y * dir.y;
        float t = clamp(dot(p - 0.5 * screen, dir) / L + 0.5, 0.0, 1.0);
        vec3 c = mix(vec3(0.243, 0.643, 0.957), vec3(0.153, 0.400, 0.878), clamp(t / 0.38, 0.0, 1.0));
        c = mix(c, vec3(0.094, 0.220, 0.706), clamp((t - 0.38) / 0.34, 0.0, 1.0));
        c = mix(c, vec3(0.071, 0.161, 0.561), clamp((t - 0.72) / 0.28, 0.0, 1.0));
        vec2 e = (p - vec2(gxp * screen.x, 0.44 * screen.y)) / (vec2(0.48, 0.62) * screen);
        float a = 0.5 * (1.0 - clamp(length(e) / 0.72, 0.0, 1.0));
        return mix(c, vec3(0.518, 0.839, 1.0), a);
      }
      void main() {
        vec2 cell = floor(vUv * low);
        vec2 uv = (cell + 0.5) / low;
        gl_FragColor = texture2D(tScene, uv);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        vec3 bg = backdrop(vec2(uv.x, 1.0 - uv.y) * screen);
        vec3 c = gl_FragColor.rgb + bg * (1.0 - gl_FragColor.a);
        c = clamp(floor(c * levels + bayer(cell)) / levels, 0.0, 1.0);
        // Linha de varredura: escurece de leve a última linha de cada pixel.
        c *= fract(vUv.y * low.y) < 0.3 ? 0.93 : 1.0;
        gl_FragColor = vec4(c, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  }));
  quad.frustumCulled = false;
  retro.scene.add(quad);
}

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
camera.layers.enableAll();

// ── Luz: estúdio claro, sombra da peça no fundo ─────
scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d2c4, 0.7));

const key = new THREE.SpotLight(0xfff3e2, 34, 0, 0.5, 0.9, 2);
key.position.set(-1.25, RAIL_Y + 1.5, 2.7);
key.target.position.set(0.05, RAIL_Y - 0.45, -0.4);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.radius = 3;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
key.shadow.camera.near = 1.5;
key.shadow.camera.far = 7;
scene.add(key, key.target);

const fill = new THREE.DirectionalLight(0xe6ecff, 0.55);
fill.position.set(2.5, 1.8, 1.5);
scene.add(fill);

const backdrop = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 14),
  new THREE.ShadowMaterial({ color: 0x0a1660, opacity: 0.3 })
);
backdrop.position.set(0, RAIL_Y - 1.2, -0.45);
backdrop.receiveShadow = true;
scene.add(backdrop);
// Luzes valem para as duas camadas (0: arara e cenário, 1: a roupa nítida do pixelado).
scene.traverse((o) => { if (o.isLight) o.layers.enableAll(); });

// ── Trilho que atravessa a tela ─────────────────────
// Barra em aço cinza-escuro (os ganchos continuam no aço claro).
const railSteel = new THREE.MeshStandardMaterial({ color: 0x55565b, metalness: 1, roughness: 0.38, envMapIntensity: 0.9 });
const rail = new THREE.Mesh(new THREE.CylinderGeometry(RAIL_R, RAIL_R, 40, 24), railSteel);
rail.rotation.z = Math.PI / 2;
rail.position.y = RAIL_Y;
rail.castShadow = false;
scene.add(rail);



// ── Estado ──────────────────────────────────────────
let PIECES = [];
const garments = [];
let assets = {}, models = {};
let cur = -1;
let lastInput = -Infinity;
let presentAt = 0;
let simT = 0;

function createGarment(i) {
  if (garments[i]) return garments[i];
  const p = PIECES[i];
  const a = assets[p.key];
  const g = models[p.key] ? new ModelGarment(p, i, models[p.key])
    : KINDS[p.kind].rigid ? new ReliefGarment(p, i, a.img, a.tex, a.back)
    : new ClothGarment(p, i, a.img, a.tex, a.backPhoto || a.back, a.backImg);
  garments[i] = g;
  scene.add(g.rig);
  markSharp(g);
  return g;
}

// A roupa (e o círculo de giro) vai para a camada 1, desenhada nítida por cima do pixelado.
// Cabide, linha e presilhas ficam na camada 0, com o resto do cenário.
const HANGER_MATS = new Set([steel, thread, clipMat]);
function markSharp(g) {
  g.sharp = [];
  g.rig.traverse((o) => {
    if (!o.isMesh || HANGER_MATS.has(o.material)) return;
    o.layers.set(1);
    for (const m of [].concat(o.material)) { m.userData.depthWrite = m.depthWrite; g.sharp.push(m); }
  });
}
// Na imagem pequena a roupa não aparece (mas continua fazendo sombra).
function hideSharp(hide) {
  for (const g of garments) {
    if (!g || !g.rig.visible) continue;
    for (const m of g.sharp) { m.colorWrite = !hide; m.depthWrite = !hide && m.userData.depthWrite; }
  }
}

// ── Câmera: sempre de frente; enquadra a peça mais alta, e as menores ficam menores ──
// Na tela larga a peça fica à esquerda (o picker ocupa a direita): a imagem é deslocada
// com setViewOffset, sem girar a câmera, então a peça continua vista de frente.
const view = { Vh: 1.4, lookY: RAIL_Y - 0.5, gx: 0.5, ppm: 600, ppm0: 600, railPx: 100, drop: 0.81 };
const par = new THREE.Vector2(), parT = new THREE.Vector2();
const DROP = 0.81;   // do trilho até a barra da peça mais comprida

// Altura da caixa de informações com o nome mais comprido (duas linhas, se quebrar): a peça
// é enquadrada para nunca ficar embaixo dela, qualquer que seja a peça escolhida.
function cardHeight() {
  const nameEl = $('name'), stats = $('stats'), oldName = nameEl.textContent, oldStats = stats.innerHTML;
  const longest = PIECES.reduce((a, p) => (p.name.length > a.length ? p.name : a), nameEl.textContent);
  nameEl.textContent = longest;
  if (!oldStats) stats.innerHTML = '<div><dt>Tipo</dt><dd>1of1</dd></div><div><dt>Tamanho</dt><dd>P, M, G</dd></div>';
  const hgt = $('info').offsetHeight;
  nameEl.textContent = oldName;
  stats.innerHTML = oldStats;
  return hgt;
}

function resize() {
  const w = innerWidth, h = innerHeight, a = w / h;
  const root = document.documentElement.style;
  const pickLeft = document.querySelector('.picker').getBoundingClientRect().left;
  root.setProperty('--cardmax', `${Math.max(260, pickLeft - 64)}px`);
  const cardH = cardHeight();
  const narrow = a <= 1.25;   // igual ao CSS: (max-aspect-ratio: 5/4) inclui o 5:4
  let railPx, ppm;
  if (narrow) {
    view.gx = 0.5;
    ppm = h / Math.max(1.6, 0.96 / a);
    railPx = Math.max(92, 0.12 * h);
    // A caixa fica embaixo da peça e a grade no rodapé: a peça diminui o que for preciso para não encostar nelas.
    const pickH = document.querySelector('.picker').offsetHeight;
    const room = h - railPx - 14 - Math.max(cardH, 124) - 12 - pickH - 14;
    ppm = Math.max(0.6 * ppm, Math.min(ppm, room / DROP));
  } else if (h < 560) {
    // Larga e baixa: a caixa vai para a coluna da grade e a peça usa a altura toda.
    view.gx = 0.29;
    railPx = Math.max(72, 0.19 * h);
    ppm = (h - railPx - 30) / DROP;
    ppm = Math.min(ppm, (2 * view.gx * w - 60) / 0.92, (pickLeft - 75 - view.gx * w) / 0.46);
  } else {
    view.gx = 0.29;
    railPx = Math.max(108, 0.12 * h);
    // A caixa fica embaixo da peça, presa a 32 px do rodapé; a barra da peça mais comprida para 12 px acima dela.
    ppm = (h - 32 - Math.max(cardH, 140) - 12 - railPx) / DROP;
    // Largura: a peça cabe na coluna dela e a seta da direita para antes da grade.
    ppm = Math.min(ppm, (2 * view.gx * w - 60) / 0.92, (pickLeft - 75 - view.gx * w) / 0.46);
  }
  view.ppm0 = ppm;
  view.railPx = railPx;
  renderer.setSize(w, h, false);
  // Pixelado: ~3 px por pixel numa tela comum, 2 px em telas pequenas.
  retro.pix = retro.force || clamp(Math.round(Math.min(w, h) / 340), 2, 4);
  const lw = Math.ceil(w / retro.pix), lh = Math.ceil(h / retro.pix);
  retro.target.setSize(lw, lh);
  retro.uniforms.low.value.set(lw, lh);
  retro.uniforms.screen.value.set(w, h);
  camera.aspect = a;
  frameCamera();

  // A interface se posiciona em volta da peça (no enquadramento padrão; peças compridas
  // só afastam a câmera, com o trilho e a barra no mesmo lugar da tela).
  const gTop = railPx - COLLAR_Y * ppm;
  const gBot = railPx + DROP * ppm;
  root.setProperty('--gx', `${(view.gx * w).toFixed(1)}px`);
  root.setProperty('--gxp', `${(view.gx * 100).toFixed(1)}%`);
  root.setProperty('--gy', `${((gTop + gBot) / 2).toFixed(1)}px`);
  root.setProperty('--gb', `${gBot.toFixed(1)}px`);
  root.setProperty('--gw', `${(0.46 * ppm).toFixed(1)}px`);
}

function frameCamera() {
  const w = innerWidth, h = innerHeight;
  const ppm = (view.ppm = (view.ppm0 * DROP) / view.drop);
  view.Vh = h / ppm;
  view.lookY = RAIL_Y + view.railPx / ppm - view.Vh / 2;
  camera.fov = 2 * Math.atan(view.Vh / 2 / CAM_DIST) * (180 / Math.PI);
  if (view.gx !== 0.5) camera.setViewOffset(w, h, (0.5 - view.gx) * w, 0, w, h);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// Distância para a peça sumir da tela pelo lado mais comprido.
function offX() {
  return (Math.max(view.gx, 1 - view.gx) * innerWidth) / view.ppm + 0.7;
}

function updateCamera(dt) {
  const g = garments[cur];
  const target = Math.max(DROP, g ? g.drop + 0.02 : DROP);
  if (Math.abs(target - view.drop) > 1e-4) {
    view.drop += (target - view.drop) * (1 - Math.exp(-dt * 3));
    frameCamera();
  }
  if (!coarse && pointer.inside) parT.copy(pointer.ndc); else parT.set(0, 0);
  par.lerp(parT, 1 - Math.exp(-dt * 2.5));
  camera.position.set(par.x * 0.1, view.lookY + par.y * 0.05, CAM_DIST);
  camera.lookAt(par.x * 0.1 * 0.5, view.lookY, 0);
}

// ── Troca de peça ───────────────────────────────────
function go(i, dir) {
  const n = PIECES.length;
  i = ((i % n) + n) % n;
  if (i === cur) return;
  if (!dir) {
    let d = i - cur;
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    dir = Math.sign(d) || 1;
  }
  const off = offX();
  const old = garments[cur];
  if (old) {
    old.state = 'out';
    old.tx = -dir * off;
    old.yaw = Math.atan2(Math.sin(old.yaw), Math.cos(old.yaw));
    old.tyaw = -dir * YAW_OUT;
  }
  const g = createGarment(i);
  // Se ela ainda estava saindo, volta de onde está; senão entra pelo lado oposto.
  // Calças entram mostrando o verso, que tem mais informação; as outras, a frente.
  const face = g.startBack ? Math.PI : 0;
  if (g.state !== 'out') g.show(dir * off, face - dir * YAW_IN);
  g.state = 'in';
  g.tx = 0;
  g.tyaw = face;
  g.manual = false;
  g.arrived = false;
  cur = i;

  // No máximo duas peças saindo ao mesmo tempo.
  const leaving = garments.filter((h) => h && h.state === 'out').sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
  for (let k = 2; k < leaving.length; k++) leaving[k].hide();

  setInfo();
}

function step(dir, auto = false) {
  if (!auto) lastInput = performance.now() / 1000;
  go(cur + dir, dir);
  const btn = dir > 0 ? $('next') : $('prev');
  btn.classList.add('hit');
  setTimeout(() => btn.classList.remove('hit'), 160);
}

// ── Interface ───────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, '0');
const infoEl = $('info'), statsEl = $('stats'), rosterEl = $('roster');
let COLS = 6;
let slots = [];
let infoTimer = 0;

const LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" stroke-width="2.6"/><rect x="4" y="10" width="16" height="11" rx="1.5" fill="currentColor"/><rect x="11" y="13.5" width="2" height="4" fill="#15121f"/></svg>';

function buildRoster() {
  rosterEl.innerHTML = '';
  // Peças em duas fileiras (três a partir de 15), com quantas colunas forem precisas; embaixo, uma fileira vazia.
  COLS = Math.ceil(PIECES.length / (PIECES.length > 14 ? 3 : 2));
  document.documentElement.style.setProperty('--cols', COLS);
  slots = PIECES.map((p, i) => {
    const b = document.createElement('button');
    b.className = 'slot';
    b.setAttribute('aria-label', p.name);
    const face = document.createElement('span');
    face.className = 'face';
    const im = document.createElement('img');
    im.src = BASE + (p.back && (p.startBack ?? KINDS[p.kind].startBack) ? p.back : p.file);   // calças: retrato do verso
    im.alt = '';
    im.decoding = 'async';
    face.append(im);
    const bar = document.createElement('span');
    bar.className = 'bar';
    b.append(face, bar);
    b.addEventListener('click', () => { lastInput = performance.now() / 1000; go(i); });
    rosterEl.append(b);
    return b;
  });
  // Depois das peças, mais uma fileira de espaços vazios: os primeiros 30% com "?" (peças que vêm
  // logo) e o resto trancado com cadeado.
  const total = (Math.ceil(PIECES.length / COLS) + 1) * COLS;
  const empty = total - PIECES.length, soon = Math.round(empty * 0.3);
  for (let k = 0; k < empty; k++) {
    const s = document.createElement('div');
    s.className = k < soon ? 'slot soon' : 'slot soon locked';
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = `<span class="face">${k < soon ? '?' : LOCK}</span>`;
    rosterEl.append(s);
  }
}

function setInfo() {
  const p = PIECES[cur];
  const kind = KINDS[p.kind];
  slots.forEach((s, k) => {
    s.setAttribute('aria-current', String(k === cur));
    s.lastChild.style.transform = 'scaleX(0)';
  });
  infoEl.classList.add('swap');
  clearTimeout(infoTimer);
  infoTimer = setTimeout(() => {
    $('rar').textContent = 'nihil';
    $('kind').textContent = kind.label;
    $('idx').textContent = `${pad2(cur + 1)} / ${pad2(PIECES.length)}`;
    $('name').textContent = p.name;
    // Tipo: peça única (1of1) ou feita em série; tamanho vem do pecas.json.
    const rows = [['Tipo', p.edition === 'serie' ? 'Série' : '1of1'], ['Tamanho', p.sizes || 'Único']];
    statsEl.innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    infoEl.classList.toggle('legend', p.edition !== 'serie');
    // Botão de compra: abre a página da peça na plataforma de vendas; sem link, fica "Em breve".
    const buy = $('buy');
    if (p.loja) {
      buy.href = p.loja;
      buy.removeAttribute('aria-disabled');
      buy.setAttribute('aria-label', `Comprar ${p.name}`);
      $('buy-txt').textContent = 'Comprar';
    } else {
      buy.removeAttribute('href');
      buy.setAttribute('aria-disabled', 'true');
      buy.removeAttribute('aria-label');
      $('buy-txt').textContent = 'Em breve';
    }
    infoEl.classList.remove('swap');
  }, 160);
  history.replaceState(null, '', `#${p.key}`);
}

$('prev').addEventListener('click', () => step(-1));
$('next').addEventListener('click', () => step(1));

// Setas andam pela grade como numa tela de seleção: ← → uma peça, ↑ ↓ uma fileira (dando a volta).
function moveRow(dir) {
  const n = PIECES.length, rows = Math.ceil(n / COLS);
  const col = cur % COLS;
  let row = (Math.floor(cur / COLS) + dir + rows) % rows;
  let i = row * COLS + col;
  if (i >= n) i = dir > 0 ? col : n - 1;   // espaço vazio na última fileira
  if (i === cur) return;
  lastInput = performance.now() / 1000;
  go(i, Math.sign(i - cur));
}

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return;
  if (e.key === 'ArrowRight' || e.key === 'd') { step(1); e.preventDefault(); }
  else if (e.key === 'ArrowLeft' || e.key === 'a') { step(-1); e.preventDefault(); }
  else if (e.key === 'ArrowDown' || e.key === 's') { moveRow(1); e.preventDefault(); }
  else if (e.key === 'ArrowUp' || e.key === 'w') { moveRow(-1); e.preventDefault(); }
  else if (e.key === 'Home') { lastInput = performance.now() / 1000; go(0); }
  else if (e.key === 'End') { lastInput = performance.now() / 1000; go(PIECES.length - 1); }
  else if (e.key === 'p' || e.key === 'P') { retro.on = !retro.on; resize(); }
});

let wheelAcc = 0, wheelT = 0;
addEventListener('wheel', (e) => {
  wheelAcc += Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
  const now = performance.now();
  if (Math.abs(wheelAcc) > 40 && now - wheelT > 450) {
    step(wheelAcc > 0 ? 1 : -1);
    wheelAcc = 0; wheelT = now;
  }
}, { passive: true });

// Arrastar/deslizar: a peça acompanha o dedo e, passado o limite, dá lugar à próxima.
const pointer = { ndc: new THREE.Vector2(), inside: false };
let drag = null, ringDrag = null;
const ray = new THREE.Raycaster();
ray.layers.enableAll();   // o círculo fica na camada da roupa
function onRing() {
  const g = garments[cur];
  if (!g || !g.ringPick || !g.rig.visible) return false;
  ray.setFromCamera(pointer.ndc, camera);
  return ray.intersectObject(g.ringPick, false).length > 0;
}
canvas.addEventListener('pointermove', (e) => {
  pointer.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  pointer.inside = e.pointerType === 'mouse';
  const g = garments[cur];
  if (ringDrag && g) {
    g.manual = true;
    g.tyaw = ringDrag.yaw0 + ((e.clientX - ringDrag.x0) / innerWidth) * Math.PI * 2.4;
    return;
  }
  if (!drag && e.pointerType === 'mouse' && g && g.ringMat) {
    const over = onRing();
    g.ringMat.opacity = over ? 0.8 : RING_OPACITY;
    canvas.classList.toggle('turn', over);
  }
  if (!drag || !garments[cur]) return;
  drag.dx = e.clientX - drag.x0;
  drag.dy = e.clientY - drag.y0;
  if (Math.abs(drag.dx) > 6) garments[cur].tx = drag.dx * (view.Vh / innerHeight) * 0.55;
});
canvas.addEventListener('pointerleave', () => { pointer.inside = false; });
canvas.addEventListener('pointerdown', (e) => {
  pointer.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  lastInput = performance.now() / 1000;
  if (onRing()) {
    const g = garments[cur];
    ringDrag = { x0: e.clientX, yaw0: g.yaw };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('grabbing');
    if (g.ringMat) g.ringMat.opacity = 0.8;
    return;
  }
  drag = { x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, t0: performance.now() };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('grabbing');
  lastInput = performance.now() / 1000;
});
const endDrag = () => {
  if (ringDrag) {
    ringDrag = null;
    canvas.classList.remove('grabbing');
    const g = garments[cur];
    if (g && g.ringMat) g.ringMat.opacity = RING_OPACITY;
    return;
  }
  if (!drag) return;
  const { dx, dy, t0 } = drag;
  drag = null;
  canvas.classList.remove('grabbing');
  const fast = Math.abs(dx) > 30 && performance.now() - t0 < 250;
  if ((Math.abs(dx) > 60 || fast) && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
  else if (garments[cur]) garments[cur].tx = 0;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { last = performance.now() / 1000; presentAt = last; }
});

// ── Início ──────────────────────────────────────────
const failTimer = setTimeout(() => { $('loader').textContent = 'A cena está demorando para carregar…'; }, 15000);

async function boot() {
  const manifest = await (await fetch(MANIFEST)).json();
  PIECES = manifest.filter((p) => KINDS[p.kind]);
  $('count').textContent = `${pad2(PIECES.length)} peças`;
  $('hint').textContent = coarse ? 'Deslize para escolher' : 'setas  ·  rolar  ·  arrastar';
  buildRoster();
  resize();   // a grade já tem a altura final
  document.fonts?.ready.then(resize);   // e a caixa, a altura com a fonte certa

  const [imgs, mdl] = await Promise.all([Promise.all(PIECES.map((p) => loadImg(BASE + p.file))), loadModels(PIECES)]);
  models = mdl;
  PIECES.forEach((p, k) => { assets[p.key] = { img: imgs[k], tex: frontTexture(imgs[k]), back: backTexture(imgs[k]) }; });
  // Peças com foto de trás (calças): carrega o verso de verdade.
  await Promise.all(PIECES.filter((p) => p.back).map(async (p) => {
    const im = await loadImg(BASE + p.back);
    assets[p.key].backImg = im;
    assets[p.key].backPhoto = bleedTexture(im);
  }));

  const fromHash = PIECES.findIndex((p) => p.key === decodeURIComponent(location.hash.slice(1)));
  go(fromHash >= 0 ? fromHash : 0, 1);

  clearTimeout(failTimer);
  $('loader').classList.add('done');
  last = performance.now() / 1000;
  presentAt = last;
  requestAnimationFrame(loop);

  // As outras peças são montadas aos poucos, das mais próximas para as mais distantes,
  // para a primeira troca não engasgar.
  const order = PIECES.map((_, k) => k).sort((a, b) => {
    const n = PIECES.length, d = (k) => Math.min((k - cur + n) % n, (cur - k + n) % n);
    return d(a) - d(b);
  });
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 60));
  const next = () => {
    const k = order.find((j) => !garments[j]);
    if (k === undefined) return;
    const g = createGarment(k);
    g.rig.traverse((m) => { if (m.material && m.material.map) renderer.initTexture(m.material.map); });
    idle(next);
  };
  idle(next);
}

// Apresentação depois de chegar. Peças de um lado viram devagar para um lado e para o outro;
// as de dois lados mostram um lado (o verso nas calças), giram para o outro e completam a volta.
const TURN = 1.6, HOLD = 2.6;
function presentYaw(g, t) {
  if (!g.twoSided) return 0.2 * Math.sin(t * 0.6);
  const cycle = 2 * (HOLD + TURN), k = Math.floor(t / cycle), p = t - k * cycle;
  const base = 2 * Math.PI * k + (g.startBack ? Math.PI : 0);
  const sway = (a) => 0.12 * Math.sin((Math.PI * a) / HOLD);
  if (p < HOLD) return base + sway(p);
  if (p < HOLD + TURN) return base + Math.PI * smooth((p - HOLD) / TURN);
  if (p < 2 * HOLD + TURN) return base + Math.PI + sway(p - HOLD - TURN);
  return base + Math.PI + Math.PI * smooth((p - 2 * HOLD - TURN) / TURN);
}

// A cena desenha no máximo 30 quadros por segundo, mas a física anda no tempo real:
// se o navegador atrasar, ela dá mais passos de uma vez e as peças não ficam em câmera lenta.
let last = performance.now() / 1000, acc = 0, nextFrame = 0;
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now() / 1000;
  if (now < nextFrame) return;
  nextFrame = Math.max(nextFrame + FRAME, now - FRAME / 2);
  const dt = Math.min(0.25, now - last);
  last = now;
  acc += dt;
  let steps = 0;
  while (acc >= FIXED && steps < MAX_STEPS) {
    simT += FIXED;
    for (const g of garments) if (g && g.rig.visible) { g.dynamics(FIXED); g.simulate(FIXED, simT); }
    acc -= FIXED; steps++;
  }
  if (steps === MAX_STEPS) acc = 0;

  for (const g of garments) {
    if (!g || !g.rig.visible) continue;
    if (g.state === 'out' && Math.abs(g.x - g.tx) < 0.08) { g.hide(); continue; }
    if (g.state === 'in' && !g.arrived && Math.abs(g.x) < 0.01 && Math.abs(g.vx) < 0.05 && !drag) {
      g.arrived = true;
      g.arrivedAt = now;
      presentAt = Math.max(presentAt, now);
    }
    // Apresentação: depois de chegar, vira devagar para um lado e para o outro.
    if (g.state === 'in' && g.arrived && !reduce && !g.manual) g.tyaw = presentYaw(g, now - g.arrivedAt);
    g.updateRing();
    g.updateMesh();
  }

  // Modo automático, como a tela de abertura dos fliperamas: passa sozinho enquanto ninguém mexe.
  const g = garments[cur];
  const auto = !reduce && now - lastInput > IDLE_AFTER && g && g.arrived;
  const bar = slots[cur] && slots[cur].lastChild;
  if (auto) {
    const t0 = Math.max(g.arrivedAt, presentAt, lastInput + IDLE_AFTER);
    const p = (now - t0) / (g.twoSided ? 2 * (HOLD + TURN) : ATTRACT);
    if (bar) bar.style.transform = `scaleX(${clamp(p, 0, 1).toFixed(3)})`;
    if (p >= 1) step(1, true);
  } else if (bar && bar.style.transform !== 'scaleX(0)') {
    bar.style.transform = 'scaleX(0)';
  }

  updateCamera(dt);
  if (retro.on) {
    retro.uniforms.gxp.value = view.gx;
    // 1) cenário sem a roupa na imagem pequena (a sombra da roupa entra) e ampliado em pixels.
    hideSharp(true);
    renderer.setRenderTarget(retro.target);
    renderer.render(scene, camera);
    hideSharp(false);
    renderer.setRenderTarget(null);
    renderer.render(retro.scene, retro.cam);
    // 2) roupa nítida por cima: primeiro a profundidade do cenário (o gancho na frente da gola
    //    continua na frente), depois só a camada da roupa.
    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.clearDepth();
    scene.overrideMaterial = retro.depthOnly;
    camera.layers.set(0);
    renderer.render(scene, camera);
    scene.overrideMaterial = null;
    camera.layers.set(1);
    renderer.render(scene, camera);
    camera.layers.enableAll();
    renderer.shadowMap.autoUpdate = true;
    renderer.autoClear = true;
  } else {
    renderer.render(scene, camera);
  }
}

boot().catch((e) => {
  console.error(e);
  $('loader').textContent = 'Não foi possível carregar as peças.';
});
