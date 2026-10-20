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
| 2 | Quill 2 WYSIWYG en editor de lección (blots math/youtube/raw, uploads imagen, bottombar/bubble móvil, guardado sanitizado) | ✅ (36/36 checks + A–E verde) |
| 3 | CodeMirror 5: pestañas HTML y LaTeX sobre el mismo documento | ⬅ siguiente |
| 4 | Conversor HTML↔LaTeX lossless (aulaimg/aulavideo/aularaw, opacos, acentos/ñ) | pendiente |
| 5 | Fallback "Convertir a imagen" (MathJax → html2canvas → upload; `data-latex-raw` preservado) | pendiente |
| 6 | Migración de lecciones demo a HTML + tests E2E + README | pendiente |

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

## 5. Registro de commits

| Commit | Hito | Descripción |
|---|---|---|
| `c2e3d0b` | — | feat: mockup editor 3 modos (aprobado visualmente) |
| `5b1894c` | 0 | docs: EDITOR-IMPLEMENTATION.md |
| `14cf38c` | 1 | feat: render de lección en iframe sandbox con dual-format |
| _(commit de este hito)_ | 2 | feat: editor Quill 2 WYSIWYG con blots custom y MathLive |

## 6. Pendientes y cosas raras

- **YouTube dentro de `sandbox="allow-scripts"`**: la reproducción REAL del
  embed youtube-nocookie dentro del iframe sandbox **queda pendiente de
  verificación manual** en el navegador (Hito 1 dejó el transform y los
  estilos; no se pudo probar reproducción desde Node). Si no reproduce,
  evaluar `allow-same-origin` — NO sin volver a preguntar.
- **sanitize-html + `allowVulnerableTags`**: emite warning de XSS; es
  intencional y está confinado. No quitar el flag.
- Lecciones 9/24/28, **68 "Ejemplo" (módulo 1)** y quiz 17 en BD local son
  producto de pruebas manuales del usuario; no culpar al código si los
  tests se desincronizan (D6).
- Regresión completa: `tmp-check-a/b/c/d/e.ps1` (**A 29/29, B 18/18,
  C 22/22, D 35/35, E 31/31** tras Hito 1) + `tmp-check-hito1.js` (45/45).
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
.\tmp-check-a.ps1            # regresión completa A–E tras cada hito
```

Pruebas manuales clave del Hito 1: abrir una lección como estudiante (iframe
crece al cargar, MathJax renderiza, YouTube embebido reproduce), preview del
admin con `<script>`/`<style>` (se ven dentro del iframe, no rompen la
plataforma), lección markdown legacy se ve normal.
