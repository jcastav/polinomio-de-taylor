// Conversor HTML ↔ LaTeX del editor (Hito 3/4 — lossless).
// Puro, sin dependencias: usa document.createElement para parsear el HTML.
// Regla: lo no convertible se conserva en data-latex-raw (aularaw / bloque
// opaco). El HTML canónico siempre sobrevive el viaje LaTeX → HTML → LaTeX.
(function (root) {
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  function parseYouTubeId(url) {
    var m = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/.exec(url || '');
    return m ? m[1] : null;
  }

  function mathInlineHtml(latex) {
    return '<span class="math-inline" data-latex="' + escAttr(latex) + '" contenteditable="false">\\(' + esc(latex) + '\\)</span>';
  }
  function mathBlockHtml(latex) {
    return '<div class="math-block" data-latex="' + escAttr(latex) + '" contenteditable="false">\\[' + esc(latex) + '\\]</div>';
  }
  function ytHtml(id) {
    return '<div class="aula-youtube" data-youtube="' + escAttr(id) + '" contenteditable="false">' +
      '<div class="aula-youtube-ph">▶ Video de YouTube · ' + esc(id) + '</div></div>';
  }
  function rawBlockHtml(rawLatex, envName) {
    var preview = rawLatex.length > 200 ? rawLatex.slice(0, 200) + '…' : rawLatex;
    return '<div class="raw-block" data-latex-raw="' + escAttr(rawLatex) + '" contenteditable="false">' +
      '<span class="raw-tag">LaTeX (sin convertir' + (envName ? ' · ' + escAttr(envName) : '') + ')</span>' +
      '<div>' + esc(preview) + '</div></div>';
  }

  // ---------- HTML → LaTeX ----------
  function escapeLatexText(t) {
    return String(t).replace(/([\\{}$&#%_^~])/g, '\\$1');
  }

  function inlineToLatex(node) {
    var out = '';
    Array.prototype.forEach.call(node.childNodes, function (n) {
      if (n.nodeType === 3) { out += escapeLatexText(n.textContent); return; }
      if (n.nodeType !== 1) return;
      var t = n.tagName.toLowerCase();
      var ds = n.dataset || {};
      if (t === 'strong' || t === 'b') out += '\\textbf{' + inlineToLatex(n) + '}';
      else if (t === 'em' || t === 'i') out += '\\textit{' + inlineToLatex(n) + '}';
      else if (t === 'u') out += '\\underline{' + inlineToLatex(n) + '}';
      else if (t === 's' || t === 'del') out += '\\sout{' + inlineToLatex(n) + '}';
      else if (t === 'code') out += '\\texttt{' + inlineToLatex(n) + '}';
      else if (t === 'a') out += '\\href{' + (n.getAttribute('href') || '') + '}{' + inlineToLatex(n) + '}';
      else if (t === 'img') out += '\\aulaimg{' + (n.getAttribute('src') || '') + '}{' + (n.getAttribute('alt') || '') + '}';
      else if (t === 'br') out += '\\\\\n';
      else if (t === 'span' && ds.latex !== undefined) out += '$' + ds.latex + '$';
      else out += inlineToLatex(n);
    });
    return out;
  }

  function alignClassOf(el) {
    var cl = el.className || '';
    if (/\bql-align-center\b/.test(cl)) return '\\begin{center}';
    if (/\bql-align-left\b/.test(cl)) return '\\begin{flushleft}';
    if (/\bql-align-right\b/.test(cl)) return '\\begin{flushright}';
    return null;
  }

  function htmlToLatex(html) {
    var rootEl = document.createElement('div');
    rootEl.innerHTML = html;
    var blocks = [];
    Array.prototype.forEach.call(rootEl.childNodes, function (el) {
      if (el.nodeType === 3) {
        if (el.textContent.trim()) blocks.push(escapeLatexText(el.textContent.trim()));
        return;
      }
      if (el.nodeType !== 1) return;
      var t = el.tagName.toLowerCase();
      var ds = el.dataset || {};
      var alignBegin = alignClassOf(el);
      if (t === 'h1') blocks.push('\\section*{' + inlineToLatex(el) + '}');
      else if (t === 'h2') blocks.push('\\subsection*{' + inlineToLatex(el) + '}');
      else if (t === 'h3') blocks.push('\\subsubsection*{' + inlineToLatex(el) + '}');
      else if (t === 'p') {
        var tx = inlineToLatex(el);
        if (tx.trim()) blocks.push(tx);
      } else if (t === 'ul' || t === 'ol') {
        var env = t === 'ul' ? 'itemize' : 'enumerate';
        var items = [];
        Array.prototype.forEach.call(el.children, function (li) {
          if ((li.tagName || '').toLowerCase() === 'li') items.push('\\item ' + inlineToLatex(li));
        });
        blocks.push('\\begin{' + env + '}\n' + items.join('\n') + '\n\\end{' + env + '}');
      } else if (t === 'blockquote') {
        blocks.push('\\begin{quote}\n' + inlineToLatex(el) + '\n\\end{quote}');
      } else if (t === 'pre') {
        blocks.push('\\begin{verbatim}\n' + el.textContent + '\n\\end{verbatim}');
      } else if (t === 'img' && ds.latexRaw !== undefined) {
        // imagen LaTeX (fallback Hito 5): el código original manda
        blocks.push('\\begin{aularaw}\n' + ds.latexRaw + '\n\\end{aularaw}');
      } else if (t === 'img') {
        blocks.push('\\aulaimg{' + (el.getAttribute('src') || '') + '}{' + (el.getAttribute('alt') || '') + '}');
      } else if (t === 'div' && ds.youtube) {
        blocks.push('\\aulavideo{https://youtu.be/' + ds.youtube + '}');
      } else if (t === 'div' && ds.latex !== undefined) {
        blocks.push('$$\n' + ds.latex + '\n$$');
      } else if (t === 'div' && ds.latexRaw !== undefined) {
        blocks.push('\\begin{aularaw}\n' + ds.latexRaw + '\n\\end{aularaw}');
      } else if (alignBegin) {
        blocks.push(alignBegin + '\n' + htmlToLatex(el.innerHTML) + '\n\\end{' + alignBegin.slice(7, -1) + '}');
      } else if (t === 'div' || t === 'section') {
        blocks.push(htmlToLatex(el.innerHTML));
      } else {
        blocks.push(inlineToLatex(el));
      }
    });
    return blocks.join('\n\n');
  }

  // ---------- LaTeX → HTML ----------
  // Tokenizador: decodifica los escapes de texto (\% → %) solo en segmentos
  // de texto plano, nunca dentro de atributos data-latex*, para que
  // «texto → LaTeX → texto» sea exacto con ñ, acentos y símbolos.
  function decodeLatexText(t) {
    return String(t).replace(/\\([\\{}$&#%_^{~])/g, '$1');
  }
  function escLatexTextPlain(t) { return esc(decodeLatexText(t)); }

  var INLINE_SRC =
    '\\\\textbf\\{([^{}]*)\\}|\\\\textit\\{([^{}]*)\\}|\\\\underline\\{([^{}]*)\\}|' +
    '\\\\sout\\{([^{}]*)\\}|\\\\texttt\\{([^{}]*)\\}|\\\\text\\{([^{}]*)\\}|' +
    '\\\\href\\{([^{}]*)\\}\\{([^{}]*)\\}|(\\$[^$\\n]+\\$)|(\\\\\\\\)|' +
    '\\\\aulaimg\\{([^{}]*)\\}\\{([^{}]*)\\}';

  function inlineFromLatex(s) {
    var re = new RegExp(INLINE_SRC, 'g');
    var out = '';
    var last = 0;
    var m;
    while ((m = re.exec(s))) {
      out += escLatexTextPlain(s.slice(last, m.index));
      if (m[1] !== undefined) out += '<strong>' + inlineFromLatex(m[1]) + '</strong>';
      else if (m[2] !== undefined) out += '<em>' + inlineFromLatex(m[2]) + '</em>';
      else if (m[3] !== undefined) out += '<u>' + inlineFromLatex(m[3]) + '</u>';
      else if (m[4] !== undefined) out += '<s>' + inlineFromLatex(m[4]) + '</s>';
      else if (m[5] !== undefined) out += '<code>' + inlineFromLatex(m[5]) + '</code>';
      else if (m[6] !== undefined) out += escLatexTextPlain(m[6]);
      else if (m[7] !== undefined) out += '<a href="' + escAttr(m[7]) + '">' + inlineFromLatex(m[8]) + '</a>';
      else if (m[9] !== undefined) out += mathInlineHtml(m[9].slice(1, -1));
      else if (m[10] !== undefined) out += '<br>';
      else if (m[11] !== undefined) out += '<img src="' + escAttr(m[11]) + '" alt="' + escAttr(m[12]) + '">';
      last = re.lastIndex;
    }
    out += escLatexTextPlain(s.slice(last));
    return out;
  }

  var CMD_DEF_RE = /^\\(newcommand|renewcommand|providecommand|def)\b/;

  function latexToHtml(src) {
    var lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    var hasRaw = false;

    function convertLines(srcLines) {
      var out = [];
      var i = 0;

      function readEnv(name) {
        var endRe = new RegExp('\\\\end\\{' + name + '\\}');
        var buf = [];
        while (i < srcLines.length) {
          if (endRe.test(srcLines[i])) { i++; return buf; }
          buf.push(srcLines[i]); i++;
        }
        return buf;
      }

      while (i < srcLines.length) {
        var t = srcLines[i].trim();
        if (!t) { i++; continue; }
        var m;

        // \newcommand / \renewcommand / \providecommand / \def → opaco exacto
        if (CMD_DEF_RE.test(t)) {
          var acc = [];
          var depth = 0;
          var started = false;
          while (i < srcLines.length) {
            var ln = srcLines[i];
            acc.push(ln);
            for (var ci = 0; ci < ln.length; ci++) {
              if (ln.charAt(ci) === '{') { depth++; started = true; }
              else if (ln.charAt(ci) === '}') depth--;
            }
            i++;
            if (started && depth <= 0) break;
          }
          hasRaw = true;
          out.push(rawBlockHtml(acc.join('\n'), 'comando'));
          continue;
        }

        if ((m = t.match(/^\\(sub)*section\*\{(.*)\}$/))) {
          var tag = m[1] === 'subsub' ? 'h3' : (m[1] === 'sub' ? 'h2' : 'h1');
          out.push('<' + tag + '>' + inlineFromLatex(m[2]) + '</' + tag + '>');
          i++; continue;
        }

        if ((m = t.match(/^\\begin\{(\w+)\}(.*)$/))) {
          var env = m[1];
          var beginRest = m[2];
          i++;
          var buf = readEnv(env);
          var rawEnv = '\\begin{' + env + '}' + beginRest + '\n' + buf.join('\n') + '\n\\end{' + env + '}';
          if (beginRest.trim()) {
            // argumentos en \begin{env}[..]{..} → opaco, el código queda exacto
            hasRaw = true;
            out.push(rawBlockHtml(rawEnv, env));
            continue;
          }
          if (env === 'itemize' || env === 'enumerate') {
            var tagL = env === 'itemize' ? 'ul' : 'ol';
            var items = [];
            var cur = null;
            buf.forEach(function (ln) {
              if (/^\\item\b/.test(ln.trim())) {
                if (cur !== null) items.push(cur);
                cur = ln.replace(/^\\item\s?/, '');
              } else if (cur !== null) { cur += '\n' + ln; }
            });
            if (cur !== null) items.push(cur);
            out.push('<' + tagL + '>' + items.map(function (it) {
              return '<li>' + inlineFromLatex(it) + '</li>';
            }).join('') + '</' + tagL + '>');
          } else if (env === 'quote') {
            out.push('<blockquote>' + inlineFromLatex(buf.join('\n')) + '</blockquote>');
          } else if (env === 'verbatim') {
            out.push('<pre>' + esc(buf.join('\n')) + '</pre>');
          } else if (env === 'center' || env === 'flushleft' || env === 'flushright') {
            var cls = env === 'center' ? 'ql-align-center'
              : (env === 'flushleft' ? 'ql-align-left' : 'ql-align-right');
            out.push('<div class="' + cls + '">' + convertLines(buf).join('') + '</div>');
          } else if (env === 'aularaw') {
            // El contenido de aularaw ES el código crudo: se guarda tal cual,
            // sin el wrapper (htmlToLatex lo vuelve a envolver al salir).
            hasRaw = true;
            out.push(rawBlockHtml(buf.join('\n'), ''));
          } else {
            // otro entorno no soportado → bloque opaco, NADA se pierde
            hasRaw = true;
            out.push(rawBlockHtml(rawEnv, env));
          }
          continue;
        }

        if ((m = t.match(/^\\aulaimg\{([^}]*)\}\{([^}]*)\}$/))) {
          out.push('<img src="' + escAttr(m[1]) + '" alt="' + escAttr(m[2]) + '">');
          i++; continue;
        }
        if ((m = t.match(/^\\aulavideo\{([^}]*)\}$/))) {
          out.push(ytHtml(parseYouTubeId(m[1]) || m[1]));
          i++; continue;
        }
        if (t.indexOf('$$') === 0) {
          var accD = t.slice(2);
          if (accD.indexOf('$$') >= 0 && accD.length > 1) {
            out.push(mathBlockHtml(accD.slice(0, accD.indexOf('$$')).trim()));
            i++; continue;
          }
          i++;
          while (i < srcLines.length && srcLines[i].indexOf('$$') < 0) { accD += '\n' + srcLines[i]; i++; }
          if (i < srcLines.length) { accD += '\n' + srcLines[i].replace(/\$\$.*/, ''); i++; }
          out.push(mathBlockHtml(accD.trim()));
          continue;
        }

        // párrafo: acumular líneas hasta línea en blanco o comando de bloque
        var para = [srcLines[i]];
        i++;
        while (i < srcLines.length) {
          var nt = srcLines[i].trim();
          if (!nt || /^\\(sub)*section\*|^\\begin\{|^\\aulaimg|^\\aulavideo|^\$\$/.test(nt)
            || CMD_DEF_RE.test(nt)) break;
          para.push(srcLines[i]); i++;
        }
        var px = inlineFromLatex(para.join('\n'));
        if (px.trim()) out.push('<p>' + px + '</p>');
      }
      return out;
    }

    // Los bloques se concatenan SIN '\n': un salto de línea entre
    // <div> embeds se interpretaba como texto y Quill lo materializaba
    // como <p> </p> basura al volver a WYSIWYG (bug duplicación/espurios).
    return { html: convertLines(lines).join(''), hasRaw: hasRaw };
  }

  var api = { htmlToLatex: htmlToLatex, latexToHtml: latexToHtml };
  root.AULA_CONVERT = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
