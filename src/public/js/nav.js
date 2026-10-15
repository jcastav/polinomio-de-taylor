const body = document.body;
const navBtn = document.getElementById('navBtn');
const backdrop = document.getElementById('backdrop');

navBtn.addEventListener('click', () => body.classList.toggle('nav-open'));
backdrop.addEventListener('click', () => body.classList.remove('nav-open'));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') body.classList.remove('nav-open');
});

// Cerrar el drawer al tocar un enlace (§10).
document.querySelectorAll('.sidebar a').forEach((a) => {
  a.addEventListener('click', () => body.classList.remove('nav-open'));
});

// Colapsar módulos del árbol (comportamiento del mockup) + aria-expanded.
document.querySelectorAll('.mod > button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const ul = btn.nextElementSibling;
    const caret = btn.querySelector('.caret');
    if (!ul || !caret) return;
    const hidden = ul.style.display === 'none';
    ul.style.display = hidden ? '' : 'none';
    caret.textContent = hidden ? '▼' : '▶';
    btn.setAttribute('aria-expanded', hidden ? 'true' : 'false');
  });
});
