const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const { sb, unwrap } = require('../db/client');
const { requireAdmin, hashPassword } = require('../lib/auth');
const { validate } = require('../lib/validate');
const { renderMarkdown } = require('../lib/markdown');
const quizLib = require('../lib/quiz');

const router = express.Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Multipart para uploads: memoria → Storage, límite 50MB (§2, §8.3).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// wrapper para responder 400 en JSON si multer rechaza el archivo
function uploadSingle(field) {
  return (req, res, next) => upload.single(field)(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? 'El archivo supera los 50MB'
      : 'No se pudo procesar el archivo';
    res.status(400).json({ error: msg });
  });
}

const TYPE_NAMES = {
  single: 'Opción múltiple',
  multiple: 'Selección múltiple',
  truefalse: 'Verdadero / Falso',
  short: 'Respuesta corta',
  match: 'Emparejamiento',
  order: 'Ordenar',
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function slugify(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150);
}

function asArr(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function lines(s) {
  return String(s || '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function formatFecha(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('es-CO', {
      dateStyle: 'short', timeStyle: 'short', timeZone: process.env.TZ,
    });
  } catch {
    return iso;
  }
}

// ---------- esquemas zod ----------

const courseSchema = z.object({
  title: z.string().trim().min(3, 'Mínimo 3 caracteres').max(150),
  slug: z.string().trim().min(3, 'Mínimo 3 caracteres').max(150)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Minusculas, números y guiones (ej: mi-curso)'),
  description: z.string().trim().max(2000, 'Máximo 2000 caracteres').default(''),
});

const moduleSchema = z.object({
  title: z.string().trim().min(2, 'Mínimo 2 caracteres').max(150),
});

const lessonSchema = z.object({
  title: z.string().trim().min(2, 'Mínimo 2 caracteres').max(150),
  content: z.string().max(100000, 'Contenido demasiado largo').default(''),
});

const quizSchema = z.object({
  title: z.string().trim().min(2, 'Mínimo 2 caracteres').max(150),
  time_limit_min: z.union([z.literal(''), z.string().regex(/^\d+$/, 'Solo números')])
    .transform((v) => (v === '' ? null : Number(v)))
    .refine((v) => v === null || (v >= 1 && v <= 600), 'Entre 1 y 600 minutos')
    .optional()
    .default(''),
  max_attempts: z.string().regex(/^\d+$/, 'Solo números')
    .transform(Number)
    .refine((v) => v >= 1 && v <= 10, 'Entre 1 y 10 intentos'),
  pass_score: z.string().regex(/^\d+$/, 'Solo números')
    .transform(Number)
    .refine((v) => v >= 1 && v <= 100, 'Entre 1 y 100'),
});

const questionSchema = z.object({
  type: z.enum(['single', 'multiple', 'truefalse', 'short', 'match', 'order'],
    { errorMap: () => ({ message: 'Tipo no válido' }) }),
  prompt: z.string().trim().min(3, 'Escribe el enunciado').max(2000),
  points: z.string().regex(/^\d+$/, 'Solo números').default('1')
    .transform(Number)
    .refine((v) => v >= 1 && v <= 100, 'Entre 1 y 100 puntos'),
});

const studentSchema = z.object({
  name: z.string().trim().min(2, 'Mínimo 2 caracteres').max(100),
  email: z.union([z.literal(''), z.string().email('Correo no válido')])
    .transform((v) => (v === '' ? null : v))
    .default(''),
  password: z.string().min(8, 'Mínimo 8 caracteres').max(200),
});

// UX-007: reset de contraseña de un estudiante existente.
const passwordSchema = z.object({
  password: z.string().min(8, 'Mínimo 8 caracteres').max(200),
});

const feedbackSchema = z.object({
  kind: z.enum(['text', 'video', 'link', 'image'],
    { errorMap: () => ({ message: 'Tipo no válido' }) }),
  content: z.string().trim().min(1, 'Escribe el contenido o sube un archivo').max(5000),
});

// ---------- helpers de datos ----------

async function findCourse(id) {
  return unwrap(await sb().from('courses').select('*').eq('id', id).maybeSingle());
}

async function findModule(id) {
  return unwrap(await sb().from('modules').select('*').eq('id', id).maybeSingle());
}

async function findLesson(id) {
  return unwrap(await sb().from('lessons').select('*').eq('id', id).maybeSingle());
}

async function findQuiz(id) {
  return unwrap(await sb().from('quizzes').select('*').eq('id', id).maybeSingle());
}

async function findQuestion(id) {
  return unwrap(await sb().from('questions').select('*').eq('id', id).maybeSingle());
}

async function nextPosition(table, field, value) {
  const rows = unwrap(
    await sb().from(table)
      .select('position')
      .eq(field, value)
      .order('position', { ascending: false })
      .limit(1)
  );
  return rows.length ? rows[0].position + 1 : 1;
}

async function moduleTree(courseId) {
  const mods = unwrap(
    await sb().from('modules')
      .select('id, title, position')
      .eq('course_id', courseId)
      .order('position')
  );
  if (!mods.length) return [];
  const lessons = unwrap(
    await sb().from('lessons')
      .select('id, module_id, title, position')
      .in('module_id', mods.map((m) => m.id))
      .order('position')
  );
  const quizzes = unwrap(
    await sb().from('quizzes')
      .select('id, module_id, kind, title')
      .eq('course_id', courseId)
  );
  return mods.map((m) => ({
    ...m,
    lessons: lessons.filter((l) => l.module_id === m.id),
    quiz: quizzes.find((q) => q.module_id === m.id) || null,
    exam: null,
  }));
}

async function courseQuiz(courseId) {
  const rows = unwrap(
    await sb().from('quizzes')
      .select('id, kind, title, module_id')
      .eq('course_id', courseId)
      .order('id')
  );
  return rows;
}

function renderAdmin(res, view, title, crumbs, extra = {}) {
  Object.assign(res.locals, extra);
  res.render('layout', { view, title, crumbs, bare: true, wide: true });
}

// UX-012: banner de éxito (?saved=1&flash=…) en acciones admin.
function savedQuery(msg) {
  return `?saved=1&flash=${encodeURIComponent(msg)}`;
}

function savedFlash(req, fallback) {
  if (req.query.saved !== '1') return null;
  return String(req.query.flash || fallback || 'Guardado correctamente').slice(0, 120);
}

// Construye el payload JSON de una pregunta desde el formulario (§4.1).
function payloadFromForm(type, body) {
  if (type === 'single' || type === 'multiple') {
    const options = asArr(body.opt).map((v) => String(v).trim());
    while (options.length && options[options.length - 1] === '') options.pop();
    const correct = asArr(body.correct).map(Number);
    if (options.length < 2) throw new Error('Añade al menos dos opciones');
    if (options.some((o) => !o)) throw new Error('Hay opciones vacías');
    if (!correct.length) throw new Error('Marca la respuesta correcta');
    if (correct.some((i) => i < 0 || i >= options.length)) {
      throw new Error('La respuesta correcta no coincide con las opciones');
    }
    return {
      options,
      correct: type === 'single' ? correct[0] : [...new Set(correct)].sort((a, b) => a - b),
    };
  }
  if (type === 'truefalse') {
    return { correct: body.tf === 'true' };
  }
  if (type === 'short') {
    const accepted = lines(asArr(body.accepted).join('\n'));
    if (!accepted.length) throw new Error('Escribe al menos una respuesta aceptada');
    return { accepted, case_sensitive: !!body.case_sensitive };
  }
  if (type === 'match') {
    const left = lines(asArr(body.left).join('\n'));
    const right = lines(asArr(body.right).join('\n'));
    if (left.length < 2 || right.length < 2) {
      throw new Error('Añade al menos dos elementos a cada columna');
    }
    if (left.length !== right.length) {
      throw new Error('Las dos columnas deben tener la misma cantidad de líneas');
    }
    return { left, right, pairs: left.map((_, i) => [i, i]) };
  }
  if (type === 'order') {
    const items = lines(asArr(body.items).join('\n'));
    if (items.length < 2) throw new Error('Añade al menos dos elementos');
    return { items, correct_order: items.map((_, i) => i) };
  }
  throw new Error('Tipo no válido');
}

// ---------- dashboard ----------

router.get('/', requireAdmin, wrap(async (req, res) => {
  const courses = unwrap(await sb().from('courses').select('id'));
  const students = unwrap(
    await sb().from('users').select('id').eq('role', 'student')
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const attemptsToday = unwrap(
    await sb().from('attempts')
      .select('id')
      .gte('started_at', today.toISOString())
  );
  const last = unwrap(
    await sb().from('attempts')
      .select('id, status, score, max_score, passed, started_at, users(name), quizzes(title)')
      .order('id', { ascending: false })
      .limit(10)
  );

  renderAdmin(res, 'admin/dashboard', 'Panel admin — Aula',
    'Panel <span class="sep">/</span> <b>Dashboard</b>', {
      counts: {
        courses: courses.length,
        students: students.length,
        attemptsToday: attemptsToday.length,
      },
      last,
      formatFecha,
    });
}));

// ---------- cursos ----------

async function coursesViewData() {
  const courses = unwrap(await sb().from('courses').select('*').order('id'));
  const mods = unwrap(await sb().from('modules').select('id, course_id'));
  return courses.map((c) => ({
    ...c,
    modules: mods.filter((m) => m.course_id === c.id).length,
  }));
}

router.get('/courses', requireAdmin, wrap(async (req, res) => {
  renderAdmin(res, 'admin/courses', 'Cursos — Aula',
    'Panel <span class="sep">/</span> <b>Cursos</b>', {
      courses: await coursesViewData(),
      errors: {},
      values: {},
      savedFlash: savedFlash(req, 'Curso guardado'),
    });
}));

router.post('/courses', requireAdmin, wrap(async (req, res) => {
  const check = validate(courseSchema, {
    title: req.body.title || '',
    slug: req.body.slug ? req.body.slug : slugify(req.body.title || ''),
    description: req.body.description || '',
  });
  const dup = check.ok
    ? unwrap(await sb().from('courses').select('id').eq('slug', check.data.slug).maybeSingle())
    : null;

  if (!check.ok || dup) {
    return renderAdmin(res, 'admin/courses', 'Cursos — Aula',
      'Panel <span class="sep">/</span> <b>Cursos</b>', {
        courses: await coursesViewData(),
        errors: { ...check.errors, ...(dup ? { slug: 'Ese slug ya existe' } : {}) },
        values: req.body,
      });
  }

  const created = unwrap(
    await sb().from('courses').insert(check.data).select('id').single()
  );
  // UX-012: al editor del curso creado con banner.
  res.redirect(`/admin/courses/${created.id}${savedQuery('Curso creado')}`);
}));

router.get('/courses/:id', requireAdmin, wrap(async (req, res) => {
  const course = await findCourse(req.params.id);
  if (!course) return res.renderError(404, 'Curso no encontrado');

  const tree = await moduleTree(course.id);
  const quizzes = await courseQuiz(course.id);
  const exam = quizzes.find((q) => q.kind === 'exam') || null;

  renderAdmin(res, 'admin/course-edit', `${course.title} — Aula`,
    `Panel <span class="sep">/</span> Cursos <span class="sep">/</span> <b>${esc(course.title)}</b>`, {
      course, tree, exam, errors: {}, values: {},
      savedFlash: savedFlash(req, 'Guardado correctamente'),
    });
}));

router.post('/courses/:id', requireAdmin, wrap(async (req, res) => {
  const course = await findCourse(req.params.id);
  if (!course) return res.renderError(404, 'Curso no encontrado');

  const check = validate(courseSchema, {
    title: req.body.title || '',
    slug: req.body.slug || '',
    description: req.body.description || '',
  });
  const dup = check.ok
    ? unwrap(await sb().from('courses').select('id').eq('slug', check.data.slug).maybeSingle())
    : null;
  const errors = { ...check.errors };
  if (dup && Number(dup.id) !== course.id) errors.slug = 'Ese slug ya existe';

  if (Object.keys(errors).length) {
    const tree = await moduleTree(course.id);
    const quizzes = await courseQuiz(course.id);
    return renderAdmin(res, 'admin/course-edit', `${course.title} — Aula`,
      `Panel <span class="sep">/</span> Cursos <span class="sep">/</span> <b>${esc(course.title)}</b>`, {
        course, tree, exam: quizzes.find((q) => q.kind === 'exam') || null,
        errors, values: req.body,
      });
  }

  unwrap(
    await sb().from('courses')
      .update({ ...check.data, published: !!req.body.published })
      .eq('id', course.id)
  );
  // B3 (excepción): guardar metadata de curso → lista de cursos (UX-012: banner).
  res.redirect(`/admin/courses${savedQuery('Curso guardado')}`);
}));

router.post('/courses/:id/delete', requireAdmin, wrap(async (req, res) => {
  const course = await findCourse(req.params.id);
  if (!course) return res.renderError(404, 'Curso no encontrado');
  unwrap(await sb().from('courses').delete().eq('id', course.id));
  res.redirect('/admin/courses');
}));

router.post('/courses/:id/publish', requireAdmin, wrap(async (req, res) => {
  const course = await findCourse(req.params.id);
  if (!course) return res.renderError(404, 'Curso no encontrado');
  unwrap(await sb().from('courses').update({ published: !course.published }).eq('id', course.id));
  res.redirect(`/admin/courses/${course.id}${savedQuery(course.published ? 'Curso despublicado' : 'Curso publicado')}`);
}));

// El árbol vive en la edición del curso (§8.2).
router.get('/courses/:id/modules', requireAdmin, wrap(async (req, res) => {
  res.redirect(`/admin/courses/${req.params.id}`);
}));

router.post('/courses/:id/modules', requireAdmin, wrap(async (req, res) => {
  const course = await findCourse(req.params.id);
  if (!course) return res.renderError(404, 'Curso no encontrado');
  const check = validate(moduleSchema, { title: req.body.title || '' });
  if (check.ok) {
    unwrap(await sb().from('modules').insert({
      course_id: course.id,
      title: check.data.title,
      position: await nextPosition('modules', 'course_id', course.id),
    }));
  }
  res.redirect(`/admin/courses/${course.id}${savedQuery('Módulo añadido')}`);
}));

// Crear lección en un módulo (añadido a §6.3).
router.post('/modules/:id/lessons', requireAdmin, wrap(async (req, res) => {
  const mod = await findModule(req.params.id);
  if (!mod) return res.renderError(404, 'Módulo no encontrado');
  const check = validate(moduleSchema, { title: req.body.title || '' });
  if (check.ok) {
    unwrap(
      await sb().from('lessons').insert({
        module_id: mod.id,
        title: check.data.title,
        content: '# ' + check.data.title + '\n\n_Contenido pendiente._\n',
        position: await nextPosition('lessons', 'module_id', mod.id),
      })
    );
  }
  // B3: tras crear se vuelve al árbol del curso (donde está la lección).
  res.redirect(`/admin/courses/${mod.course_id}${savedQuery('Lección añadida')}`);
}));

router.post('/modules/:id', requireAdmin, wrap(async (req, res) => {
  const mod = await findModule(req.params.id);
  if (!mod) return res.renderError(404, 'Módulo no encontrado');
  const check = validate(moduleSchema, { title: req.body.title || '' });
  if (check.ok) {
    unwrap(await sb().from('modules').update({ title: check.data.title }).eq('id', mod.id));
  }
  res.redirect(`/admin/courses/${mod.course_id}${savedQuery('Módulo guardado')}`);
}));

router.post('/modules/:id/delete', requireAdmin, wrap(async (req, res) => {
  const mod = await findModule(req.params.id);
  if (!mod) return res.renderError(404, 'Módulo no encontrado');
  unwrap(await sb().from('modules').delete().eq('id', mod.id));
  res.redirect(`/admin/courses/${mod.course_id}`);
}));

router.post('/modules/:id/reorder', requireAdmin, wrap(async (req, res) => {
  const mod = await findModule(req.params.id);
  if (!mod) return res.renderError(404, 'Módulo no encontrado');

  const sibs = unwrap(
    await sb().from('modules')
      .select('id, position')
      .eq('course_id', mod.course_id)
      .order('position')
  );
  const i = sibs.findIndex((m) => m.id === mod.id);
  const target = req.body.dir === 'down' ? i + 1 : i - 1;
  if (i >= 0 && target >= 0 && target < sibs.length) {
    unwrap(await sb().from('modules').update({ position: -1 }).eq('id', mod.id));
    unwrap(await sb().from('modules').update({ position: mod.position }).eq('id', sibs[target].id));
    unwrap(await sb().from('modules').update({ position: sibs[target].position }).eq('id', mod.id));
  }
  res.redirect(`/admin/courses/${mod.course_id}`);
}));

// ---------- lecciones ----------

router.get('/lessons/:id', requireAdmin, wrap(async (req, res) => {
  const lesson = await findLesson(req.params.id);
  if (!lesson) return res.renderError(404, 'Lección no encontrada');
  const mod = await findModule(lesson.module_id);
  const course = await findCourse(mod.course_id);

  renderAdmin(res, 'admin/lesson-edit', `${lesson.title} — Aula`,
    `Panel <span class="sep">/</span> ${esc(course.title)} ` +
    `<span class="sep">/</span> <b>${esc(lesson.title)}</b>`, {
      lesson, module: mod, course, errors: {}, values: {},
      previewHtml: renderMarkdown(lesson.content),
    });
}));

router.post('/lessons/:id', requireAdmin, wrap(async (req, res) => {
  const lesson = await findLesson(req.params.id);
  if (!lesson) return res.renderError(404, 'Lección no encontrada');
  const mod = await findModule(lesson.module_id);
  const course = await findCourse(mod.course_id);

  const check = validate(lessonSchema, {
    title: req.body.title || '',
    content: req.body.content || '',
  });
  if (!check.ok) {
    return renderAdmin(res, 'admin/lesson-edit', `${lesson.title} — Aula`,
      `Panel <span class="sep">/</span> ${esc(course.title)} ` +
      `<span class="sep">/</span> <b>${esc(lesson.title)}</b>`, {
        lesson, module: mod, course, errors: check.errors, values: req.body,
        previewHtml: renderMarkdown(req.body.content || ''),
      });
  }

  unwrap(await sb().from('lessons').update(check.data).eq('id', lesson.id));
  // B3: tras guardar se vuelve al árbol del curso (UX-012: banner).
  res.redirect(`/admin/courses/${course.id}${savedQuery('Lección guardada')}`);
}));

// Preview markdown del editor (JSON; añadido a §6.3).
router.post('/lessons/:id/preview', requireAdmin, wrap(async (req, res) => {
  const content = String(req.body.content || '').slice(0, 100000);
  res.json({ html: renderMarkdown(content) });
}));

router.post('/lessons/:id/delete', requireAdmin, wrap(async (req, res) => {
  const lesson = await findLesson(req.params.id);
  if (!lesson) return res.renderError(404, 'Lección no encontrada');
  const mod = await findModule(lesson.module_id);
  unwrap(await sb().from('lessons').delete().eq('id', lesson.id));
  res.redirect(`/admin/courses/${mod.course_id}`);
}));

// ---------- quizzes ----------

// Crear quiz de módulo o examen final (añadido a §6.3).
router.post('/courses/:id/quizzes', requireAdmin, wrap(async (req, res) => {
  const course = await findCourse(req.params.id);
  if (!course) return res.renderError(404, 'Curso no encontrado');

  const kind = req.body.kind === 'exam' ? 'exam' : 'quiz';
  const moduleId = kind === 'quiz' ? Number(req.body.module_id || 0) || null : null;
  if (kind === 'quiz' && !moduleId) return res.redirect(`/admin/courses/${course.id}`);

  // Ojo: .eq('module_id', null) no funciona en PostgREST → usar .is().
  const base = sb().from('quizzes').select('id')
    .eq('course_id', course.id).eq('kind', kind);
  const existing = unwrap(
    await (moduleId ? base.eq('module_id', moduleId) : base.is('module_id', null)).maybeSingle()
  );
  if (existing) return res.redirect(`/admin/quizzes/${existing.id}${savedQuery('Quiz creado')}`);

  const created = unwrap(
    await sb().from('quizzes').insert({
      course_id: course.id,
      module_id: moduleId,
      kind,
      title: kind === 'exam' ? 'Examen final' : 'Quiz del módulo',
      max_attempts: 3,
      pass_score: 70,
    }).select('id').single()
  );
  res.redirect(`/admin/quizzes/${created.id}${savedQuery('Quiz creado')}`);
}));

router.get('/quizzes/:id', requireAdmin, wrap(async (req, res) => {
  const quiz = await findQuiz(req.params.id);
  if (!quiz) return res.renderError(404, 'Quiz no encontrado');
  const course = await findCourse(quiz.course_id);

  const questions = unwrap(
    await sb().from('questions')
      .select('*')
      .eq('quiz_id', quiz.id)
      .order('position')
  );
  const feedback = questions.length
    ? unwrap(
        await sb().from('question_feedback')
          .select('*')
          .in('question_id', questions.map((q) => q.id))
          .order('position')
      )
    : [];

  renderAdmin(res, 'admin/quiz-edit', `${quiz.title} — Aula`,
    `Panel <span class="sep">/</span> ${esc(course.title)} ` +
    `<span class="sep">/</span> <b>${esc(quiz.title)}</b>`, {
      quiz, course, questions, feedback, TYPE_NAMES,
      errors: {}, values: {}, errorMsg: req.query.error || null,
      savedFlash: savedFlash(req, 'Quiz creado'),
    });
}));

router.post('/quizzes/:id', requireAdmin, wrap(async (req, res) => {
  const quiz = await findQuiz(req.params.id);
  if (!quiz) return res.renderError(404, 'Quiz no encontrado');
  const course = await findCourse(quiz.course_id);

  const check = validate(quizSchema, {
    title: req.body.title || '',
    time_limit_min: req.body.time_limit_min || '',
    max_attempts: req.body.max_attempts || '',
    pass_score: req.body.pass_score || '',
  });
  if (!check.ok) {
    const questions = unwrap(
      await sb().from('questions').select('*').eq('quiz_id', quiz.id).order('position')
    );
    const feedback = questions.length
      ? unwrap(await sb().from('question_feedback').select('*')
        .in('question_id', questions.map((q) => q.id)).order('position'))
      : [];
    return renderAdmin(res, 'admin/quiz-edit', `${quiz.title} — Aula`,
      `Panel <span class="sep">/</span> ${esc(course.title)} ` +
      `<span class="sep">/</span> <b>${esc(quiz.title)}</b>`, {
        quiz, course, questions, feedback, TYPE_NAMES,
        errors: check.errors, values: req.body,
      });
  }

  unwrap(await sb().from('quizzes').update({
    title: check.data.title,
    time_limit_min: check.data.time_limit_min ?? null,
    max_attempts: check.data.max_attempts,
    pass_score: check.data.pass_score,
    shuffle: !!req.body.shuffle,
  }).eq('id', quiz.id));
  // B3: tras guardar se vuelve al árbol del curso (UX-012: banner).
  res.redirect(`/admin/courses/${quiz.course_id}${savedQuery('Quiz guardado')}`);
}));

// Q2/UX-006: eliminar un quiz individual (antes solo se podía borrando
// el módulo o el curso entero).
router.post('/quizzes/:id/delete', requireAdmin, wrap(async (req, res) => {
  const quiz = await findQuiz(req.params.id);
  if (!quiz) return res.renderError(404, 'Quiz no encontrado');
  unwrap(await sb().from('quizzes').delete().eq('id', quiz.id));
  res.redirect(`/admin/courses/${quiz.course_id}`);
}));

router.post('/quizzes/:id/questions', requireAdmin, wrap(async (req, res) => {
  const quiz = await findQuiz(req.params.id);
  if (!quiz) return res.renderError(404, 'Quiz no encontrado');

  const check = validate(questionSchema, {
    type: req.body.type || '',
    prompt: req.body.prompt || '',
    points: req.body.points || '1',
  });
  if (!check.ok) {
    const first = Object.values(check.errors)[0] || 'Revisa el formulario';
    return res.redirect(`/admin/quizzes/${quiz.id}?error=${encodeURIComponent(first)}`);
  }
  try {
    const payload = payloadFromForm(check.data.type, req.body);
    unwrap(await sb().from('questions').insert({
      quiz_id: quiz.id,
      type: check.data.type,
      prompt: check.data.prompt,
      points: check.data.points,
      position: await nextPosition('questions', 'quiz_id', quiz.id),
      payload: JSON.stringify(payload),
    }));
  } catch (err) {
    // error de payload (opciones etc.): vuelve al editor con query de error
    return res.redirect(`/admin/quizzes/${quiz.id}?error=${encodeURIComponent(err.message)}`);
  }
  res.redirect(`/admin/quizzes/${quiz.id}`);
}));

router.post('/questions/:id', requireAdmin, wrap(async (req, res) => {
  const q = await findQuestion(req.params.id);
  if (!q) return res.renderError(404, 'Pregunta no encontrada');

  const check = validate(questionSchema, {
    type: q.type,
    prompt: req.body.prompt || '',
    points: req.body.points || '1',
  });
  let redirect = `/admin/quizzes/${q.quiz_id}`;
  try {
    if (!check.ok) {
      const first = Object.values(check.errors)[0] || 'Revisa el formulario';
      throw new Error(first);
    }
    const payload = payloadFromForm(q.type, req.body);
    unwrap(await sb().from('questions').update({
      prompt: check.data.prompt,
      points: check.data.points,
      payload: JSON.stringify(payload),
    }).eq('id', q.id));
  } catch (err) {
    redirect += `?error=${encodeURIComponent(err.message)}`;
  }
  res.redirect(redirect);
}));

router.post('/questions/:id/delete', requireAdmin, wrap(async (req, res) => {
  const q = await findQuestion(req.params.id);
  if (!q) return res.renderError(404, 'Pregunta no encontrada');
  unwrap(await sb().from('questions').delete().eq('id', q.id));
  res.redirect(`/admin/quizzes/${q.quiz_id}`);
}));

router.post('/questions/:id/feedback', requireAdmin, wrap(async (req, res) => {
  const q = await findQuestion(req.params.id);
  if (!q) return res.renderError(404, 'Pregunta no encontrada');

  const check = validate(feedbackSchema, {
    kind: req.body.kind || '',
    content: req.body.content || '',
  });
  let redirect = `/admin/quizzes/${q.quiz_id}`;
  if (check.ok) {
    const rows = unwrap(
      await sb().from('question_feedback')
        .select('id, position')
        .eq('question_id', q.id)
        .order('position', { ascending: false })
        .limit(1)
    );
    unwrap(await sb().from('question_feedback').insert({
      question_id: q.id,
      kind: check.data.kind,
      content: check.data.content,
      position: rows.length ? rows[0].position + 1 : 1,
    }));
  } else {
    redirect += '?error=' + encodeURIComponent(check.errors.content || check.errors.kind || 'Revisa el formulario');
  }
  res.redirect(redirect);
}));

router.post('/feedback/:id/delete', requireAdmin, wrap(async (req, res) => {
  const row = unwrap(
    await sb().from('question_feedback')
      .select('id, question_id, kind')
      .eq('id', req.params.id)
      .maybeSingle()
  );
  if (!row) return res.renderError(404, 'Recurso no encontrado');
  const q = await findQuestion(row.question_id);
  unwrap(await sb().from('question_feedback').delete().eq('id', row.id));
  res.redirect(`/admin/quizzes/${q.quiz_id}`);
}));

// Subida a Storage bucket 'aula-media' (§8.3): devuelve {url}.
router.post('/uploads', requireAdmin, uploadSingle('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo' });
  const mime = req.file.mimetype || '';
  if (!/^(image|video)\//.test(mime)) {
    return res.status(400).json({ error: 'Solo se permiten imágenes o vídeos' });
  }

  const ext = (req.file.originalname || '').includes('.')
    ? req.file.originalname.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '')
    : '';
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext ? '.' + ext : ''}`;

  const { error } = await sb().storage.from('aula-media')
    .upload(path, req.file.buffer, { contentType: mime, upsert: false });
  if (error) return res.status(500).json({ error: error.message });

  const { data } = sb().storage.from('aula-media').getPublicUrl(path);
  res.json({ url: data.publicUrl });
}));

// ---------- estudiantes ----------

async function studentsWithStats() {
  const students = unwrap(
    await sb().from('users')
      .select('id, name, email, created_at')
      .eq('role', 'student')
      .order('name')
  );
  const prog = unwrap(await sb().from('lesson_progress').select('user_id'));
  const att = unwrap(
    await sb().from('attempts')
      .select('user_id, quiz_id, score, max_score, status')
      .eq('status', 'graded')
  );

  return students.map((u) => {
    const mine = att.filter((a) => a.user_id === u.id);
    const best = new Map();
    for (const a of mine) {
      const pct = a.max_score > 0 ? (a.score * 100) / a.max_score : 0;
      if (!best.has(a.quiz_id) || pct > best.get(a.quiz_id)) best.set(a.quiz_id, pct);
    }
    const avg = best.size
      ? Math.round([...best.values()].reduce((s, v) => s + v, 0) / best.size)
      : null;
    return {
      ...u,
      lessons: prog.filter((p) => p.user_id === u.id).length,
      avg,
    };
  });
}

router.get('/students', requireAdmin, wrap(async (req, res) => {
  const students = await studentsWithStats();
  renderAdmin(res, 'admin/students', 'Estudiantes — Aula',
    'Panel <span class="sep">/</span> <b>Estudiantes</b>', {
      students, errors: {}, values: {},
      savedFlash: savedFlash(req, 'Estudiante creado'),
    });
}));

router.post('/students', requireAdmin, wrap(async (req, res) => {
  const check = validate(studentSchema, {
    name: req.body.name || '',
    email: req.body.email || '',
    password: req.body.password || '',
  });

  const students = await studentsWithStats();
  const renderError = async (errors) => renderAdmin(res, 'admin/students', 'Estudiantes — Aula',
    'Panel <span class="sep">/</span> <b>Estudiantes</b>', {
      students, errors, values: req.body,
    });

  if (!check.ok) return renderError(check.errors);

  const dupName = unwrap(
    await sb().from('users').select('id').eq('name', check.data.name).maybeSingle()
  );
  if (dupName) return renderError({ name: 'Ese nombre ya está en uso' });
  if (check.data.email) {
    const dupMail = unwrap(
      await sb().from('users').select('id').eq('email', check.data.email).maybeSingle()
    );
    if (dupMail) return renderError({ email: 'Ese correo ya está en uso' });
  }

  unwrap(await sb().from('users').insert({
    name: check.data.name,
    email: check.data.email,
    password_hash: await hashPassword(check.data.password),
    role: 'student',
  }));
  res.redirect(`/admin/students${savedQuery('Estudiante creado')}`);
}));

router.get('/students/:id', requireAdmin, wrap(async (req, res) => {
  const student = unwrap(
    await sb().from('users')
      .select('id, name, email, created_at, role')
      .eq('id', req.params.id)
      .maybeSingle()
  );
  if (!student) return res.renderError(404, 'Estudiante no encontrado');

  const prog = unwrap(
    await sb().from('lesson_progress').select('lesson_id').eq('user_id', student.id)
  );
  const attempts = unwrap(
    await sb().from('attempts')
      .select('id, quiz_id, status, score, max_score, passed, started_at, finished_at, quizzes(title)')
      .eq('user_id', student.id)
      .order('id', { ascending: false })
  );

  // UX-007: la nueva contraseña se muestra una sola vez (flash de sesión);
  // con resave:false hay que guardar el store explícitamente al vaciarlo.
  const pwFlash = req.session.pwFlash || null;
  req.session.pwFlash = null;
  await new Promise((resolve) => req.session.save(() => resolve()));

  renderAdmin(res, 'admin/student', `${student.name} — Aula`,
    `Panel <span class="sep">/</span> Estudiantes <span class="sep">/</span> <b>${esc(student.name)}</b>`, {
      student,
      lessonsDone: prog.length,
      attempts: attempts.map((a) => ({
        ...a,
        fecha: formatFecha(a.finished_at || a.started_at),
        quizTitle: a.quizzes ? a.quizzes.title : 'Quiz',
      })),
      errors: { _: req.query.error || null },
      values: {},
      savedFlash: savedFlash(req, 'Contraseña actualizada'),
      pwFlash,
    });
}));

// UX-007: el admin genera una nueva contraseña para un estudiante existente.
router.post('/students/:id/password', requireAdmin, wrap(async (req, res) => {
  const student = unwrap(
    await sb().from('users').select('id, name').eq('id', req.params.id).maybeSingle()
  );
  if (!student) return res.renderError(404, 'Estudiante no encontrado');

  const check = validate(passwordSchema, { password: req.body.password || '' });
  if (!check.ok) {
    const msg = Object.values(check.errors)[0] || 'Revisa el formulario';
    return res.redirect(`/admin/students/${student.id}?error=${encodeURIComponent(msg)}`);
  }

  unwrap(await sb().from('users')
    .update({ password_hash: await hashPassword(check.data.password) })
    .eq('id', student.id));
  // Se pinta una vez en el siguiente GET y se borra; no viaja por la URL.
  req.session.pwFlash = check.data.password;
  res.redirect(`/admin/students/${student.id}${savedQuery('Contraseña actualizada')}`);
}));

// ---------- detalle de intento (§8.5) ----------

router.get('/attempts/:id', requireAdmin, wrap(async (req, res) => {
  const attempt = unwrap(
    await sb().from('attempts')
      .select('*, users(name), quizzes(title, course_id, pass_score)')
      .eq('id', req.params.id)
      .maybeSingle()
  );
  if (!attempt) return res.renderError(404, 'Intento no encontrado');
  const course = await findCourse(attempt.quizzes.course_id);

  const questions = await quizLib.getQuestions(attempt.quiz_id);
  const answers = unwrap(
    await sb().from('answers')
      .select('question_id, response, correct, awarded')
      .eq('attempt_id', attempt.id)
  );
  const byQ = new Map(answers.map((a) => [Number(a.question_id), a]));

  const items = questions.map((q, i) => {
    const a = byQ.get(Number(q.id)) || null;
    let resp = null;
    if (a) {
      try {
        resp = JSON.parse(a.response);
      } catch {
        resp = null;
      }
    }
    const rq = { ...q, payload: quizLib.parsePayload(q) };
    return {
      n: i + 1,
      typeName: TYPE_NAMES[q.type] || q.type,
      prompt: q.prompt,
      points: q.points || 1,
      your: quizLib.fmtResponse(rq, resp) || 'Sin responder',
      right: quizLib.fmtCorrect(rq) || '—',
      correct: a ? a.correct === true : false,
      awarded: a ? (a.awarded || 0) : 0,
    };
  });

  renderAdmin(res, 'admin/attempt', `Intento #${attempt.id} — Aula`,
    `Panel <span class="sep">/</span> Intento #${attempt.id}`, {
      attempt: {
        ...attempt,
        studentName: attempt.users ? attempt.users.name : '—',
        quizTitle: attempt.quizzes ? attempt.quizzes.title : 'Quiz',
      },
      course, items,
      fecha: formatFecha(attempt.finished_at || attempt.started_at),
    });
}));

module.exports = router;
