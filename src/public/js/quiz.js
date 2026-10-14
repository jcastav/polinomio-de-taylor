// Selección visual de opciones (label.sel) al estilo del mockup.
document.addEventListener('change', (e) => {
  const input = e.target;
  if (!input.matches || !input.matches('.opts input[type="radio"], .opts input[type="checkbox"]')) return;

  const box = input.closest('.opts');
  if (input.type === 'checkbox') {
    const label = input.closest('label');
    if (label) label.classList.toggle('sel', input.checked);
  } else if (box) {
    box.querySelectorAll('label').forEach((l) => l.classList.toggle('sel', l.contains(input)));
  }
});

// Reordenar (preguntas de tipo order): subir/bajar y sincronizar el hidden.
document.addEventListener('click', (e) => {
  const up = e.target.closest && e.target.closest('.ord-up');
  const down = e.target.closest && e.target.closest('.ord-down');
  if (!up && !down) return;

  const li = e.target.closest('li');
  if (!li || !li.parentElement) return;
  const list = li.parentElement;

  if (up && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
  if (down && li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);

  const hidden = list.nextElementSibling;
  if (hidden && hidden.type === 'hidden') {
    hidden.value = Array.from(list.children).map((n) => n.dataset.idx).join(',');
  }
});
