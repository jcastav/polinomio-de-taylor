// Panel admin: paneles dinámicos del editor de preguntas (§8.3),
// preview markdown de lecciones y subida de retroalimentación.

// ---------- formularios de pregunta ----------
document.querySelectorAll('.qform').forEach((form) => {
  const typeSel = form.querySelector('[data-type-select]');
  const hiddenType = form.querySelector('input[name="type"]');
  const list = form.querySelector('[data-opt-list]');

  const currentType = () => (typeSel ? typeSel.value : (hiddenType ? hiddenType.value : 'single'));

  function showPanels() {
    const t = currentType();
    form.querySelectorAll('.qtype-panel').forEach((panel) => {
      panel.classList.toggle('is-on', panel.dataset.panel.split(/\s+/).includes(t));
    });
    // radio/checkbox según tipo
    form.querySelectorAll('[data-opt-list] input[name="correct"]').forEach((input) => {
      input.type = t === 'multiple' ? 'checkbox' : 'radio';
      if (t === 'single' && input.checked) {
        form.querySelectorAll('[data-opt-list] input[name="correct"]').forEach((o) => {
          if (o !== input) o.checked = false;
        });
      }
    });
  }

  function reindex() {
    if (!list) return;
    list.querySelectorAll('.opt-row').forEach((row, i) => {
      const c = row.querySelector('input[name="correct"]');
      if (c) c.value = String(i);
      const ph = row.querySelector('input[name="opt"]');
      if (ph && !ph.value) ph.placeholder = 'Opción ' + (i + 1);
    });
  }

  if (typeSel) typeSel.addEventListener('change', showPanels);

  const addBtn = form.querySelector('[data-add-opt]');
  if (addBtn && list) {
    addBtn.addEventListener('click', () => {
      const t = currentType();
      const row = document.createElement('div');
      row.className = 'opt-row';
      row.innerHTML =
        '<input type="text" name="opt" maxlength="300">' +
        '<label class="opt-correct"><input type="' + (t === 'multiple' ? 'checkbox' : 'radio') +
        '" name="correct" value="0"> correcta</label>' +
        '<button type="button" class="btn btn-sm" data-del-opt>Quitar</button>';
      list.appendChild(row);
      reindex();
    });
  }

  if (list) {
    list.addEventListener('click', (e) => {
      const del = e.target.closest('[data-del-opt]');
      if (!del) return;
      if (list.querySelectorAll('.opt-row').length <= 2) return;
      del.closest('.opt-row').remove();
      reindex();
    });
  }

  showPanels();
});

// ---------- preview markdown de lección ----------
document.querySelectorAll('[data-preview]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const area = document.getElementById('l-content');
    const out = document.getElementById('lessonPreview');
    if (!area || !out) return;
    const body = new URLSearchParams();
    body.set('content', area.value);
    const r = await fetch(`/admin/lessons/${btn.dataset.preview}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (r.ok) {
      const data = await r.json();
      out.innerHTML = data.html;
      out.scrollIntoView({ block: 'nearest' });
    }
  });
});

// ---------- subida de recursos de retroalimentación ----------
document.querySelectorAll('.fb-add').forEach((form) => {
  const kind = form.querySelector('[data-fb-kind]');
  const content = form.querySelector('[data-fb-content]');
  const file = form.querySelector('[data-fb-file]');
  const uploadLabel = form.querySelector('.fb-upload');
  const status = form.querySelector('[data-fb-status]');

  function sync() {
    if (uploadLabel) uploadLabel.hidden = !(kind && (kind.value === 'video' || kind.value === 'image'));
  }
  if (kind) kind.addEventListener('change', sync);
  sync();

  if (file) {
    file.addEventListener('change', async () => {
      if (!file.files.length) return;
      const fd = new FormData();
      fd.append('file', file.files[0]);
      if (status) status.textContent = 'Subiendo…';
      try {
        const r = await fetch('/admin/uploads', { method: 'POST', body: fd });
        const data = await r.json();
        if (r.ok && data.url) {
          content.value = data.url;
          if (status) status.textContent = 'Archivo subido ✓';
        } else if (status) {
          status.textContent = data.error || 'Error al subir';
        }
      } catch (e) {
        if (status) status.textContent = 'Error de red al subir';
      }
      file.value = '';
    });
  }
});
