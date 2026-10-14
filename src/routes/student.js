const express = require('express');
const { sb, unwrap } = require('../db/client');
const { requireAuth, requireStudent } = require('../lib/auth');
const { renderMarkdown } = require('../lib/markdown');

const router = express.Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function activeCourse() {
  const rows = unwrap(
    await sb().from('courses')
      .select('id, title, slug, description, published, require_all_passed')
      .eq('published', true)
      .order('id')
      .limit(1)
  );
  return rows[0] || null;
}

async function findCourse(slug) {
  return unwrap(
    await sb().from('courses')
      .select('id, title, slug, description, published, require_all_passed')
      .eq('slug', slug)
      .maybeSingle()
  );
}

// Árbol módulo → lecciones con estado de progreso del usuario (§9.1).
async function buildTree(course, userId) {
  const mods = unwrap(
    await sb().from('modules')
      .select('id, title, position')
      .eq('course_id', course.id)
      .order('position')
  );
  if (!mods.length) return [];

  const lessons = unwrap(
    await sb().from('lessons')
      .select('id, module_id, title, position')
      .in('module_id', mods.map((m) => m.id))
  );

  const done = new Set();
  if (userId && lessons.length) {
    const prog = unwrap(
      await sb().from('lesson_progress')
        .select('lesson_id')
        .eq('user_id', userId)
        .in('lesson_id', lessons.map((l) => l.id))
    );
    prog.forEach((p) => done.add(Number(p.lesson_id)));
  }

  return mods
    .map((m) => ({
      ...m,
      lessons: lessons
        .filter((l) => l.module_id === m.id)
        .sort((a, b) => a.position - b.position)
        .map((l) => ({ ...l, done: done.has(Number(l.id)) })),
    }));
}

function computeStats(tree) {
  const flat = tree.flatMap((m) => m.lessons);
  const done = flat.filter((l) => l.done).length;
  return {
    flat,
    total: flat.length,
    done,
    percent: flat.length ? Math.round((done * 100) / flat.length) : 0,
  };
}

// GET / → redirige al curso publicado activo (§6.2).
router.get('/', requireAuth, wrap(async (req, res) => {
  const course = await activeCourse();
  if (!course) return res.status(404).send('No hay cursos publicados todavía.');
  res.redirect(`/c/${course.slug}`);
}));

// Portada del curso (§9.1).
router.get('/c/:slug', requireStudent, wrap(async (req, res) => {
  const course = await findCourse(req.params.slug);
  if (!course) return res.status(404).send('Curso no encontrado');
  if (!course.published && req.user.role !== 'admin') {
    return res.status(404).send('Curso no encontrado');
  }

  const tree = await buildTree(course, req.user.id);
  const stats = computeStats(tree);
  const nextLesson = stats.flat.find((l) => !l.done) || null;

  Object.assign(res.locals, {
    course, tree, stats, nextLesson, currentLessonId: null,
  });

  res.render('layout', {
    view: 'student/course',
    title: `${course.title} — Aula`,
    crumbs: `Curso <span class="sep">/</span> <b>${esc(course.title)}</b>`,
  });
}));

// Lección con markdown renderizado (§9.2).
router.get('/c/:slug/l/:lessonId', requireStudent, wrap(async (req, res) => {
  const course = await findCourse(req.params.slug);
  if (!course) return res.status(404).send('Curso no encontrado');
  if (!course.published && req.user.role !== 'admin') {
    return res.status(404).send('Curso no encontrado');
  }

  const lesson = unwrap(
    await sb().from('lessons')
      .select('id, module_id, title, content, position')
      .eq('id', req.params.lessonId)
      .maybeSingle()
  );
  if (!lesson) return res.status(404).send('Lección no encontrada');

  const mod = unwrap(
    await sb().from('modules')
      .select('id, course_id, title, position')
      .eq('id', lesson.module_id)
      .maybeSingle()
  );
  if (!mod || mod.course_id !== course.id) {
    return res.status(404).send('Lección no encontrada');
  }

  const tree = await buildTree(course, req.user.id);
  const stats = computeStats(tree);
  const idx = stats.flat.findIndex((l) => l.id === lesson.id);
  const next = idx >= 0 ? stats.flat[idx + 1] || null : null;
  const completed = idx >= 0 ? stats.flat[idx].done : false;

  Object.assign(res.locals, {
    course, tree, stats, nextLesson: next,
    currentLessonId: lesson.id,
    module: mod,
    lesson: { ...lesson, html: renderMarkdown(lesson.content) },
    completed,
    next,
  });

  res.render('layout', {
    view: 'student/lesson',
    title: `${lesson.title} — Aula`,
    crumbs: `Curso <span class="sep">/</span> ${esc(mod.title)} ` +
            `<span class="sep">/</span> <b>${esc(lesson.title)}</b>`,
  });
}));

// Marcar lección como completada (§9.2). No estaba en la tabla de §6.2
// del plan; añadida para que el botón "Marcar como completada" funcione.
router.post('/c/:slug/l/:lessonId/complete', requireStudent, wrap(async (req, res) => {
  const course = await findCourse(req.params.slug);
  if (!course) return res.status(404).send('Curso no encontrado');
  if (!course.published && req.user.role !== 'admin') {
    return res.status(404).send('Curso no encontrado');
  }

  const lesson = unwrap(
    await sb().from('lessons').select('id, module_id').eq('id', req.params.lessonId).maybeSingle()
  );
  if (!lesson) return res.status(404).send('Lección no encontrada');

  const mod = unwrap(
    await sb().from('modules').select('id, course_id').eq('id', lesson.module_id).maybeSingle()
  );
  if (!mod || mod.course_id !== course.id) {
    return res.status(404).send('Lección no encontrada');
  }

  unwrap(
    await sb().from('lesson_progress').upsert(
      { user_id: req.user.id, lesson_id: lesson.id },
      { onConflict: 'user_id,lesson_id', ignoreDuplicates: true }
    )
  );

  res.redirect(`/c/${course.slug}/l/${lesson.id}`);
}));

module.exports = router;
