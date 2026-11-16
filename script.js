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

function showView() {
  const hash = location.hash.slice(1);
  const name = viewNames.includes(hash) ? hash : 'home';

  views.forEach((view) => {
    view.classList.toggle('is-active', view.dataset.view === name);
  });

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
