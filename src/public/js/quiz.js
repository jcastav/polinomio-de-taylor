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

// 6b.2: cuenta atrás del quiz (§7.1). El deadline real vive en el
// servidor (attempts.started_at + time_limit_min); esto solo lo pinta
// y, al llegar a 0, envía el form para que se califique solo.
(function () {
  const box = document.getElementById('examTimer');
  if (!box) return;
  const deadline = Date.parse(box.getAttribute('data-deadline'));
  if (Number.isNaN(deadline)) return;
  const text = document.getElementById('examTimerText');
  const form = document.getElementById('quiz-form');
  const pad = (n) => (n < 10 ? '0' + n : String(n));

  function tick() {
    const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    if (text) text.textContent = pad(Math.floor(left / 60)) + ':' + pad(left % 60);
    box.classList.toggle('is-low', left <= 60);
    if (left <= 0) {
      if (form) form.submit();
      return;
    }
    setTimeout(tick, 1000);
  }
  tick();
})();

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
