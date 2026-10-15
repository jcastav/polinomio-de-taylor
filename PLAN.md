# PLAN.md — Plataforma de Curso (nombre clave: "Aula")

> Documento maestro para agente de desarrollo.
> Modo de uso: leer completo antes de escribir una sola línea.
> Cualquier ambigüedad se resuelve preguntando, no inventando.

---

## 0. Resumen ejecutivo

Construir una plataforma web de curso, tipo Moodle pero:
- **Más densa visualmente** (cero espacio muerto).
- **Más cómoda** en escritorio y móvil.
- **Con carácter propio** (estética papel/óxido, no clichés SaaS).
- **Administrable al 100%** por un rol admin (la autora del curso).
- **Consumible** por un rol estudiante con quizzes y examen final.

El tema del curso es **Polinomio de Taylor** (único curso de v1:
módulos, lecciones, quizzes y examen final tratan este tema).

---

## 1. Referencia visual (obligatoria)

Archivo: `design/reference.html`

Es el mockup aprobado. El agente debe:
1. Leerlo completo antes de empezar.
2. Extraer de ahí los tokens de diseño (colores, tipografía, espaciados,
   bordes, sombras, radios, comportamiento responsive).
3. Replicar el layout exacto: 3 columnas en escritorio, drawer en móvil.
4. NO simplificar ni "modernizar". El diseño rústico es intencional.

### 1.1 Tokens de diseño (extraídos del mockup)

```
--paper:      #f3efe6   /* fondo general */
--panel:      #fbf9f4   /* fondo de paneles */
--ink:        #171717   /* texto principal */
--muted:      #5f5a50   /* texto secundario */
--line:       #cdc5b4   /* bordes principales */
--line-soft:  #e3ddce   /* bordes suaves */
--accent:     #8a2f1b   /* rojo óxido (primario) */
--accent-2:   #2c4a3e   /* verde bosque (secundario) */
--hl:         #efe3c6   /* resaltado / selección */
--topbar:     #1b1b1b   /* barra superior */
```

Tipografía:
- **UI**: `Tahoma, Verdana, "Segoe UI", sans-serif`
- **Lectura larga**: `Georgia, "Times New Roman", serif`
- **Escala**: base 13px UI, 14.5px lectura, títulos serif 25px.

Reglas duras:
- **Sin border-radius** en elementos estructurales (solo en inputs si acaso).
- **Sin sombras difusas**. Sombras solo offset duro tipo `4px 0 0`.
- **Sin gradientes**, sin glassmorphism, sin animaciones decorativas.
- **Mayúsculas con letter-spacing** para etiquetas y encabezados de sección.
- **Bordes de 1px visibles** como separadores estructurales.

---

## 2. Stack técnico (fijo)

- **Runtime**: Node.js 20 LTS
- **Servidor**: Express 4
- **BD**: Supabase (Postgres) vía `@supabase/supabase-js`.
  Todas las consultas son async/await. Cliente con `service_role`
  SOLO en el servidor (nunca en templates ni JS del cliente).
  Sin ORM. Migraciones = pegar `supabase/schema.sql` en el SQL Editor.
- **Auth**: propio — `bcrypt` + sesión con cookie. NO Supabase Auth
  (el flujo es nombre+password sin email y no encaja).
- **Templates**: EJS (server-side rendering)
- **Interactividad**: HTMX + Alpine.js (declarativo, poco JS propio)
- **Estilos**: CSS puro con custom properties, un solo archivo por capa
- **Validación**: `zod` para todos los inputs del servidor
- **Uploads**: `multer` (multipart, máx 50MB/archivo) → Supabase Storage,
  bucket `aula-media` (lectura pública, escritura solo desde el servidor)
- **Sin frameworks SPA** (React/Vue). No aportan nada aquí.

Razón: SSR + HTMX da la sensación "web clásica rápida" que el diseño
pide, reduce el JS al mínimo y simplifica el despliegue.

---

## 3. Estructura del repositorio

```
aula/
├── design/
│   └── reference.html          # mockup aprobado (no tocar)
├── supabase/
│   └── schema.sql              # esquema Postgres (copiar/pegar en SQL Editor)
├── src/
│   ├── server.js               # bootstrap de Express
│   ├── db/
│   │   ├── client.js           # cliente Supabase (service_role, solo servidor)
│   │   └── seed.js             # crea admin inicial + curso demo vía Supabase
│   ├── lib/
│   │   ├── auth.js             # sesiones, hashing, middlewares
│   │   ├── quiz.js             # motor de quizzes
│   │   ├── markdown.js         # marked + sanitize-html
│   │   └── validate.js         # helpers de zod
│   ├── routes/
│   │   ├── auth.js             # login / logout / register
│   │   ├── student.js          # vista estudiante + ranking
│   │   └── admin.js            # panel admin (CRUD) + uploads
│   ├── views/
│   │   ├── layout.ejs          # topbar + estructura base
│   │   ├── partials/
│   │   │   ├── sidebar-tree.ejs
│   │   │   ├── rail.ejs
│   │   │   ├── quiz-block.ejs
│   │   │   └── admin-nav.ejs
│   │   ├── auth/
│   │   │   ├── login.ejs
│   │   │   └── register.ejs
│   │   ├── student/
│   │   │   ├── course.ejs
│   │   │   ├── lesson.ejs
│   │   │   ├── quiz.ejs
│   │   │   ├── history.ejs
│   │   │   ├── ranking.ejs
│   │   │   └── results.ejs
│   │   └── admin/
│   │       ├── dashboard.ejs
│   │       ├── courses.ejs
│   │       ├── course-edit.ejs
│   │       ├── lesson-edit.ejs
│   │       ├── quiz-edit.ejs
│   │       ├── students.ejs
│   │       ├── student.ejs
│   │       ├── attempt.ejs
│   │       └── partials/question-form.ejs
│   └── public/
│       ├── css/
│       │   ├── tokens.css      # variables del mockup
│       │   ├── base.css        # reset + tipografía
│       │   ├── layout.css      # grid 3 col + drawer
│       │   └── components.css  # botones, tablas, quiz, cards
│       └── js/
│           ├── nav.js          # drawer móvil
│           ├── quiz.js         # interacciones del quiz
│           └── modal.js        # modal de material (Escape/backdrop/Cerrar)
│                               # admin.js: paneles del editor, preview, uploads
├── .env.example                # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
│                               # SESSION_SECRET, PORT
├── package.json
└── README.md
```

---

## 4. Modelo de datos

Todo en `supabase/schema.sql` (Postgres). Se ejecuta una vez en el SQL
Editor de Supabase. No hay `migrate.js`. Sin ORM; consultas vía
`@supabase/supabase-js` con async/await.

```sql
CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          TEXT    NOT NULL UNIQUE,   -- identificador del estudiante
  email         TEXT    UNIQUE,            -- requerido solo para admin
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'student'
                CHECK (role IN ('admin','student')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_admin_needs_email CHECK (role <> 'admin' OR email IS NOT NULL)
);

CREATE TABLE courses (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title               TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  description         TEXT NOT NULL DEFAULT '',
  published           BOOLEAN NOT NULL DEFAULT false,
  require_all_passed  BOOLEAN NOT NULL DEFAULT true,  -- bloqueo examen (§9.3)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE modules (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title     TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE lessons (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  module_id BIGINT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  title     TEXT NOT NULL,
  content   TEXT NOT NULL DEFAULT '',   -- markdown
  position  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE lesson_progress (
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id    BIGINT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE quizzes (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id      BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  module_id      BIGINT REFERENCES modules(id) ON DELETE CASCADE, -- NULL = examen
  kind           TEXT NOT NULL CHECK (kind IN ('quiz','exam')),
  title          TEXT NOT NULL,
  time_limit_min INTEGER,                        -- NULL = sin límite
  max_attempts   INTEGER NOT NULL DEFAULT 3,
  pass_score     INTEGER NOT NULL DEFAULT 70,    -- porcentaje
  shuffle        BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE questions (
  id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quiz_id  BIGINT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  type     TEXT NOT NULL CHECK (type IN
           ('single','multiple','truefalse','short','match','order')),
  prompt   TEXT NOT NULL,
  points   INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  payload  TEXT NOT NULL   -- JSON serializado (formato §4.1, sin cambios)
);

CREATE TABLE attempts (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quiz_id     BIGINT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  score       INTEGER,
  max_score   INTEGER,
  passed      BOOLEAN,
  status      TEXT NOT NULL DEFAULT 'in_progress'
              CHECK (status IN ('in_progress','submitted','graded'))
);

CREATE TABLE answers (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attempt_id  BIGINT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  response    TEXT NOT NULL,          -- JSON
  correct     BOOLEAN,                -- NULL si requiere revisión
  awarded     INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT answers_attempt_question_unique UNIQUE (attempt_id, question_id)
);

CREATE TABLE question_feedback (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question_id BIGINT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('text','video','link','image')),
  content     TEXT NOT NULL,          -- texto, o URL pública (Storage/YouTube/Vimeo)
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_modules_course   ON modules(course_id, position);
CREATE INDEX idx_lessons_module   ON lessons(module_id, position);
CREATE INDEX idx_questions_quiz   ON questions(quiz_id, position);
CREATE INDEX idx_attempts_user    ON attempts(user_id, quiz_id);
CREATE INDEX idx_attempts_quiz    ON attempts(quiz_id, status);
CREATE INDEX idx_answers_attempt  ON answers(attempt_id);
CREATE INDEX idx_feedback_q       ON question_feedback(question_id, position);
```

### 4.1 Formato de `payload` por tipo de pregunta

Todos en JSON. Guardar como string.

- **single** (una correcta):
  ```json
  { "options": ["A","B","C"], "correct": 1 }
  ```
- **multiple** (varias correctas):
  ```json
  { "options": ["A","B","C","D"], "correct": [0,2] }
  ```
- **truefalse**:
  ```json
  { "correct": true }
  ```
- **short** (respuesta corta, una o varias variantes aceptadas):
  ```json
  { "accepted": ["relación","relacion","relaciones"], "case_sensitive": false }
  ```
- **match** (emparejar):
  ```json
  { "left":  ["A","B","C"], "right": ["1","2","3"], "pairs": [[0,1],[1,2],[2,0]] }
  ```
- **order** (ordenar):
  ```json
  { "items": ["paso 1","paso 2","paso 3"], "correct_order": [0,1,2] }
  ```

### 4.2 Ranking — lógica de referencia

**Esta query NO se ejecuta en v1.** PostgREST (la API de Supabase)
no ejecuta window functions; la implementación real computa el
ranking en JS en el servidor (§9.5, `src/routes/student.js`). El
SQL se mantiene aquí como especificación de la lógica: examen ×2,
quizzes ×1, desempate por intentos `graded`, luego alfabético.
Migrar a función Postgres (rpc) o vista materializada si el curso
supera ~200 estudiantes.

```sql
-- Ranking del curso :courseId. Sin tabla propia.
WITH mejores AS (
  -- mejor intento por usuario y quiz (quizzes y examen)
  SELECT a.user_id, a.quiz_id, a.score, a.max_score,
         ROW_NUMBER() OVER (
           PARTITION BY a.user_id, a.quiz_id
           ORDER BY a.score::numeric / NULLIF(a.max_score,0) DESC,
                    a.finished_at DESC
         ) AS rn,
         q.kind
  FROM attempts a JOIN quizzes q ON q.id = a.quiz_id
  WHERE a.status = 'graded' AND q.course_id = :courseId
),
puntajes AS (
  -- examen pondera ×2 (aunque esté suspendido); quizzes ×1
  SELECT m.user_id,
         ROUND(SUM(CASE WHEN m.kind = 'exam' THEN
                          2 * m.score::numeric * 100 / NULLIF(m.max_score,0)
                        ELSE m.score::numeric * 100 / NULLIF(m.max_score,0)
                   END))                        AS puntaje_total,
         COUNT(*) FILTER (WHERE m.kind = 'quiz') AS quizzes_completados
  FROM mejores m
  WHERE m.rn = 1
  GROUP BY m.user_id
),
intentos AS (
  SELECT a.user_id, COUNT(*) AS intentos_usados
  FROM attempts a JOIN quizzes q ON q.id = a.quiz_id
  WHERE q.course_id = :courseId
    AND a.status = 'graded'   -- solo intentos enviados; los borradores
                              -- abiertos/abandonados no penalizan
  GROUP BY a.user_id
)
SELECT u.name, p.puntaje_total, p.quizzes_completados,
       COALESCE(i.intentos_usados, 0) AS intentos_usados
FROM puntajes p
JOIN users u ON u.id = p.user_id
LEFT JOIN intentos i ON i.user_id = p.user_id
ORDER BY p.puntaje_total DESC,      -- 1º puntaje
         intentos_usados ASC,       -- 2º menos intentos
         u.name ASC                 -- 3º alfabético
LIMIT 20;
```

---

## 5. Autenticación y roles

### 5.1 Flujo
1. `GET /login` → formulario con UN campo de identificación + password.
2. `POST /login` → si el input contiene `@`: busca por `email` (admin);
   si no: busca por `name` (estudiante). Valida bcrypt, crea sesión.
3. `GET /register` / `POST /register` → auto-registro de estudiantes.
   Campos: `name` (único, identificador) + `password` (mín. 8).
   Siempre `role='student'`. Tras registrarse entra al curso publicado.
4. `POST /logout` → destruye sesión.
5. Sesiones con `express-session` + store **`connect-pg-simple`** (tabla
   `session` creada por el paquete en la BD de Supabase, vía
   `SUPABASE_DB_URL`). En Render las sesiones **sobreviven cold starts**
   porque viven en Postgres, no en memoria del proceso.
6. Cookie `sid`, `httpOnly`, `sameSite=lax`, `secure` en producción.

### 5.2 Middlewares
- `requireAuth` → redirige a `/login` si no hay sesión.
- `requireAdmin` → 403 si `role !== 'admin'`.
- `requireStudent` → permite `student` y `admin` (admin puede ver todo).

### 5.3 Reglas
- Solo hay **un admin inicial**, creado en `seed.js` con credenciales
  tomadas de `.env`. Imprime email y password en consola una sola vez.
- El admin puede crear más admins y estudiantes desde el panel.
- El estudiante SÍ se registra solo vía `GET/POST /register`. `name` es
  UNIQUE global: si está ocupado → 409 con mensaje claro.
- Nota: la búsqueda por `name` puede devolver también al admin (el name
  es único global); el rol SIEMPRE sale de la BD, nunca del input.
- Contraseñas con `bcrypt` (10 rondas). Mínimo 8 caracteres.

### 5.4 Por qué NO Supabase Auth

El flujo es nombre+password sin email; Supabase Auth exige email o
provedores OAuth. Auth propio (bcrypt + cookie) cubre el 100% del
flujo pedido sin workarounds. `SUPABASE_SERVICE_ROLE_KEY` se usa SOLO
para datos y storage, jamás para identidad.

---

## 6. Mapa de rutas

### 6.1 Públicas
| Método | Ruta      | Descripción                 |
|--------|-----------|-----------------------------|
| GET    | `/login`  | Formulario de login         |
| POST   | `/login`  | Procesa login (detecta `@` → email / name) |
| GET    | `/register` | Auto-registro de estudiantes |
| POST   | `/register` | Crea estudiante (name + password) |
| POST   | `/logout` | Cierra sesión               |

### 6.2 Estudiante (requiere sesión)
| Método | Ruta                              | Descripción                       |
|--------|-----------------------------------|-----------------------------------|
| GET    | `/`                               | Redirige al curso activo          |
| GET    | `/c/:slug`                        | Portada del curso + árbol         |
| GET    | `/c/:slug/l/:lessonId`            | Lección (con quiz embebido si hay)|
| POST   | `/c/:slug/l/:lessonId/complete`   | Marca la lección como completada |
| POST   | `/c/:slug/l/:lessonId/check`      | Envía respuestas del quiz         |
| GET    | `/c/:slug/quiz/:quizId`           | Vista de quiz completo (móvil ok) |
| POST   | `/c/:slug/quiz/:quizId/submit`    | Envía intento                     |
| GET    | `/c/:slug/quiz/:quizId/result/:attemptId` | Resultados del intento (§9.6) |
| GET    | `/c/:slug/results`                | Historial de notas del estudiante |
| GET    | `/c/:slug/exam`                   | Acceso al examen final            |
| GET    | `/c/:slug/ranking`                | Ranking top 20                    |
| POST   | `/c/:slug/quiz/:quizId/save`      | Guardado parcial (borrador)       |

### 6.3 Admin (requiere rol admin)
| Método | Ruta                                  | Descripción                    |
|--------|---------------------------------------|--------------------------------|
| GET    | `/admin`                              | Dashboard                      |
| GET    | `/admin/courses`                      | Lista de cursos                |
| POST   | `/admin/courses`                      | Crear curso                    |
| GET    | `/admin/courses/:id`                  | Editar curso                   |
| POST   | `/admin/courses/:id`                  | Guardar cambios                |
| POST   | `/admin/courses/:id/delete`           | Eliminar curso                 |
| POST   | `/admin/courses/:id/publish`          | Publicar / despublicar         |
| GET    | `/admin/courses/:id/modules`          | Árbol de módulos               |
| POST   | `/admin/courses/:id/modules`          | Crear módulo                   |
| POST   | `/admin/courses/:id/quizzes`          | Crear quiz de módulo o examen   |
| POST   | `/admin/modules/:id`                  | Editar módulo                  |
| POST   | `/admin/modules/:id/delete`           | Eliminar módulo                |
| POST   | `/admin/modules/:id/reorder`          | Reordenar (drag o flechas)     |
| POST   | `/admin/modules/:id/lessons`          | Crear lección                  |
| GET    | `/admin/lessons/:id`                  | Editor de lección              |
| POST   | `/admin/lessons/:id`                  | Guardar lección                |
| POST   | `/admin/lessons/:id/preview`          | Preview markdown (JSON)        |
| POST   | `/admin/lessons/:id/delete`           | Eliminar lección               |
| GET    | `/admin/quizzes/:id`                  | Editor de quiz/examen          |
| POST   | `/admin/quizzes/:id`                  | Guardar metadata del quiz      |
| POST   | `/admin/quizzes/:id/questions`        | Añadir pregunta                |
| POST   | `/admin/questions/:id`                | Editar pregunta                |
| POST   | `/admin/questions/:id/delete`         | Eliminar pregunta             |
| GET    | `/admin/students`                     | Lista de estudiantes           |
| POST   | `/admin/students`                     | Crear estudiante               |
| GET    | `/admin/students/:id`                 | Ver progreso de un estudiante  |
| GET    | `/admin/attempts/:id`                 | Revisar intento (notas manuales)|
| POST   | `/admin/uploads`                      | Sube archivo a Storage (multipart, ≤50MB) |
| POST   | `/admin/questions/:id/feedback`       | Añadir recurso de retroalimentación |
| POST   | `/admin/feedback/:id/delete`          | Eliminar recurso de retroalimentación |

Todas las respuestas HTML, salvo endpoints HTMX que devuelven fragmentos.

---

## 7. Motor de quizzes (`src/lib/quiz.js`)

### 7.1 Responsabilidades
- `scoreAttempt(attemptId)` → recorre `answers`, calcula `awarded` por pregunta,
  actualiza `attempt` con `score`, `max_score`, `passed`.
- `gradeAnswer(question, response)` → retorna `{ correct, awarded }`.
- `ensureAttempt(user, quiz)` → **reutiliza el intento `in_progress` si existe**
  (no crea otro al reabrir el quiz); si no hay uno abierto, cuenta con
  `countUsedAttempts` y crea uno nuevo; `null` si se agotó `max_attempts`.
- `countUsedAttempts` → cuenta **solo intentos `graded`** (los `in_progress`
  no gastan cupo: si el estudiante cierra el navegador sin enviar, el intento
  abierto queda y se reutiliza).
- `saveAnswers(attemptId, questions, body)` → guardado parcial como
  **UPSERT** sobre `answers (attempt_id, question_id)` (constraint
  `answers_attempt_question_unique`): si ya existe fila se actualiza, si no
  se inserta. Nunca duplica respuestas.
- `remainingSeconds(attempt, quiz)` → si `time_limit_min`, calcula deadline.

### 7.2 Reglas de puntuación
- **single / truefalse**: todo o nada.
- **multiple**: requiere conjunto exacto. Sin crédito parcial (v1).
- **short**: compara normalizado (trim, lowercase, sin acentos) contra `accepted`.
- **match**: todo o nada.
- **order**: todo o nada.
- Preguntas abiertas de texto largo: **no incluidas en v1** (evitar
  revisión manual). Si se añaden luego, quedan en `status='submitted'`
  esperando calificación del admin.

### 7.3 Intentos
- Al abrir el quiz: si ya existe un intento `in_progress` del mismo usuario
  y quiz, **se reutiliza** (con sus respuestas ya guardadas); si no, se crea
  uno nuevo `in_progress`, salvo que `countUsedAttempts` haya alcanzado
  `max_attempts` (en ese caso la ruta responde que no quedan intentos).
- `canAttempt` (para decidir si la ruta de quiz es accesible o "solo
  lectura") cuenta **solo intentos con `status='graded'`**; los
  `in_progress` no consumen cupo.
- Guardado parcial (POST a `/c/:slug/quiz/:quizId/save`): **UPSERT** de cada
  respuesta en `answers` por `(attempt_id, question_id)` (constraint
  `answers_attempt_question_unique`), no INSERT ciego. Puede guardarse
  varias veces sin duplicar filas.
- Al enviar: `status='submitted'`, se ejecuta `scoreAttempt`, queda `graded`.
- Si `passed=0` y quedan intentos, se muestra botón "Reintentar".
- Si se acaban los intentos, solo lectura.
- **Criterio unificado**: tanto el límite de `max_attempts` como el ranking
  (§9.5/§4.2) usan el mismo criterio — solo cuentan intentos
  `status='graded'`; el ranking toma el **mejor** intento por usuario y quiz
  (`ROW_NUMBER` sobre `score/max_score`); los `in_progress` jamás puntúan
  ni gastan cupo.

### 7.4 Aleatorización
- Si `quiz.shuffle` es true, se baraja orden de preguntas y de opciones
  (para `single`/`multiple`) al **crear el intento**, y ese orden
  se persiste implícitamente en las respuestas guardadas.
- No barajar `match` ni `order` (rompen la pregunta).

### 7.5 Retroalimentación por pregunta
- Al enviar el intento (`status='graded'`), la vista de resultados carga
  `question_feedback` de cada pregunta incorrecta.
- `kind='text'` → concatenados en `position`, expand INLINE bajo la pregunta.
- Recursos no-texto → botón "Ver material" → modal (§9.6).
- NUNCA se muestra durante el intento: revelaría la respuesta correcta y
  anularía la evaluación en reintentos. Solo al finalizar.
- También visible en `/c/:slug/results` para intentos anteriores.

---

## 8. Panel de administración

### 8.1 Dashboard (`/admin`)
- Resumen: nº cursos, nº estudiantes, nº intentos hoy.
- Accesos rápidos: "Nuevo curso", "Nuevo estudiante".
- Tabla densa con últimos 10 intentos.

### 8.2 Editar curso
- Campos: título, slug (auto desde título, editable), descripción, publicado.
- Árbol de módulos a la izquierda, mismo componente que la vista estudiante.
- Botones: añadir módulo, reordenar, eliminar.
- Cada módulo: añadir lección, editar, eliminar.
- Cada lección: editor con textarea markdown + preview lado a lado.
- Al final del curso: botón "Configurar examen final".

### 8.3 Editor de quiz/examen
- Metadata: título, límite de tiempo, intentos máximos, nota mínima, shuffle.
- Lista de preguntas. Añadir pregunta abre un formulario con:
  - Selector de tipo (radio).
  - Enunciado (textarea).
  - Puntos (número).
  - Editor específico según tipo (campos dinámicos con Alpine).
- Bloque "Retroalimentación" por pregunta: añadir N recursos
  (selector de tipo: text | video | link | image).
  - text → textarea; link → input URL + título; video/image → botón
    "Subir archivo" → `POST /admin/uploads` → devuelve `{url}` → se
    guarda en `content`. También se puede pegar URL de YouTube/Vimeo.
  - Validación en servidor: MIME `image/*` o `video/*`, máx 50MB.
  - Recursos ordenables (position) y eliminables.
- Vista previa de la pregunta como la verá el estudiante.
- Botón "Probar este quiz" (abre en modo estudiante en pestaña nueva).

### 8.4 Estudiantes
- Lista con: nombre, email, progreso (lecciones vistas), media de notas.
- Crear estudiante: nombre (único, identificador), email opcional,
  password temporal.
- Resetear password (genera nueva y la muestra una vez).
- Ver detalle: historial de intentos con enlaces a revisión.

### 8.5 Detalle de intento
- Pregunta por pregunta: enunciado, respuesta del estudiante,
  respuesta correcta, si acertó.
- Botón "Ajustar puntaje" (solo si luego se añaden preguntas abiertas).

---

## 9. Experiencia del estudiante

### 9.1 Portada del curso
- Mismo layout del mockup pero sin controles de edición.
- Columna izquierda: árbol completo, con estados (✓ completada, ○ pendiente).
- Centro: descripción del curso + lista de módulos con progreso.
- Derecha: progreso, próximo paso, últimas notas.

### 9.2 Lección
- Contenido renderizado desde markdown (usar `marked`).
- Sanitizar HTML resultante.
- El quiz del módulo NO se embebe en la lección: es un ítem hermano en
  el árbol (badge + estado ○◐✗✓) y se entra desde su propia ruta
  `GET /c/:slug/quiz/:quizId` (decisión de UX de la ronda 1; el bloque
  `partials/quiz-block.ejs` se renderiza solo en `student/quiz.ejs`).
- Al final de la ÚLTIMA lección del módulo: bloque CTA "Avanzar al quiz
  del módulo →", siempre visible; habilitado si el módulo está completo,
  deshabilitado con hint "Completa las N lecciones…" si no (UX-A3).
- Botones del pie: "← Lección anterior" (UX-017), "Marcar como
  completada" + "Siguiente lección".
- Se guarda progreso por lección (tabla `lesson_progress`).
- El bloqueo del quiz de módulo hasta completar las lecciones vive en
  §9.7 (el CTA de este apartado sigue igual).

> `lesson_progress` quedó incluida en §4 (supabase/schema.sql).

### 9.3 Examen final
- Único por curso.
- Bloqueado hasta que todos los quizzes de módulo (kind='quiz') estén
  APROBADOS (mejor intento con score/max_score >= pass_score).
- Flag `courses.require_all_passed BOOLEAN DEFAULT true` en la tabla
  `courses` (§4) para poder relajarlo cuando el tema esté listo.
- Si está bloqueado, la vista del examen muestra qué quizzes faltan
  por aprobar, con enlace directo a cada uno.
- Una vez iniciado, temporizador visible en la topbar (si tiene límite).
- Al enviar: página de resultados con nota, aprobado/suspendido,
  desglose por pregunta.

### 9.4 Resultados
- Tabla con todos los intentos del estudiante en el curso.
- Fecha, quiz, nota, estado (aprobado/suspendido/en curso).

### 9.5 Ranking (`GET /c/:slug/ranking`)
- Visible para TODO estudiante autenticado (no anónimos). Racional:
  motiva a quien va a mitad de curso; no filtra respuestas (solo puntaje
  agregado y nº de quizzes completados); la columna "quizzes
  completados" evidencia el avance de cada uno.
- Calculado en JS en el servidor (PostgREST no ejecuta window functions,
  así que la query de §4.2 no corre tal cual contra la API de Supabase).
  Sin tabla propia, ni caché en v1; con >~200 estudiantes migrarlo a
  una función Postgres (rpc) o vista materializada (UX-NOTES §4).
- Pestañas: `/ranking` → "Curso completo"; `?quiz=:quizId` → "Este quiz".
  La fila del estudiante autenticado se resalta (`tr.me` + etiqueta "tú").
- Tabla densa (`table.dense`, estilo mockup), top 20.
- Columnas curso completo: Posición | Nombre | Puntaje total |
  Quizzes completados | Intentos. Columnas por quiz: Posición | Nombre |
  Mejor nota | Intentos.
- Puntaje total = suma del mejor % de cada quiz + (mejor % del examen ×2).
  El examen puntúa con peso 2 aunque esté suspendido; si aún no se rindió,
  no aporta. Nota al pie en la vista: "El examen final puntúa ×2".
- Desempate: 1) menos intentos usados en el curso, 2) alfabético por
  nombre. Nota al pie: "Solo se cuentan intentos enviados".
- Enlace "Ranking" en la topbar (estilo `.btn-ghost`, antes del userchip,
  solo en páginas con curso) y botón "Ver ranking" desde los resultados.

### 9.6 Resultados con retroalimentación
- Inline y modal SOLO tras enviar el intento. Nunca a mitad de intento:
  revelaría la respuesta correcta y anularía la evaluación en reintentos.
- Pregunta incorrecta → se expande INLINE con el texto de feedback
  (`kind='text'` concatenados en `position`).
- Si hay recursos no-texto → botón "Ver material" → MODAL centrado:
  - video: `<iframe>` de YouTube/Vimeo o `<video>` si es archivo propio
  - image: `<img>` a ancho completo
  - link: botón/enlace grande con el título del recurso
- Modal responsive, cierra con Escape, click en backdrop o botón
  "Cerrar". Borde duro 1px, sin border-radius, sin animaciones.

### 9.7 Quiz de módulo
- Cada módulo puede tener a lo sumo un quiz (`kind='quiz'` con
  `module_id` no nulo).
- Bloqueado hasta que TODAS las lecciones del módulo estén completadas
  por el estudiante (misma lógica que §9.3 pero sobre lecciones en vez
  de sobre quizzes).
- En el sidebar: ítem con estado "bloqueado" (icono 🔒, color
  `--muted`, `cursor:not-allowed`, sin enlace; cosmético).
- En la ruta `GET /c/:slug/quiz/:quizId`: guard en servidor que
  redirige a la primera lección pendiente del módulo con flash
  "Completa las lecciones del módulo para acceder al quiz" — el guard
  del servidor es la regla real.
- Excepción: si el estudiante YA tiene intentos `graded` en ese quiz,
  el ítem queda desbloqueado para consultar resultado o reintentar. El
  guard del servidor también respeta esta excepción.
- Referencia cruzada en §9.2 (el CTA sigue ahí, pero la regla de
  bloqueo vive aquí).

---

## 10. Comportamiento móvil (crítico)

Breakpoints:
- `> 1120px`: 3 columnas (sidebar + content + rail).
- `820px – 1120px`: 2 columnas (sidebar + content), rail baja debajo.
- `< 820px`: 1 columna, sidebar es drawer lateral, rail baja debajo.

Reglas móviles:
- Topbar **sticky** siempre. Contiene: hamburguesa, marca, breadcrumb
  truncado, botón de acción contextual, chip de usuario.
- Sidebar: `position: fixed`, `transform: translateX(-100%)` por defecto,
  `translateX(0)` cuando `body.nav-open`. Backdrop oscuro detrás.
- Cerrar drawer: tap en backdrop, tap en un enlace, o tecla `Escape`.
- Sin scroll horizontal jamás.
- Inputs y botones con `min-height: 36px` para dedos.
- El rail de progreso baja debajo del contenido, a ancho completo,
  en una sola columna.
- Modal: ancho `min(720px, 92vw)`, scroll interno si el material es
  alto; al abrir bloquea el scroll del body; mismas reglas de cierre.

---

## 11. Componentes CSS (reutilizables)

Definir en `components.css`:
- `.btn`, `.btn-dark`, `.btn-accent`, `.btn-ghost`
- `.card` (borde + header en mayúsculas)
- `.table.dense`
- `.defbox`
- `.keylist`
- `.quiz`, `.quiz-head`, `.q`, `.opts`, `.quiz-foot`
- `.mod` (módulo del árbol), `.side-progress`
- `.stat`, `.nextlist`
- `.eyebrow` (línea superior de contexto)
- `.modal`, `.modal-backdrop`, `.modal-head`, `.modal-body`
- `.fb` (bloque de retroalimentación inline), `.fb-actions`
- `.rank-pos` (celdas de posición del ranking)

Todos los estilos deben coincidir 1:1 con `design/reference.html`.
Si algo no está ahí, diseñar siguiendo los mismos principios
(denso, bordes 1px, sin radios, tipografía mixta Tahoma/Georgia).

---

## 12. Convenciones del código

- **JS**: CommonJS, sin TypeScript (por velocidad).
- **Nombres**: `snake_case` en BD, `camelCase` en JS, `kebab-case` en CSS.
- **Rutas**: siempre en español para el usuario, inglés en el código.
- **Errores**: nunca exponer stack al cliente. Vista 500 genérica + log.
- **Validación**: TODOS los POST pasan por esquema zod antes de tocar BD.
- **Consultas**: siempre vía `@supabase/supabase-js` (parametrizadas por
  defecto), en `async/await`. Nunca concatenar SQL.
- **Secretos**: `SUPABASE_SERVICE_ROLE_KEY` solo en servidor; jamás en
  EJS, ni en atributos `data-*`, ni en JS del cliente.
- **Renderizado markdown**: `marked` + `DOMPurify` (o `sanitize-html`).
- **Fechas**: guardar en UTC, mostrar en hora local del navegador.
- **Comentarios**: solo cuando explican el "por qué", no el "qué".

---

## 13. Lo que NO se hace (anti-scope)

- ❌ No SPA, no React, no Vue, no build step con webpack/vite.
- ❌ No autenticación con Google/OAuth en v1.
- ❌ No Supabase Auth, ni reset de password por email en v1.
- ❌ No foros, ni chat, ni comentarios.
- ❌ No streaming de video propio. Media de retroalimentación ≤50MB en
      Storage (`aula-media`); para video largo, embed YouTube/Vimeo.
      La portada de curso sigue sin subida en v1.
- ❌ No realtime/websockets de Supabase.
- ❌ No notificaciones por email en v1.
- ❌ No multi-curso para estudiantes en v1 (un estudiante ve el curso
      publicado). Sí se permiten varios cursos creados por el admin,
      pero el estudiante ve solo el que esté `published=1`.
- ❌ No internacionalización. Solo español.
- ❌ No tests automatizados en v1 (sí un `smoke.md` con checklist manual).
- ❌ No Docker. Correr con `npm start` y ya.

---

## 14. Fases de implementación

El agente debe ejecutar en este orden. **Cada fase termina con
`npm start` funcionando y algo visible en el navegador.**

### Fase 1 — Esqueleto
1. `package.json` con dependencias.
2. `src/server.js` con Express y render de una vista "hola".
3. `tokens.css`, `base.css`, `layout.css`, `components.css`
   replicando `design/reference.html`.
4. `layout.ejs` con topbar + estructura 3 columnas + drawer móvil.
5. Verificar el layout en 3 anchos (1400, 1000, 400).

### Fase 2 — Base de datos y auth
1. Crear proyecto Supabase; pegar `supabase/schema.sql` en el SQL Editor
   (incluye `lesson_progress` y `question_feedback`); crear bucket
   `aula-media` público.
2. `src/db/client.js` + `seed.js` con el cliente Supabase (admin inicial
   + curso demo con 2 módulos y 2 lecciones placeholder).
3. `.env.example` con las 4 variables (SUPABASE_URL,
   SUPABASE_SERVICE_ROLE_KEY, SESSION_SECRET, PORT).
4. Rutas `/login`, `POST /login`, `POST /logout`, `GET|POST /register`.
5. Middlewares `requireAuth`, `requireAdmin`.
6. Vistas de login y register con el mismo estilo del mockup.

### Fase 3 — Vista estudiante
1. `/c/:slug` con árbol + contenido.
2. `/c/:slug/l/:id` con markdown renderizado.
3. `lesson_progress` al marcar completada.
4. Sidebar y rail con datos reales.
5. Navegación móvil funcional.

### Fase 4 — Motor de quizzes
1. `src/lib/quiz.js` con `gradeAnswer` y `scoreAttempt`.
2. Endpoints `POST .../check` y `.../submit`.
3. Vista de quiz embebido (idéntica al mockup).
4. Página de resultados por intento.
5. Todos los tipos excepto los que requieran revisión manual.
6. Retroalimentación inline + modal (§9.6).

### Fase 5 — Panel admin
1. Dashboard.
2. CRUD de cursos, módulos, lecciones.
3. Editor de quizzes con formularios dinámicos por tipo.
4. Gestión de estudiantes.
5. Vista de detalle de intento.
6. Editor de retroalimentación por pregunta + `POST /admin/uploads`.

### Fase 6 — Examen final y pulido
1. Bloqueo del examen hasta aprobar quizzes.
2. Temporizador visible si hay límite.
3. Página de resultados finales.
4. Ranking (§9.5).
5. `smoke.md` con checklist de pruebas manuales.
6. `README.md` con instrucciones de instalación y uso.
7. Deploy en Render (sección 15).

---

## 15. Deploy (Render)

### 15.1 Variables de entorno requeridas

| Variable | Uso |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role — SOLO servidor |
| `SUPABASE_DB_URL` | Connection string `postgres://` de Supabase — para `connect-pg-simple` (sesiones) |
| `SESSION_SECRET` | firma de la cookie de sesión |
| `PORT` | el servidor DEBE escuchar en `process.env.PORT` |

- `server.js`: `app.listen(process.env.PORT || 3000)`.
- Cookie `secure` solo cuando `NODE_ENV=production`.

### 15.2 Build

- Build: `npm install` · Start: `npm start` · Node 20.
- `schema.sql` y `seed.js` se corren una vez, no en el deploy.

### 15.3 Cold starts (free tier)

- El dyno duerme ~15 min sin tráfico; el primer request tarda 20-60s.
- Mitigación opcional: UptimeRobot golpeando `/login` cada 10-15 min
  (plan gratis cubre). Alternativa: avisar en README.
- Efecto colateral: las sesiones en memoria se pierden → re-login.

---

## 16. Criterios de aceptación (checklist)

El proyecto está listo cuando:

- [ ] `npm install && npm start` levanta en `http://localhost:3000`.
- [ ] `.env` con las 4 variables; el servidor escucha en `process.env.PORT`.
- [ ] Un estudiante se autoregistra en `/register` y entra al curso.
- [ ] El login distingue email (admin) vs name (estudiante).
- [ ] El admin sube un archivo ≤50MB y queda en `aula-media` con URL pública.
- [ ] Al enviar un quiz, las incorrectas muestran feedback inline y el
      modal "Ver material" cierra con Escape, backdrop y botón.
- [ ] `GET /c/:slug/ranking` muestra el top 20.
- [ ] Despliegue en Render con las 4 variables de entorno.
- [ ] Existe un admin creado por seed, con credenciales impresas en consola.
- [ ] El admin puede loguearse y ver `/admin`.
- [ ] El admin puede crear un curso, dos módulos, tres lecciones, un quiz
      y un examen final, todo desde la UI.
- [ ] Un estudiante creado por el admin puede loguearse.
- [ ] El estudiante ve el curso, navega lecciones, marca progreso.
- [ ] El estudiante responde el quiz, ve su nota, y puede reintentar
      hasta el máximo configurado.
- [ ] El examen final se bloquea hasta aprobar los quizzes (si así se
      configuró).
- [ ] Todo funciona en móvil (probado a 375px de ancho).
- [ ] No hay scroll horizontal en ningún breakpoint.
- [ ] El diseño coincide con `design/reference.html` en:
      colores, tipografía, bordes, densidad, layout de 3 columnas.
- [ ] No hay console.log olvidados ni TODOs sin resolver.
- [ ] `README.md` explica cómo crear el primer admin y cómo usar el panel.

---

## 17. Instrucciones finales al agente

1. **Lee `design/reference.html` completo antes de escribir CSS.**
2. **Lee este PLAN.md completo antes de escribir código.**
3. Empieza por la **Fase 1**. Al terminar cada fase, para y muestra
   el resultado antes de continuar.
4. Si algo del plan no está claro, **pregunta antes de inventar**.
5. No añadas features no listadas. No omitas ninguna listada.
6. Nombra los commits de forma clara: `fase-1: esqueleto`,
   `fase-2: auth y bd`, etc.
7. Al final, deja el curso demo del seed con contenido obvio tipo
   "Lección de ejemplo — reemplazar". El tema del curso SÍ está
   definido (Polinomio de Taylor); no inventes lecciones o quizzes
   sobre él hasta que la autora los cargue.
8. Nunca expongas `SUPABASE_SERVICE_ROLE_KEY` (ni en vistas, ni en JS
   del cliente, ni en logs).

---

## 18. Notas para el humano (no para el agente)

- El tema (Polinomio de Taylor) está definido; el contenido real
  (lecciones, quizzes, preguntas) se carga desde el panel.
- La BD es Supabase. Para resetear: vaciar las tablas en el SQL Editor
  y correr `npm run seed` (o recrear desde `supabase/schema.sql`).
- Próximos pasos posibles tras v1: foros, preguntas abiertas con
  revisión manual, certificados en PDF, multi-curso por estudiante.