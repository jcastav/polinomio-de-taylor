// Altura dinámica del iframe de lección (sandbox allow-scripts) y
// reproductor de YouTube FUERA del sandbox (D27).
// El documento de lección corre en origen opaco (sandbox sin
// allow-same-origin): el player de YouTube exige su origen propio y ahí muere.
// El placeholder avía por postMessage y aquí se monta el iframe del
// reproductor en la página host (mismo patrón que results.ejs).
// Siempre se valida: origen del mensaje (source === contentWindow), token por
// request y el id se vuelve a sanitizar antes de construir la URL.
(function () {
  var frames = document.querySelectorAll('iframe.lesson-frame');
  for (var i = 0; i < frames.length; i++) {
    (function (frame) {
      var token = frame.getAttribute('data-token') || '';
      var overlay = null; // iframe del reproductor (fuera del sandbox)
      var rect = null; // posición del placeholder en coords del doc de lección

      function place() {
        if (!overlay || !rect) return;
        var fr = frame.getBoundingClientRect();
        var sx = window.scrollX || window.pageXOffset || 0;
        var sy = window.scrollY || window.pageYOffset || 0;
        overlay.style.left = Math.round(fr.left + sx + rect.left) + 'px';
        overlay.style.top = Math.round(fr.top + sy + rect.top) + 'px';
        overlay.style.width = Math.round(rect.width) + 'px';
        overlay.style.height = Math.round(rect.height) + 'px';
      }

      function mount(id) {
        if (overlay) overlay.parentNode.removeChild(overlay);
        overlay = document.createElement('iframe');
        overlay.className = 'lesson-yt-player';
        overlay.src = 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1';
        overlay.title = 'Reproductor de video';
        overlay.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
        overlay.setAttribute('allowfullscreen', '');
        overlay.style.cssText = 'position:absolute; border:0; margin:0; background:#000; z-index:40;';
        document.body.appendChild(overlay);
        place();
      }

      window.addEventListener('message', function (e) {
        if (e.source !== frame.contentWindow) return;
        var d = e.data;
        if (!d || (d.token || '') !== token) return;

        if (d.type === 'aula:lesson-height') {
          var h = Number(d.height);
          if (h > 0) frame.style.height = h + 'px';
          place(); // el reflow interior puede mover el marcador del vídeo
          return;
        }

        if (d.type === 'aula:play-youtube') {
          var id = String(d.id || '').replace(/[^\w-]/g, '');
          if (!id) return;
          var r = d.rect || {};
          var w = Number(r.width);
          var hgt = Number(r.height);
          if (!(w > 0 && hgt > 0)) return;
          var left = Number(r.left);
          var top = Number(r.top);
          rect = {
            left: (isFinite(left) ? left : 0) + (Number(d.sx) || 0),
            top: (isFinite(top) ? top : 0) + (Number(d.sy) || 0),
            width: w,
            height: hgt,
          };
          mount(id);
        }
      });

      window.addEventListener('resize', place);
    })(frames[i]);
  }
})();
