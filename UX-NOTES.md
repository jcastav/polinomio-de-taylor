# UX-NOTES — ronda de correcciones de UX

Bitácora de la ronda de correcciones UX aplicada sobre las fases 1–5 del
plan (PLAN.md §9). **Sin cambios en el esquema de Supabase. Fase 6 no
iniciada.**

---

## 1. Correcciones aplicadas

### `1024271` — ux: quiz fuera de lección (A1–A5)

| ID | Corrección |
|----|------------|
| A1 | Quiz desembebido de la lección: se eliminó el bloque y la ruta `POST /c/:slug/l/:lessonId/check`; `partials/quiz-block.ejs` vive solo en `student/quiz.ejs` (pantalla completa). |
| A2 | `buildTree` lleva estado del quiz (pending/running/failed/approved); sidebar con iconos ○◐✗✓, badge `[QUIZ]`/`[EXAMEN]` y clases `.qstate`. |
| A3 | Bloque CTA `.quiz-cta` al final de la última lección del módulo: botón grande habilitado si el módulo está completo; deshabilitado con `.cta-hint` ("Completa las N lecciones…") si no. |
| A4 | Ruta `GET /c/:slug/quiz/:quizId` como pantalla propia del quiz (intentos agotados = vista válida). |
| A5 | `GET /c/:slug/ranking?quiz=` con pestañas "Curso completo"/"Este quiz", fila propia resaltada (`class="me"`), botón "Ver ranking" en resultados y enlace "Ranking" en el topbar (solo con `course` en locals, nunca en admin). |

### `b6e8236` — ux: navegación admin (B1–B3 + Q1–Q3)

| ID | Corrección |
|----|------------|
| B1 | Botones "Editar"/"Eliminar" en módulos, lecciones y quizzes del árbol del curso; el quiz pasa a tener título enlazado. |
| B2 | "← Volver al curso" en los editores de lección/quiz; "← Volver a cursos" + "Ver como estudiante" en el editor de curso. |
| B3 | Tras guardar: crear lección → árbol, guardar lección → árbol, guardar quiz → árbol, guardar curso → lista `/admin/courses` (crear quiz sigue en su editor). |
| Q1 | `data-focus-inline` + handler en `public/js/admin.js`: el botón "Editar" del módulo enfoca el input inline del título. |
| Q2 | `POST /admin/quizzes/:id/delete` con `confirm()` junto a "Eliminar" (resolvía UX-006: no se podía borrar un quiz individual). |
| Q3 | "← Volver" del editor de curso → `/admin/courses`; enlace "Ver como estudiante" (`/c/:slug`, target `_blank`). |
| fix | Crear examen fallaba con 500 (`module_id null` consultado con `.eq` en vez de `.is` en PostgREST). Bug preexistente de la fase 5. |

### `ba04626` — ux: 404/500 con layout, semántica de color, tablas, paralelismo

| ID | Corrección |
|----|------------|
| UX-001 | Vista `views/error.ejs` con el layout (topbar + CSS del sitio) y helper `res.renderError(status, msg)` usado por los handlers globales 404/500 y por todos los `404` de rutas (antes: texto plano). |
| UX-006 | (resuelto en `b6e8236`, ver Q2) |
| UX-010 | Semántica de color: `.btn-danger` (rojo) solo para acciones destructivas; `.btn-positive` (verde `--accent-2`) para CTAs positivas. `.btn-accent` queda como clase base. |
| UX-013 | `.table-scroll` (overflow-x) en las 8 tablas `table.dense` del sitio. |
| UX-016 | `Promise.all` en `courseContext` (árbol ∥ stats de quizzes) y en `buildTree` (lecciones ∥ quizzes; progreso ∥ intentos). |

### `87dbdf9` — ux: pulido de bajo esfuerzo (9 hallazgos)

| ID | Sev. | Corrección |
|----|------|------------|
| UX-003 | MEDIA | "Guardar borrador" redirige con `?saved=1` y se pinta el banner "Borrador guardado · hh:mm" (`.saved-flash`, `role="status"`). |
| UX-004 | MEDIA | Columna "Quiz" en la tabla de módulos de la portada del curso, con icono/estado del quiz y enlace. |
| UX-005 | BAJA | Rail "Siguiente": si no queda lección pero hay quiz sin aprobar → CTA "Aprobar: \<quiz\> →" (antes decía "Todas las lecciones completadas"). |
| UX-008 | BAJA | Contraseña del formulario "Crear estudiante": `type="password"`, `autocomplete="new-password"`, sin placeholder "clave1234". |
| UX-011 | BAJA | Texto neutral del rail: "Panel de administración" / "Edita lecciones…" (sin género hardcodeado). |
| UX-014 | BAJA | `:focus-visible` global con `outline: 2px solid var(--accent)`. |
| UX-015 | BAJA | `@media (pointer:coarse)`: `min-height: 44px` en botones (`.btn`, `.btn-sm`, ▲▼ del árbol, botones de ordenar) y en filas del árbol lateral. |
| UX-017 | BAJA | "← Lección anterior" en `.lesson-foot` (variable `prev` en la ruta de lección). |
| UX-019 | BAJA | Migajas: "Curso" es un enlace al curso (`<a href="/c/:slug">Curso</a>`) en las 6 vistas con migajas de estudiante + estilo `.crumbs a`. |

---

## 2. Hallazgos pendientes

No abordados en esta ronda (acordado con la revisión):

| ID | Sev. | Problema | Propuesta |
|----|------|----------|-----------|
| UX-002 | MEDIA | Sesión expirada en un POST redirige a `/login` perdiendo el formulario; tras login cae en `/` y no vuelve al formulario. | Mensaje "Tu sesión expiró" + `returnTo` tras login. |
| UX-007 | MEDIA | El admin no puede resetear la contraseña de un estudiante existente. | Formulario "Cambiar contraseña" en el detalle del estudiante (`/admin/students/:id`). |
| UX-009 | BAJA | Botones ▲▼ y acordeón del sidebar sin ARIA. | `aria-label` en los botones y `aria-expanded` en el acordeón. |
| UX-012 | BAJA | Acciones admin sin confirmación de éxito. | Flash `?saved=1` → banner efímero (mecanismo ya usado en UX-003). |
| UX-018 | BAJA | Un quiz sin preguntas es enviable (0/0 → "Suspendido"). | Marcarlo "en preparación" o bloquear el envío. |

---

## 3. Decisiones de UX

1. **Quiz fuera de la lección**: el quiz del módulo nunca se embebe en el
   contenido de la lección; es un ítem hermano en el árbol con badge,
   estado visual y ruta propia (A1/A2/§9.2).
2. **CTA siempre visible + hard-lock del quiz de módulo**
   *(decisión actualizada; antes: ~~solo CTA deshabilitado, sin
   hard-lock en v1~~)*: el bloque "Avanzar al quiz" aparece siempre al
   final de la última lección del módulo y se habilita cuando el módulo
   está completo (A3). El quiz del módulo **SÍ se bloquea** hasta
   completar todas sus lecciones: guard en servidor en
   `GET /c/:slug/quiz/:quizId` → redirige a la primera lección pendiente
   con flash "Completa las lecciones del módulo para acceder al quiz";
   el sidebar muestra el ítem "bloqueado" (🔒, `--muted`,
   `cursor:not-allowed`, sin enlace; cosmético). **Excepción**: si el
   estudiante ya tiene intentos `graded` del quiz (aprobado o no),
   conserva el acceso para ver resultados o reintentar
   (PLAN.md §9.7).
3. **Quiz en pantalla completa** con borrador, reintentos y resultados;
   los intentos agotados muestran una vista válida (no un error) (A4).
4. **Ranking visible y por pestañas**: enlace en el topbar (solo páginas
   de curso), pestañas "Curso completo"/"Este quiz", fila propia
   resaltada, y botón "Ver ranking" desde los resultados (A5/§9.5).
5. **Progreso explícito**: la lección se marca como completada con el
   botón "Marcar como completada" (sin auto-detección de lectura).
6. **Navegación admin incremental**: tras guardar se vuelve al árbol del
   curso (o a la lista de cursos en el editor de curso), los editores
   tienen "← Volver", y la edición de módulos es inline con focus
   (B1–B3, Q1).
7. **Semántica de color**: rojo (`.btn-danger`) solo para destructivos;
   verde (`.btn-positive`) para CTAs positivas; estados del quiz con
   iconos ○◐✗✓ (UX-010).

---

## 4. Nota técnica: ranking

El ranking **se computa en JS en el servidor** (`src/routes/student.js`,
ruta `GET /c/:slug/ranking`): PostgREST no ejecuta queries con *window
functions*, por lo que la query de §4.2 no puede correr tal cual contra la
API de Supabase.

- Umbrales y migración: si el curso supera **~200 estudiantes**, mover el
  cálculo a una **función Postgres (rpc)** o a una **vista materializada**
  y exponerla por `sb().rpc(...)`.
- En v1: sin tabla propia, sin caché; se descartan los intentos no
  `graded` y solo se traen los intentos de los quizzes del curso.

---

## 5. Mejoras futuras

- **Fase 6**: no iniciada (examen final con temporizador, bloqueo por
  quizzes aprobados, flag `require_all_passed`, §9.3).
- **Hallazgos pendientes** de la auditoría (§2): UX-002, 007, 009, 012,
  018.
- **Ranking a escala**: función Postgres/vista materializada al superar
  ~200 estudiantes (§4).
- **Sesiones**: `connect-pg-simple` con `SUPABASE_DB_URL`; si no hay URL,
  cae a `MemoryStore` (pierde sesiones al reiniciar). Considerar
  limpieza/expiración de sesiones y de intentos antiguos.
- **Credenciales**: rotar la contraseña de Supabase y la `SERVICE_ROLE_KEY`
  (fueron pegadas en el chat de trabajo) — pendiente del usuario.
- **Tests E2E**: los scripts `tmp-*.ps1` (gitignored) crean sus propios
  datos con prefijo `tmp-test-` (curso/módulo/lecciones/quiz/estudiante)
  y los borran al final; **no tocar el curso demo ni el admin real**.
  Baterías actuales: `tmp-check-a.ps1` (A: 22), `tmp-check-b.ps1`
  (B: 18), `tmp-check-c.ps1` (9 hallazgos: 22).
- **Contenido real**: las lecciones del curso demo siguen siendo
  placeholders del seed (§8: el contenido real lo aporta el equipo).

---

*Commits de la ronda: `1024271` → `b6e8236` → `ba04626` → `87dbdf9`
(+ `docs: UX-NOTES.md`).*
