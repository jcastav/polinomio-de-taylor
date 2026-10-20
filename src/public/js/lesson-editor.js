// Editor de lección WYSIWYG (Hito 2). Quill 2 + MathLive por CDN.
// Sin execCommand ni contenteditable directo: todo pasa por la API de Quill.
// Blots custom: aula-math-inline / aula-math-block / aula-youtube / aula-raw.
(function () {
  var mount = document.getElementById('lessonEditor');
  if (!mount || !window.Quill) return;

  var out = document.getElementById('l-content');
  var seedEl = document.getElementById('lessonSeed');
  var seed = { content: '' };
  try { seed = JSON.parse(seedEl.textContent); } catch (e) {}

  // ---------- blots ----------
  var Embed = Quill.import('blots/embed');
  var BlockEmbed = Quill.import('blots/block/embed');

  class MathInlineBlot extends Embed {
    static create(value) {
      const node = super.create();
      node.setAttribute('data-latex', value);
      node.setAttribute('class', 'math-inline');
      node.setAttribute('contenteditable', 'false');
      node.textContent = '\\(' + value + '\\)';
      return node;
    }
    static value(node) { return node.getAttribute('data-latex'); }
  }
  MathInlineBlot.blotName = 'aula-math-inline';
  MathInlineBlot.tagName = 'span';
  MathInlineBlot.className = 'math-inline';

  class MathBlockBlot extends BlockEmbed {
    static create(value) {
      const node = super.create();
      node.setAttribute('data-latex', value);
      node.setAttribute('class', 'math-block');
      node.setAttribute('contenteditable', 'false');
      node.textContent = '\\[' + value + '\\]';
      return node;
    }
    static value(node) { return node.getAttribute('data-latex'); }
  }
  MathBlockBlot.blotName = 'aula-math-block';
  MathBlockBlot.tagName = 'div';
  MathBlockBlot.className = 'math-block';

  class YoutubeBlot extends BlockEmbed {
    static create(id) {
      const node = super.create();
      node.setAttribute('data-youtube', id);
      node.setAttribute('class', 'aula-youtube');
      node.setAttribute('contenteditable', 'false');
      const ph = document.createElement('div');
      ph.className = 'aula-youtube-ph';
      ph.textContent = '▶ Video de YouTube · ' + id;
      node.appendChild(ph);
      return node;
    }
    static value(node) { return node.getAttribute('data-youtube'); }
  }
  YoutubeBlot.blotName = 'aula-youtube';
  YoutubeBlot.tagName = 'div';
  YoutubeBlot.className = 'aula-youtube';

  class RawLatexBlot extends BlockEmbed {
    static create(raw) {
      const node = super.create();
      node.setAttribute('data-latex-raw', raw);
      node.setAttribute('class', 'raw-block');
      node.setAttribute('contenteditable', 'false');
      const tag = document.createElement('span');
      tag.className = 'raw-tag';
      tag.textContent = 'LaTeX (sin convertir)';
      node.appendChild(tag);
      const code = document.createElement('div');
      code.textContent = raw.length > 200 ? raw.slice(0, 200) + '…' : raw;
      node.appendChild(code);
      return node;
    }
    static value(node) { return node.getAttribute('data-latex-raw'); }
  }
  RawLatexBlot.blotName = 'aula-raw';
  RawLatexBlot.tagName = 'div';
  RawLatexBlot.className = 'raw-block';

  Quill.register('formats/aula-math-inline', MathInlineBlot, true);
  Quill.register('formats/aula-math-block', MathBlockBlot, true);
  Quill.register('formats/aula-youtube', YoutubeBlot, true);
  Quill.register('formats/aula-raw', RawLatexBlot, true);

  // ---------- instancia ----------
  var quill = new Quill('#lessonEditor', {
    theme: 'snow',
    placeholder: 'Escribe el contenido de la lección…',
    modules: {
      toolbar: {
        container: '#editorToolbar',
        handlers: { image: pickImage, formula: function () { openMath(null); } },
      },
    },
  });

  if (seed.content) quill.clipboard.dangerouslyPasteHTML(0, seed.content);

  function getHtml() { return quill.root.innerHTML; }
  window.AULA_LESSON_EDITOR = { getHtml: getHtml, quill: quill };

  var form = out && out.closest('form');
  if (form) form.addEventListener('submit', function () { out.value = getHtml(); });

  // ---------- inserts / reemplazos ----------
  function insertEmbed(type, value) {
    var range = quill.getSelection(true);
    var index = range ? range.index : quill.getLength();
    quill.insertEmbed(index, type, value, 'user');
  }

  function replaceEmbed(blot, type, value) {
    var index = quill.getIndex(blot);
    quill.deleteText(index, 1, 'user');
    quill.insertEmbed(index, type, value, 'user');
  }

  // ---------- imagen ----------
  function pickImage() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      if (!/^image\//.test(f.type)) { alert('Solo se permiten imágenes'); return; }
      if (f.size > 10 * 1024 * 1024) { alert('La imagen supera los 10MB'); return; }
      var fd = new FormData();
      fd.append('file', f);
      fetch('/admin/uploads', { method: 'POST', body: fd })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j.url) insertEmbed('image', j.url);
          else alert(j.error || 'No se pudo subir la imagen');
        })
        .catch(function () { alert('Error de red al subir la imagen'); });
    });
    input.click();
  }

  // ---------- diálogo de fórmula (MathLive) ----------
  var mathBackdrop = document.getElementById('edMathBackdrop');
  var mathField = document.getElementById('edMathField');
  var mathDisplay = document.getElementById('edMathDisplay');
  var mathSave = document.getElementById('edMathSave');
  var mathCancel = document.getElementById('edMathCancel');
  var mathEditBlot = null;

  function openMath(blot) {
    mathEditBlot = blot;
    var current = blot ? (blot.domNode.getAttribute('data-latex') || '') : '';
    if (mathField) {
      if (mathField.setValue) mathField.setValue(current);
      else mathField.value = current;
    }
    if (mathDisplay) {
      mathDisplay.checked = !!blot && blot.domNode.classList.contains('math-block');
    }
    mathBackdrop.classList.add('show');
    if (mathField && mathField.focus) setTimeout(function () { mathField.focus(); }, 30);
  }

  function closeMath() {
    mathBackdrop.classList.remove('show');
    mathEditBlot = null;
  }

  function mathValue() {
    var v = mathField && mathField.getValue ? mathField.getValue('latex')
      : (mathField ? mathField.value : '');
    v = String(v || '').trim();
    v = v.replace(/^\\\(|\\\)$/g, '').replace(/^\\\[|\\\]$/g, '');
    v = v.replace(/^\$+|\$$/g, '');
    return v.trim();
  }

  if (mathSave) mathSave.addEventListener('click', function () {
    var latex = mathValue();
    if (!latex) { closeMath(); return; }
    var display = mathDisplay && mathDisplay.checked;
    var type = display ? 'aula-math-block' : 'aula-math-inline';
    if (mathEditBlot) replaceEmbed(mathEditBlot, type, latex);
    else insertEmbed(type, latex);
    closeMath();
  });
  if (mathCancel) mathCancel.addEventListener('click', closeMath);
  if (mathBackdrop) mathBackdrop.addEventListener('click', function (e) {
    if (e.target === mathBackdrop) closeMath();
  });

  // ---------- diálogo de YouTube ----------
  var ytBackdrop = document.getElementById('edYtBackdrop');
  var ytInput = document.getElementById('edYtUrl');
  var ytSave = document.getElementById('edYtSave');
  var ytCancel = document.getElementById('edYtCancel');
  var ytEditBlot = null;

  function ytIdFrom(raw) {
    raw = String(raw || '').trim();
    if (/^[\w-]{6,20}$/.test(raw)) return raw;
    var m = raw.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{6,20})/);
    return m ? m[1] : null;
  }

  function openYt(blot) {
    ytEditBlot = blot;
    if (ytInput) ytInput.value = blot ? (blot.domNode.getAttribute('data-youtube') || '') : '';
    ytBackdrop.classList.add('show');
    if (ytInput) setTimeout(function () { ytInput.focus(); }, 30);
  }

  function closeYt() {
    ytBackdrop.classList.remove('show');
    ytEditBlot = null;
  }

  if (ytSave) ytSave.addEventListener('click', function () {
    var id = ytIdFrom(ytInput && ytInput.value);
    if (!id) { alert('No se reconoce el ID del video de YouTube'); return; }
    if (ytEditBlot) replaceEmbed(ytEditBlot, 'aula-youtube', id);
    else insertEmbed('aula-youtube', id);
    closeYt();
  });
  if (ytCancel) ytCancel.addEventListener('click', closeYt);
  if (ytBackdrop) ytBackdrop.addEventListener('click', function (e) {
    if (e.target === ytBackdrop) closeYt();
  });

  // ---------- diálogo de LaTeX crudo ----------
  var rawBackdrop = document.getElementById('edRawBackdrop');
  var rawText = document.getElementById('edRawText');
  var rawSave = document.getElementById('edRawSave');
  var rawCancel = document.getElementById('edRawCancel');
  var rawEditBlot = null;

  function openRaw(blot) {
    rawEditBlot = blot;
    if (rawText) rawText.value = blot ? (blot.domNode.getAttribute('data-latex-raw') || '') : '';
    rawBackdrop.classList.add('show');
    if (rawText) setTimeout(function () { rawText.focus(); }, 30);
  }

  function closeRaw() {
    rawBackdrop.classList.remove('show');
    rawEditBlot = null;
  }

  if (rawSave) rawSave.addEventListener('click', function () {
    var v = rawText ? rawText.value : '';
    if (rawEditBlot && v.trim()) replaceEmbed(rawEditBlot, 'aula-raw', v);
    closeRaw();
  });
  if (rawCancel) rawCancel.addEventListener('click', closeRaw);
  if (rawBackdrop) rawBackdrop.addEventListener('click', function (e) {
    if (e.target === rawBackdrop) closeRaw();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeMath(); closeYt(); closeRaw(); hideBubble();
    }
  });

  // ---------- clic en blots para editar ----------
  quill.root.addEventListener('click', function (e) {
    var t = e.target;
    if (!t.closest) return;
    var node = t.closest('[data-latex-raw]');
    if (node) {
      var blot = Quill.find(node, false);
      if (blot) openRaw(blot);
      return;
    }
    node = t.closest('[data-youtube]');
    if (node) {
      var yb = Quill.find(node, false);
      if (yb) openYt(yb);
      return;
    }
    node = t.closest('[data-latex]');
    if (node) {
      var mb = Quill.find(node, false);
      if (mb) openMath(mb);
    }
  });

  // ---------- comandos (bottombar / bubble / toolbar) ----------
  function runCmd(cmd, value) {
    quill.focus();
    if (cmd === 'image') return pickImage();
    if (cmd === 'formula') return openMath(null);
    if (cmd === 'youtube') return openYt(null);
    if (cmd === 'link') {
      var url = prompt('URL del enlace:');
      if (!url) return;
      var range = quill.getSelection() || { index: 0, length: 0 };
      if (range.length) quill.format('link', url);
      else if (range.index > 0) quill.formatText(range.index - 1, 1, 'link', url);
      return;
    }
    if (cmd === 'header') {
      quill.format('header', value === '' || value === undefined ? false : Number(value));
      return;
    }
    if (cmd === 'code') { quill.format('code-block', true); return; }
    if (cmd === 'blockquote') { quill.format('blockquote', true); return; }
    quill.format(cmd, value === undefined ? true : value);
  }

  // bottombar/bubble usan touchstart + preventDefault para no colapsar la
  // selección al tocar en móvil (instrucción 2.b del usuario).
  function wireButton(btn) {
    var cmd = btn.getAttribute('data-ed-cmd');
    var value = btn.getAttribute('data-value');
    if (!cmd) return;
    btn.addEventListener('touchstart', function (ev) {
      ev.preventDefault();
      runCmd(cmd, value === null ? undefined : value);
    }, { passive: false });
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      runCmd(cmd, value === null ? undefined : value);
    });
  }
  var btns = document.querySelectorAll('[data-ed-cmd]');
  for (var i = 0; i < btns.length; i++) wireButton(btns[i]);

  var headerSels = document.querySelectorAll('#edHeader, #edBottombar select');
  for (var s = 0; s < headerSels.length; s++) {
    (function (sel) {
      sel.addEventListener('change', function () { runCmd('header', sel.value); });
    })(headerSels[s]);
  }

  var ytTopBtn = document.querySelector('#editorToolbar [data-ed="youtube"]');
  if (ytTopBtn) {
    ytTopBtn.addEventListener('click', function (ev) { ev.preventDefault(); openYt(null); });
  }

  // ---------- bubble menu (móvil) ----------
  var bubble = document.getElementById('edBubble');

  function hideBubble() { if (bubble) bubble.classList.remove('show'); }

  function isMobile() {
    return window.matchMedia && window.matchMedia('(max-width: 820px)').matches;
  }

  quill.on('selection-change', function (range) {
    if (!bubble) return;
    if (!isMobile() || !range || range.length === 0) { hideBubble(); return; }
    var bounds = quill.getBounds(range.index, range.length);
    var editorRect = mount.getBoundingClientRect();
    bubble.classList.add('show');
    var top = editorRect.top + window.scrollY + bounds.top - bubble.offsetHeight - 6;
    var minTop = editorRect.top + window.scrollY + 4;
    if (top < minTop) top = editorRect.top + window.scrollY + bounds.top + bounds.height + 6;
    bubble.style.top = top + 'px';
    var left = editorRect.left + window.scrollX + bounds.left;
    bubble.style.left = Math.max(4, left) + 'px';
  });

  // ---------- bottombar: ajuste con visualViewport (iOS Safari) ----------
  var bottombar = document.getElementById('edBottombar');
  function placeBottombar() {
    if (!bottombar) return;
    if (window.visualViewport) {
      var vv = window.visualViewport;
      bottombar.style.bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + 'px';
    }
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', placeBottombar);
    window.visualViewport.addEventListener('scroll', placeBottombar);
  }
  window.addEventListener('resize', placeBottombar);
  placeBottombar();
})();
