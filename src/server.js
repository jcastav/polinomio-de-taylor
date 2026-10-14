require('dotenv').config();

const path = require('path');
const express = require('express');

const { sessionMiddleware, loadUser } = require('./lib/auth');
const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/student');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(sessionMiddleware());
app.use(loadUser);

app.use('/', studentRoutes);
app.use('/', authRoutes);

app.use((req, res) => {
  res.status(404).send('No encontrado');
});

// §12: nunca exponer stack al cliente. Log + 500 genérico.
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).send('Error interno');
});

app.listen(PORT, () => {
  console.log(`Aula escuchando en http://localhost:${PORT}`);
});
