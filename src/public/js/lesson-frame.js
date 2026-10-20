// Altura dinámica del iframe de lección (sandbox allow-scripts).
// Valida origen del mensaje y token por request antes de redimensionar.
(function () {
  var frames = document.querySelectorAll('iframe.lesson-frame');
  for (var i = 0; i < frames.length; i++) {
    (function (frame) {
      var token = frame.getAttribute('data-token') || '';
      window.addEventListener('message', function (e) {
        if (e.source !== frame.contentWindow) return;
        var d = e.data;
        if (!d || d.type !== 'aula:lesson-height' || (d.token || '') !== token) return;
        var h = Number(d.height);
        if (h > 0) frame.style.height = h + 'px';
      });
    })(frames[i]);
  }
})();
