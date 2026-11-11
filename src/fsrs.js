// fsrs.js
// Agendador de revisão espaçada baseado em FSRS (biblioteca ts-fsrs v5).
// Substitui o sistema de caixas de Leitner (gamification.js: reviewCard / isCardDue)
// na tela de flashcards, com 4 respostas: De novo, Difícil, Bom, Fácil.
//
// Formato do cartão no app (tudo serializável em JSON; datas viram texto ISO):
//   fsrs: true                       marca o cartão como já migrado
//   due, last_review                 ISO 8601 (data e hora)
//   stability, difficulty            memória do FSRS
//   state                            0 novo, 1 aprendendo, 2 revisão, 3 reaprendendo
//   scheduled_days, elapsed_days, learning_steps, reps, lapses
//   box, dueAt, lastReview           derivados, mantidos para o Anki e para a UI
//
// Cartões antigos (box 1 a 5, sem `fsrs`) continuam funcionando: são convertidos na
// primeira resposta (ou em ensureFsrs). Até lá, isDue usa a regra antiga por dia.

import { createEmptyCard, fsrs, Rating, State } from "ts-fsrs";
import { todayISO, isCardDue as isLegacyDue, BOX_INTERVALS, MAX_BOX } from "./gamification.js";

// request_retention 0.9: meta de 90% de acerto (padrão do Anki).
// enable_fuzz false: intervalos determinísticos (testáveis). Pode ligar em produção.
// enable_short_term true: passos curtos de aprendizado (1 min, 10 min) da biblioteca.
const scheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: false,
  enable_short_term: true,
});

export const RATING = {
  AGAIN: Rating.Again,
  HARD: Rating.Hard,
  GOOD: Rating.Good,
  EASY: Rating.Easy,
};

const DAY_MS = 86400000;

// Campos de agendamento que mudam a cada resposta (usados no desfazer).
export const SCHED_KEYS = [
  "fsrs", "due", "stability", "difficulty", "elapsed_days", "scheduled_days",
  "learning_steps", "reps", "lapses", "state", "last_review",
  "box", "dueAt", "lastReview",
];

/* ---------------- utilidades de data ---------------- */
function parseDay(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, m - 1, d);
}
function asDate(v) {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
const toISO = (d) => (d ? d.toISOString() : null);
const daysBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / DAY_MS);

/* ---------------- conversão app <-> ts-fsrs ---------------- */

// Intervalo (dias) que um cartão antigo tinha: usa as datas reais se houver, senão a tabela.
function legacyIntervalDays(card) {
  const box = Math.max(1, Math.min(MAX_BOX, card.box || 1));
  if (card.dueAt && card.lastReview) {
    const diff = daysBetween(parseDay(card.lastReview), parseDay(card.dueAt));
    if (diff >= 1) return diff;
  }
  return BOX_INTERVALS[box] ?? 1;
}

/** Converte o cartão do app (novo ou antigo) para o formato do ts-fsrs. */
export function toFsrsCard(card, now = new Date()) {
  if (!card) return createEmptyCard(now);

  if (card.fsrs && card.stability != null) {
    const state = card.state != null ? Number(card.state) : State.New;
    const scheduled = Number(card.scheduled_days) || 0;
    const due = asDate(card.due) || now;
    let last = asDate(card.last_review);
    // Cartão que já foi revisto precisa de last_review para o FSRS calcular o intervalo decorrido
    if (!last && state !== State.New) last = new Date(due.getTime() - scheduled * DAY_MS);
    return {
      due,
      stability: Number(card.stability) || 0,
      difficulty: Number(card.difficulty) || 0,
      elapsed_days: Number(card.elapsed_days) || 0,
      scheduled_days: scheduled,
      learning_steps: Number(card.learning_steps) || 0,
      reps: Number(card.reps) || 0,
      lapses: Number(card.lapses) || 0,
      state,
      last_review: last || undefined,
    };
  }

  // Cartão antigo (caixas de Leitner)
  const box = Math.max(1, Math.min(MAX_BOX, card.box || 1));
  if (box === 1) return createEmptyCard(now);

  const ivl = legacyIntervalDays(card);
  const dueAt = card.dueAt ? parseDay(card.dueAt) : null;
  const lastReview = card.lastReview ? parseDay(card.lastReview) : null;
  const due = dueAt || (lastReview ? new Date(lastReview.getTime() + ivl * DAY_MS) : now);
  const last = lastReview || new Date(due.getTime() - ivl * DAY_MS);
  return {
    due,
    stability: Math.max(1, ivl),
    difficulty: 5, // escala 1 a 10, neutro
    elapsed_days: Math.max(0, daysBetween(last, now)),
    scheduled_days: ivl,
    learning_steps: 0,
    reps: Math.max(1, box - 1),
    lapses: 0,
    state: State.Review,
    last_review: last,
  };
}

// "box" é só para exibição e para o export do Anki; derivado do estado e do intervalo.
function boxFor(state, scheduledDays) {
  if (state !== State.Review) return 1;
  const sd = scheduledDays || 0;
  return sd <= 4 ? 2 : sd <= 10 ? 3 : sd <= 25 ? 4 : 5;
}

/** Converte o cartão do ts-fsrs para os campos de agendamento do app (JSON seguro). */
function fromFsrsCard(c) {
  const due = asDate(c.due) || new Date();
  const last = asDate(c.last_review);
  return {
    fsrs: true,
    due: toISO(due),
    dueAt: todayISO(due),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps ?? 0,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: toISO(last),
    lastReview: last ? todayISO(last) : null,
    box: boxFor(c.state, c.scheduled_days),
  };
}

/** Garante o formato FSRS (migra cartão antigo). Não muta o original. */
export function ensureFsrs(card, now = new Date()) {
  if (card.fsrs && card.stability != null) return card;
  return { ...card, ...fromFsrsCard(toFsrsCard(card, now)) };
}

/* ---------------- agendamento ---------------- */

/**
 * Aplica a resposta e devolve o cartão atualizado (mantém id, frente, verso etc.).
 * @param {object} card
 * @param {number} rating RATING.AGAIN | HARD | GOOD | EASY
 */
export function rateCard(card, rating, now = new Date()) {
  if (![1, 2, 3, 4].includes(rating)) throw new RangeError(`Resposta inválida: ${rating}`);
  const result = scheduler.next(toFsrsCard(card, now), now, rating);
  return { ...card, ...fromFsrsCard(result.card) };
}

/** Texto curto para um intervalo em milissegundos: "10 min", "3 h", "4 dias", "2 meses". */
export function formatInterval(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return "<1 min";
  if (min < 60) return `${min} min`;
  const h = Math.round(ms / 3600000);
  if (h < 24) return `${h} h`;
  const days = Math.round(ms / DAY_MS);
  if (days < 30) return days === 1 ? "1 dia" : `${days} dias`;
  if (days < 365) {
    const mo = Math.max(1, Math.round(days / 30));
    return mo === 1 ? "1 mês" : `${mo} meses`;
  }
  const yr = Math.round(days / 365);
  return yr === 1 ? "1 ano" : `${yr} anos`;
}

/** Prévia dos 4 botões (tempo até a próxima revisão), sem alterar o cartão. */
export function previewIntervals(card, now = new Date()) {
  const rec = scheduler.repeat(toFsrsCard(card, now), now);
  const label = (r) => formatInterval(new Date(rec[r].card.due).getTime() - now.getTime());
  return {
    again: label(Rating.Again),
    hard: label(Rating.Hard),
    good: label(Rating.Good),
    easy: label(Rating.Easy),
  };
}

/* ---------------- vencimento ---------------- */

/**
 * O cartão está para revisar agora?
 * - antigo (caixas): regra por dia, igual à anterior
 * - em revisão: vence no dia (dueAt <= hoje)
 * - novo, aprendendo ou reaprendendo: vence quando o horário chega
 */
export function isDue(card, now = new Date()) {
  if (!card) return false;
  if (!card.fsrs) return isLegacyDue(card, todayISO(now));
  const today = todayISO(now);
  if (card.state === State.Review) {
    const d = asDate(card.due);
    return (card.dueAt || (d ? todayISO(d) : today)) <= today;
  }
  const due = asDate(card.due);
  return !due || due.getTime() <= now.getTime();
}

/** O cartão ainda está em aprendizado (novo, aprendendo ou reaprendendo)? */
export function isLearning(card) {
  return !!card && card.state !== State.Review;
}

/* ---------------- desfazer ---------------- */

/** Foto dos campos de agendamento (campos ausentes ficam undefined). */
export function snapshotScheduling(card) {
  return Object.fromEntries(SCHED_KEYS.map((k) => [k, card[k]]));
}

/** Devolve ao cartão o agendamento da foto; campos que não existiam são removidos. */
export function restoreScheduling(card, snap) {
  const out = { ...card };
  for (const k of SCHED_KEYS) {
    if (snap[k] === undefined) delete out[k];
    else out[k] = snap[k];
  }
  return out;
}

/** Copia só os campos de agendamento de `scheduled` para `card` (sem tocar em frente/verso). */
export function withScheduling(card, scheduled) {
  const out = { ...card };
  for (const k of SCHED_KEYS) if (scheduled[k] !== undefined) out[k] = scheduled[k];
  return out;
}

/* ---------------- rótulo para a UI ---------------- */

export function cardStatusLabel(card) {
  if (!card.fsrs) return `cx ${card.box || 1}`;
  if (card.state === State.New) return "novo";
  if (card.state !== State.Review) return "aprendendo";
  return formatInterval((card.scheduled_days || 0) * DAY_MS);
}
