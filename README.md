# Aula — Polinomio de Taylor

Plataforma de curso en Express + EJS + Supabase (Postgres/Storage).

## Arranque local

```bash
cp .env.example .env   # rellenar credenciales
npm install
node src/db/seed.js    # idempotente: crea admin, curso demo y bucket
npm start              # http://localhost:3000
```

## Sesiones (§5.1 / §15.1)

Las sesiones se guardan en **Postgres** (Supabase) con
`express-session` + `connect-pg-simple` (tabla `session`), usando la
variable `SUPABASE_DB_URL` (connection string del pooler de sesión).

- Las sesiones **sobreviven cold starts** en Render: el proceso puede
  reiniciarse sin obligar a loguearse de nuevo (antes, con el
  MemoryStore, se perdían en cada cold start).
- Sin `SUPABASE_DB_URL` (solo dev local) se cae al MemoryStore.
- La tabla `session` la crea `connect-pg-simple` automáticamente
  (`createTableIfMissing: true`).
