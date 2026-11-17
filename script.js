const peaceBtn = document.getElementById('peace-btn');
const menu = document.getElementById('menu');
const main = document.getElementById('app');
const views = document.querySelectorAll('.view');
const viewNames = ['home', 'manifesto', 'historia', 'blog'];

function setMenu(open) {
  document.body.classList.toggle('menu-open', open);
  menu.classList.toggle('is-open', open);
  peaceBtn.setAttribute('aria-expanded', String(open));
  peaceBtn.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
}

// Manifesto, História e Blog em construção: só abrem com a senha. É uma cortina, não uma tranca:
// o conteúdo continua no código da página. Quem acerta a senha fica liberado neste navegador.
const obra = document.getElementById('obra');
const obraForm = document.getElementById('obra-form');
const obraInput = document.getElementById('obra-input');
const obraErro = document.getElementById('obra-erro');
const OBRA_SENHA = 'fb6021d282db8315b391ada032b3e9bb17ab9b4c390ed050a8103e7815d7fca1';   // SHA-256 da senha
const OBRA_CHAVE = 'nihil-obra-liberada';
const nomes = { manifesto: 'Manifesto', historia: 'História', blog: 'Blog' };
let liberado = false;
try { liberado = localStorage.getItem(OBRA_CHAVE) === '1'; } catch (e) { /* sem armazenamento: pede a senha */ }

async function sha256(texto) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

obraForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const tentativa = obraInput.value.trim().toLowerCase();
  let ok = false;
  try { ok = (await sha256(tentativa)) === OBRA_SENHA; } catch (e) { ok = false; }
  if (ok) {
    liberado = true;
    try { localStorage.setItem(OBRA_CHAVE, '1'); } catch (e) { /* vale só até fechar a página */ }
    obraInput.value = '';
    obraErro.textContent = '';
    showView();
  } else {
    obraErro.textContent = 'Senha errada';
    obraForm.classList.remove('treme');
    void obraForm.offsetWidth;   // reinicia a animação de tremer
    obraForm.classList.add('treme');
    obraInput.select();
  }
});

function showView() {
  const hash = location.hash.slice(1);
  const name = viewNames.includes(hash) ? hash : 'home';
  const emObra = name !== 'home' && !liberado;

  views.forEach((view) => {
    view.classList.toggle('is-active', !emObra && view.dataset.view === name);
  });
  obra.hidden = !emObra;
  if (emObra) {
    document.getElementById('obra-pagina').textContent = nomes[name];
    obraErro.textContent = '';
  }

  document.body.dataset.view = name;
  window.scrollTo(0, 0);
  setMenu(false);
}

peaceBtn.addEventListener('click', () => {
  setMenu(!menu.classList.contains('is-open'));
});

main.addEventListener('click', () => {
  setMenu(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setMenu(false);
});

window.addEventListener('hashchange', showView);
showView();
