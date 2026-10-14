// Modal de retroalimentación (§9.6): abre con [data-open-modal],
// cierra con el botón "Cerrar", el backdrop o Escape.
function closeModal() {
  document.body.classList.remove('modal-open');
  document.querySelectorAll('.modal.is-open').forEach((m) => m.classList.remove('is-open'));
}

document.addEventListener('click', (e) => {
  const opener = e.target.closest && e.target.closest('[data-open-modal]');
  if (opener) {
    const modal = document.getElementById(opener.getAttribute('data-open-modal'));
    if (modal) {
      document.body.classList.add('modal-open');
      modal.classList.add('is-open');
    }
    return;
  }

  if (e.target.closest && e.target.closest('.modal-close')) {
    closeModal();
    return;
  }
  if (e.target.classList && e.target.classList.contains('modal-backdrop')) {
    closeModal();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});
