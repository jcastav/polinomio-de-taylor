const express = require('express');
const { sb, unwrap } = require('../db/client');
const { requireAuth, requireStudent } = require('../lib/auth');
const { renderMarkdown } = require('../lib/markdown');
const quizLib = require('../lib/quiz');

const router = express.Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

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

// URL relativa de retorno (evita open redirects).
function safeBack(url) {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : null;
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

async function courseOk(req, course) {
  if (!course) return false;
  if (!course.published && req.user.role !== 'admin') return false;
  return true;
}

async function findQuiz(course, quizId) {
  const quiz = unwrap(
    await sb().from('quizzes').select('*').eq('id', quizId).maybeSingle()
  );
  return quiz && quiz.course_id === course.id ? quiz : null;
}

// Primer quiz de módulo (v1: uno por módulo).
async function moduleQuiz(course, moduleId) {
  const rows = unwrap(
    await sb().from('quizzes')
      .select('*')
      .eq('course_id', course.id)
      .eq('module_id', moduleId)
      .eq('kind', 'quiz')
      .order('id')
      .limit(1)
  );
  return rows[0] || null;
}

// Árbol módulo → lecciones con estado de progreso del usuario (§9.1).
// Cada módulo lleva su quiz (si tiene) y si ya está aprobado.
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

  const quizzes = unwrap(
    await sb().from('quizzes')
      .select('id, module_id, title, kind')
      .eq('course_id', course.id)
      .eq('kind', 'quiz')
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

  const quizIds = quizzes.filter((q) => q.module_id).map((q) => q.id);
  const passed = new Set();
  if (userId && quizIds.length) {
    const att = unwrap(
      await sb().from('attempts')
        .select('quiz_id')
        .eq('user_id', userId)
        .in('quiz_id', quizIds)
        .eq('status', 'graded')
        .eq('passed', true)
    );
    att.forEach((a) => passed.add(Number(a.quiz_id)));
  }

  return mods.map((m) => {
    const qz = quizzes.find((q) => q.module_id === m.id) || null;
    return {
      ...m,
      lessons: lessons
        .filter((l) => l.module_id === m.id)
        .sort((a, b) => a.position - b.position)
        .map((l) => ({ ...l, done: done.has(Number(l.id)) })),
      quiz: qz ? { id: qz.id, title: qz.title, passed: passed.has(Number(qz.id)) } : null,
    };
  });
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

// Progreso de quizzes del usuario en el curso (rail §9.1).
async function loadQuizStats(course, userId) {
  const quizzes = unwrap(
    await sb().from('quizzes').select('id').eq('course_id', course.id).eq('kind', 'quiz')
  );
  const ids = quizzes.map((q) => q.id);
  if (!ids.length) return { total: 0, done: 0, avg: null };

  const att = unwrap(
    await sb().from('attempts')
      .select('quiz_id, score, max_score')
      .eq('user_id', userId)
      .in('quiz_id', ids)
      .eq('status', 'graded')
  );

  const best = new Map();
  for (const a of att) {
    const pct = a.max_score > 0 ? (a.score * 100) / a.max_score : 0;
    if (!best.has(a.quiz_id) || pct > best.get(a.quiz_id)) best.set(a.quiz_id, pct);
  }
  const avg = best.size
    ? Math.round([...best.values()].reduce((s, v) => s + v, 0) / best.size)
    : null;
  return { total: ids.length, done: best.size, avg };
}

// Contexto común: árbol + progreso + stats de quizzes (vistas con layout).
async function courseContext(req, course) {
  const tree = await buildTree(course, req.user.id);
  const stats = computeStats(tree);
  stats.quizStats = await loadQuizStats(course, req.user.id);
  const nextLesson = stats.flat.find((l) => !l.done) || null;
  return { tree, stats, nextLesson };
}

// Preguntas listas para pintar: barajos deterministas por intento (§7.4).
function renderQuestions(quiz, attempt, questions, saved) {
  const seed = attempt ? Number(attempt.id) : 0;
  let qs = questions;
  if (quiz.shuffle && attempt) {
    qs = quizLib.shuffleWithSeed(questions, seed * 7919 + 13);
  }

  return qs.map((q, i) => {
    const payload = quizLib.parsePayload(q);
    const resp = saved && saved.has(Number(q.id)) ? saved.get(Number(q.id)) : null;
    let opts = null;
    let displayOrder = null;

    if (q.type === 'single' || q.type === 'multiple') {
      opts = (payload.options || []).map((text, idx) => ({ text, idx }));
      if (quiz.shuffle && attempt) {
        opts = quizLib.shuffleWithSeed(opts, seed * 31 + Number(q.id));
      }
    } else if (q.type === 'truefalse') {
      opts = [{ text: 'Verdadero', idx: 'true' }, { text: 'Falso', idx: 'false' }];
    } else if (q.type === 'order') {
      const items = (payload.items || []).map((text, idx) => ({ text, idx }));
      const ord = resp && Array.isArray(resp.order) ? resp.order : null;
      if (ord && ord.length === items.length && ord.every((v) => items.some((it) => it.idx === v))) {
        displayOrder = ord.map((v) => items.find((it) => it.idx === v));
      } else {
        displayOrder = items;
      }
    }

    return {
      ...q,
      n: i + 1,
      typeName: TYPE_NAMES[q.type] || q.type,
      payload,
      opts,
      displayOrder,
      savedResp: resp,
    };
  });
}

// Respuesta del estudiante en texto (para resultados §9.6).
function fmtResponse(q, resp) {
  if (!resp) return null;
  const p = q.payload;
  switch (q.type) {
    case 'single': {
      if (resp.choice == null) return null;
      const t = (p.options || [])[resp.choice];
      return t == null ? null : String(t);
    }
    case 'multiple': {
      const arr = (resp.choices || [])
        .map((n) => (p.options || [])[n])
        .filter((t) => t != null);
      return arr.length ? arr.join(' · ') : null;
    }
    case 'truefalse':
      return resp.value == null ? null : (resp.value ? 'Verdadero' : 'Falso');
    case 'short':
      return resp.text ? String(resp.text) : null;
    case 'match': {
      if (!Array.isArray(resp.map)) return null;
      const rows = (p.left || []).map((l, i) => {
        const r = (p.right || [])[resp.map[i]];
        return r == null ? `${l} → —` : `${l} → ${r}`;
      });
      return rows.join(' · ');
    }
    case 'order': {
      if (!Array.isArray(resp.order)) return null;
      return resp.order
        .map((v) => (p.items || [])[v])
        .filter((t) => t != null)
        .join(' → ');
    }
    default:
      return null;
  }
}

// Respuesta correcta en texto.
function fmtCorrect(q) {
  const p = q.payload;
  switch (q.type) {
    case 'single': {
      const t = (p.options || [])[p.correct];
      return t == null ? null : String(t);
    }
    case 'multiple':
      return (p.correct || [])
        .map((n) => (p.options || [])[n])
        .filter((t) => t != null)
        .join(' · ');
    case 'truefalse':
      return p.correct ? 'Verdadero' : 'Falso';
    case 'short':
      return (p.accepted || []).join(' / ');
    case 'match':
      return (p.pairs || [])
        .map(([l, r]) => `${(p.left || [])[l]} → ${(p.right || [])[r]}`)
        .join(' · ');
    case 'order':
      return (p.correct_order || [])
        .map((v) => (p.items || [])[v])
        .filter((t) => t != null)
        .join(' → ');
    default:
      return null;
  }
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

// Datos del quiz para su vista (crea intento si hay cupo, §7.3).
async function quizView(req, course, quiz) {
  const attempt = await quizLib.ensureAttempt(req.user, quiz);
  const used = await quizLib.countUsedAttempts(req.user.id, quiz.id);
  const questions = await quizLib.getQuestions(quiz.id);
  const saved = attempt ? await quizLib.loadSavedResponses(attempt.id) : new Map();
  return {
    quiz,
    attempt,
    used,
    attemptNo: attempt ? used + 1 : used,
    renderedQs: attempt ? renderQuestions(quiz, attempt, questions, saved) : [],
    exhausted: !attempt,
  };
}

// Envía y califica el intento (compartido por /submit y /check).
async function handleSend(req, res, course, quiz, backUrl) {
  const attempt = await quizLib.ensureAttempt(req.user, quiz);
  if (!attempt) return res.redirect(`/c/${course.slug}/quiz/${quiz.id}`);

  const questions = await quizLib.getQuestions(quiz.id);
  await quizLib.saveAnswers(attempt.id, questions, req.body);
  await quizLib.scoreAttempt(attempt.id);

  const dest = `/c/${course.slug}/quiz/${quiz.id}/result/${attempt.id}`;
  res.redirect(backUrl ? `${dest}?back=${encodeURIComponent(backUrl)}` : dest);
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
  if (!(await courseOk(req, course))) return res.status(404).send('Curso no encontrado');

  const { tree, stats, nextLesson } = await courseContext(req, course);

  Object.assign(res.locals, {
    course, tree, stats, nextLesson, currentLessonId: null,
  });

  res.render('layout', {
    view: 'student/course',
    title: `${course.title} — Aula`,
    crumbs: `Curso <span class="sep">/</span> <b>${esc(course.title)}</b>`,
  });
}));

// Lección con markdown renderizado y quiz embebido al final (§9.2).
router.get('/c/:slug/l/:lessonId', requireStudent, wrap(async (req, res) => {
  const course = await findCourse(req.params.slug);
  if (!(await courseOk(req, course))) return res.status(404).send('Curso no encontrado');

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

  const { tree, stats, nextLesson } = await courseContext(req, course);
  const idx = stats.flat.findIndex((l) => l.id === lesson.id);
  const next = idx >= 0 ? stats.flat[idx + 1] || null : null;
  const completed = idx >= 0 ? stats.flat[idx].done : false;

  // Quiz del módulo embebido en la última lección (§9.2).
  let quizBlock = null;
  const qz = await moduleQuiz(course, mod.id);
  if (qz) {
    const modTree = tree.find((m) => m.id === mod.id);
    const isLast = modTree && modTree.lessons.length
      && modTree.lessons[modTree.lessons.length - 1].id === lesson.id;
    if (isLast) {
      quizBlock = await quizView(req, course, qz);
      Object.assign(quizBlock, {
        action: `/c/${course.slug}/l/${lesson.id}/check`,
        saveUrl: `/c/${course.slug}/quiz/${qz.id}/save`,
        backUrl: `/c/${course.slug}/l/${lesson.id}`,
      });
    }
  }

  Object.assign(res.locals, {
    course, tree, stats, nextLesson: next,
    currentLessonId: lesson.id,
    module: mod,
    lesson: { ...lesson, html: renderMarkdown(lesson.content) },
    completed,
    next,
    quizBlock,
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
  if (!(await courseOk(req, course))) return res.status(404).send('Curso no encontrado');

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

// Quiz completo (§6.2). Mismo bloque que el embebido, en página propia.
router.get('/c/:slug/quiz/:quizId', requireStudent, wrap(async (req, res) => {
  const course = await findCourse(req.params.slug);
  if (!(await courseOk(req, course))) return res.status(404).send('Curso no encontrado');
  const quiz = await findQuiz(course, req.params.quizId);
  if (!quiz) return res.status(404).send('Quiz no encontrado');

  const { tree, stats, nextLesson } = await courseContext(req, course);
  const qv = await quizView(req, course, quiz);
  Object.assign(qv, {
    action: `/c/${course.slug}/quiz/${quiz.id}/submit`,
    saveUrl: `/c/${course.slug}/quiz/${quiz.id}/save`,
    backUrl: null,
  });

  Object.assign(res.locals, {
    course, tree, stats, nextLesson, currentLessonId: null,
    quizBlock: qv, quiz: qv.quiz, attemptNo: qv.attemptNo, exhausted: qv.exhausted,
  });

  res.render('layout', {
    view: 'student/quiz',
    title: `${quiz.title} — Aula`,
    crumbs: `Curso <span class="sep">/</span> <b>${esc(quiz.title)}</b>`,
  });
}));

// Guardado parcial del borrador (§7.3).
router.post('/c/:slug/quiz/:quizId/save', requireStudent, wrap(async (req, res) => {
  const course = await findCourse(req.params.slug);
  if (!(await courseOk(req, course))) return res.status(404).send('Curso no encontrado');
  const quiz = await findQuiz(course, req.params.quizId);
  if (!quiz) return res.status(404).send('Quiz no encontrado');

  const attempt = await quizLib.ensureAttempt(req.user, quiz);
  const quizUrl = `/c/${course.slug}/quiz/${quiz.id}`;
  if (!attempt) return res.redirect(quizUrl);

  const questions = await quizLib.getQuestions(quiz.id);
  await quizLib.saveAnswers(attempt.id, questions, req.body);
  res.redirect(safeBack(req.body.back) || quizUrl);
}));

// Envío y calificación del quiz completo (§6.2, §7.1).
router.post('/c/:slug/quiz/:quizId/submit', requireStudent, wrap(async (req, res) => {
  const course = await findCourse(req.params.slug);
  if (!(await courseOk(req, course))) return res.status(404).send('Curso no encontrado');
  const quiz = await findQuiz(course, req.params.quizId);
  if (!quiz) return res.status(404).send('Quiz no encontrado');
  await handleSend(req, res, course, quiz, safeBack(req.body.back));
}));

// Envío del quiz embebido en la lección (§6.2, §9.2).
router.post('/c/:slug/l/:lessonId/check', requireStudent, wrap(async (req, res) => {
  const course = await findCourse(req.params.slug);
  if (!(await courseOk(req, course))) return res.status(404).send('Curso no encontrado');

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

  const quiz = await moduleQuiz(course, mod.id);
  if (!quiz) return res.status(404).send('Quiz no encontrado');

  const back = safeBack(req.body.back) || `/c/${course.slug}/l/${lesson.id}`;
  await handleSend(req, res, course, quiz, back);
}));

// Página de resultados de un intento con retroalimentación (§7.5, §9.6).
router.get('/c/:slug/quiz/:quizId/result/:attemptId', requireStudent, wrap(async (req, res) => {
  const course = await findCourse(req.params.slug);
  if (!(await courseOk(req, course))) return res.status(404).send('Curso no encontrado');
  const quiz = await findQuiz(course, req.params.quizId);
  if (!quiz) return res.status(404).send('Quiz no encontrado');

  const attempt = unwrap(
    await sb().from('attempts')
      .select('*')
      .eq('id', req.params.attemptId)
      .eq('quiz_id', quiz.id)
      .eq('user_id', req.user.id)
      .maybeSingle()
  );
  if (!attempt) return res.status(404).send('Intento no encontrado');
  if (attempt.status !== 'graded') {
    return res.redirect(`/c/${course.slug}/quiz/${quiz.id}`);
  }

  const { tree, stats, nextLesson } = await courseContext(req, course);

  const questions = await quizLib.getQuestions(quiz.id);
  const answers = unwrap(
    await sb().from('answers')
      .select('question_id, response, correct, awarded')
      .eq('attempt_id', attempt.id)
  );
  const byQ = new Map(answers.map((a) => [Number(a.question_id), a]));

  const wrongIds = questions
    .filter((q) => byQ.get(Number(q.id)) && byQ.get(Number(q.id)).correct === false)
    .map((q) => q.id);
  const feedbackRows = wrongIds.length
    ? unwrap(
        await sb().from('question_feedback')
          .select('question_id, kind, content, position')
          .in('question_id', wrongIds)
          .order('position')
      )
    : [];
  const fbByQ = new Map();
  for (const f of feedbackRows) {
    const k = Number(f.question_id);
    if (!fbByQ.has(k)) fbByQ.set(k, []);
    fbByQ.get(k).push(f);
  }

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
    const fbs = fbByQ.get(Number(q.id)) || [];
    return {
      n: i + 1,
      typeName: TYPE_NAMES[q.type] || q.type,
      prompt: q.prompt,
      correct: a ? a.correct === true : false,
      awarded: a ? (a.awarded || 0) : 0,
      points: q.points || 1,
      your: fmtResponse(rq, resp),
      right: fmtCorrect(rq),
      texts: fbs.filter((f) => f.kind === 'text').map((f) => f.content),
      resources: fbs.filter((f) => f.kind !== 'text'),
    };
  });

  const attemptNo = await quizLib.countUsedAttempts(req.user.id, quiz.id);
  const pct = attempt.max_score ? Math.round((attempt.score * 100) / attempt.max_score) : 0;

  Object.assign(res.locals, {
    course, tree, stats, nextLesson, currentLessonId: null,
    quiz, attempt, items, attemptNo, pct,
    back: safeBack(req.query.back),
    quizUrl: `/c/${course.slug}/quiz/${quiz.id}`,
    canRetry: !attempt.passed && attemptNo < (quiz.max_attempts || 3),
  });

  res.render('layout', {
    view: 'student/results',
    title: `Resultados — ${quiz.title} — Aula`,
    crumbs: `Curso <span class="sep">/</span> ${esc(quiz.title)} ` +
            `<span class="sep">/</span> <b>Resultados</b>`,
  });
}));

// Historial de notas del estudiante en el curso (§9.4).
router.get('/c/:slug/results', requireStudent, wrap(async (req, res) => {
  const course = await findCourse(req.params.slug);
  if (!(await courseOk(req, course))) return res.status(404).send('Curso no encontrado');

  const { tree, stats, nextLesson } = await courseContext(req, course);

  const quizIds = (tree.map((m) => m.quiz && m.quiz.id).filter(Boolean));
  const rows = [];
  if (quizIds.length) {
    const attempts = unwrap(
      await sb().from('attempts')
        .select('id, status, score, max_score, passed, finished_at, started_at, quiz_id')
        .eq('user_id', req.user.id)
        .in('quiz_id', quizIds)
        .order('id', { ascending: false })
    );
    const titleById = new Map(tree.filter((m) => m.quiz).map((m) => [m.quiz.id, m.quiz.title]));

    for (const a of attempts) {
      const inProgress = a.status === 'in_progress';
      const pct = a.max_score ? Math.round((a.score * 100) / a.max_score) : null;
      rows.push({
        fecha: formatFecha(a.finished_at || a.started_at),
        title: titleById.get(a.quiz_id) || 'Quiz',
        nota: inProgress ? '—' : `${a.score} / ${a.max_score} (${pct}%)`,
        estado: inProgress ? 'En curso' : (a.passed ? 'Aprobado' : 'Suspendido'),
        href: inProgress
          ? `/c/${course.slug}/quiz/${a.quiz_id}`
          : `/c/${course.slug}/quiz/${a.quiz_id}/result/${a.id}`,
      });
    }
  }

  Object.assign(res.locals, {
    course, tree, stats, nextLesson, currentLessonId: null, rows,
  });

  res.render('layout', {
    view: 'student/history',
    title: `Resultados — ${course.title} — Aula`,
    crumbs: `Curso <span class="sep">/</span> <b>Resultados</b>`,
  });
}));

module.exports = router;
