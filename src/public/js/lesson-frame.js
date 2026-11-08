// Altura dinámica del iframe de lección (sandbox allow-scripts) y montaje de
// embeds (YouTube/GeoGebra/Vimeo) FUERA del sandbox (D27/D28).
// El documento de lección corre en origen opaco (sandbox sin
// allow-same-origin): YouTube y GeoGebra mueren ahí (storage/canvas), así que
// el marcador avía por postMessage y aquí se monta el iframe real en la
// página host (mismo patrón que results.ejs).
// Siempre se valida: origen del mensaje (source === contentWindow), token por
// request y la URL (https + host en lista blanca) antes de montar.
(function () {
  var EMBED_HOSTS = [
    'www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com',
    'player.vimeo.com', 'vimeo.com',
    'www.geogebra.org', 'geogebra.org', 'tube.geogebra.org',
  ];

  function safeEmbedUrl(raw) {
    try {
      var u = new URL(String(raw || ''));
      if (u.protocol !== 'https:') return null;
      if (EMBED_HOSTS.indexOf(u.hostname.toLowerCase()) === -1) return null;
      return u.href;
    } catch (e) {
      return null;
    }
  }

  var frames = document.querySelectorAll('iframe.lesson-frame');
  for (var i = 0; i < frames.length; i++) {
    (function (frame) {
      var token = frame.getAttribute('data-token') || '';
      var overlay = null; // iframe del embed (fuera del sandbox)
      var rect = null; // posición del marcador en coords del doc de lección

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

      function mount(src) {
        if (overlay) overlay.parentNode.removeChild(overlay);
        overlay = document.createElement('iframe');
        overlay.className = 'lesson-embed-player';
        overlay.src = src;
        overlay.title = 'Contenido interactivo';
        overlay.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen');
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
          place(); // el reflow interior puede mover el marcador del embed
          return;
        }

        if (d.type === 'aula:play-embed') {
          var src = safeEmbedUrl(d.src);
          if (!src) return;
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
          mount(src);
        }
      });

      window.addEventListener('resize', place);
    })(frames[i]);
  }
})();
