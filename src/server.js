require('dotenv').config();

const path = require('path');
const express = require('express');

const { sessionMiddleware, loadUser } = require('./lib/auth');
const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/student');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(sessionMiddleware());
app.use(loadUser);

// UX-001: 404/500 con layout (vista error.ejs) en vez de texto plano.
// Cualquier ruta puede llamar res.renderError(status, message).
app.use((req, res, next) => {
  res.renderError = (status, message) => {
    res.status(status);
    if (!req.accepts('html')) return res.send(message);
    try {
      return res.render('layout', {
        view: 'error',
        title: status === 404 ? 'No encontrado' : 'Error',
        crumbs: status === 404 ? 'No encontrado' : 'Error',
        bare: true,
        status,
        message,
      });
    } catch (e) {
      console.error(e);
      return res.send(message);
    }
  };
  next();
});

app.use('/', studentRoutes);
app.use('/', authRoutes);
app.use('/admin', adminRoutes);

app.use((req, res) => {
  res.renderError(404, 'No encontrado');
});

// §12: nunca exponer stack al cliente. Log + 500 con layout.
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.renderError(500, 'Error interno');
});

app.listen(PORT, () => {
  console.log(`Aula escuchando en http://localhost:${PORT}`);
});
