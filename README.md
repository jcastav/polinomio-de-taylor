# Aula — Polinomio de Taylor

Plataforma de curso en Express + EJS + Supabase (Postgres/Storage):
lecciones con markdown, quizzes calificados con retroalimentación,
examen final con bloqueo y temporizador, ranking global y panel de
administración.

## Requisitos

- **Node.js 20+** (`package.json` lo exige en `engines`).
- Un proyecto **Supabase** (gratis sirve) con acceso al SQL Editor y
  a las claves de API en Settings → API.

## Variables de entorno

Copia `.env.example` a `.env` y rellena:

| Variable | Uso |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase (`https://….supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | clave `service_role` — **solo servidor**, nunca al cliente |
| `SUPABASE_DB_URL` | connection string `postgres://` del pooler (Settings → Database) — para las sesiones |
| `SESSION_SECRET` | firma de la cookie de sesión (obligatoria en producción) |
| `PORT` | el servidor escucha en `process.env.PORT \|\| 3000` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | solo las usa el seed para crear el admin inicial |

## Arranque local

```bash
cp .env.example .env   # rellenar credenciales
npm install
# En el SQL Editor de Supabase: ejecutar supabase/schema.sql una vez
npm run seed           # idempotente: admin, curso demo y bucket
npm start              # http://localhost:3000
```

- El **primer admin** lo crea el seed y **imprime sus credenciales en
  consola** (una sola vez; si ya existe no imprime la password).
- El seed también crea el curso demo "Polinomio de Taylor" (con
  contenido placeholder) y el bucket público `aula-media`.
- `schema.sql` y el seed se corren **una vez**, no en cada deploy.

## Cómo se usa

### Estudiantes

- Se **autoregistran** en `/register` o los crea el admin desde el
  panel (con contraseña temporal visible una sola vez).
- El login distingue: **email = admin**, **nombre = estudiante**.
- Navegan lecciones (markdown), marcan progreso, resuelven quizzes
  (reintentos hasta el máximo) y ven notas, feedback y ranking.

### Panel de admin (`/admin`)

- Cursos: crear, editar, **publicar**; módulos y lecciones con
  markdown + preview; un quiz por módulo y un examen final.
- Quizzes: 6 tipos de pregunta, puntos, nota mínima, intentos,
  límite de tiempo, barajado, feedback por pregunta (texto +
  recursos: video/imagen/URL) y material de repaso en el modal.
- Estudiantes: crear, ver detalle/intentos y **resetear la
  contraseña**.
- Subida de material a Storage: archivos ≤50MB a `aula-media` con
  URL pública.

### Examen final

- Se bloquea hasta aprobar todos los quizzes del módulo si el curso
  tiene `require_all_passed` (el admin siempre puede verlo).
- Soporta **temporizador**: cuenta atrás en el topbar; al vencer se
  envía solo y el servidor califica con lo guardado.
- En los resultados: "Ver ranking del curso" (el examen puntúa ×2).

## Sesiones (§5.1 / §15.1)

Las sesiones se guardan en **Postgres** (Supabase) con
`express-session` + `connect-pg-simple` (tabla `session`), usando la
variable `SUPABASE_DB_URL` (connection string del pooler de sesión).

- Las sesiones **sobreviven cold starts** en Render: el proceso puede
  reiniciarse sin obligar a loguearse de nuevo (antes, con la
  MemoryStore, se perdían en cada cold start).
- Sin `SUPABASE_DB_URL` (solo dev local) se cae al MemoryStore.
- La tabla `session` la crea `connect-pg-simple` automáticamente
  (`createTableIfMissing: true`).
- La cookie es `secure` **solo cuando `NODE_ENV=production`**.

## Deploy en Render (§15)

1. Crea un **Web Service** apuntando al repo (build: `npm install`,
   start: `npm start`, Node 20).
2. Configura estas variables de entorno en el servicio:

   | Variable | Valor |
   |---|---|
   | `SUPABASE_URL` | la de tu proyecto |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role |
   | `SUPABASE_DB_URL` | connection string del pooler |
   | `SESSION_SECRET` | cadena larga aleatoria |
   | `PORT` | lo asigna Render; el servidor lo lee de `process.env.PORT` |
   | `NODE_ENV` | `production` |

3. `schema.sql` y `npm run seed` se ejecutan **una vez** desde tu
   máquina contra la BD de Supabase (no en el deploy).
4. **Cold starts (free tier)**: el dyno duerme ~15 min sin tráfico y
   el primer request tarda 20-60s. Mitigación: un UptimeRobot (plan
   gratis) golpeando `/login` cada 10-15 min.

## Troubleshooting

- **"Faltan ADMIN_EMAIL y/o ADMIN_PASSWORD"** → rellena esas
  variables en `.env` antes del seed.
- **"Admin ya existe"** → el seed es idempotente; usa el admin que ya
  tienes o cambia `ADMIN_EMAIL` para crear otro.
- **"No se pudo verificar el bucket"** → créalo a mano en Supabase →
  Storage → New bucket → `aula-media` (public).
- **Cae a MemoryStore / se pierde la sesión** → falta
  `SUPABASE_DB_URL` (solo acepta `postgres://`, no `postgresql://`).
- **"SESSION_SECRET es obligatorio en producción"** → define la
  variable cuando `NODE_ENV=production`.
- **404 en assets** → revisa que el servicio esté sirviendo
  `src/public` (no hay pasos de build extra).

## Estructura

```
src/
  server.js        Express, layout de errores 404/500
  lib/             auth (sesiones/roles), quiz (motor de quizzes), markdown
  routes/          auth, student, admin
  views/           EJS: layout + student/ admin/ partials/
  public/          css/ js/ (assets estáticos)
  db/              seed.js (admin + curso demo + bucket)
supabase/schema.sql
design/reference.html
PLAN.md            plan completo del proyecto
UX-NOTES.md        decisiones y correcciones de UX
smoke.md           checklist manual de humo
```
