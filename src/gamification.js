// gamification.js
// Módulo puro de gamificação. Sem dependências de React.
// Todas as funções são determinísticas e testáveis isoladamente.

/* =========================================================
   XP E NÍVEIS
   ========================================================= */

export const XP_REWARDS = {
  subtopicDone: 50,
  subjectDone: 200,
  pomodoroFocus: 10,
  flashcardKnow: 2,
  questionRight: 3,
  dailyGoal: 30,
  weeklyMission: 100,
};

// Curva quadrática suave: nível N começa em (N-1)^2 * 100 XP
// Nv 1: 0 · Nv 2: 100 · Nv 3: 400 · Nv 4: 900 · Nv 5: 1600 · Nv 10: 8100
export function levelFor(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
}
export function xpForLevel(level) {
  return (Math.max(1, level) - 1) ** 2 * 100;
}
export function levelProgress(xp) {
  const level = levelFor(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const span = next - base;
  const into = xp - base;
  return {
    level,
    xp,
    into,
    span,
    pct: span > 0 ? Math.min(100, Math.round((into / span) * 100)) : 100,
    nextAt: next,
  };
}

// Cargos por nível — metáfora "Diário Oficial"
export const RANKS = [
  { min: 1,  name: "Estagiário",       emoji: "📎" },
  { min: 4,  name: "Assistente",       emoji: "📋" },
  { min: 8,  name: "Técnico",          emoji: "🖇️" },
  { min: 12, name: "Analista",         emoji: "📊" },
  { min: 18, name: "Especialista",     emoji: "🎯" },
  { min: 25, name: "Auditor",          emoji: "⚖️" },
  { min: 35, name: "Delegado",         emoji: "🛡️" },
  { min: 50, name: "Juiz",             emoji: "🏛️" },
];
export function rankFor(level) {
  let rank = RANKS[0];
  for (const r of RANKS) if (level >= r.min) rank = r;
  return rank;
}

/* =========================================================
   STREAK (ofensiva de dias)
   ========================================================= */

const DAY_MS = 86400000;
export function todayISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function daysBetween(isoA, isoB) {
  const [ya, ma, da] = isoA.split("-").map(Number);
  const [yb, mb, db] = isoB.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / DAY_MS);
}

// Regras:
// - Mesmo dia: não mexe.
// - Ontem: incrementa.
// - Antes de ontem: reseta para 1.
// - Nunca estudou: 1.
// Freeze: se tiver `freezes > 0` e o gap for 2 dias, consome 1 freeze e mantém o streak.
export function updateStreak(gam, dateISO = todayISO()) {
  const s = gam.streak || { current: 0, best: 0, last: null, freezes: 1 };
  if (s.last === dateISO) return { ...gam, streak: s };
  // Relógio voltou (mudança de fuso/horário do aparelho): não mexe na ofensiva nem gasta freeze
  if (s.last && daysBetween(s.last, dateISO) <= 0) return { ...gam, streak: s };
  let { current, freezes } = s;
  if (!s.last) {
    current = 1;
  } else {
    const gap = daysBetween(s.last, dateISO);
    if (gap === 1) current += 1;
    else if (gap === 2 && freezes > 0) { freezes -= 1; current += 1; } // usa freeze
    else current = 1;
  }
  const best = Math.max(s.best || 0, current);
  return { ...gam, streak: { ...s, current, best, last: dateISO, freezes } };
}

/* =========================================================
   ESTADO BASE
   ========================================================= */

export function makeGamState() {
  return {
    xp: 0,
    streak: { current: 0, best: 0, last: null, freezes: 1 },
    dailyGoal: 30, // XP mínimo para "dia batido"
    today: { date: null, xp: 0, subtopics: 0, pomodoros: 0, flashcards: 0 },
    unlocked: {},   // { badgeId: ISOdate }
    missions: null, // { weekKey, items: [{id, title, target, progress, done}] }
    counters: { pomodoros: 0, flashcards: 0, questions: 0, subtopics: 0, subjects: 0, reviewsDone: 0 },
    awarded: {},    // chaves de recompensas "uma vez só" (evita ganhar XP marcando/desmarcando)
  };
}

// Garante consistência ao carregar (reset do "today" se mudou o dia)
export function normalizeGam(gam) {
  const base = makeGamState();
  const saved = gam || {};
  const g = {
    ...base,
    ...saved,
    streak: { ...base.streak, ...(saved.streak || {}) },
    today: { ...base.today, ...(saved.today || {}) },
    counters: { ...base.counters, ...(saved.counters || {}) },
    unlocked: { ...(saved.unlocked || {}) },
    awarded: { ...(saved.awarded || {}) },
  };
  const today = todayISO();
  if (g.today.date !== today) {
    g.today = { date: today, xp: 0, subtopics: 0, pomodoros: 0, flashcards: 0 };
  }
  if (!g.missions || g.missions.weekKey !== weekKey()) {
    g.missions = makeWeeklyMissions();
  }
  return g;
}

/* =========================================================
   BADGES
   Cada badge tem `check(gam, ctx)` → true se desbloqueia agora.
   ========================================================= */

export const BADGES = [
  { id: "first_sub",    name: "Primeiro Passo",     emoji: "🎯", desc: "Concluir 1 submatéria",       check: (g) => g.counters.subtopics >= 1 },
  { id: "first_subj",   name: "Matéria Fechada",    emoji: "📚", desc: "Concluir 1 matéria inteira",  check: (g) => g.counters.subjects >= 1 },
  { id: "streak_3",     name: "Constância",         emoji: "🔥", desc: "3 dias seguidos estudando",   check: (g) => g.streak.current >= 3 },
  { id: "streak_7",     name: "Semana Perfeita",    emoji: "💪", desc: "7 dias seguidos",             check: (g) => g.streak.current >= 7 },
  { id: "streak_30",    name: "Mês de Ferro",       emoji: "💎", desc: "30 dias seguidos",            check: (g) => g.streak.current >= 30 },
  { id: "pomodoro_10",  name: "Foco Inicial",       emoji: "🍅", desc: "10 ciclos de foco",           check: (g) => g.counters.pomodoros >= 10 },
  { id: "pomodoro_100", name: "Máquina de Foco",    emoji: "⚙️", desc: "100 ciclos de foco",          check: (g) => g.counters.pomodoros >= 100 },
  { id: "flash_50",     name: "Memória de Aço",     emoji: "🧠", desc: "50 cartões marcados 'Sabia'", check: (g) => g.counters.flashcards >= 50 },
  { id: "questions_100",name: "Mira Certeira",      emoji: "🎯", desc: "100 questões acertadas",      check: (g) => g.counters.questions >= 100 },
  { id: "level_5",      name: "Promoção",           emoji: "⭐", desc: "Alcançar nível 5",            check: (g) => levelFor(g.xp) >= 5 },
  { id: "level_10",     name: "Concursando Sério",  emoji: "🌟", desc: "Alcançar nível 10",           check: (g) => levelFor(g.xp) >= 10 },
  { id: "night_owl",    name: "Coruja",             emoji: "🦉", desc: "Estudar após 22h",            check: (g, ctx) => (ctx?.hour ?? new Date().getHours()) >= 22 },
  { id: "early_bird",   name: "Madrugador",         emoji: "🌅", desc: "Estudar antes das 6h",        check: (g, ctx) => (ctx?.hour ?? new Date().getHours()) < 6 },
  { id: "perfect_day",  name: "Dia Perfeito",       emoji: "🏆", desc: "Bater a meta diária",         check: (g) => g.today.xp >= g.dailyGoal },
  { id: "first_concurso", name: "De Olho no Edital",emoji: "📰", desc: "Cadastrar 1 concurso",        check: (g, ctx) => (ctx?.concursosCount ?? 0) >= 1 },
];

export function evaluateBadges(gam, ctx = {}) {
  const unlocked = { ...gam.unlocked };
  const newly = [];
  for (const b of BADGES) {
    if (unlocked[b.id]) continue;
    try {
      if (b.check(gam, ctx)) {
        unlocked[b.id] = todayISO();
        newly.push(b);
      }
    } catch { /* check nunca deve quebrar o fluxo */ }
  }
  return { gam: { ...gam, unlocked }, newly };
}

/* =========================================================
   MISSÕES SEMANAIS (rotativas)
   ========================================================= */

function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / DAY_MS) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
export const weekKey = () => isoWeekKey();

const MISSION_POOL = [
  { id: "m_pomo_10",   title: "10 pomodoros de foco",     target: 10, kind: "pomodoros" },
  { id: "m_sub_6",     title: "Concluir 6 submatérias",   target: 6,  kind: "subtopics" },
  { id: "m_flash_40",  title: "40 cartões 'Sabia'",       target: 40, kind: "flashcards" },
  { id: "m_streak_5",  title: "5 dias seguidos estudando",target: 5,  kind: "streak_days" },
  { id: "m_q_30",      title: "30 questões corretas",     target: 30, kind: "questions" },
  { id: "m_daily_5",   title: "Bater a meta em 5 dias",   target: 5,  kind: "goal_days" },
];

function pickRandom(arr, n) {
  const copy = [...arr];
  const out = [];
  while (copy.length && out.length < n) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}

export function makeWeeklyMissions() {
  const chosen = pickRandom(MISSION_POOL, 3);
  return {
    weekKey: weekKey(),
    items: chosen.map((m) => ({ ...m, progress: 0, done: false })),
  };
}

// Retorna { gam, completedNow: [mission] }
export function progressMission(gam, kind, inc = 1) {
  if (!gam.missions) return { gam, completedNow: [] };
  const completedNow = [];
  const items = gam.missions.items.map((m) => {
    if (m.kind !== kind || m.done) return m;
    const progress = Math.min(m.target, m.progress + inc);
    const done = progress >= m.target;
    const updated = { ...m, progress, done };
    if (done) completedNow.push(updated);
    return updated;
  });
  return { gam: { ...gam, missions: { ...gam.missions, items } }, completedNow };
}

// "N dias seguidos" acompanha a ofensiva real (e não o número de ações).
export function syncStreakMissions(gam) {
  if (!gam.missions) return { gam, completedNow: [] };
  const completedNow = [];
  const items = gam.missions.items.map((m) => {
    if (m.kind !== "streak_days" || m.done) return m;
    const progress = Math.min(m.target, Math.max(m.progress, gam.streak.current));
    const done = progress >= m.target;
    const updated = { ...m, progress, done };
    if (done) completedNow.push(updated);
    return updated;
  });
  return { gam: { ...gam, missions: { ...gam.missions, items } }, completedNow };
}

/* =========================================================
   AWARD — função central chamada pelo app em cada ação
   ========================================================= */

/**
 * @param {object} gam     estado atual
 * @param {string} action  chave de XP_REWARDS (ex: "subtopicDone")
 * @param {object} ctx     { onceKey, hour, concursosCount }
 *   onceKey: se informado, a recompensa só é dada uma vez para essa chave
 * @returns {{ gam, gainedXP, levelUp, prevLevel, newLevel, newBadges, missionsDone, goalHit }}
 */
export function award(gam, action, ctx = {}) {
  let g = normalizeGam(gam);
  const prevLevel = levelFor(g.xp);

  if (ctx.onceKey) {
    if (g.awarded[ctx.onceKey]) {
      return { gam: g, gainedXP: 0, levelUp: false, prevLevel, newLevel: prevLevel, newBadges: [], missionsDone: [], goalHit: false, skipped: true };
    }
    g = { ...g, awarded: { ...g.awarded, [ctx.onceKey]: true } };
  }

  const gained = XP_REWARDS[action] ?? 0;
  g = { ...g, xp: g.xp + gained, today: { ...g.today, xp: g.today.xp + gained } };

  // Counters / today stats
  const c = { ...g.counters };
  const t = { ...g.today };
  switch (action) {
    case "subtopicDone": t.subtopics += 1; c.subtopics += 1; break;
    case "subjectDone": c.subjects += 1; break;
    case "pomodoroFocus": t.pomodoros += 1; c.pomodoros += 1; break;
    case "flashcardKnow": t.flashcards += 1; c.flashcards += 1; break;
    case "questionRight": c.questions += 1; break;
    default: break;
  }
  g.counters = c;
  g.today = t;

  // Streak: só conta dia de estudo
  const studyAction = action === "subtopicDone" || action === "pomodoroFocus" || action === "flashcardKnow" || action === "questionRight";
  const missionsDone = [];
  if (studyAction) {
    g = updateStreak(g);
    const r = syncStreakMissions(g);
    g = r.gam;
    missionsDone.push(...r.completedNow);
  }

  // Missões por tipo de ação
  const missionKindMap = {
    subtopicDone: "subtopics",
    pomodoroFocus: "pomodoros",
    flashcardKnow: "flashcards",
    questionRight: "questions",
  };
  if (missionKindMap[action]) {
    const r = progressMission(g, missionKindMap[action], 1);
    g = r.gam;
    missionsDone.push(...r.completedNow);
  }

  // Meta diária batida AGORA (cruzou o limite nesta ação)
  let goalHit = false;
  let bonus = 0;
  if (g.today.xp >= g.dailyGoal && g.today.xp - gained < g.dailyGoal) {
    goalHit = true;
    bonus += XP_REWARDS.dailyGoal;
    const r = progressMission(g, "goal_days", 1);
    g = r.gam;
    missionsDone.push(...r.completedNow);
  }

  // XP extra: bônus da meta + missões concluídas
  const extra = bonus + missionsDone.length * XP_REWARDS.weeklyMission;
  g = { ...g, xp: g.xp + extra };

  // Badges (por último, já com o XP final)
  const b = evaluateBadges(g, { hour: ctx.hour ?? new Date().getHours(), concursosCount: ctx.concursosCount });
  g = b.gam;

  const newLevel = levelFor(g.xp);
  return {
    gam: g,
    gainedXP: gained + extra,
    levelUp: newLevel > prevLevel,
    prevLevel,
    newLevel,
    newBadges: b.newly,
    missionsDone,
    goalHit,
  };
}

/* =========================================================
   REVISÃO ESPAÇADA (flashcards)
   ========================================================= */

// Intervalos em dias por box. Box 1 é "novo".
export const BOX_INTERVALS = { 1: 1, 2: 3, 3: 7, 4: 15, 5: 30 };
export const MAX_BOX = 5;

export function nextDueISO(box, fromDate = new Date()) {
  const days = BOX_INTERVALS[Math.min(MAX_BOX, Math.max(1, box))] ?? 1;
  const d = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate() + days);
  return todayISO(d);
}
export function isCardDue(card, dateISO = todayISO()) {
  // cards antigos sem dueAt: considera due se box < MAX_BOX
  if (!card.dueAt) return (card.box || 1) < MAX_BOX;
  return card.dueAt <= dateISO;
}
export function reviewCard(card, knew, dateISO = todayISO()) {
  const box = knew ? Math.min(MAX_BOX, (card.box || 1) + 1) : 1;
  const [y, m, d] = dateISO.split("-").map(Number);
  return { ...card, box, dueAt: nextDueISO(box, new Date(y, m - 1, d)), lastReview: dateISO };
}

/* =========================================================
   EXPORT / IMPORT
   ========================================================= */

export const GAM_STORAGE_KEY = "gamification";
