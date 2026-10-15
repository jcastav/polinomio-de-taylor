const { sb, unwrap } = require('../db/client');

// ---------- helpers ----------

function parsePayload(question) {
  try {
    return JSON.parse(question.payload);
  } catch {
    return {};
  }
}

// trim + lowercase + sin acentos + espacios colapsados (§7.2).
function normalizeText(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

// PRNG determinista para barajados reproducibles por intento (§7.4):
// el orden no se persiste en BD, pero es estable entre renders.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rnd() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithSeed(arr, seed) {
  const rnd = mulberry32(seed);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- calificación (§7.1, §7.2) ----------
// response es el JSON parseado de answers.response.
// Tipos: single, multiple, truefalse, short, match, order.
// (No hay preguntas abiertas en v1 → nada queda en revisión manual.)
function gradeAnswer(question, response) {
  const payload = parsePayload(question);
  const pts = question.points || 1;

  switch (question.type) {
    case 'single': {
      if (!response || response.choice == null) return { correct: false, awarded: 0 };
      const ok = response.choice === payload.correct;
      return { correct: ok, awarded: ok ? pts : 0 };
    }

    case 'truefalse': {
      if (!response || response.value == null) return { correct: false, awarded: 0 };
      const ok = Boolean(response.value) === Boolean(payload.correct);
      return { correct: ok, awarded: ok ? pts : 0 };
    }

    case 'multiple': {
      // Conjunto exacto, sin crédito parcial (§7.2).
      const given = Array.isArray(response?.choices)
        ? [...response.choices].map(Number).sort((a, b) => a - b)
        : [];
      const want = Array.isArray(payload.correct)
        ? [...payload.correct].map(Number).sort((a, b) => a - b)
        : [];
      const ok = given.length > 0
        && given.length === want.length
        && given.every((v, i) => v === want[i]);
      return { correct: ok, awarded: ok ? pts : 0 };
    }

    case 'short': {
      const raw = String(response?.text ?? '').trim();
      if (!raw) return { correct: false, awarded: 0 };
      const accepted = (payload.accepted || []).map((a) => String(a).trim());
      const ok = payload.case_sensitive
        ? accepted.includes(raw)
        : accepted.map(normalizeText).includes(normalizeText(raw));
      return { correct: ok, awarded: ok ? pts : 0 };
    }

    case 'match': {
      // payload.pairs = [[leftIdx, rightIdx], ...]
      // response.map[leftIdx] = rightIdx elegido
      const pairs = Array.isArray(payload.pairs) ? payload.pairs : [];
      const map = Array.isArray(response?.map) ? response.map : null;
      if (!pairs.length || !map) return { correct: false, awarded: 0 };
      const ok = pairs.every(([l, r]) => Number(map[l]) === Number(r));
      return { correct: ok, awarded: ok ? pts : 0 };
    }

    case 'order': {
      const want = Array.isArray(payload.correct_order) ? payload.correct_order.map(Number) : [];
      const given = Array.isArray(response?.order) ? response.order.map(Number) : null;
      if (!want.length || !given) return { correct: false, awarded: 0 };
      const ok = given.length === want.length && given.every((v, i) => v === want[i]);
      return { correct: ok, awarded: ok ? pts : 0 };
    }

    default:
      // Tipo desconocido: queda para revisión manual (no debería pasar).
      return { correct: null, awarded: 0 };
  }
}

// ---------- respuestas del formulario → JSON ----------

function parseFormResponse(question, body) {
  const key = `q_${question.id}`;

  switch (question.type) {
    case 'single': {
      const v = body[key];
      return v == null || v === '' ? null : { choice: Number(v) };
    }
    case 'truefalse': {
      const v = body[key];
      return v == null ? null : { value: v === 'true' };
    }
    case 'multiple': {
      let v = body[key];
      if (v == null) return { choices: [] };
      if (!Array.isArray(v)) v = [v];
      return { choices: v.map(Number).sort((a, b) => a - b) };
    }
    case 'short':
      return { text: String(body[key] ?? '').trim() };
    case 'match': {
      const map = [];
      let any = false;
      for (const k of Object.keys(body)) {
        const m = /^q_(\d+)_m(\d+)$/.exec(k);
        if (m && Number(m[1]) === question.id) {
          const raw = body[k];
          map[Number(m[2])] = raw == null || raw === '' ? -1 : Number(raw);
          any = true;
        }
      }
      return any ? { map: map.map((v) => (v == null ? -1 : v)) } : null;
    }
    case 'order': {
      const v = body[`${key}_order`];
      return v ? { order: String(v).split(',').map(Number) } : null;
    }
    default:
      return null;
  }
}

// ---------- intentos (§7.3) ----------

async function getQuestions(quizId) {
  return unwrap(
    await sb().from('questions')
      .select('id, quiz_id, type, prompt, points, position, payload')
      .eq('quiz_id', quizId)
      .order('position')
  );
}

async function getOpenAttempt(userId, quizId) {
  const rows = unwrap(
    await sb().from('attempts')
      .select('*')
      .eq('user_id', userId)
      .eq('quiz_id', quizId)
      .eq('status', 'in_progress')
      .order('id', { ascending: false })
      .limit(1)
  );
  return rows[0] || null;
}

// Intentos ya contabilizados (enviados). Los in_progress no gastan cupo.
async function countUsedAttempts(userId, quizId) {
  const rows = unwrap(
    await sb().from('attempts')
      .select('id')
      .eq('user_id', userId)
      .eq('quiz_id', quizId)
      .neq('status', 'in_progress')
  );
  return rows.length;
}

// Devuelve el intento abierto o crea uno; null si se acabaron los intentos
// o si el quiz está vacío (UX-018: sin preguntas no se envía nada).
async function ensureAttempt(user, quiz) {
  const open = await getOpenAttempt(user.id, quiz.id);
  if (open) return open;

  const qRows = unwrap(
    await sb().from('questions').select('id').eq('quiz_id', quiz.id).limit(1)
  );
  if (!qRows.length) return null;

  const used = await countUsedAttempts(user.id, quiz.id);
  if (used >= (quiz.max_attempts || 3)) return null;

  return unwrap(
    await sb().from('attempts')
      .insert({ user_id: user.id, quiz_id: quiz.id, status: 'in_progress' })
      .select('*')
      .single()
  );
}

// ---------- guardado y scoring ----------

async function loadSavedResponses(attemptId) {
  const rows = unwrap(
    await sb().from('answers')
      .select('question_id, response')
      .eq('attempt_id', attemptId)
  );
  const map = new Map();
  for (const r of rows) {
    try {
      map.set(Number(r.question_id), JSON.parse(r.response));
    } catch {
      map.set(Number(r.question_id), null);
    }
  }
  return map;
}

async function saveAnswers(attemptId, questions, body) {
  for (const q of questions) {
    const resp = parseFormResponse(q, body);
    const response = JSON.stringify(resp ?? {});

    const existing = unwrap(
      await sb().from('answers')
        .select('id')
        .eq('attempt_id', attemptId)
        .eq('question_id', q.id)
        .maybeSingle()
    );

    if (existing) {
      unwrap(
        await sb().from('answers')
          .update({ response, correct: null, awarded: 0 })
          .eq('id', existing.id)
      );
    } else {
      unwrap(
        await sb().from('answers')
          .insert({ attempt_id: attemptId, question_id: q.id, response, correct: null, awarded: 0 })
      );
    }
  }
}

// Califica todas las preguntas, actualiza answers y el intento (§7.1).
async function scoreAttempt(attemptId) {
  const attempt = unwrap(
    await sb().from('attempts')
      .select('id, user_id, quiz_id, status')
      .eq('id', attemptId)
      .maybeSingle()
  );
  if (!attempt) throw new Error('Intento no encontrado');

  const quiz = unwrap(
    await sb().from('quizzes')
      .select('id, pass_score')
      .eq('id', attempt.quiz_id)
      .maybeSingle()
  );
  const questions = await getQuestions(attempt.quiz_id);
  const answers = unwrap(
    await sb().from('answers')
      .select('id, question_id, response')
      .eq('attempt_id', attemptId)
  );
  const byQ = new Map(answers.map((a) => [Number(a.question_id), a]));

  let score = 0;
  let maxScore = 0;

  for (const q of questions) {
    maxScore += q.points || 1;
    const a = byQ.get(Number(q.id));
    let resp = null;
    if (a) {
      try {
        resp = JSON.parse(a.response);
      } catch {
        resp = null;
      }
    }
    const { correct, awarded } = gradeAnswer(q, resp);
    score += awarded;
    if (a) {
      unwrap(
        await sb().from('answers')
          .update({ correct, awarded })
          .eq('id', a.id)
      );
    }
  }

  const pct = maxScore > 0 ? (score * 100) / maxScore : 0;
  const passed = maxScore > 0 && pct >= (quiz.pass_score ?? 70);

  unwrap(
    await sb().from('attempts')
      .update({
        score,
        max_score: maxScore,
        passed,
        status: 'graded',
        finished_at: new Date().toISOString(),
      })
      .eq('id', attemptId)
  );

  return { score, max_score: maxScore, passed };
}

// Tiempo restante en segundos; null si no hay límite (§7.1).
function remainingSeconds(attempt, quiz) {
  if (!quiz.time_limit_min || !attempt.started_at) return null;
  const deadline = new Date(attempt.started_at).getTime() + quiz.time_limit_min * 60 * 1000;
  const left = Math.floor((deadline - Date.now()) / 1000);
  return left > 0 ? left : 0;
}

// 6b.2: instante límite del intento (ISO) o null si no aplica (sin
// time_limit_min o sin started_at). Fuente de verdad: servidor (§7.1).
function attemptDeadline(quiz, attempt) {
  if (!quiz.time_limit_min || !attempt || !attempt.started_at) return null;
  return new Date(
    new Date(attempt.started_at).getTime() + quiz.time_limit_min * 60 * 1000
  ).toISOString();
}

function attemptExpired(quiz, attempt) {
  const d = attemptDeadline(quiz, attempt);
  return d ? Date.now() > new Date(d).getTime() : false;
}

// 6b.2: si el intento sigue abierto y venció, se califica ya con lo
// guardado (sin tocar answers) y se devuelve el intento graded.
async function finalizeAttempt(attempt) {
  if (attempt && attempt.status === 'in_progress') {
    await scoreAttempt(attempt.id);
    return unwrap(
      await sb().from('attempts').select('*').eq('id', attempt.id).maybeSingle()
    );
  }
  return attempt;
}

// Respuesta del estudiante en texto (q.payload ya parseado).
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

// Respuesta correcta en texto (q.payload ya parseado).
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

module.exports = {
  parsePayload,
  normalizeText,
  shuffleWithSeed,
  gradeAnswer,
  parseFormResponse,
  getQuestions,
  getOpenAttempt,
  countUsedAttempts,
  ensureAttempt,
  loadSavedResponses,
  saveAnswers,
  scoreAttempt,
  remainingSeconds,
  attemptDeadline,
  attemptExpired,
  finalizeAttempt,
  fmtResponse,
  fmtCorrect,
};
