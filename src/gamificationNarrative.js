// gamificationNarrative.js
// "Personal trainer" narrativo: gera mensagens contextuais.
// Módulo puro. Não usa React, não toca storage.

import { rankFor, todayISO } from "./gamification.js";

/* =========================================================
   BANCO DE MENSAGENS
   ========================================================= */

const MESSAGES = {
  // Promoção de cargo: a chave é o NOVO cargo
  promotion: {
    assistente: ["Você foi efetivado como Assistente. O protocolo avança.", "Promoção registrada: Assistente. Continue."],
    tecnico: ["Nomeado Técnico. O Diário reconhece sua constância.", "Técnico(a) empossado(a). A fila anda."],
    analista: ["Analista. O edital agora tem seu nome.", "Promoção a Analista — carimbo dourado no seu diário."],
    especialista: ["Especialista. Uma vaga a menos entre você e a posse.", "Especialista confirmado. Siga com revisão espaçada."],
    auditor: ["Auditor. Isso já é seleto — mantenha o ritmo.", "Auditor(a). A aprovação está no horizonte."],
    delegado: ["Delegado. Poder de investigação — e de disciplina.", "Delegado(a). Sua constância virou autoridade."],
    juiz: ["Juiz. Ato final. Aproveite cada revisão.", "Juiz(a). Você senta na cadeira que estudou para ocupar."],
  },
  // Subiu de nível sem mudar de cargo
  levelUpSameRank: [
    "Novo nível registrado. O Diário acompanha seu avanço.",
    "Subiu de nível. Cada bloco conta.",
    "Mais um degrau. Siga no ritmo.",
  ],

  // Ao desbloquear um badge
  badge: {
    first_sub: "Primeiro carimbo: o Diário Oficial reconhece seu primeiro passo.",
    first_subj: "Matéria inteira vencida. Isso não é sorte — é método.",
    streak_3: "Três dias. O hábito começa a se formar.",
    streak_7: "Uma semana inteira. Seu cérebro já pede o estudo.",
    streak_30: "Trinta dias. Você virou outro concurseiro.",
    pomodoro_10: "Dez ciclos de foco. A máquina está calibrada.",
    pomodoro_100: "Cem ciclos. Foco virou rotina.",
    flash_50: "Cinquenta cartões dominados. A memória agradece.",
    questions_100: "Cem questões certas. A banca vai te reconhecer.",
    level_5: "Cinco níveis. A escada tem mais degraus — e você sobe.",
    level_10: "Nível 10. Concursando sério é outro patamar.",
    night_owl: "Coruja. Estudar tarde também é estudar — só cuide do sono.",
    early_bird: "Madrugador. Quem estuda antes do sol larga na frente.",
    perfect_day: "Dia perfeito: a meta foi batida. Amanhã recomeça.",
    first_concurso: "Edital na mira. O alvo foi oficialmente registrado.",
  },

  // Ações específicas (feedback curto)
  subtopicDone: [
    "Submatéria protocolada. Mais um item riscado do edital.",
    "Concluída. O Diário registra — e a fila anda.",
    "Feito. Cada submatéria é uma questão que não te derruba.",
    "Protocolo encerrado. Respire e siga.",
  ],
  subjectDone: [
    "Matéria inteira. Carimbo dourado no seu diário.",
    "Fechou uma matéria. Agora é revisão espaçada e questões.",
    "Matéria vencida. Você acaba de encurtar o edital.",
  ],
  pomodoroFocus: [
    "Ciclo cumprido. Levante, beba água.",
    "Foco encerrado. Alongue a vista.",
    "Um bloco a menos. Você está mais perto.",
  ],
  questionRight: [
    "Acertou. Confirme o porquê — é isso que fixa.",
    "Correta. Anote o raciocínio, não só a resposta.",
    "Boa. Erre menos nas próximas.",
  ],
  flashcardKnow: [
    "Memória confirmada. Box sobe.",
    "Sabia — o intervalo aumenta.",
    "Fixa. Revisão espaçada agradece.",
  ],

  // Saudações por contexto
  greeting: {
    morning: ["Bom dia. O edital não espera.", "Manhã é ouro para concurseiro."],
    afternoon: ["Boa tarde. Um bloco antes do café ajuda.", "A tarde rende — pegue um pomodoro."],
    evening: ["Boa noite. Uma submatéria antes de dormir.", "Noite boa para revisão leve."],
    night: ["Tarde da noite? Cuidado com o sono — ele também estuda.", "Madrugada é silêncio, mas o corpo cobra."],
  },

  // Alerta de streak em risco
  streakRisk: [
    "Seu streak está em risco. Um pomodoro resolve.",
    "Não perca a ofensiva: 10 minutos já contam.",
    "O Diário registra ausências. Um bloco, só um.",
  ],

  // Celebração de retorno após pausa
  comeback: [
    "Voltou. O importante é retomar — sem culpa.",
    "Recomeço registrado. Siga de onde parou.",
    "Bem-vindo de volta. Um bloco para aquecer.",
  ],

  // Estado neutro (sem muito contexto)
  idle: [
    "Pronto para o próximo bloco?",
    "O Diário aguarda o próximo protocolo.",
    "Um passo de cada vez — mas hoje tem passo.",
  ],

  goalHit: [
    "Meta batida. O Diário registra — e libera o descanso.",
    "Meta do dia cumprida. Guarde energia para amanhã.",
    "Dia protocolado. Você fez sua parte.",
  ],
};

/* =========================================================
   SELEÇÃO COM ANTI-REPETIÇÃO
   ========================================================= */

const lastPick = new Map(); // categoria → índice

function pickNarrative(list, key) {
  if (!Array.isArray(list) || !list.length) return "";
  if (list.length === 1) return list[0];
  const prev = lastPick.get(key);
  let i = Math.floor(Math.random() * list.length);
  if (i === prev) i = (i + 1) % list.length;
  lastPick.set(key, i);
  return list[i];
}

function rankKey(rankName) {
  return rankName
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");
}

function timeOfDay(hour = new Date().getHours()) {
  if (hour < 6) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  if (hour < 23) return "evening";
  return "night";
}

/* =========================================================
   API PRINCIPAL
   ========================================================= */

/**
 * Mensagem para uma conquista (nível ou badge).
 * @param {object} args
 * @param {"levelUp"|"badge"} args.kind
 * @param {number} [args.level]      nível novo
 * @param {number} [args.prevLevel]  nível anterior (para saber se o cargo mudou)
 * @param {string} [args.badgeId]
 */
export function narrativeForAchievement({ kind, level, prevLevel, badgeId }) {
  if (kind === "levelUp" && level) {
    const rank = rankFor(level);
    const promoted = prevLevel == null || rankFor(prevLevel).name !== rank.name;
    const pool = promoted ? MESSAGES.promotion[rankKey(rank.name)] : null;
    if (pool) return `${rank.emoji} ${pickNarrative(pool, `promotion:${rank.name}`)}`;
    return `${rank.emoji} ${pickNarrative(MESSAGES.levelUpSameRank, "levelUpSameRank")}`;
  }
  if (kind === "badge" && badgeId && MESSAGES.badge[badgeId]) {
    return MESSAGES.badge[badgeId];
  }
  return "";
}

/** Feedback curto por ação concluída. */
export function narrativeForAction(action) {
  const pool = MESSAGES[action];
  if (!Array.isArray(pool)) return "";
  return pickNarrative(pool, `action:${action}`);
}

/** Saudação conforme horário. */
export function greeting(hour = new Date().getHours()) {
  const tod = timeOfDay(hour);
  return pickNarrative(MESSAGES.greeting[tod], `greet:${tod}`);
}

/**
 * Alerta se o streak está em risco: já tem ofensiva, não estudou hoje e já é tarde.
 */
export function streakWarning(gam, hour = new Date().getHours()) {
  const s = gam?.streak;
  const risk = s && s.current > 0 && s.last !== todayISO() && hour >= 18;
  if (!risk) return "";
  return pickNarrative(MESSAGES.streakRisk, "streakRisk");
}

/** Mensagem de retorno (usuário volta depois de 3+ dias). */
export function comebackMessage(gam) {
  const last = gam?.streak?.last;
  if (!last) return "";
  const today = todayISO();
  if (last === today) return "";
  const gap = Math.round((Date.parse(today) - Date.parse(last)) / 86400000);
  if (gap >= 3) return pickNarrative(MESSAGES.comeback, "comeback");
  return "";
}

/** Mensagem ociosa (para o header). */
export function idleMessage() {
  return pickNarrative(MESSAGES.idle, "idle");
}

/**
 * Texto do toast de recompensa: nível (com cargo) e badges.
 */
export function narrativeForReward(reward) {
  if (!reward) return "";
  const parts = [];
  if (reward.levelUp) parts.push(narrativeForAchievement({ kind: "levelUp", level: reward.newLevel, prevLevel: reward.prevLevel }));
  if (reward.newBadges?.length) {
    for (const b of reward.newBadges) {
      const m = narrativeForAchievement({ kind: "badge", badgeId: b.id });
      if (m) parts.push(m);
    }
  }
  return parts.join(" ");
}

/* =========================================================
   MENSAGENS ESPECIAIS POR CONTEXTO DE ESTUDO
   ========================================================= */

/** Comentário sobre uma matéria que está sendo negligenciada. */
export function neglectedSubjectHint(subject, daysSince = null) {
  if (!subject) return "";
  const name = subject.name || "uma matéria";
  if (daysSince != null && daysSince >= 7) {
    return `"${name}" está há ${daysSince} dias sem avançar. Um bloco resolve.`;
  }
  return "";
}

/** Comentário após bater a meta diária. */
export function goalHitMessage() {
  return pickNarrative(MESSAGES.goalHit, "goalHit");
}

/** Comentário ao concluir um bloco de foco. */
export function blockDoneMessage(cyclesToday = 0) {
  if (cyclesToday >= 4) {
    return pickNarrative([
      "Quatro blocos. Pausa longa merecida.",
      "Já são 4 ciclos — alonga, hidrata, volta.",
    ], "blockDone");
  }
  return pickNarrative(MESSAGES.pomodoroFocus, "blockDone");
}
