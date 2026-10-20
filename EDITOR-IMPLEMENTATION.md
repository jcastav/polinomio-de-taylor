# EDITOR-IMPLEMENTATION.md — Memoria de implementación del editor 3 modos

Archivo de memoria a largo plazo para la integración del editor de lecciones
(WYSIWYG + LaTeX + HTML). Si la conversación pierde contexto, **este archivo es
la fuente de verdad del estado**. Se actualiza en cada hito y ante cada
decisión técnica no especificada en las instrucciones originales.

---

## 1. Objetivo

Reemplazar el editor markdown de lecciones por un editor de **3 modos** sobre
el mismo documento:

- **WYSIWYG** (Quill 2) — para usuarios sin experiencia técnica.
- **HTML** (CodeMirror 5) — libertad total del admin (`<style>`, `<script>`).
- **LaTeX** (CodeMirror 5) — autores técnicos.

Regla de oro: **lossless round-trip** — nada se pierde entre modos. El HTML
es el formato canónico en `lessons.content`; el LaTeX no convertible se
conserva íntegro en `data-latex-raw`.

## 2. Reglas cerradas del usuario (resumen literal)

1. **Lossless**: LaTeX no convertible (`align`, tablas, `\newcommand`, …) →
   bloque visual (imagen MathJax o placeholder) + código original intacto en
   `data-latex-raw="..."` en el HTML canónico. WYSIWYG→LaTeX lee
   `data-latex-raw` y devuelve el código original exacto, jamás lo adivina
   desde la imagen. Tablas LaTeX → `data-latex-raw` con placeholder. La
   "conversión a imagen" es solo representación visual del editor; la BD y el
   HTML canónico **siempre** conservan `data-latex-raw`.
2. **Quill 2 obligatorio**. PROHIBIDO `document.execCommand` o contenteditable
   directo en la integración (el mockup los usó solo para prototipar).
3. **Móvil**: bubble menu y bottombar deben escuchar `touchstart` con
   `preventDefault()` además de `mousedown`, para no colapsar la selección.
4. **Fallback "Convertir a imagen"**: render MathJax del bloque → captura PNG
   con `html2canvas` (o similar) → sube a Supabase Storage vía
   `/admin/uploads` → inserta `<img>` en el HTML. El original **siempre**
   se conserva en `data-latex-raw`.
5. **Sanitizado**: `sanitize-html` en guardado (admin) y en render.
   El HTML de Quill y los `data-latex*` deben sobrevivir al sanitize.
   MathJax se ejecuta **después** de sanitize-html (sus etiquetas no se
   eliminan). El conversor debe soportar acentos, ñ y caracteres especiales.
6. **Libertad del admin en HTML**: `<style>` y `<script>` permitidos. La vista
   del estudiante renderiza el contenido de la lección dentro de un
   `<iframe sandbox="allow-scripts">` (SIN `allow-same-origin`):
   - `src` de ruta interna `GET /c/:slug/l/:lessonId/render` que devuelve SOLO
     el HTML de la lección envuelto en plantilla limpia con estilos base.
   - `width:100%` + altura dinámica vía `postMessage` desde el iframe al padre.
   - sanitize-html en guardado permite `style`/`script`; solo se ejecutan
     dentro del iframe aislado. Fuera del iframe el HTML **no** se inyecta.
   - Estilos base de la plataforma (tipografía Tahoma/Georgia, colores,
     bordes) dentro del iframe para que una lección sin CSS propio se vea
     integrada.
7. **Sin cambios de schema** (`supabase/schema.sql` intocable). Si algo no
   cuadra → PARAR y preguntar. `src/db/seed.js` también intocable (regla previa
   del proyecto): la migración a HTML es un script aparte one-time.

## 3. Arquitectura (decidida)

### 3.1 Almacenamiento y formatos

- **Canónico**: HTML en `lessons.content` (producción del editor Quill).
- **Legado**: contenido markdown (seed + lecciones demo antiguas). Se cubre
  con detección dual en render hasta migrar; el script one-time
  `src/db/migrate-lessons-html.js` (marked → HTML) convierte todo al canónico.
- Detección `isHtmlContent()`: heurística por etiquetas comunes
  (`p|h1-h6|div|ul|ol|blockquote|pre|img|span|table|figure`). Falsa negativa
  imposible de eliminar sin columna de formato (schema intocable); se acepta
  y se documenta.

### 3.2 Librería `src/lib/lesson-html.js` (nueva)

- `isHtmlContent(content)` — heurística dual.
- `sanitizeLessonHtml(html)` — perfil **permisivo** (editor HTML):
  permite `style`, `script`, `div[data-youtube|data-latex|data-latex-raw]`,
  `span[data-latex|class]`, `iframe` solo hostnames youtube/vimeo
  (`allowedIframeHostnames`), atributos de tabla, `img/a/pre/code/…`.
  `allowVulnerableTags: true` (aceptado documentadamente: la ejecución queda
  confinada en el iframe sandbox de origen opaco). SIEMPRE se eliminan
  handlers `on*`, `javascript:` y `data:` (schemes http/https/mailto).
- `renderLessonContent(content)` — dual: HTML → `sanitizeLessonHtml`;
  markdown legado → `renderMarkdown` (perfil estricto legacy, §12).
- `renderLessonDocument({ innerHtml, token, title })` — documento completo
  para el iframe: `lang="es"`, viewport, `link` a `/css/tokens.css` y
  `/css/base.css` (paleta/fuentes compartidas, sin duplicar), estilos base de
  lección inline (copiados de `components.css`), contenido saneado, MathJax 3
  (CDN fijado) **inyectado por la plantilla** (no por el contenido → siempre
  después del sanitize), y script cliente:
  - transforma `div[data-youtube]` → `<iframe src="https://www.youtube-nocookie.com/embed/ID">`
    (ID filtrado a `[\w-]`; se crean iframes **dentro** del sandbox, no pasan
    por sanitize server-side),
  - MathJax `typesetPromise` sobre el body tras el transform,
  - `postMessage({type:'aula:lesson-height', token, height})` al padre con
    `ResizeObserver` + tras typeset.

### 3.3 Rutas y vistas

- **Nueva** `GET /c/:slug/l/:lessonId/render` (student.js, `requireStudent`
  — también accesible al admin): mismos checks de pertenencia curso↔módulo↔
  lección que la vista de lección; responde el documento de §3.2 con
  `Cache-Control: no-store`.
- **Vista estudiante** (`student/lesson.ejs`): el contenido ya NO se inyecta
  inline; se sirve `<iframe class="lesson-frame" sandbox="allow-scripts"
  src="…/render?t=TOKEN" data-token="TOKEN">`. TOKEN aleatorio por request
  (crypto) generado en la ruta de lección; el listener de
  `src/public/js/lesson-frame.js` valida `event.source === iframe.contentWindow`
  y `data.token` antes de fijar la altura.
- **Vista admin** (`admin/lesson-edit.ejs`): la "Vista previa" deja de ser
  `innerHTML` (riesgo de ejecutar scripts del admin en origen de la
  plataforma) y pasa a ser un `<iframe sandbox="allow-scripts">` con
  `srcdoc` — el endpoint `POST /admin/lessons/:id/preview` devuelve el
  documento completo (`{doc}`) construido con `renderLessonDocument`. El
  contenido sin guardar se previsualiza igual, aislado.
- **Guardado admin**: `POST /admin/lessons/:id` sanitiza `content` con
  `sanitizeLessonHtml` antes de persistir (defensa en profundidad; el render
  vuelve a sanitizar).

### 3.4 Editor (hitos posteriores)

- **Quill 2** (CDN fijado, sin build): pestaña WYSIWYG. Custom blots:
  - math inline/bloque: `<span class="math-inline" data-latex="…">\(…\)</span>`
    / `<div class="math-block" data-latex="…">\[…\]</div>` (el texto con
    delimitadores permite el typeset de MathJax por scanning; el atributo es
    la fuente para el conversor). En el editor se muestran como chips
    monospace (MathJax NO typeset dentro del DOM de Quill: rompería el
    Delta). MathLive solo en el diálogo de inserción/edición.
  - youtube: `<div data-youtube="ID">` (Block blot con placeholder 16/9).
  - raw LaTeX: `<div class="raw-block" data-latex-raw="…">` con chip "LaTeX"
    y botón "Ver en modo LaTeX".
- **CodeMirror 5** (CDN fijado, modos htmlmixed + stex, addons closetag/
  closebrackets/matchbrackets): pestañas HTML y LaTeX. CM5 NO ejecuta JS
  del usuario (solo lo muestra); el sanitize ocurre al guardar.
- **Toolbar**: >820px toolbar Quill arriba (borde 1px, fondo `--panel`, sin
  radius); <820px sin toolbar arriba, bubble menu propio (formatos inline)
  + bottombar fija con `window.visualViewport` (ajuste iOS Safari).
  Handlers de la bottombar/bubble: `mousedown` + `touchstart` con
  `preventDefault()`.
- **Imagen**: file picker → `POST /admin/uploads` (ya existe; validar
  `image/*` y ≤10MB en cliente).
- **Conversor HTML↔LaTeX** (propio, sin dependencias): `\aulaimg{URL}{alt}`,
  `\aulavideo{URL}`, `\begin{aularaw}…\end{aularaw}`; opacos para el resto
  (`align`, `cases`, matrices, `newcommand`, tablas…). Round-trip: opaco
  HTML→LaTeX devuelve el texto original de `data-latex-raw` sin interpretar.
- **Convertir a imagen**: MathJax typeset del bloque en un contenedor off-DOM
  → `html2canvas` → PNG → `POST /admin/uploads` → `<figure><img …></figure>`
  con `data-latex-raw` preservado en el figure.

### 3.5 Migración

- `src/db/migrate-lessons-html.js`: por cada lección cuyo contenido no pasa
  `isHtmlContent()`, `marked` → `sanitizeLessonHtml` → update. One-time,
  idempotente. Se ejecuta tras el seed en setups nuevos (pasos en README).
- `seed.js` permanece en markdown (regla intocable). El dual-format cubre el
  seed hasta que el dueño decida migrarlo en un commit propio.

### 3.6 Versiones CDN (fijadas)

| Librería | Versión | Uso |
|---|---|---|
| CodeMirror | `5.65.16` (jsdelivr) | pestañas HTML/LaTeX |
| MathJax | `3` (`tex-mml-chtml.js`, jsdelivr) | render de `data-latex` (lectura) |
| MathLive | `0.111.1` (jsdelivr) | diálogo de fórmulas (editor) |
| Quill | `2.0.3` (jsdelivr) | WYSIWYG |
| html2canvas | fijar al integrar (Hito 5) | convertir-a-imagen |

Sin build step: todo por CDN o `src/public/js` plano. Sin npm nuevo salvo
necesidad demostrada.

## 4. Hitos

| # | Hito | Estado |
|---|---|---|
| 0 | `EDITOR-IMPLEMENTATION.md` (este archivo) | ✅ |
| 1 | Render infra: `lesson-html.js`, ruta `/render`, iframe sandbox en estudiante y preview admin, dual-format, MathJax, youtube transform, postMessage height | ✅ `14cf38c` (45/45 checks) |
| 2 | Quill 2 WYSIWYG en editor de lección (blots math/youtube/raw, uploads imagen, bottombar/bubble móvil, guardado sanitizado) | ✅ `7e8999e` (36/36 checks + A–E verde) |
| 3 | CodeMirror 5: pestañas HTML y LaTeX sobre el mismo documento | ✅ `d7a9435` (28/28 checks + A–E verde) |
| 4 | Conversor HTML↔LaTeX lossless (aulaimg/aulavideo/aularaw, opacos, acentos/ñ) | ✅ `db03ab2` (46/46 checks jsdom + A–E verde) |
| 5 | Fallback "Convertir a imagen" (MathJax → html2canvas → upload; `data-latex-raw` preservado) | ✅ `b83c137` (29/29 checks + A–E verde) |
| 6 | Migración de lecciones demo a HTML + tests E2E + README | ✅ `6734db3` (40/40 checks E2E + A–E verde 135/135) |

**Protocolo**: al terminar cada hito → commit atómico → actualizar §5 y §6 de
este archivo → resumen ejecutivo → PARAR y esperar luz verde.

### 4.1 Decisiones tomadas en la implementación (log)

| # | Decisión | Razón | Hito |
|---|---|---|---|
| D1 | Sanitizado al guardar SOLO si `isHtmlContent(content)`; markdown legacy queda intacto en la BD | El sanitize-html re-serializa y podría romper `<` sueltos del markdown; el markdown se sanea estricto al render (§12) | 1 |
| D2 | Preview admin = iframe `srcdoc` + `{doc}` desde `POST /preview` (token ecoado en el body) | Nunca inyectar HTML del admin inline en la página admin (regla del apéndice); srcdoc aísla igual que /render | 1 |
| D3 | YouTube → `youtube-nocookie.com/embed/` vía transform **client-side** dentro del iframe | Sin dependencias extra (cheerio); el ID se filtra a `[\w-]`; se crea dentro del sandbox | 1 |
| D4 | MathJax solo se inyecta en el documento si el contenido tiene `data-latex`/`\(`/`\[` | Evita carga CDN muerta en lecciones legacy | 1 |
| D5 | Altura: `ResizeObserver` + resize + postMessage con token por request; listener en `/js/lesson-frame.js` (clase `.lesson-frame`, reutilizado por el preview admin) | Un solo mecanismo para estudiante y preview | 1 |
| D6 | `tmp-check-a.ps1` ajustado: última lección del módulo 1 se resuelve dinámicamente (el usuario añadió la lección 68 "Ejemplo" a mano; el test hardcodeaba la 10) | Datos manuales ≠ regresión rota; A vuelve a 29/29 | 1 |
| D7 | CDN fijados: Quill **2.0.3**, MathLive **0.111.1** (jsdelivr). Assets propios: `public/js/lesson-editor.js` + `public/css/lesson-editor.css`. `layout.ejs` ganó hook `extraHead` (inyectado solo en modo wysiwyg) | Sin build step; paleta del mockup aprobado | 2 |
| D8 | Tres modos de edición en `lesson-edit.ejs`: `wysiwyg` (contenido vacío o HTML simple), `raw-legacy` (markdown sin tocar), `raw-advanced` (contiene `<script>`/`<style>`/`data-latex-raw` → textarea cruda con aviso, hasta las pestañas del Hito 3). NO se migra markdown al abrir (migración = Hito 6) | Quill solo conserva lo que sus blots serializan; el aviso evita pérdida silenciosa | 2 |
| D9 | Lecciones nuevas nacen con `content: ''` (antes placeholder markdown) para abrir directo en Quill | Flujo admin nuevos sin markdown | 2 |
| D10 | Blots ES6 (`class extends Embed/BlockEmbed` — el patrón ES5 con `.call()` rompe en Quill 2). Math = chips monospace con `data-latex` (MathJax NO typeset dentro del DOM de Quill); clic en chip abre el diálogo MathLive para editar; `aula-youtube` y `aula-raw` igual con sus diálogos | API de Quill 2; Delta no se rompe | 2 |
| D11 | Imagen: file picker valida `image/*` y ≤10MB en cliente → `POST /admin/uploads` → `insertEmbed('image', url)` | Upload ya existente (§8.3) | 2 |
| D12 | Móvil: bottombar + bubble propios (no el theme bubble de Quill); botones con `touchstart`+`preventDefault` Y `click`; bubble positioned con `quill.getBounds`; bottombar ajustada con `window.visualViewport` | Instrucción 2.b del usuario; iOS Safari | 2 |
| D13 | Puente `textarea.ed-bridge` (name=content) sincronizado en `submit` del form y en el botón Previsualizar vía `window.AULA_LESSON_EDITOR.getHtml()`. Sin JS, el form degrada al contenido original del textarea | Sin romper el POST existente | 2 |
| D14 | El conversor `lesson-convert.js` (port del mockup aprobado) se implementa YA en el Hito 3 para que las pestañas HTML↔LaTeX funcionen end-to-end; el Hito 4 lo endurece (entornos opacos, round-trip exacto, avisos, tests con acentos) | Las pestañas sin conversor quedarían inútiles; commits funcionales | 3 |
| D15 | Pestañas WYSIWYG/HTML/LaTeX SIEMPRE visibles. `initialTab`: `html` para markdown legacy o contenido avanzado (script/style/data-latex-raw), `wysiwyg` para vacío/HTML simple. El documento canónico entre pestañas es el HTML (`currentHtml()`); LaTeX se convierte al salir de la pestaña. Al entrar a WYSIWYG con contenido avanzado: `confirm()` de aviso de pérdida | Lossless salvo confirmación explícita del usuario | 3 |
| D16 | CodeMirror por CDN `5.65.16` con modos xml+javascript+css+htmlmixed+stex y addons closetag/closebrackets/matchbrackets. Los paneles CM solo existen como pestañas (no dos editores simultáneos); el bottombar/bubble móvil se ocultan fuera de la pestaña WYSIWYG (`.ed-host[data-tab]`) | Un solo documento, sin duplicar estado | 3 |
| D17 | Tokenizador de `inlineFromLatex` (regex por llamada, recursivo): los escapes de texto LaTeX (`\%`, `\&`, `\#`, `\$`, `\_`, `\{`, `\}`, `\\`→`<br>`) se decodifican SOLO en segmentos de texto plano, nunca dentro de atributos `data-latex*` → «texto → LaTeX → texto» exacto con ñ, acentos y símbolos | Lossless real; el enfoque de replace global del mockup corrompía atributos | 4 |
| D18 | `\newcommand`/`\renewcommand`/`\providecommand`/`\def` (llaves balanceadas) y `\begin{env}` con argumentos (`\begin{tabular}{ll}`, `[opt]`) → bloque opaco con código exacto; `equation`, `tabular`, etc. siguen opacos (el nombre del entorno se conserva en `data-latex-raw`); `center`/`flushleft`/`flushright` ↔ `div.ql-align-*` (Quill) con conversión de contenido anidado | Lo no convertible nunca se degrada; lo convertible conserva el entorno original | 4 |
| D19 | `aularaw` es bidireccional exacto: `\begin{aularaw}\nX\n\end{aularaw}` ↔ `div.raw-block[data-latex-raw="X"]` (X SIN el wrapper; el wrapper se re-emite al volver a LaTeX). Imagen inline: `\aulaimg{src}{alt}` se reconoce también dentro de párrafos. Al pasar a pestaña LaTeX con `<script>`/`<style>`/`<table>`: `confirm()` de aviso | Round-trip estable sin anidamiento de wrappers | 4 |
| D20 | Fallback "Convertir a imagen": botón `raw-convert` en el blot `aula-raw`; carga lazy de MathJax 3 CHTML + html2canvas 1.4.1 por CDN solo al pulsar; typeset off-screen → `canvas.toBlob` → `POST /admin/uploads` (Supabase Storage en prod) → blot `aula-lateximg` (`<img class="aula-lateximg" data-latex-raw="…">`). El conversor emite `aularaw` para img con `data-latex-raw` (nunca `\aulaimg`, que perdería el original); sanitize conserva `data-latex-raw` en img | El PNG es SOLO representación visual: el código LaTeX original vive siempre en `data-latex-raw` (regla 1 del usuario) | 5 |
| D21 | MathJax y html2canvas NO se cargan en el head del editor: se lazy-loadan en la primera conversión (MathJax pesa ~1 MB). El host off-screen `.aula-convert-host` se elimina siempre (éxito o error) | Editor rápido hasta que se usa el fallback | 5 |
| D22 | Migración one-time manual `src/db/migrate-lessons-html.js` (NO en el arranque): `--dry-run` para revisar; convierte solo contenido que no pasa `isHtmlContent` usando el MISMO pipeline de vista (marked + sanitize estricto §12). Idempotente. Ejecutada en la BD local del Hito 6: **6 lecciones migradas (9, 10, 13, 24, 28, 68), 0 restantes** | El schema y el seed quedan intactos (regla del usuario) | 6 |
| D23 | Tests E2E del Hito 6 (`tmp-check-hito6.js`): flujo completo admin→curso publicado→módulo→lección→contenido rico (math/youtube/raw/lateximg/ñ)→editor seed→preview {doc}→estudiante creado→vista con iframe sandbox→/render con todos los embeds→migración real+idempotente | Cubre el viaje end-to-end sin navegador real | 6 |
| D24 | **Fix post-cierre (bug crítico de duplicación, reportado en test manual)**: `switchTab('wysiwyg')` y la semilla usaban `quill.clipboard.dangerouslyPasteHTML(0, html)`, que INSERTA en el índice sin borrar lo anterior (el Delta no se limpia) → cada ida y vuelta duplicaba. Nuevo helper `setQuillHtml(html)`: `clipboard.convert({html})` → `setContents(delta, 'silent')` → `setSelection(0,0)`; NUNCA `root.innerHTML=` (no actualiza el Delta). Segundo bug hallado por el test: `latexToHtml` unía bloques con `'\n'` y ese salto entre `<div>` embeds se materializaba como `<p> </p>` basura → ahora `join('')` | Reemplazo canónico de Quill 2 + HTML sin nodos de texto espurios | 7 |
| D25 | Verificación del fix con **navegador real**: `puppeteer-core` (devDependency) lanzando el Edge del sistema en headless sobre el editor completo (`tmp-check-hito7.js`): 3 ciclos exactos, blots únicos, ñ/acentos, guardado desde pestaña. Tests de Hito 2 actualizados a D15 (las aserciones de los antiguos modos "crudos" ya no aplicaban) | Evidencia end-to-end sin depender de JS simulado | 7 |

## 5. Registro de commits

| Commit | Hito | Descripción |
|---|---|---|
| `c2e3d0b` | — | feat: mockup editor 3 modos (aprobado visualmente) |
| `5b1894c` | 0 | docs: EDITOR-IMPLEMENTATION.md |
| `14cf38c` | 1 | feat: render de lección en iframe sandbox con dual-format |
| `7e8999e` | 2 | feat: editor Quill 2 WYSIWYG con blots custom y MathLive |
| `d7a9435` | 3 | feat: CodeMirror 5 en pestañas HTML y LaTeX con conversor base |
| `db03ab2` | 4 | feat: conversor HTML↔LaTeX lossless (tokenizador, opacos, acentos/ñ) |
| `b83c137` | 5 | feat: fallback "Convertir a imagen" (MathJax+html2canvas→uploads, data-latex-raw) |
| `6734db3` | 6 | feat: migración markdown→HTML + E2E del editor + README |
| `5d3aeb2` | 7 | fix: duplicación al cambiar de pestaña (setContents + join sin `\n`) |

## 6. Pendientes y cosas raras

- **YouTube dentro de `sandbox="allow-scripts"`**: la reproducción REAL del
  embed youtube-nocookie dentro del iframe sandbox **queda pendiente de
  verificación manual** en el navegador (Hito 1 dejó el transform y los
  estilos; no se pudo probar reproducción desde Node). Si no reproduce,
  evaluar `allow-same-origin` — NO sin volver a preguntar.
- **"Convertir a imagen"**: el clic real en navegador (MathJax typeset +
  html2canvas rasteriza + sube) **queda pendiente de verificación manual**
  (Node no ejecuta canvas/CDN); lo automatizado cubre el conversor, la
  subida real a uploads (Supabase Storage) y el sanitize/guardado.
- **sanitize-html + `allowVulnerableTags`**: emite warning de XSS; es
  intencional y está confinado. No quitar el flag.
- Lecciones 9/24/28, **68 "Ejemplo" (módulo 1)** y quiz 17 en BD local son
  producto de pruebas manuales del usuario; no culpar al código si los
  tests se desincronizan (D6).
- Regresión completa: `tmp-check-a/b/c/d/e.ps1` (**A 29/29, B 18/18,
  C 22/22, D 35/35, E 31/31** — verde tras cada hito 1–5) +
  `tmp-check-hitoN.js` por hito.
  Servidor :3100. Tras tocar `src/routes/*.js` → reiniciar servidor (falso
  error `ChildProcess.kill` con Start-Process; verificar con GET /login 200).
- Los `tmp-*` son gitignored; scripts de prueba por hito:
  `tmp-check-hitoN.js` (Node, fetch + cookies).
- **Preview admin con `srcdoc`**: verificado en Hito 1 (URLs relativas
  resuelven contra el padre; tokens.css/base.css cargan). El botón
  Previsualizar sincroniza Quill → POST → srcdoc (verificado en Hito 2).
- `tmp-check-hito1.js` y `tmp-check-hito2.js` reutilizables como base
  (login admin, creación de módulo/lección tmp, limpieza).
- **Si un run de `tmp-check-e.ps1` se interrumpe** (timeout), deja curso
  `tmp-test-6b-curso` y estudiante `tmp-test-alum6b`: limpiar con
  `sb().from('courses').delete().like('slug','tmp-test-6b%')` +
  users like `tmp-test-alum6b` antes de reintentar (slugs duplicados
  rompen el regex del setup).
- El editor WYSIWYG solo carga en modo `wysiwyg`; las páginas raw no
  descargan Quill/MathLive (extraHead condicional).

## 7. Cómo probar (por hito)

```powershell
# servidor (si no está corriendo)
$env:PORT=3100; Start-Process node -ArgumentList 'src/server.js' `
  -RedirectStandardOutput tmp-server.log -RedirectStandardError tmp-server.err

node tmp-check-hito1.js      # checks Hito 1 (45/45)
node tmp-check-hito2.js      # checks Hito 2 (36/36)
node tmp-check-hito3.js      # checks Hito 3 (28/28)
node tmp-check-hito4.js      # checks Hito 4 conversor (46/46, jsdom)
node tmp-check-hito5.js      # checks Hito 5 convertir-a-imagen (29/29)
node tmp-check-hito6.js      # E2E editor + migración (40/40)
node tmp-check-hito7.js      # fix duplicación, navegador real Edge (18/18)
.\tmp-check-a.ps1            # regresión completa A–E tras cada hito
```

Pruebas manuales clave del Hito 1: abrir una lección como estudiante (iframe
crece al cargar, MathJax renderiza, YouTube embebido reproduce), preview del
admin con `<script>`/`<style>` (se ven dentro del iframe, no rompen la
plataforma), lección markdown legacy se ve normal.

## 8. Resumen final de la implementación (Hitos 0–6 completados)

**Estado: IMPLEMENTACIÓN COMPLETA.** Los 7 hitos (0–6) del plan quedaron
implementados, probados y commiteados de forma atómica:

| Hito | Qué entrega | Commit | Tests |
|---|---|---|---|
| 0 | Este plan en `EDITOR-IMPLEMENTATION.md` | `5b1894c` | — |
| 1 | Render infra: `lesson-html.js` (sanitize dual permisivo/estricto + `isHtmlContent`), `GET /c/:slug/l/:id/render`, iframe `sandbox="allow-scripts"` (sin `allow-same-origin`) en estudiante y preview admin (`srcdoc` + `{doc}` con token), MathJax condicional, transform youtube-nocookie, `postMessage` de altura con token anti-spoofing | `14cf38c` | 45/45 |
| 2 | Editor Quill 2 WYSIWYG: blots ES6 `aula-math-inline/block`, `aula-youtube`, `aula-raw`; diálogos MathLive/YouTube/LaTeX crudo; imágenes vía `/admin/uploads` ≤10MB; bottombar+bubble móvil con `touchstart`+`preventDefault`; guardado sanitizado; puente `ed-bridge` | `7e8999e` | 36/36 + A–E |
| 3 | CodeMirror 5.65.16 en pestañas **WYSIWYG \| HTML \| LaTeX** (htmlmixed+stex+addons); documento canónico HTML (`currentHtml()`); pestaña inicial según contenido (D15); conversor base | `d7a9435` | 28/28 + A–E |
| 4 | Conversor lossless: tokenizador recursivo (escapes `\%`… solo en texto), `\newcommand`/`def`/envs con argumentos → opacos exactos, `center/flushleft/flushright` ↔ `ql-align-*`, `aularaw` sin wrapper anidado, img inline, ñ/acentos/símbolos estables | `db03ab2` | 46/46 (jsdom) + A–E |
| 5 | Fallback **"Convertir a imagen"**: MathJax 3 CHTML + html2canvas 1.4.1 (lazy) → PNG → `/admin/uploads` (Supabase Storage) → blot `aula-lateximg` con `data-latex-raw` SIEMPRE preservado (BD, LaTeX tab vía `aularaw`, vista estudiante) | `b83c137` | 29/29 + A–E |
| 6 | `src/db/migrate-lessons-html.js` (one-time, idempotente, `--dry-run`; **6 lecciones migradas en la BD local**), E2E completo admin→estudiante (`tmp-check-hito6.js`), README actualizado | `6734db3` | 40/40 + A–E |

**Regresión total al cierre**: A 29/29 · B 18/18 · C 22/22 · D 35/35 ·
E 31/31 (**135/135**) + 224 checks de hito (45+36+28+46+29+40).

**Garantías del usuario, verificadas**:
1. **Lossless round-trip** — lo no convertible vive en
   `data-latex-raw`/`aularaw` con el código exacto; WYSIWYG→LaTeX lo
   devuelve tal cual; "convertir a imagen" es solo representación
   visual (D20, checks Hito 4/5).
2. **Quill 2 obligatorio, sin `execCommand`** — todo pasa por la API
   de Quill (blots + `dangerouslyPasteHTML`).
3. **Móvil** — bottombar/bubble con `touchstart`+`preventDefault`,
   ocultas fuera de la pestaña WYSIWYG.
4. **Fallback a imagen** — MathJax→html2canvas→PNG→uploads con
   original en `data-latex-raw`.
5. **sanitize-html en guardado Y render**; Quill HTML y `data-latex*`
   sobreviven; MathJax corre después del sanitize dentro del iframe;
   acentos/ñ probados (Hito 4).
6. **Vista estudiante en iframe sandbox** (sin `allow-same-origin`),
   ruta interna `/render`, altura dinámica, estilos base dentro.
7. **`schema.sql` y `seed.js` intactos**; migración por script aparte.

**Pendiente solo de verificación manual en navegador** (no automatizable
desde Node): reproducción real de YouTube dentro del sandbox (Hito 1) y
el clic de "Convertir a imagen" con rasterizado real (Hito 5).

**Post-cierre (modo test manual del usuario)**: detectado y corregido el
bug crítico de duplicación al cambiar de pestaña (D24/D25, tests
`tmp-check-hito7.js` 18/18 con navegador real + A–E 135/135). Ver fila
"7" en §5.
