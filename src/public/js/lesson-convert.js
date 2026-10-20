// Conversor HTML ↔ LaTeX del editor (Hito 3/4). Puro, sin dependencias:
// usa el DOM del navegador (document.createElement) para parsear el HTML.
// Lossless: lo no convertible se conserva en data-latex-raw (aularaw).
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
      else if (t === 'br') out += '\\\\\n';
      else if (t === 'span' && ds.latex !== undefined) out += '$' + ds.latex + '$';
      else out += inlineToLatex(n);
    });
    return out;
  }

  function htmlToLatex(html) {
    var root = document.createElement('div');
    root.innerHTML = html;
    var blocks = [];
    Array.prototype.forEach.call(root.childNodes, function (el) {
      if (el.nodeType === 3) {
        if (el.textContent.trim()) blocks.push(escapeLatexText(el.textContent.trim()));
        return;
      }
      if (el.nodeType !== 1) return;
      var t = el.tagName.toLowerCase();
      var ds = el.dataset || {};
      if (t === 'h1') blocks.push('\\section*{' + inlineToLatex(el) + '}');
      else if (t === 'h2') blocks.push('\\subsection*{' + inlineToLatex(el) + '}');
      else if (t === 'h3') blocks.push('\\subsubsection*{' + inlineToLatex(el) + '}');
      else if (t === 'p') {
        var tx = inlineToLatex(el);
        if (tx.trim()) blocks.push(tx);
      } else if (t === 'ul' || t === 'ol') {
        var env = t === 'ul' ? 'itemize' : 'enumerate';
        var items = Array.prototype.map.call(el.querySelectorAll(':scope > li'), function (li) {
          return '\\item ' + inlineToLatex(li);
        });
        blocks.push('\\begin{' + env + '}\n' + items.join('\n') + '\n\\end{' + env + '}');
      } else if (t === 'blockquote') {
        blocks.push('\\begin{quote}\n' + inlineToLatex(el) + '\n\\end{quote}');
      } else if (t === 'pre') {
        blocks.push('\\begin{verbatim}\n' + el.textContent + '\n\\end{verbatim}');
      } else if (t === 'img') {
        blocks.push('\\aulaimg{' + (el.getAttribute('src') || '') + '}{' + (el.getAttribute('alt') || '') + '}');
      } else if (t === 'div' && ds.youtube) {
        blocks.push('\\aulavideo{https://youtu.be/' + ds.youtube + '}');
      } else if (t === 'div' && ds.latex !== undefined) {
        blocks.push('$$\n' + ds.latex + '\n$$');
      } else if (t === 'div' && ds.latexRaw !== undefined) {
        blocks.push('\\begin{aularaw}\n' + ds.latexRaw + '\n\\end{aularaw}');
      } else if (t === 'div' || t === 'section') {
        blocks.push(htmlToLatex(el.innerHTML));
      } else {
        blocks.push(inlineToLatex(el));
      }
    });
    return blocks.join('\n\n');
  }

  // ---------- LaTeX → HTML ----------
  function inlineFromLatex(s) {
    var x = esc(s);
    x = x.replace(/\\textbf\{([^{}]*)\}/g, '<strong>$1</strong>');
    x = x.replace(/\\textit\{([^{}]*)\}/g, '<em>$1</em>');
    x = x.replace(/\\underline\{([^{}]*)\}/g, '<u>$1</u>');
    x = x.replace(/\\sout\{([^{}]*)\}/g, '<s>$1</s>');
    x = x.replace(/\\texttt\{([^{}]*)\}/g, '<code>$1</code>');
    x = x.replace(/\\href\{([^{}]*)\}\{([^{}]*)\}/g, '<a href="$1">$2</a>');
    x = x.replace(/\$([^$]+)\$/g, function (m0, l) {
      return mathInlineHtml(l.replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"'));
    });
    return x;
  }

  function latexToHtml(src) {
    var lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var hasRaw = false;
    var i = 0;

    function readEnv(name) {
      var endRe = new RegExp('\\\\end\\{' + name + '\\}');
      var buf = [];
      while (i < lines.length) {
        if (endRe.test(lines[i])) { i++; return buf; }
        buf.push(lines[i]); i++;
      }
      return buf;
    }

    while (i < lines.length) {
      var t = lines[i].trim();
      if (!t) { i++; continue; }
      var m;

      if ((m = t.match(/^\\(sub)*section\*\{(.*)\}$/))) {
        var tag = m[1] === 'subsub' ? 'h3' : (m[1] === 'sub' ? 'h2' : 'h1');
        out.push('<' + tag + '>' + inlineFromLatex(m[2]) + '</' + tag + '>');
        i++; continue;
      }

      if ((m = t.match(/^\\begin\{(\w+)\}$/))) {
        var env = m[1];
        i++;
        var buf = readEnv(env);
        var rawEnv = '\\begin{' + env + '}\n' + buf.join('\n') + '\n\\end{' + env + '}';
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
        } else {
          // aularaw u otro entorno no soportado → bloque opaco, NADA se pierde
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
        var acc = t.slice(2);
        if (acc.indexOf('$$') >= 0 && acc.length > 1) {
          out.push(mathBlockHtml(acc.slice(0, acc.indexOf('$$')).trim()));
          i++; continue;
        }
        i++;
        while (i < lines.length && lines[i].indexOf('$$') < 0) { acc += '\n' + lines[i]; i++; }
        if (i < lines.length) { acc += '\n' + lines[i].replace(/\$\$.*/, ''); i++; }
        out.push(mathBlockHtml(acc.trim()));
        continue;
      }

      // párrafo: acumular líneas hasta línea en blanco o comando de bloque
      var para = [lines[i]];
      i++;
      while (i < lines.length) {
        var nt = lines[i].trim();
        if (!nt || /^\\(sub)*section\*|^\\begin\{|^\\aulaimg|^\\aulavideo|^\$\$/.test(nt)) break;
        para.push(lines[i]); i++;
      }
      var px = inlineFromLatex(para.join('\n'));
      if (px.trim()) out.push('<p>' + px + '</p>');
    }

    return { html: out.join('\n'), hasRaw: hasRaw };
  }

  var api = { htmlToLatex: htmlToLatex, latexToHtml: latexToHtml };
  root.AULA_CONVERT = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
