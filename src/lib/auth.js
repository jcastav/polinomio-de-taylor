const bcrypt = require('bcrypt');
const session = require('express-session');
const { sb, unwrap } = require('../db/client');

const ROUNDS = 10;

function hashPassword(plain) {
  return bcrypt.hash(plain, ROUNDS);
}

function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function sessionMiddleware() {
  const secret = process.env.SESSION_SECRET ||
    (process.env.NODE_ENV === 'production'
      ? (() => { throw new Error('SESSION_SECRET es obligatorio en producción'); })()
      : 'aula-dev-secret');

  return session({
    name: 'sid',
    secret,
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

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.role !== 'admin') return res.status(403).send('Prohibido');
  next();
}

// student y admin (el admin puede ver todo) — §5.2 del plan.
function requireStudent(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  sessionMiddleware,
  loadUser,
  startSession,
  endSession,
  requireAuth,
  requireAdmin,
  requireStudent,
};
