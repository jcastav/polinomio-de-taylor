const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

marked.setOptions({ gfm: true });

// §12: marked + sanitizado siempre. El HTML crudo del markdown nunca
// llega al cliente sin pasar por aquí.
function renderMarkdown(md) {
  const raw = marked.parse(md || '');

  return sanitizeHtml(raw, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'img', 'h1', 'h2', 'h3', 'h4',
      'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'pre', 'code', 'span',
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ['href', 'name', 'target', 'rel'],
      img: ['src', 'alt', 'title'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
  });
}

module.exports = { renderMarkdown };
