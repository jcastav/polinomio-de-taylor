-- ============================================================
-- Aula — esquema completo (Postgres / Supabase)
-- Pegar una vez en el SQL Editor de Supabase. No hay migrate.js.
-- Consultas desde Node vía @supabase/supabase-js (async/await).
-- ============================================================

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
  payload  TEXT NOT NULL   -- JSON serializado (formato §4.1 del plan)
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

-- ============================================================
-- Storage (fuera del SQL anterior — se creó desde el servidor)
-- Bucket público `aula-media` para imágenes/vídeos de feedback:
--   await sb.storage.createBucket('aula-media', { public: true })
-- En el SQL Editor equivalente:
--   INSERT INTO storage.buckets (id, name, public)
--   VALUES ('aula-media', 'aula-media', true)
--   ON CONFLICT (id) DO UPDATE SET public = true;
-- (ya existe en la BD de desarrollo; este bloque es la referencia)
-- ============================================================
