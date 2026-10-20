// Librería del contenido de lección (editor 3 modos — Hito 1).
// Ver EDITOR-IMPLEMENTATION.md §3.2: sanitizado dual, detección de formato
// y documento del iframe sandbox.
const crypto = require('crypto');
const sanitizeHtml = require('sanitize-html');
const { renderMarkdown } = require('./markdown');

// Perfil permisivo para el HTML canónico del editor: style/script permitidos
// porque la ejecución queda confinada en el <iframe sandbox="allow-scripts">
// de la vista estudiante/preview (origen opaco, sin cookies ni DOM padre).
// Se eliminan SIEMPRE handlers on*, javascript: y data: (schemes http/https/mailto).
const PERMISSIVE = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption',
    'pre', 'code', 'span', 'div', 'figure', 'figcaption',
    'style', 'script', 'iframe', 'video', 'source', 'audio',
    'section', 'article', 'header', 'footer', 'details', 'summary',
    'dl', 'dt', 'dd', 'sup', 'sub', 'small', 'mark', 'abbr',
  ]),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    '*': ['class', 'id', 'style'],
    a: ['href', 'name', 'target', 'rel', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'data-latex-raw'],
    span: ['data-latex'],
    div: ['data-youtube', 'data-latex', 'data-latex-raw'],
    figure: ['data-latex-raw'],
    ol: ['start'],
    th: ['colspan', 'rowspan', 'align'],
    td: ['colspan', 'rowspan', 'align'],
    iframe: ['src', 'width', 'height', 'allow', 'allowfullscreen',
      'frameborder', 'title', 'loading'],
    video: ['src', 'controls', 'width', 'height', 'poster'],
    source: ['src', 'type'],
    audio: ['src', 'controls'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  allowedIframeHostnames: [
    'www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com',
    'player.vimeo.com', 'vimeo.com',
  ],
  // Aceptado y documentado: script/style solo se ejecutan dentro del
  // iframe sandbox (EDITOR-IMPLEMENTATION.md §6).
  allowVulnerableTags: true,
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function sanitizeLessonHtml(html) {
  return sanitizeHtml(String(html || ''), PERMISSIVE);
}

// Heurística dual (schema intocable, sin columna de formato): si el contenido
// parece HTML del editor se sanea con el perfil permisivo; si no, se trata
// como markdown legacy (perfil estricto de §12).
function isHtmlContent(content) {
  return /<(?:p|h[1-6]|div|ul|ol|blockquote|pre|img|span|table|figure|section|article|iframe|video|style|script)\b/i
    .test(String(content || ''));
}

function renderLessonContent(content) {
  return isHtmlContent(content)
    ? sanitizeLessonHtml(content)
    : renderMarkdown(content);
}

// Documento completo servido dentro del iframe sandbox. El template inyecta
// MathJax DESPUÉS del sanitize (el contenido nunca trae el script de MathJax).
function renderLessonDocument({ innerHtml, token, title } = {}) {
  const safeToken = String(token || '').replace(/[^\w-]/g, '');
  const needsMath = /data-latex|\\\(|\\\[/.test(String(innerHtml || ''));
  const mathjax = needsMath
    ? '<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>'
    : '';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title || 'Lección')}</title>
<link rel="stylesheet" href="/css/tokens.css">
<link rel="stylesheet" href="/css/base.css">
<style>
body{ margin:0; padding:14px 16px 24px; }
.lesson-doc{ max-width:760px; margin:0 auto; }
.lesson-doc img{ max-width:100%; }
.lesson-doc h1{ font:400 25px/1.2 Georgia, "Times New Roman", serif; margin:14px 0 4px; }
.lesson-doc h2{ font:700 12px/1 Tahoma, sans-serif; letter-spacing:.14em; text-transform:uppercase; color:var(--accent-2); margin:24px 0 8px; padding-bottom:5px; border-bottom:1px solid var(--line-soft); }
.lesson-doc h3{ font:700 14px/1.3 Tahoma, sans-serif; color:var(--ink); margin:18px 0 6px; }
.lesson-doc p, .lesson-doc li{ font:400 14.5px/1.62 Georgia, serif; }
.lesson-doc p{ margin:0 0 12px; }
.lesson-doc ul, .lesson-doc ol{ margin:0 0 12px; padding-left:22px; }
.lesson-doc pre{ overflow-x:auto; border:1px solid var(--line-soft); background:#fff; padding:8px 10px; margin:0 0 14px; }
.lesson-doc code{ font:12.5px/1.5 Consolas, "Courier New", monospace; }
.lesson-doc blockquote{ border-left:3px solid var(--accent); background:var(--hl); padding:10px 12px; margin:0 0 14px; font:400 14px/1.55 Georgia, serif; }
.lesson-doc table{ width:100%; border-collapse:collapse; margin:0 0 14px; font-size:13.5px; }
.lesson-doc th, .lesson-doc td{ border:1px solid var(--line); padding:6px 9px; text-align:left; vertical-align:top; }
.lesson-doc th{ background:#e9e3d4; font:700 10.5px/1.3 Tahoma, sans-serif; letter-spacing:.1em; text-transform:uppercase; color:#4a453c; }
.lesson-doc figure{ margin:0 0 14px; }
.lesson-doc figcaption{ font:11.5px/1.4 Tahoma, sans-serif; color:var(--muted); margin-top:4px; }
.math-block{ display:block; text-align:center; margin:10px 0 16px; }
.raw-block{ border:1px dashed var(--line); background:#fff; padding:8px 10px; font:12px/1.5 Consolas, "Courier New", monospace; margin:0 0 14px; white-space:pre-wrap; }
.raw-block .raw-tag{ display:block; font:700 10px/1 Tahoma, sans-serif; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); margin-bottom:4px; }
.lesson-youtube{ display:block; width:100%; aspect-ratio:16/9; height:auto; border:0; margin:0 0 14px; background:#000; }
.aula-youtube{ display:flex; align-items:center; justify-content:center; position:relative; aspect-ratio:16/9; border:1px solid var(--line-soft); background:#1b1b1b; margin:0 0 14px; cursor:pointer; color:#f3efe6; font:700 12px/1.4 Tahoma, sans-serif; letter-spacing:.06em; text-align:center; padding:12px; box-sizing:border-box; }
.aula-youtube:hover{ border-color:var(--accent); }
.aula-youtube:focus-visible{ outline:2px solid var(--accent); outline-offset:2px; }
.aula-youtube .aula-youtube-ph{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding:12px; text-align:center; }
</style>
</head>
<body>
<div class="lesson-doc">${innerHtml || ''}</div>
<script>window.MathJax=window.MathJax||{};Object.assign(window.MathJax,{tex:{inlineMath:[['\\\\(','\\\\)']],displayMath:[['\\\\[','\\\\]']],processEscapes:true},options:{skipHtmlTags:['script','noscript','style','textarea','pre','code']},startup:{typeset:false}});window.__AULA_TOKEN=${JSON.stringify(safeToken)};</script>
${mathjax}
<script>
(function () {
  var token = window.__AULA_TOKEN || '';
  function sendHeight() {
    try {
      var h = Math.max(
        document.documentElement.scrollHeight,
        document.body ? document.body.scrollHeight : 0
      );
      parent.postMessage({ type: 'aula:lesson-height', token: token, height: h }, '*');
    } catch (e) {}
  }
  var yt = document.querySelectorAll('div[data-youtube]');
  for (var i = 0; i < yt.length; i++) {
    (function (el) {
      var id = String(el.getAttribute('data-youtube') || '').replace(/[^\\w-]/g, '');
      if (!id) return;
      // D27: el placeholder NO se convierte en iframe aquí. El documento corre
      // en origen opaco (sandbox sin allow-same-origin) y el player de YouTube
      // exige su origen propio; se avía al padre y lesson-frame.js monta el
      // reproductor FUERA del sandbox.
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', 'Reproducir video');
      function play() {
        var r = el.getBoundingClientRect();
        parent.postMessage({
          type: 'aula:play-youtube',
          token: token,
          id: id,
          rect: { left: r.left, top: r.top, width: r.width, height: r.height },
          sx: window.scrollX || 0,
          sy: window.scrollY || 0
        }, '*');
      }
      el.addEventListener('click', play);
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          play();
        }
      });
    })(yt[i]);
  }
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () { sendHeight(); });
    ro.observe(document.documentElement);
    if (document.body) ro.observe(document.body);
  }
  window.addEventListener('resize', sendHeight);
  sendHeight();
  if (window.MathJax && MathJax.startup && MathJax.startup.promise) {
    MathJax.startup.promise
      .then(function () { return MathJax.typesetPromise([document.body]); })
      .then(sendHeight)
      .catch(function () { sendHeight(); });
  }
})();
</script>
</body>
</html>`;
}

function newFrameToken() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = {
  isHtmlContent,
  sanitizeLessonHtml,
  renderLessonContent,
  renderLessonDocument,
  newFrameToken,
};
