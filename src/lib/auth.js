const bcrypt = require('bcrypt');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const { sb, unwrap } = require('../db/client');

const ROUNDS = 10;

function hashPassword(plain) {
  return bcrypt.hash(plain, ROUNDS);
}

function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function sessionStore() {
  // Sesiones en Postgres (Supabase) vía connect-pg-simple (§5.1/§15.1):
  // sobreviven cold starts en Render. Sin SUPABASE_DB_URL (dev local
  // sin configurar) se cae al MemoryStore de express-session.
  if (!process.env.SUPABASE_DB_URL) return undefined;

  const PgStore = connectPgSimple(session);
  return new PgStore({
    conString: process.env.SUPABASE_DB_URL,
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : undefined,
    createTableIfMissing: true,
  });
}

function sessionMiddleware() {
  const secret = process.env.SESSION_SECRET ||
    (process.env.NODE_ENV === 'production'
      ? (() => { throw new Error('SESSION_SECRET es obligatorio en producción'); })()
      : 'aula-dev-secret');

  return session({
    name: 'sid',
    secret,
    store: sessionStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 días
    },
  });
}

// Carga req.user y res.locals.user desde la sesión.
async function loadUser(req, res, next) {
  req.user = null;
  res.locals.user = null;
  if (!req.session || !req.session.userId) return next();

  try {
    const data = unwrap(
      await sb().from('users')
        .select('id, name, email, role, created_at')
        .eq('id', req.session.userId)
        .maybeSingle()
    );
    if (!data) {
      return req.session.destroy(() => next());
    }
    req.user = data;
    res.locals.user = data;
    next();
  } catch (err) {
    next(err);
  }
}

// Regenera la sesión (evita fijación) y guarda al usuario.
function startSession(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      resolve();
    });
  });
}

function endSession(req) {
  return new Promise((resolve) => req.session.destroy(() => resolve()));
}

// UX-002: solo rutas internas (misma origin); nada de //host ni /login.
function safeReturnTo(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/login')) return null;
  return raw.slice(0, 500);
}

// UX-002: al tocar una ruta protegida sin sesión, volver a ella tras login.
function loginRedirectUrl(req) {
  const back = safeReturnTo(req.originalUrl);
  return back
    ? `/login?expired=1&returnTo=${encodeURIComponent(back)}`
    : '/login';
}

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect(loginRedirectUrl(req));
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect(loginRedirectUrl(req));
  if (req.user.role !== 'admin') return res.status(403).send('Prohibido');
  next();
}

// student y admin (el admin puede ver todo) — §5.2 del plan.
function requireStudent(req, res, next) {
  if (!req.user) return res.redirect(loginRedirectUrl(req));
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  sessionMiddleware,
  loadUser,
  startSession,
  endSession,
  safeReturnTo,
  requireAuth,
  requireAdmin,
  requireStudent,
};
