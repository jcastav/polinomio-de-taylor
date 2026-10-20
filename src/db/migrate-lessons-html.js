// Migración one-time de lecciones markdown legacy → HTML canónico (Hito 6).
// Idempotente: solo toca contenido que NO pasa isHtmlContent. No se ejecuta
// al arrancar el servidor; es manual:
//
//   node src/db/migrate-lessons-html.js --dry-run   # qué haría
//   node src/db/migrate-lessons-html.js             # aplica
//
// Tras migrar, la lección se abre en el editor 3 modos como HTML y el
// render dual (Hito 1) la trata con el perfil permisivo confinado en el
// iframe sandbox. El markdown original se sustituye por su HTML saneado
// con el MISMO pipeline de vista (marked + sanitizado estricto §12).
require('dotenv').config();
const { sb, unwrap } = require('./client');
const { isHtmlContent } = require('../lib/lesson-html');
const { renderMarkdown } = require('../lib/markdown');

async function main() {
  const dry = process.argv.includes('--dry-run');
  const lessons = unwrap(await sb().from('lessons')
    .select('id, title, content')
    .order('id', { ascending: true }));

  let migrated = 0;
  let skipped = 0;
  for (const l of lessons) {
    if (!l.content || !l.content.trim() || isHtmlContent(l.content)) {
      skipped++;
      continue;
    }
    let html;
    try {
      html = renderMarkdown(l.content);
    } catch (e) {
      console.log('WARN id=' + l.id + ': marked falló (' + e.message + '), se omite');
      skipped++;
      continue;
    }
    if (!html || !isHtmlContent(html)) {
      console.log('WARN id=' + l.id + ': la conversión no produjo HTML, se omite');
      skipped++;
      continue;
    }
    console.log((dry ? 'DRY  ' : 'OK   ') + 'id=' + l.id + '  ' + JSON.stringify(l.title));
    if (!dry) {
      unwrap(await sb().from('lessons').update({ content: html }).eq('id', l.id));
    }
    migrated++;
  }
  console.log('Listo: ' + migrated + ' migradas' + (dry ? ' (dry-run, nada escrito)' : '') +
    ', ' + skipped + ' sin cambios.');
}

main().catch((e) => { console.error(e); process.exit(1); });
