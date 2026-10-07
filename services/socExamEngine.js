const crypto = require("crypto");

// Fisher–Yates con RNG criptográfico (Math.random es predecible).
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Armado del intento ──────────────────────────────────────────────────
/**
 * Devuelve { sequence, optionOrder } listo para persistir en el intento.
 *  sequence:    [{ qid, kind: "sjt"|"exp"|"ind", caseId, posInCase }]
 *  optionOrder: { [qid]: number[] }  → índice de pantalla → índice original
 */
function buildAttemptPlan(bank) {
  const bp = bank.blueprint;
  const units = [];

  // Casos: se elige al azar QUÉ casos salen, pero sus 5 preguntas van en
  // bloque y en el orden original (las transiciones dependen de ese orden).
  const pickCases = (ids, n, kind) =>
    shuffle(ids).slice(0, n).forEach(cid => {
      const qids = bank.cases[cid].questionIds.slice(0, bp.questionsPerCase);
      if (qids.length !== bp.questionsPerCase) throw new Error(`Caso ${cid} incompleto`);
      units.push(qids.map((qid, i) => ({ qid, kind, caseId: cid, posInCase: i + 1 })));
    });
  pickCases(bank.sjtCaseIds, bp.sjtCases, "sjt");
  pickCases(bank.expCaseIds, bp.expCases, "exp");

  // Individuales: N al azar por módulo según blueprint, cada una es su propia unidad.
  for (const [mod, n] of Object.entries(bp.individual)) {
    shuffle(bank.individualPools[mod] || []).slice(0, n).forEach(qid =>
      units.push([{ qid, kind: "ind", caseId: null, posInCase: null }])
    );
  }

  const sequence = shuffle(units).flat();

  const optionOrder = {};
  for (const item of sequence) {
    const q = bank.questions[item.qid];
    const idx = q.options.map((_, i) => i);
    // Verdadero/Falso se muestra siempre en el mismo orden (Verdadero, Falso).
    optionOrder[item.qid] = q.responseType === "truefalse"
      ? idx.sort((a, b) => (q.options[a].text === "Verdadero" ? -1 : q.options[b].text === "Verdadero" ? 1 : 0))
      : shuffle(idx);
  }

  return { sequence, optionOrder };
}

// ─── Respuestas: pantalla ↔ original ─────────────────────────────────────
/**
 * Valida la selección enviada por el front (índices de pantalla) y la
 * traduce a índices originales. Lanza Error("INVALID_SELECTION") si no cierra.
 */
function displayToOriginal(bank, attempt, qid, selected) {
  const q = bank.questions[qid];
  const order = attempt.optionOrder?.[qid];
  if (!q || !Array.isArray(order)) throw new Error("INVALID_SELECTION");
  if (!Array.isArray(selected)) throw new Error("INVALID_SELECTION");
  if (selected.length > order.length) throw new Error("INVALID_SELECTION");
  if (q.responseType !== "multi" && selected.length > 1) throw new Error("INVALID_SELECTION");
  const seen = new Set();
  for (const d of selected) {
    if (!Number.isInteger(d) || d < 0 || d >= order.length || seen.has(d)) throw new Error("INVALID_SELECTION");
    seen.add(d);
  }
  return selected.map(d => order[d]).sort((a, b) => a - b);
}

function originalToDisplay(attempt, qid, original = []) {
  const order = attempt.optionOrder?.[qid] || [];
  return original.map(o => order.indexOf(o)).filter(d => d >= 0).sort((a, b) => a - b);
}

// ─── Vista pública (lo único que ve el front) ────────────────────────────
function isAnswered(attempt, qid) {
  const a = attempt.answers?.[qid];
  return Array.isArray(a) && a.length > 0;
}

function questionView(bank, attempt, position) {
  const item = attempt.sequence[position];
  const q = bank.questions[item.qid];
  const order = attempt.optionOrder[item.qid];

  let caseInfo = null;
  if (item.caseId) {
    const c = bank.cases[item.caseId];
    caseInfo = {
      id: c.id,
      kind: c.kind,
      name: c.name,
      position: item.posInCase,
      size: c.questionIds.length,
      contextHtml: c.contextHtml,
      // Solo la info adicional que ya "ocurrió" a esta altura del caso.
      transitions: Object.entries(c.transitions || {})
        .filter(([before]) => Number(before) <= item.posInCase)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([before, html]) => ({ beforePosition: Number(before), html, isNew: Number(before) === item.posInCase })),
    };
  }

  return {
    id: q.id,
    number: position + 1,
    kind: item.kind,
    module: item.kind === "ind" ? q.module : null,
    responseType: q.responseType,
    difficulty: q.difficulty,
    text: q.text,
    options: order.map(o => q.options[o].text),
    selected: originalToDisplay(attempt, item.qid, attempt.answers?.[item.qid]),
    flagged: (attempt.flagged || []).includes(item.qid),
    case: caseInfo,
  };
}

/** Estado del examen para el front. No incluye nada que permita deducir respuestas. */
function buildView(bank, attempt) {
  const total = attempt.sequence.length;
  const flagged = attempt.flagged || [];
  const reached = attempt.phase === "review" ? total : attempt.currentIndex + 1;

  const positionOf = qid => attempt.sequence.findIndex(s => s.qid === qid);

  // Mapa de progreso: estado de cada número, sin contenido.
  const map = attempt.sequence.map((s, i) => ({
    number: i + 1,
    state: i < reached ? (i === attempt.currentIndex && attempt.phase === "exam" ? "current" : "done") : "locked",
    answered: i < reached && isAnswered(attempt, s.qid),
    flagged: flagged.includes(s.qid),
    inCase: s.kind !== "ind",
  }));

  let question = null;
  let review = null;

  if (attempt.phase === "exam") {
    question = questionView(bank, attempt, attempt.currentIndex);
  } else {
    const queue = (attempt.reviewQueue || []).map(qid => {
      const p = positionOf(qid);
      return { questionId: qid, number: p + 1, answered: isAnswered(attempt, qid), flagged: flagged.includes(qid) };
    });
    const idx = Math.min(attempt.reviewIndex || 0, Math.max(queue.length - 1, 0));
    review = { queue, index: idx };
    if (queue.length) question = questionView(bank, attempt, positionOf(queue[idx].questionId));
  }

  const answered = attempt.sequence.filter(s => isAnswered(attempt, s.qid)).length;

  return {
    phase: attempt.phase,
    total,
    currentIndex: attempt.currentIndex,
    isLast: attempt.currentIndex === total - 1,
    question,
    review,
    map,
    progress: { answered, flagged: flagged.length, unanswered: total - answered },
  };
}

// ─── Corrección (lógica aprobada v16) ────────────────────────────────────
/**
 *  • Opción única / V-F: puntaje completo solo si coincide exacto.
 *  • Selección múltiple: max(0, (correctas_elegidas − incorrectas_elegidas) / total_correctas) × peso.
 *  • "Correcta" (para el conteo) = puntaje completo.
 *  • score = puntos obtenidos / puntos posibles.
 */
function grade(bank, attempt) {
  let earned = 0, max = 0, correctCount = 0;
  const byModule = {};

  for (const item of attempt.sequence) {
    const q = bank.questions[item.qid];
    const w = q.weight;
    const modKey = item.kind === "sjt" ? "Casos SJT" : item.kind === "exp" ? "Casos Exploratorios" : q.module;
    const m = (byModule[modKey] ||= { module: modKey, earned: 0, max: 0, correct: 0, total: 0 });

    const correctIdx = q.options.map((o, i) => (o.correct ? i : -1)).filter(i => i >= 0);
    const given = Array.isArray(attempt.answers?.[item.qid]) ? attempt.answers[item.qid] : [];

    let pts = 0, full = false;
    if (given.length) {
      if (q.responseType === "multi") {
        const hit  = given.filter(i => correctIdx.includes(i)).length;
        const miss = given.filter(i => !correctIdx.includes(i)).length;
        pts  = Math.max(0, (hit - miss) / correctIdx.length) * w;
        full = hit === correctIdx.length && miss === 0;
      } else {
        full = given.length === 1 && given[0] === correctIdx[0];
        pts  = full ? w : 0;
      }
    }

    earned += pts; max += w;
    m.earned += pts; m.max += w; m.total++;
    if (full) { correctCount++; m.correct++; }
  }

  const round = n => Math.round(n * 10000) / 10000;
  return {
    score: max ? round(earned / max) : 0,
    pointsEarned: round(earned),
    maxPoints: max,
    correctCount,
    totalQuestions: attempt.sequence.length,
    byModule: Object.values(byModule).map(m => ({
      module: m.module, correct: m.correct, total: m.total,
      score: m.max ? round(m.earned / m.max) : 0,
    })),
  };
}

module.exports = { buildAttemptPlan, buildView, grade, displayToOriginal, isAnswered, shuffle };