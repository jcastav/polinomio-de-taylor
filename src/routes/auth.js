const express = require('express');
const { z } = require('zod');
const { sb, unwrap } = require('../db/client');
const {
  hashPassword, verifyPassword, startSession, endSession, safeReturnTo,
} = require('../lib/auth');
const { validate } = require('../lib/validate');

const router = express.Router();

// Express 4 no captura promesas rechazadas: envolver cada handler.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const loginSchema = z.object({
  identity: z.string().trim().min(1, 'Escribe tu correo o nombre').max(200),
  password: z.string().min(1, 'Escribe tu contraseña').max(200),
});

const registerSchema = z.object({
  name: z.string().trim()
    .min(3, 'Mínimo 3 caracteres')
    .max(60, 'Máximo 60 caracteres')
    .regex(/^[\p{L}\p{N} ._\-]+$/u,
      'Solo letras, números, espacios, puntos, guiones y guiones bajos'),
  password: z.string().min(8, 'Mínimo 8 caracteres').max(200, 'Máximo 200 caracteres'),
});

function authView(req, res, view, status, extra = {}) {
  res.status(status).render('layout', {
    view: `auth/${view}`,
    title: view === 'login' ? 'Entrar — Aula' : 'Registro — Aula',
    crumbs: view === 'login' ? 'Entrar' : 'Registro',
    bare: true,
    errors: {},
    values: {},
    returnTo: null,
    expiredNotice: null,
    ...extra,
  });
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  // UX-002: ?expired=1 + returnTo cuando se cayó la sesión en una ruta protegida.
  const returnTo = safeReturnTo(req.query.returnTo);
  authView(req, res, 'login', 200, {
    returnTo,
    expiredNotice: req.query.expired === '1'
      ? 'Tu sesión expiró. Inicia sesión para continuar.' : null,
  });
});

router.post('/login', wrap(async (req, res) => {
  const returnTo = safeReturnTo(req.body.returnTo);
  const check = validate(loginSchema, req.body);
  if (!check.ok) {
    return authView(req, res, 'login', 400, {
      errors: check.errors,
      values: { identity: req.body.identity || '' },
      returnTo,
    });
  }

  const { identity, password } = check.data;

  // Admin entra con email, estudiante con name (§5.1 del plan).
  const isEmail = identity.includes('@');
  const query = sb().from('users').select('*');
  const user = unwrap(
    await (isEmail ? query.eq('email', identity) : query.eq('name', identity)).maybeSingle()
  );

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return authView(req, res, 'login', 401, {
      errors: { _: 'Credenciales incorrectas' },
      values: { identity },
      returnTo,
    });
  }

  await startSession(req, user.id);
  // UX-002: volver al formulario original si el returnTo es interno.
  res.redirect(returnTo || '/');
}));

router.post('/logout', wrap(async (req, res) => {
  await endSession(req);
  res.redirect('/login');
}));

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  authView(req, res, 'register', 200);
});

router.post('/register', wrap(async (req, res) => {
  const check = validate(registerSchema, req.body);
  if (!check.ok) {
    return authView(req, res, 'register', 400, {
      errors: check.errors,
      values: { name: req.body.name || '' },
    });
  }

  const { name, password } = check.data;

  const clash = unwrap(
    await sb().from('users').select('id').eq('name', name).maybeSingle()
  );
  if (clash) {
    return authView(req, res, 'register', 409, {
      errors: { name: 'Ese nombre ya está en uso' },
      values: { name },
    });
  }

  let created;
  try {
    created = unwrap(
      await sb().from('users').insert({
        name,
        password_hash: await hashPassword(password),
        role: 'student',
      }).select('id').single()
    );
  } catch (err) {
    if (err.code === '23505') {
      return authView(req, res, 'register', 409, {
        errors: { name: 'Ese nombre ya está en uso' },
        values: { name },
      });
    }
    throw err;
  }

  await startSession(req, created.id);
  res.redirect('/');
}));

module.exports = router;
