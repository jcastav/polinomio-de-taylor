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
// Cada módulo lleva su quiz (si tiene): kind, passed y estado visual
// (pending/running/failed/approved) para los iconos del sidebar (A2).
async function buildTree(course, userId) {
  const mods = unwrap(
    await sb().from('modules')
      .select('id, title, position')
      .eq('course_id', course.id)
      .order('position')
  );
  if (!mods.length) return [];

  // UX-016: lecciones y quizzes son independientes entre sí → en paralelo.
  const [lessons, quizzes] = await Promise.all([
    sb().from('lessons')
      .select('id, module_id, title, position')
      .in('module_id', mods.map((m) => m.id))
      .then((r) => unwrap(r)),
    sb().from('quizzes')
      .select('id, module_id, title, kind, questions(count)')
      .eq('course_id', course.id)
      .in('module_id', mods.map((m) => m.id))
      .then((r) => unwrap(r)),
  ]);

  // Progreso y intentos dependen de las queries anteriores → también en paralelo.
  const [prog, att] = await Promise.all([
    (userId && lessons.length)
      ? sb().from('lesson_progress')
          .select('lesson_id')
          .eq('user_id', userId)
          .in('lesson_id', lessons.map((l) => l.id))
          .then((r) => unwrap(r))
      : Promise.resolve([]),
    (userId && quizzes.length)
      ? sb().from('attempts')
          .select('quiz_id, status, passed')
          .eq('user_id', userId)
          .in('quiz_id', quizzes.map((q) => q.id))
          .then((r) => unwrap(r))
      : Promise.resolve([]),
  ]);

  const done = new Set();
  prog.forEach((p) => done.add(Number(p.lesson_id)));

  return mods.map((m) => {
    const modLessons = lessons
      .filter((l) => l.module_id === m.id)
      .sort((a, b) => a.position - b.position);
    const qz = quizzes.find((q) => q.module_id === m.id) || null;
    let quiz = null;
    if (qz) {
      const forQ = att.filter((a) => Number(a.quiz_id) === Number(qz.id));
      const passed = forQ.some((a) => a.status === 'graded' && a.passed);
      // UX-018: quiz sin preguntas → estado "preparing" (envío bloqueado).
      const qCount = qz.questions && qz.questions[0] ? qz.questions[0].count : 0;
      let state = 'pending';
      if (!qCount) state = 'preparing';
      else if (passed) state = 'approved';
      else if (forQ.some((a) => a.status === 'in_progress')) state = 'running';
      else if (forQ.some((a) => a.status === 'graded')) state = 'failed';
      // §9.7: quiz de módulo bloqueado hasta completar sus lecciones;
      // excepción para quien ya tiene intentos graded (ve resultado/reintenta).
      const complete = modLessons.every((l) => done.has(Number(l.id)));
      const locked = qz.kind === 'quiz' && !complete &&
        !forQ.some((a) => a.status === 'graded');
      quiz = { id: qz.id, title: qz.title, kind: qz.kind, passed, state, locked };
    }
    return {
      ...m,
      lessons: modLessons.map((l) => ({ ...l, done: done.has(Number(l.id)) })),
      quiz,
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
// UX-016: árbol y stats de quizzes no dependen entre sí → en paralelo.
// 6b.3: el examen final viaja aparte (buildExam) para el sidebar.
async function courseContext(req, course) {
  const [tree, quizStats, exam] = await Promise.all([
    buildTree(course, req.user.id),
    loadQuizStats(course, req.user.id),
    buildExam(course, req.user),
  ]);
  const stats = computeStats(tree);
  stats.quizStats = quizStats;
  const nextLesson = stats.flat.find((l) => !l.done) || null;
  return { tree, stats, exam, nextLesson };
}

// 6b.1: quizzes de módulo (kind='quiz') sin intento aprobado (§9.3).
async function missingModuleQuizzes(course, userId) {
  const quizzes = unwrap(
    await sb().from('quizzes').select('id, title')
      .eq('course_id', course.id).eq('kind', 'quiz')
  );
  if (!quizzes.length) return [];
  const att = unwrap(
    await sb().from('attempts').select('quiz_id, passed')
      .eq('user_id', userId).eq('status', 'graded')
      .in('quiz_id', quizzes.map((q) => q.id))
  );
  const passedIds = new Set(att.filter((a) => a.passed).map((a) => Number(a.quiz_id)));
  return quizzes.filter((q) => !passedIds.has(Number(q.id)))
    .map((q) => ({ id: q.id, title: q.title }));
}

// 6b.1/6b.3: examen final del curso (si existe) con estado y bloqueo.
// `user` puede ser null (aunque requireStudent ya lo garantiza).
async function buildExam(course, user) {
  const examQ = unwrap(
    await sb().from('quizzes')
      .select('id, title, questions(count)')
      .eq('course_id', course.id).eq('kind', 'exam')
      .maybeSingle()
  );
  if (!examQ) return null;
  const qCount = examQ.questions && examQ.questions[0] ? examQ.questions[0].count : 0;

  let state = qCount ? 'pending' : 'preparing';
  let passedExam = false;
  let locked = false;
  if (user) {
    const att = unwrap(
      await sb().from('attempts').select('status, passed')
        .eq('user_id', user.id).eq('quiz_id', examQ.id)
    );
    passedExam = att.some((a) => a.status === 'graded' && a.passed);
    if (!qCount) state = 'preparing';
    else if (passedExam) state = 'approved';
    else if (att.some((a) => a.status === 'in_progress')) state = 'running';
    else if (att.some((a) => a.status === 'graded')) state = 'failed';
    // Bypass admin + flag relaxable (§9.3).
    if (qCount > 0 && !passedExam && user.role !== 'admin' &&
        course.require_all_passed !== false) {
      locked = (await missingModuleQuizzes(course, user.id)).length > 0;
    }
  }
  return { id: examQ.id, title: examQ.title, state, locked };
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
  const questions = await quizLib.getQuestions(quiz.id);
  // UX-018: sin preguntas no se crea intento ni se envía nada.
  if (!questions.length) {
    const usedQ = await quizLib.countUsedAttempts(req.user.id, quiz.id);
    return {
      quiz, attempt: null, used: usedQ, attemptNo: usedQ + 1,
      renderedQs: [], exhausted: false, preparing: true,
    };
  }
  const attempt = await quizLib.ensureAttempt(req.user, quiz);
  const used = await quizLib.countUsedAttempts(req.user.id, quiz.id);
  const saved = attempt ? await quizLib.loadSavedResponses(attempt.id) : new Map();
  return {
    quiz,
    attempt,
    used,
    attemptNo: attempt ? used + 1 : used,
    renderedQs: attempt ? renderQuestions(quiz, attempt, questions, saved) : [],
    exhausted: !attempt,
    preparing: false,
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
  if (!course) return res.renderError(404, 'No hay cursos publicados todavía.');
  res.redirect(`/c/${course.slug}`);
}));

// Portada del curso (§9.1).
router.get('/c/:slug', requireStudent, wrap(async (req, res) => {
  const course = await findCourse(req.params.slug);
  if (!(await courseOk(req, course))) return res.renderError(404, 'Curso no encontrado');

  const { tree, stats, exam, nextLesson } = await courseContext(req, course);

  Object.assign(res.locals, {
    course, tree, stats, exam, nextLesson, currentLessonId: null,
  });

  res.render('layout', {
    view: 'student/course',
    title: `${course.title} — Aula`,
    crumbs: `<a href="/c/${course.slug}">Curso</a> <span class="sep">/</span> <b>${esc(course.title)}</b>`,
  });
}));

// Lección con markdown renderizado (§9.2). El quiz NO se embebe: es
// ítem hermano en el árbol y se entra desde su propia ruta (UX decisiones).
router.get('/c/:slug/l/:lessonId', requireStudent, wrap(async (req, res) => {
  const course = await findCourse(req.params.slug);
  if (!(await courseOk(req, course))) return res.renderError(404, 'Curso no encontrado');

  const lesson = unwrap(
    await sb().from('lessons')
      .select('id, module_id, title, content, position')
      .eq('id', req.params.lessonId)
      .maybeSingle()
  );
  if (!lesson) return res.renderError(404, 'Lección no encontrada');

  const mod = unwrap(
    await sb().from('modules')
      .select('id, course_id, title, position')
      .eq('id', lesson.module_id)
      .maybeSingle()
  );
  if (!mod || mod.course_id !== course.id) {
    return res.renderError(404, 'Lección no encontrada');
  }

  const { tree, stats, exam, nextLesson } = await courseContext(req, course);
  const idx = stats.flat.findIndex((l) => l.id === lesson.id);
  const next = idx >= 0 ? stats.flat[idx + 1] || null : null;
  // UX-017: lección anterior para no depender del sidebar/migajas.
  const prev = idx > 0 ? stats.flat[idx - 1] : null;
  const completed = idx >= 0 ? stats.flat[idx].done : false;

  // CTA "Avanzar al quiz" en la última lección del módulo (A3).
  const modTree = tree.find((m) => m.id === mod.id) || null;
  const isLastLesson = !!(modTree && modTree.lessons.length &&
    modTree.lessons[modTree.lessons.length - 1].id === lesson.id);
  const moduleInfo = modTree ? {
    quiz: modTree.quiz,
    lessonsTotal: modTree.lessons.length,
    lessonsDone: modTree.lessons.filter((l) => l.done).length,
  } : null;

  Object.assign(res.locals, {
    course, tree, stats, exam, nextLesson: next,
    currentLessonId: lesson.id,
    module: mod,
    lesson: { ...lesson, html: renderMarkdown(lesson.content) },
    completed,
    prev,
    next,
    isLastLesson,
    moduleInfo,
    // §9.7: aviso al ser redirigido desde un quiz bloqueado (?locked=1).
    lockedFlash: req.query.locked === '1',
  });

  res.render('layout', {
    view: 'student/lesson',
    title: `${lesson.title} — Aula`,
    crumbs: `<a href="/c/${course.slug}">Curso</a> <span class="sep">/</span> ${esc(mod.title)} ` +
            `<span class="sep">/</span> <b>${esc(lesson.title)}</b>`,
  });
}));

// Marcar lección como completada (§9.2). No estaba en la tabla de §6.2
// del plan; añadida para que el botón "Marcar como completada" funcione.
router.post('/c/:slug/l/:lessonId/complete', requireStudent, wrap(async (req, res) => {
  const course = await findCourse(req.params.slug);
  if (!(await courseOk(req, course))) return res.renderError(404, 'Curso no encontrado');

  const lesson = unwrap(
    await sb().from('lessons').select('id, module_id').eq('id', req.params.lessonId).maybeSingle()
  );
  if (!lesson) return res.renderError(404, 'Lección no encontrada');

  const mod = unwrap(
    await sb().from('modules').select('id, course_id').eq('id', lesson.module_id).maybeSingle()
  );
  if (!mod || mod.course_id !== course.id) {
    return res.renderError(404, 'Lección no encontrada');
  }

  unwrap(
    await sb().from('lesson_progress').upsert(
      { user_id: req.user.id, lesson_id: lesson.id },
      { onConflict: 'user_id,lesson_id', ignoreDuplicates: true }
    )
  );

  res.redirect(`/c/${course.slug}/l/${lesson.id}`);
}));

// 6b.1/6b.4: acceso al examen final (§9.3). La URL bonita /c/:slug/exam
// redirige a su quiz; si está bloqueado, muestra la vista con lo que falta.
router.get('/c/:slug/exam', requireStudent, wrap(async (req, res) => {
  const course = await findCourse(req.params.slug);
  if (!(await courseOk(req, course))) return res.renderError(404, 'Curso no encontrado');

  const exam = unwrap(
    await sb().from('quizzes').select('*')
      .eq('course_id', course.id).eq('kind', 'exam')
      .maybeSingle()
  );
  if (!exam) return res.renderError(404, 'El examen final aún no está disponible.');

  // 6b.1: bloqueo salvo admin, o si el curso relajó require_all_passed.
  if (req.user.role !== 'admin' && course.require_all_passed !== false) {
    const missing = await missingModuleQuizzes(course, req.user.id);
    if (missing.length) {
      const { tree, stats, exam: sidebarExam, nextLesson } = await courseContext(req, course);
      Object.assign(res.locals, {
        course, tree, stats, exam: sidebarExam, nextLesson, currentLessonId: null,
        examBlock: { title: exam.title, pass_score: exam.pass_score },
        missing,
      });
      return res.render('layout', {
        view: 'student/exam',
        title: `Examen final — ${course.title} — Aula`,
        crumbs: `<a href="/c/${course.slug}">Curso</a> <span class="sep">/</span> <b>Examen final</b>`,
      });
    }
  }
  res.redirect(`/c/${course.slug}/quiz/${exam.id}`);
}));

// Quiz completo (§6.2). Mismo bloque que el embebido, en página propia.
router.get('/c/:slug/quiz/:quizId', requireStudent, wrap(async (req, res) => {
  const course = await findCourse(req.params.slug);
  if (!(await courseOk(req, course))) return res.renderError(404, 'Curso no encontrado');
  const quiz = await findQuiz(course, req.params.quizId);
  if (!quiz) return res.renderError(404, 'Quiz no encontrado');

  // 6b.1: el examen también se bloquea por URL directa (§9.3).
  if (quiz.kind === 'exam' && req.user.role !== 'admin' &&
      course.require_all_passed !== false) {
    const missing = await missingModuleQuizzes(course, req.user.id);
    if (missing.length) return res.redirect(`/c/${course.slug}/exam`);
  }

  // §9.7: guard del servidor — quiz de módulo bloqueado hasta completar
  // TODAS sus lecciones. Excepción: quien ya tiene intentos graded del
  // quiz conserva el acceso (resultado/reintento). El sidebar es solo
  // cosmético; esta regla es la que vale.
  if (quiz.kind === 'quiz' && quiz.module_id && req.user.role !== 'admin') {
    const graded = unwrap(
      await sb().from('attempts').select('id')
        .eq('quiz_id', quiz.id).eq('user_id', req.user.id)
        .eq('status', 'graded').limit(1)
    );
    if (!graded.length) {
      const modLessons = unwrap(
        await sb().from('lessons').select('id')
          .eq('module_id', quiz.module_id).order('position')
      );
      if (modLessons.length) {
        const prog = unwrap(
          await sb().from('lesson_progress').select('lesson_id')
            .eq('user_id', req.user.id)
            .in('lesson_id', modLessons.map((l) => l.id))
        );
        const doneSet = new Set(prog.map((p) => Number(p.lesson_id)));
        const pending = modLessons.find((l) => !doneSet.has(Number(l.id)));
        if (pending) {
          return res.redirect(`/c/${course.slug}/l/${pending.id}?locked=1`);
        }
      }
    }
  }

  const { tree, stats, exam, nextLesson } = await courseContext(req, course);
  const qv = await quizView(req, course, quiz);
  Object.assign(qv, {
    action: `/c/${course.slug}/quiz/${quiz.id}/submit`,
    saveUrl: `/c/${course.slug}/quiz/${quiz.id}/save`,
    backUrl: null,
  });

  // UX-003: confirmación visible tras guardar borrador (?saved=1).
  if (req.query.saved === '1') {
    qv.savedFlash = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  }

  Object.assign(res.locals, {
    course, tree, stats, exam, nextLesson, currentLessonId: null,
    quizBlock: qv, quiz: qv.quiz, attemptNo: qv.attemptNo, exhausted: qv.exhausted,
  });

  res.render('layout', {
    view: 'student/quiz',
    title: `${quiz.title} — Aula`,
    crumbs: `<a href="/c/${course.slug}">Curso</a> <span class="sep">/</span> <b>${esc(quiz.title)}</b>`,
  });
}));

// Guardado parcial del borrador (§7.3).
router.post('/c/:slug/quiz/:quizId/save', requireStudent, wrap(async (req, res) => {
  const course = await findCourse(req.params.slug);
  if (!(await courseOk(req, course))) return res.renderError(404, 'Curso no encontrado');
  const quiz = await findQuiz(course, req.params.quizId);
  if (!quiz) return res.renderError(404, 'Quiz no encontrado');

  const attempt = await quizLib.ensureAttempt(req.user, quiz);
  const quizUrl = `/c/${course.slug}/quiz/${quiz.id}`;
  if (!attempt) return res.redirect(quizUrl);

  const questions = await quizLib.getQuestions(quiz.id);
  await quizLib.saveAnswers(attempt.id, questions, req.body);
  // UX-003: ?saved=1 para pintar el banner "Borrador guardado · hh:mm".
  const target = safeBack(req.body.back) || quizUrl;
  const sep = target.includes('?') ? '&' : '?';
  res.redirect(`${target}${sep}saved=1`);
}));

// Envío y calificación del quiz completo (§6.2, §7.1).
router.post('/c/:slug/quiz/:quizId/submit', requireStudent, wrap(async (req, res) => {
  const course = await findCourse(req.params.slug);
  if (!(await courseOk(req, course))) return res.renderError(404, 'Curso no encontrado');
  const quiz = await findQuiz(course, req.params.quizId);
  if (!quiz) return res.renderError(404, 'Quiz no encontrado');
  await handleSend(req, res, course, quiz, safeBack(req.body.back));
}));

// Página de resultados de un intento con retroalimentación (§7.5, §9.6).
router.get('/c/:slug/quiz/:quizId/result/:attemptId', requireStudent, wrap(async (req, res) => {
  const course = await findCourse(req.params.slug);
  if (!(await courseOk(req, course))) return res.renderError(404, 'Curso no encontrado');
  const quiz = await findQuiz(course, req.params.quizId);
  if (!quiz) return res.renderError(404, 'Quiz no encontrado');

  const attempt = unwrap(
    await sb().from('attempts')
      .select('*')
      .eq('id', req.params.attemptId)
      .eq('quiz_id', quiz.id)
      .eq('user_id', req.user.id)
      .maybeSingle()
  );
  if (!attempt) return res.renderError(404, 'Intento no encontrado');
  if (attempt.status !== 'graded') {
    return res.redirect(`/c/${course.slug}/quiz/${quiz.id}`);
  }

  const { tree, stats, exam, nextLesson } = await courseContext(req, course);

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
      your: quizLib.fmtResponse(rq, resp),
      right: quizLib.fmtCorrect(rq),
      texts: fbs.filter((f) => f.kind === 'text').map((f) => f.content),
      resources: fbs.filter((f) => f.kind !== 'text'),
    };
  });

  const attemptNo = await quizLib.countUsedAttempts(req.user.id, quiz.id);
  const pct = attempt.max_score ? Math.round((attempt.score * 100) / attempt.max_score) : 0;

  Object.assign(res.locals, {
    course, tree, stats, exam, nextLesson, currentLessonId: null,
    quiz, attempt, items, attemptNo, pct,
    back: safeBack(req.query.back),
    quizUrl: `/c/${course.slug}/quiz/${quiz.id}`,
    canRetry: !attempt.passed && attemptNo < (quiz.max_attempts || 3),
  });

  res.render('layout', {
    view: 'student/results',
    title: `Resultados — ${quiz.title} — Aula`,
    crumbs: `<a href="/c/${course.slug}">Curso</a> <span class="sep">/</span> ${esc(quiz.title)} ` +
            `<span class="sep">/</span> <b>Resultados</b>`,
  });
}));

// Historial de notas del estudiante en el curso (§9.4).
router.get('/c/:slug/results', requireStudent, wrap(async (req, res) => {
  const course = await findCourse(req.params.slug);
  if (!(await courseOk(req, course))) return res.renderError(404, 'Curso no encontrado');

  const { tree, stats, exam, nextLesson } = await courseContext(req, course);

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
    course, tree, stats, exam, nextLesson, currentLessonId: null, rows,
  });

  res.render('layout', {
    view: 'student/history',
    title: `Resultados — ${course.title} — Aula`,
    crumbs: `<a href="/c/${course.slug}">Curso</a> <span class="sep">/</span> <b>Resultados</b>`,
  });
}));

// Ranking del curso con dos pestañas (§4.2/§9.5 + A5):
//   /c/:slug/ranking              → pestaña "Curso completo"
//   /c/:slug/ranking?quiz=:quizId → pestaña "Este quiz"
// NOTA (UX-NOTES): se computa en JS porque PostgREST no ejecuta queries
// con window functions. Si el curso supera ~200 estudiantes, mover la
// consulta de §4.2 a una función Postgres (rpc) o vista materializada.
router.get('/c/:slug/ranking', requireStudent, wrap(async (req, res) => {
  const course = await findCourse(req.params.slug);
  if (!(await courseOk(req, course))) return res.renderError(404, 'Curso no encontrado');

  const { tree, stats, exam, nextLesson } = await courseContext(req, course);

  const quizzes = unwrap(
    await sb().from('quizzes')
      .select('id, title, kind')
      .eq('course_id', course.id)
  );
  const quizById = new Map(quizzes.map((q) => [Number(q.id), q]));
  const quizParam = req.query.quiz ? Number(req.query.quiz) : null;
  const activeQuiz = quizParam && quizById.has(quizParam) ? quizById.get(quizParam) : null;

  const attempts = quizzes.length
    ? unwrap(
        await sb().from('attempts')
          .select('user_id, quiz_id, score, max_score')
          .eq('status', 'graded')
          .in('quiz_id', quizzes.map((q) => q.id))
      )
    : [];

  const userIds = [...new Set(attempts.map((a) => Number(a.user_id)))];
  const users = userIds.length
    ? unwrap(await sb().from('users').select('id, name').in('id', userIds))
    : [];
  const nameById = new Map(users.map((u) => [Number(u.id), u.name]));
  const nameOf = (id) => nameById.get(Number(id)) || 'Estudiante';
  const pctOf = (a) => (a.max_score > 0 ? Math.round((a.score * 100) / a.max_score) : 0);

  const meId = Number(req.user.id);
  let rows = [];
  let allRows = [];

  if (activeQuiz) {
    // Pestaña "Este quiz": mejor nota por estudiante + nº de intentos (§7.3:
    // solo intentos graded gastan cupo y puntúan).
    const byUser = new Map();
    for (const a of attempts) {
      if (Number(a.quiz_id) !== activeQuiz.id) continue;
      const cur = byUser.get(Number(a.user_id)) || { best: 0, tries: 0 };
      cur.tries += 1;
      cur.best = Math.max(cur.best, pctOf(a));
      byUser.set(Number(a.user_id), cur);
    }
    allRows = [...byUser.entries()].map(([uid, v]) => ({
      name: nameOf(uid), best: v.best, tries: v.tries, isMe: uid === meId,
    }));
    allRows.sort((a, b) => b.best - a.best || a.tries - b.tries || a.name.localeCompare(b.name, 'es'));
    allRows.forEach((r, i) => { r.pos = i + 1; });
    rows = allRows.slice(0, 20);
  } else {
    // Pestaña "Curso completo": mejor % por usuario y quiz, examen ×2 (§4.2).
    // Desempate: menos intentos, luego alfabético (§9.5).
    const best = new Map(); // `${uid}:${quizId}` → pct
    const triesByUser = new Map();
    for (const a of attempts) {
      const uid = Number(a.user_id);
      const qid = Number(a.quiz_id);
      const pct = pctOf(a);
      const key = `${uid}:${qid}`;
      if (!best.has(key) || pct > best.get(key)) best.set(key, pct);
      triesByUser.set(uid, (triesByUser.get(uid) || 0) + 1);
    }
    const byUser = new Map();
    for (const [key, pct] of best) {
      const [uid, qid] = key.split(':').map(Number);
      const quiz = quizById.get(qid);
      if (!quiz) continue;
      const cur = byUser.get(uid) || { total: 0, quizzes: 0 };
      cur.total += quiz.kind === 'exam' ? 2 * pct : pct;
      if (quiz.kind !== 'exam') cur.quizzes += 1;
      byUser.set(uid, cur);
    }
    allRows = [...byUser.entries()].map(([uid, v]) => ({
      name: nameOf(uid),
      total: Math.round(v.total),
      quizzes: v.quizzes,
      tries: triesByUser.get(uid) || 0,
      isMe: uid === meId,
    }));
    allRows.sort((a, b) => b.total - a.total || a.tries - b.tries || a.name.localeCompare(b.name, 'es'));
    allRows.forEach((r, i) => { r.pos = i + 1; });
    rows = allRows.slice(0, 20);
  }

  // Resaltar al usuario actual: si no entra en el top 20, añadir su fila
  // con su posición real (A5: "debe verse resaltado").
  if (!rows.some((r) => r.isMe)) {
    const mine = allRows.find((r) => r.isMe);
    if (mine) rows.push(mine);
  }

  Object.assign(res.locals, {
    course, tree, stats, exam, nextLesson, currentLessonId: null,
    rows, activeQuiz, quizzes,
    tab: activeQuiz ? 'quiz' : 'course',
  });

  res.render('layout', {
    view: 'student/ranking',
    title: `Ranking — ${course.title} — Aula`,
    crumbs: `<a href="/c/${course.slug}">Curso</a> <span class="sep">/</span> <b>Ranking</b>`,
  });
}));

module.exports = router;
