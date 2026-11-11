// ankiHistory.js
// Conversão entre o sistema de caixas do app (1 a 5) e o estado de agendamento do Anki.
// Usado por anki.js para:
//   - Import: ler cards (ivl/factor/type/queue/due) + revlog -> box/dueAt/lastReview
//   - Export: gerar cards com ivl/factor/due coerentes + revlog sintético
//
// O mapeamento é aproximado: o Anki usa SM-2/FSRS com intervalos variáveis; o app usa
// caixas fixas (1, 3, 7, 15, 30 dias). A "sensação" do cartão (novo/difícil/maduro) é
// preservada, mas não os intervalos exatos.
//
// ATENÇÃO ao calendário do Anki: o campo `due` dos cartões de revisão é o número de DIAS
// desde a criação da coleção (`col.crt`, em segundos), e não desde 1970. Por isso as
// conversões de data recebem o `crt` da coleção.

import { BOX_INTERVALS, MAX_BOX, todayISO, nextDueISO } from "./gamification.js";

/* =========================================================
   MAPEAMENTO BOX <-> ESTADO ANKI
   ========================================================= */

const IVL_TO_BOX = [
  { maxIvl: 1, box: 1 },
  { maxIvl: 4, box: 2 },
  { maxIvl: 10, box: 3 },
  { maxIvl: 25, box: 4 },
  { maxIvl: Infinity, box: 5 },
];
const FACTOR_BY_BOX = [0, 0, 2300, 2500, 2700, 2900];

// Factor baixo (< 2.0) sugere cartão difícil: rebaixa 1. Alto (> 2.8) sugere fácil: sobe 1.
function adjustBoxByFactor(box, factor) {
  let b = box;
  if (factor > 0 && factor < 2000) b = Math.max(1, b - 1);
  else if (factor > 2800) b = Math.min(MAX_BOX, b + 1);
  return b;
}

/** Estado do cartão no Anki -> caixa do app (1..5). */
export function ankiCardToBox(ankiCard) {
  const { ivl = 0, factor = 0, type = 0, queue = 0, reps = 0 } = ankiCard || {};
  if (type === 0 && reps === 0) return 1; // novo
  if (queue === 1 || queue === 3) return 1; // aprendendo / reaprendendo
  if (queue === -1) return 1; // suspenso: trata como "revisar"
  const found = IVL_TO_BOX.find((r) => ivl <= r.maxIvl) || IVL_TO_BOX[IVL_TO_BOX.length - 1];
  return adjustBoxByFactor(found.box, factor);
}

/** Caixa do app -> estado do cartão no Anki. Caixa 1 = novo; 2 a 5 = em revisão. */
export function boxToAnkiCardState(box) {
  const b = Math.max(1, Math.min(MAX_BOX, box || 1));
  if (b === 1) return { ivl: 0, factor: 0, type: 0, queue: 0, reps: 0 };
  return { ivl: BOX_INTERVALS[b] ?? 1, factor: FACTOR_BY_BOX[b], type: 2, queue: 2, reps: b - 1 };
}

/* =========================================================
   DATAS <-> DIAS DO ANKI (relativos à criação da coleção)
   ========================================================= */

/**
 * `crt` ideal para uma coleção nova: 4h da manhã (horário local) do dia atual — a
 * virada de dia padrão do Anki. Antes das 4h, usa o dia anterior para que "hoje"
 * continue sendo o dia 0.
 */
export function makeCrt(date = new Date()) {
  const base = new Date(date.getFullYear(), date.getMonth(), date.getDate() - (date.getHours() < 4 ? 1 : 0), 4, 0, 0);
  return Math.floor(base.getTime() / 1000);
}

function crtParts(crtSec) {
  const c = new Date(crtSec * 1000);
  return { y: c.getFullYear(), m: c.getMonth(), d: c.getDate() };
}

/** Dia do Anki (dias desde `crt`) -> data ISO local. */
export function ankiDayToISO(day, crtSec) {
  const { y, m, d } = crtParts(crtSec);
  return todayISO(new Date(y, m, d + day));
}

/** Data ISO -> dia do Anki (nunca negativo: vencido vira "hoje"). */
export function isoToAnkiDay(iso, crtSec) {
  if (!iso) return 0;
  const [y, m, d] = iso.split("-").map(Number);
  const c = crtParts(crtSec);
  return Math.max(0, Math.round((Date.UTC(y, m - 1, d) - Date.UTC(c.y, c.m, c.d)) / 86400000));
}

/* =========================================================
   LEITURA DO PROGRESSO (import)
   ========================================================= */

/** Lê `col.crt` (segundos). Retorna null se não existir. */
export function readCrt(db) {
  try {
    const res = db.exec("SELECT crt FROM col");
    const v = res && res[0] && res[0].values[0] && res[0].values[0][0];
    return Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null;
  } catch {
    return null;
  }
}

/**
 * Retorna Map: nid -> { cardId, ivl, factor, reps, type, queue, due }
 * Se o note tiver vários cards, pega o de maior ivl (o mais "maduro").
 */
export function readCardProgress(db) {
  const out = new Map();
  try {
    const res = db.exec("SELECT id, nid, ivl, factor, reps, type, queue, due FROM cards ORDER BY nid, ord");
    if (!res || !res.length) return out;
    const { columns, values } = res[0];
    const idx = Object.fromEntries(columns.map((c, i) => [c, i]));
    for (const row of values) {
      const nid = row[idx.nid];
      const card = {
        cardId: row[idx.id],
        ivl: row[idx.ivl],
        factor: row[idx.factor],
        reps: row[idx.reps],
        type: row[idx.type],
        queue: row[idx.queue],
        due: row[idx.due],
      };
      const prev = out.get(nid);
      if (!prev || card.ivl > prev.ivl) out.set(nid, card);
    }
  } catch { /* sem tabela cards */ }
  return out;
}

/**
 * Retorna Map: nid -> [ { id, time, ease, ivl, lastIvl, factor, type }, ... ] em ordem.
 * `id` é o horário da revisão (ms desde 1970); `time` é só a duração da revisão.
 * `cardIdToNid` mapeia cards.id -> notes.id.
 */
export function readRevlog(db, cardIdToNid) {
  const out = new Map();
  try {
    const res = db.exec("SELECT id, cid, ease, ivl, lastIvl, factor, time, type FROM revlog ORDER BY id");
    if (!res || !res.length) return out;
    const { columns, values } = res[0];
    const idx = Object.fromEntries(columns.map((c, i) => [c, i]));
    for (const row of values) {
      const nid = cardIdToNid.get(row[idx.cid]);
      if (nid == null) continue;
      if (!out.has(nid)) out.set(nid, []);
      out.get(nid).push({
        id: row[idx.id],
        time: row[idx.time],
        ease: row[idx.ease],
        ivl: row[idx.ivl],
        lastIvl: row[idx.lastIvl],
        factor: row[idx.factor],
        type: row[idx.type],
      });
    }
  } catch { /* sem revlog */ }
  return out;
}

const plausibleISO = (iso) => (iso && iso >= "2000-01-01" && iso <= "2100-12-31" ? iso : null);

/**
 * Enriquece os cards lidos com box/dueAt/lastReview, a partir do progresso no Anki.
 * `cards` precisa trazer `nid` (preenchido em readCollection).
 */
export function applyProgressToCards(cards, progressByNid, revlogByNid, crtSec) {
  return cards.map((c) => {
    const prog = c.nid != null ? progressByNid.get(c.nid) : null;
    if (!prog) return { ...c, box: 1, dueAt: null, lastReview: null };

    const box = ankiCardToBox(prog);
    // `due` só é uma data (dia desde crt) para cartões de revisão (queue 2) e reaprendizado por dia (queue 3).
    // Em cartões novos é a posição na fila e em aprendizado é um horário.
    const hasDate = (prog.queue === 2 || prog.queue === 3) && crtSec != null;
    const dueAt = hasDate ? plausibleISO(ankiDayToISO(prog.due, crtSec)) : null;

    let lastReview = null;
    const revs = c.nid != null ? revlogByNid?.get(c.nid) : null;
    if (revs && revs.length) {
      lastReview = plausibleISO(todayISO(new Date(revs[revs.length - 1].id)));
    }
    if (!lastReview && dueAt && prog.ivl > 0) {
      const [y, m, d] = dueAt.split("-").map(Number);
      lastReview = plausibleISO(todayISO(new Date(y, m - 1, d - prog.ivl)));
    }
    return { ...c, box, dueAt, lastReview };
  });
}

/* =========================================================
   EXPORTAÇÃO COM HISTÓRICO
   ========================================================= */

// Revlog sintético com os intervalos canônicos (1, 3, 7, 15, 30 dias): uma revisão por
// salto de caixa, datada "para trás" a partir da última revisão.
function synthesizeRevlogForCard(card) {
  const box = Math.max(1, Math.min(MAX_BOX, card.box || 1));
  if (box < 2) return [];
  const reviews = [];
  const lastISO = card.lastReview || todayISO();
  const [y, m, d] = lastISO.split("-").map(Number);
  let cursor = new Date(y, m - 1, d, 12, 0, 0);
  if (cursor.getTime() > Date.now()) cursor = new Date();
  let cursorMs = cursor.getTime();

  for (let b = box; b >= 2; b--) {
    const wasNew = b === 2;
    const prevIvl = wasNew ? 0 : (BOX_INTERVALS[b - 1] ?? 0);
    reviews.unshift({
      id: cursorMs, // horário da revisão (ms)
      ease: wasNew ? 3 : 4,
      ivl: BOX_INTERVALS[b] ?? 1,
      lastIvl: prevIvl,
      factor: FACTOR_BY_BOX[b],
      time: 15000 + Math.floor(Math.random() * 15000), // duração (ms)
      type: wasNew ? 0 : 1,
    });
    cursorMs -= Math.max(1, prevIvl) * 86400000;
  }
  return reviews;
}

/**
 * Prepara o estado de agendamento + revlog de cada cartão do app.
 * `due` fica null para cartões novos (anki.js usa a posição na fila).
 */
export function buildProgressForExport(decks, crtSec) {
  const byCardId = new Map();
  const nowSec = Math.floor(Date.now() / 1000);
  for (const deck of decks) {
    for (const card of deck.cards) {
      const box = Math.max(1, Math.min(MAX_BOX, card.box || 1));
      const state = boxToAnkiCardState(box);
      const due = box === 1 ? null : isoToAnkiDay(card.dueAt || nextDueISO(box), crtSec);
      byCardId.set(card.id, { ...state, due, mod: nowSec, revlog: synthesizeRevlogForCard(card) });
    }
  }
  return { byCardId };
}
