// gamification.test.js
import { describe, it, expect } from "vitest";
import {
  makeGamState, normalizeGam, award,
  levelFor, xpForLevel, levelProgress, rankFor, RANKS,
  updateStreak, todayISO,
  BADGES, evaluateBadges,
  progressMission, syncStreakMissions, makeWeeklyMissions, weekKey,
  reviewCard, isCardDue, nextDueISO,
  XP_REWARDS, BOX_INTERVALS, MAX_BOX,
} from "./gamification.js";
import {
  narrativeForAchievement, narrativeForReward, streakWarning, comebackMessage,
} from "./gamificationNarrative.js";
import {
  ankiCardToBox, boxToAnkiCardState, makeCrt, isoToAnkiDay, ankiDayToISO,
  applyProgressToCards, buildProgressForExport,
} from "./ankiHistory.js";

/* Estado de teste com missões fixas, para o resultado não depender do sorteio */
function freshGam(overrides = {}) {
  const g = makeGamState();
  g.today.date = todayISO();
  g.missions = { weekKey: weekKey(), items: [] };
  return { ...g, ...overrides };
}

/* =========================================================
   XP E NÍVEIS
   ========================================================= */
describe("níveis e XP", () => {
  it("nível 1 começa em 0 XP e nível 2 em 100", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(100);
    expect(xpForLevel(3)).toBe(400);
    expect(xpForLevel(4)).toBe(900);
  });

  it("levelFor é o inverso de xpForLevel nos limites", () => {
    for (let lvl = 1; lvl <= 20; lvl++) {
      expect(levelFor(xpForLevel(lvl))).toBe(lvl);
    }
  });

  it("levelFor trata XP negativo e zero", () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(-50)).toBe(1);
  });

  it("levelProgress calcula percentual dentro do nível", () => {
    const p = levelProgress(250);
    expect(p.level).toBe(2);
    expect(p.into).toBe(150);
    expect(p.span).toBe(300);
    expect(p.pct).toBe(50);
    expect(p.nextAt).toBe(400);
  });

  it("levelProgress nunca passa de 100%", () => {
    const p = levelProgress(xpForLevel(5));
    expect(p.pct).toBeLessThanOrEqual(100);
  });
});

describe("ranks", () => {
  it("nível 1 é Estagiário", () => {
    expect(rankFor(1).name).toBe("Estagiário");
  });

  it("rank sobe conforme o nível", () => {
    expect(rankFor(4).name).toBe("Assistente");
    expect(rankFor(8).name).toBe("Técnico");
    expect(rankFor(12).name).toBe("Analista");
    expect(rankFor(50).name).toBe("Juiz");
  });

  it("rank muito alto continua no topo", () => {
    expect(rankFor(999).name).toBe("Juiz");
  });

  it("RANKS está em ordem crescente de min", () => {
    for (let i = 1; i < RANKS.length; i++) {
      expect(RANKS[i].min).toBeGreaterThan(RANKS[i - 1].min);
    }
  });
});

/* =========================================================
   STREAK
   ========================================================= */
describe("streak", () => {
  it("primeiro estudo conta 1", () => {
    let g = makeGamState();
    g = updateStreak(g, "2026-01-01");
    expect(g.streak.current).toBe(1);
    expect(g.streak.last).toBe("2026-01-01");
  });

  it("dias consecutivos incrementam", () => {
    let g = makeGamState();
    g = updateStreak(g, "2026-01-01");
    g = updateStreak(g, "2026-01-02");
    g = updateStreak(g, "2026-01-03");
    expect(g.streak.current).toBe(3);
  });

  it("pular um dia zera o streak (sem freeze)", () => {
    let g = makeGamState();
    g.streak.freezes = 0;
    g = updateStreak(g, "2026-01-01");
    g = updateStreak(g, "2026-01-03");
    expect(g.streak.current).toBe(1);
  });

  it("pular 1 dia com freeze consome o freeze e mantém", () => {
    let g = makeGamState();
    g.streak.freezes = 1;
    g = updateStreak(g, "2026-01-01");
    g = updateStreak(g, "2026-01-03");
    expect(g.streak.current).toBe(2);
    expect(g.streak.freezes).toBe(0);
  });

  it("pular 3 dias ou mais zera mesmo com freeze", () => {
    let g = makeGamState();
    g.streak.freezes = 1;
    g = updateStreak(g, "2026-01-01");
    g = updateStreak(g, "2026-01-02");
    g = updateStreak(g, "2026-01-05");
    expect(g.streak.current).toBe(1);
  });

  it("relógio que volta no tempo não zera a ofensiva nem gasta freeze", () => {
    let g = makeGamState();
    g = updateStreak(g, "2026-01-05");
    g = updateStreak(g, "2026-01-06");
    const back = updateStreak(g, "2026-01-04");
    expect(back.streak.current).toBe(2);
    expect(back.streak.last).toBe("2026-01-06");
    expect(back.streak.freezes).toBe(1);
  });

  it("mesmo dia não incrementa", () => {
    let g = makeGamState();
    g = updateStreak(g, "2026-01-01");
    g = updateStreak(g, "2026-01-01");
    expect(g.streak.current).toBe(1);
  });

  it("best guarda o recorde", () => {
    let g = makeGamState();
    g = updateStreak(g, "2026-01-01");
    g = updateStreak(g, "2026-01-02");
    g = updateStreak(g, "2026-01-03");
    expect(g.streak.best).toBe(3);
    g = updateStreak(g, "2026-02-01");
    expect(g.streak.current).toBe(1);
    expect(g.streak.best).toBe(3);
  });
});

/* =========================================================
   BADGES
   ========================================================= */
describe("badges", () => {
  it("first_sub desbloqueia ao concluir 1 submatéria", () => {
    const g = makeGamState();
    g.counters.subtopics = 1;
    const r = evaluateBadges(g);
    expect(r.gam.unlocked.first_sub).toBeDefined();
    expect(r.newly.some((b) => b.id === "first_sub")).toBe(true);
  });

  it("não desbloqueia o mesmo badge duas vezes", () => {
    let g = makeGamState();
    g.counters.subtopics = 1;
    g = evaluateBadges(g).gam;
    const firstUnlockDate = g.unlocked.first_sub;
    const r2 = evaluateBadges(g);
    expect(r2.newly.some((b) => b.id === "first_sub")).toBe(false);
    expect(r2.gam.unlocked.first_sub).toBe(firstUnlockDate);
  });

  it("night_owl depende do horário passado no ctx", () => {
    const r = evaluateBadges(makeGamState(), { hour: 23 });
    expect(r.gam.unlocked.night_owl).toBeDefined();
    expect(evaluateBadges(makeGamState(), { hour: 14 }).gam.unlocked.night_owl).toBeUndefined();
  });

  it("early_bird depende do horário antes das 6h", () => {
    const r = evaluateBadges(makeGamState(), { hour: 5 });
    expect(r.gam.unlocked.early_bird).toBeDefined();
  });

  it("first_concurso depende de concursosCount no ctx", () => {
    const r = evaluateBadges(makeGamState(), { concursosCount: 1 });
    expect(r.gam.unlocked.first_concurso).toBeDefined();
  });

  it("badge de level_5 dispara ao alcançar nível 5", () => {
    const g = makeGamState();
    g.xp = xpForLevel(5);
    const r = evaluateBadges(g);
    expect(r.gam.unlocked.level_5).toBeDefined();
  });

  it("todos os badges têm id, name, emoji, desc e check", () => {
    for (const b of BADGES) {
      expect(b.id).toBeTruthy();
      expect(b.name).toBeTruthy();
      expect(b.emoji).toBeTruthy();
      expect(b.desc).toBeTruthy();
      expect(typeof b.check).toBe("function");
    }
  });
});

/* =========================================================
   MISSÕES
   ========================================================= */
describe("missões", () => {
  it("makeWeeklyMissions cria 3 missões com weekKey atual", () => {
    const m = makeWeeklyMissions();
    expect(m.items).toHaveLength(3);
    expect(m.weekKey).toBe(weekKey());
  });

  it("progressMission incrementa até o alvo e marca done", () => {
    const g = makeGamState();
    g.missions = { weekKey: "x", items: [{ id: "a", title: "t", target: 3, kind: "pomodoros", progress: 0, done: false }] };
    let r = progressMission(g, "pomodoros", 1);
    expect(r.gam.missions.items[0].progress).toBe(1);
    expect(r.completedNow).toHaveLength(0);
    r = progressMission(r.gam, "pomodoros", 5);
    expect(r.gam.missions.items[0].progress).toBe(3);
    expect(r.gam.missions.items[0].done).toBe(true);
    expect(r.completedNow).toHaveLength(1);
  });

  it("progressMission ignora kind diferente", () => {
    const g = makeGamState();
    g.missions = { weekKey: "x", items: [{ id: "a", title: "t", target: 3, kind: "flashcards", progress: 0, done: false }] };
    const r = progressMission(g, "pomodoros", 1);
    expect(r.gam.missions.items[0].progress).toBe(0);
  });

  it("missão já concluída não é reportada de novo", () => {
    const g = makeGamState();
    g.missions = { weekKey: "x", items: [{ id: "a", title: "t", target: 1, kind: "pomodoros", progress: 1, done: true }] };
    const r = progressMission(g, "pomodoros", 1);
    expect(r.completedNow).toHaveLength(0);
  });

  it("missão de dias seguidos acompanha a ofensiva real", () => {
    const g = makeGamState();
    g.streak.current = 3;
    g.missions = { weekKey: "x", items: [{ id: "s", title: "t", target: 5, kind: "streak_days", progress: 0, done: false }] };
    let r = syncStreakMissions(g);
    expect(r.gam.missions.items[0].progress).toBe(3);
    expect(r.completedNow).toHaveLength(0);
    r.gam.streak.current = 5;
    r = syncStreakMissions(r.gam);
    expect(r.gam.missions.items[0].done).toBe(true);
    expect(r.completedNow).toHaveLength(1);
  });
});

/* =========================================================
   AWARD
   ========================================================= */
describe("award", () => {
  it("subtopicDone dá XP e atualiza counters", () => {
    const r = award(freshGam(), "subtopicDone");
    expect(r.gainedXP).toBeGreaterThanOrEqual(XP_REWARDS.subtopicDone);
    expect(r.gam.counters.subtopics).toBe(1);
    expect(r.gam.today.subtopics).toBe(1);
  });

  it("award dá XP e pode subir de nível", () => {
    const g = freshGam({ dailyGoal: 1000 });
    g.xp = 60;
    const r = award(g, "subtopicDone");
    expect(r.gam.xp).toBe(110);
    expect(r.levelUp).toBe(true);
    expect(r.prevLevel).toBe(1);
    expect(r.newLevel).toBe(2);
  });

  it("award dispara badge novo", () => {
    const r = award(freshGam(), "subtopicDone");
    expect(r.newBadges.some((b) => b.id === "first_sub")).toBe(true);
  });

  it("bater a meta diária concede bônus e avisa goalHit", () => {
    const g = freshGam({ dailyGoal: 50 });
    const r = award(g, "subtopicDone");
    expect(r.goalHit).toBe(true);
    expect(r.gainedXP).toBe(XP_REWARDS.subtopicDone + XP_REWARDS.dailyGoal);
    expect(r.gam.xp).toBe(XP_REWARDS.subtopicDone + XP_REWARDS.dailyGoal);
  });

  it("o bônus da meta só vem uma vez por dia", () => {
    let r = award(freshGam({ dailyGoal: 50 }), "subtopicDone");
    r = award(r.gam, "subtopicDone");
    expect(r.goalHit).toBe(false);
    expect(r.gainedXP).toBe(XP_REWARDS.subtopicDone);
  });

  it("award em ação desconhecida não quebra", () => {
    const r = award(freshGam(), "acao_que_nao_existe");
    expect(r.gainedXP).toBe(0);
    expect(r.gam).toBeDefined();
  });

  it("award é idempotente na streak no mesmo dia", () => {
    let r = award(freshGam(), "subtopicDone");
    const streakAfter = r.gam.streak.current;
    r = award(r.gam, "subtopicDone");
    expect(r.gam.streak.current).toBe(streakAfter);
  });

  it("award preserva badges já desbloqueados", () => {
    let r = award(freshGam(), "subtopicDone");
    const unlockedAt = r.gam.unlocked.first_sub;
    r = award(r.gam, "pomodoroFocus");
    expect(r.gam.unlocked.first_sub).toBe(unlockedAt);
  });

  it("onceKey impede ganhar XP duas vezes pela mesma submatéria", () => {
    let r = award(freshGam({ dailyGoal: 1000 }), "subtopicDone", { onceKey: "sub:abc" });
    expect(r.gainedXP).toBe(XP_REWARDS.subtopicDone);
    r = award(r.gam, "subtopicDone", { onceKey: "sub:abc" });
    expect(r.gainedXP).toBe(0);
    expect(r.skipped).toBe(true);
    expect(r.gam.xp).toBe(XP_REWARDS.subtopicDone);
    expect(r.gam.counters.subtopics).toBe(1);
  });

  it("subjectDone não conta a submatéria de novo", () => {
    let g = freshGam({ dailyGoal: 1000 });
    g = award(g, "subtopicDone", { onceKey: "sub:1" }).gam;
    g = award(g, "subjectDone", { onceKey: "subj:1" }).gam;
    expect(g.counters.subtopics).toBe(1);
    expect(g.counters.subjects).toBe(1);
    expect(g.xp).toBe(XP_REWARDS.subtopicDone + XP_REWARDS.subjectDone);
    expect(g.unlocked.first_subj).toBeDefined();
  });

  it("completar uma missão dá o bônus e reporta em missionsDone", () => {
    const g = freshGam({ dailyGoal: 1000 });
    g.missions = { weekKey: weekKey(), items: [{ id: "m", title: "1 pomodoro", target: 1, kind: "pomodoros", progress: 0, done: false }] };
    const r = award(g, "pomodoroFocus");
    expect(r.missionsDone).toHaveLength(1);
    expect(r.gainedXP).toBe(XP_REWARDS.pomodoroFocus + XP_REWARDS.weeklyMission);
  });

  it("flashcard e questão contam nos contadores", () => {
    let g = freshGam({ dailyGoal: 1000 });
    g = award(g, "flashcardKnow").gam;
    g = award(g, "questionRight").gam;
    expect(g.counters.flashcards).toBe(1);
    expect(g.counters.questions).toBe(1);
    expect(g.today.flashcards).toBe(1);
  });
});

/* =========================================================
   REVISÃO ESPAÇADA
   ========================================================= */
describe("revisão espaçada", () => {
  it("subir de box 1→2 agenda para daqui a 3 dias", () => {
    const r = reviewCard({ id: "x", box: 1 }, true, "2026-01-01");
    expect(r.box).toBe(2);
    expect(r.dueAt).toBe("2026-01-04");
  });

  it("errar volta para box 1 e agenda para o dia seguinte", () => {
    const r = reviewCard({ id: "x", box: 4 }, false, "2026-01-01");
    expect(r.box).toBe(1);
    expect(r.dueAt).toBe("2026-01-02");
  });

  it("box não passa do máximo", () => {
    const r = reviewCard({ id: "x", box: MAX_BOX }, true, "2026-01-01");
    expect(r.box).toBe(MAX_BOX);
  });

  it("nextDueISO respeita a tabela de intervalos", () => {
    expect(nextDueISO(1, new Date("2026-01-01T12:00:00"))).toBe("2026-01-02");
    expect(nextDueISO(3, new Date("2026-01-01T12:00:00"))).toBe("2026-01-08");
  });

  it("isCardDue checa corretamente", () => {
    expect(isCardDue({ box: 1, dueAt: "2026-01-02" }, "2026-01-01")).toBe(false);
    expect(isCardDue({ box: 1, dueAt: "2026-01-02" }, "2026-01-02")).toBe(true);
    expect(isCardDue({ box: 1, dueAt: "2026-01-02" }, "2026-01-10")).toBe(true);
  });

  it("isCardDue em cartão legado sem dueAt usa box", () => {
    expect(isCardDue({ box: 1 })).toBe(true);
    expect(isCardDue({ box: MAX_BOX })).toBe(false);
  });

  it("BOX_INTERVALS cobre todos os boxes até MAX_BOX", () => {
    for (let b = 1; b <= MAX_BOX; b++) {
      expect(BOX_INTERVALS[b]).toBeGreaterThan(0);
    }
  });
});

/* =========================================================
   NORMALIZAÇÃO / PERSISTÊNCIA
   ========================================================= */
describe("normalizeGam", () => {
  it("retorna estado base se receber null", () => {
    const g = normalizeGam(null);
    expect(g.xp).toBe(0);
    expect(g.streak.current).toBe(0);
    expect(g.missions).not.toBeNull();
  });

  it("reseta o 'today' se mudou de dia", () => {
    const saved = makeGamState();
    saved.today = { date: "2026-01-01", xp: 999, subtopics: 9, pomodoros: 9, flashcards: 9 };
    const g = normalizeGam(saved);
    expect(g.today.xp).toBe(0);
    expect(g.today.date).toBe(todayISO());
  });

  it("preserva XP e streak entre reloads no mesmo dia", () => {
    const saved = makeGamState();
    saved.xp = 500;
    saved.streak.current = 7;
    saved.streak.last = todayISO();
    const g = normalizeGam(saved);
    expect(g.xp).toBe(500);
    expect(g.streak.current).toBe(7);
  });

  it("gera novas missões se a semana mudou", () => {
    const saved = makeGamState();
    saved.missions = { weekKey: "1999-W01", items: [] };
    const g = normalizeGam(saved);
    expect(g.missions.weekKey).toBe(weekKey());
    expect(g.missions.items).toHaveLength(3);
  });

  it("completa campos que faltam em dados salvos por versões antigas", () => {
    const g = normalizeGam({ xp: 10, streak: { current: 2 }, counters: { pomodoros: 4 } });
    expect(g.streak.freezes).toBe(1);
    expect(g.counters.subtopics).toBe(0);
    expect(g.counters.pomodoros).toBe(4);
    expect(g.awarded).toBeDefined();
  });
});

/* =========================================================
   NARRATIVA
   ========================================================= */
describe("narrativa", () => {
  it("promoção de cargo só quando o cargo muda", () => {
    const promoted = narrativeForAchievement({ kind: "levelUp", level: 4, prevLevel: 3 });
    expect(promoted).toContain("Assistente");
    const same = narrativeForAchievement({ kind: "levelUp", level: 5, prevLevel: 4 });
    expect(same).not.toContain("Técnico");
  });

  it("narrativeForReward junta nível e badges", () => {
    const text = narrativeForReward({ levelUp: true, newLevel: 4, prevLevel: 3, newBadges: [{ id: "first_sub" }] });
    expect(text).toContain("Assistente");
    expect(text).toContain("Primeiro carimbo");
  });

  it("aviso de streak só aparece com ofensiva ativa, sem estudo hoje e à noite", () => {
    const risky = { streak: { current: 3, last: "2020-01-01" } };
    expect(streakWarning(risky, 20)).toBeTruthy();
    expect(streakWarning(risky, 10)).toBe("");
    expect(streakWarning({ streak: { current: 0, last: null } }, 20)).toBe("");
    expect(streakWarning({ streak: { current: 3, last: todayISO() } }, 20)).toBe("");
  });

  it("mensagem de retorno só depois de 3+ dias", () => {
    expect(comebackMessage({ streak: { last: "2020-01-01" } })).toBeTruthy();
    expect(comebackMessage({ streak: { last: todayISO() } })).toBe("");
    expect(comebackMessage({ streak: { last: null } })).toBe("");
  });
});

/* =========================================================
   INTEGRAÇÃO — fluxo completo
   ========================================================= */
describe("integração: fluxo de estudo de um dia", () => {
  it("3 pomodoros + 2 submatérias batem a meta e desbloqueiam badges", () => {
    let g = freshGam({ dailyGoal: 100 });

    g = award(g, "pomodoroFocus").gam;
    g = award(g, "pomodoroFocus").gam;
    g = award(g, "pomodoroFocus").gam;
    g = award(g, "subtopicDone", { onceKey: "s1" }).gam;

    expect(g.today.pomodoros).toBe(3);
    expect(g.today.subtopics).toBe(1);
    expect(g.today.xp).toBe(80);

    g = award(g, "subtopicDone", { onceKey: "s2" }).gam;
    expect(g.today.xp).toBeGreaterThanOrEqual(100);
    expect(g.unlocked.first_sub).toBeDefined();
    expect(g.unlocked.perfect_day).toBeDefined();
  });
});

/* =========================================================
   ANKI: conversão de progresso (caixas <-> estado do Anki)
   ========================================================= */
describe("ankiHistory: conversão box <-> Anki", () => {
  it("cartão novo (type 0, reps 0) vira box 1", () => {
    expect(ankiCardToBox({ type: 0, reps: 0 })).toBe(1);
  });

  it("cartão em aprendizado (queue 1) vira box 1", () => {
    expect(ankiCardToBox({ type: 1, queue: 1, reps: 1, ivl: 1 })).toBe(1);
  });

  it("cartão em revisão: intervalo define a caixa", () => {
    expect(ankiCardToBox({ type: 2, queue: 2, reps: 10, ivl: 60, factor: 2500 })).toBe(5);
    expect(ankiCardToBox({ type: 2, queue: 2, reps: 3, ivl: 8, factor: 2500 })).toBe(3);
    expect(ankiCardToBox({ type: 2, queue: 2, reps: 5, ivl: 20, factor: 2500 })).toBe(4);
  });

  it("factor baixo rebaixa 1 caixa e factor alto sobe 1 (até 5)", () => {
    expect(ankiCardToBox({ type: 2, queue: 2, reps: 3, ivl: 8, factor: 1900 })).toBe(2);
    expect(ankiCardToBox({ type: 2, queue: 2, reps: 5, ivl: 20, factor: 3000 })).toBe(5);
  });

  it("ida e volta caixa -> estado -> caixa preserva 1 a 5", () => {
    for (let b = 1; b <= 5; b++) {
      expect(ankiCardToBox(boxToAnkiCardState(b))).toBe(b);
    }
  });

  it("caixa 1 exporta como novo; caixas 2 a 5 como revisão", () => {
    expect(boxToAnkiCardState(1).type).toBe(0);
    for (let b = 2; b <= 5; b++) {
      const st = boxToAnkiCardState(b);
      expect(st.type).toBe(2);
      expect(st.queue).toBe(2);
      expect(st.ivl).toBeGreaterThan(0);
    }
  });
});

describe("ankiHistory: dias do Anki (relativos à criação da coleção)", () => {
  const crt = Math.floor(new Date(2025, 5, 1, 4, 0, 0).getTime() / 1000); // 01/06/2025 04:00 local

  it("dia 0 é o dia da criação e o dia 100 é 100 dias depois", () => {
    expect(ankiDayToISO(0, crt)).toBe("2025-06-01");
    expect(ankiDayToISO(100, crt)).toBe("2025-09-09");
  });

  it("isoToAnkiDay e ankiDayToISO são inversos", () => {
    expect(isoToAnkiDay("2025-09-09", crt)).toBe(100);
    expect(ankiDayToISO(isoToAnkiDay("2026-02-01", crt), crt)).toBe("2026-02-01");
  });

  it("data vencida ou vazia vira dia 0 (revisar hoje)", () => {
    expect(isoToAnkiDay("2020-01-01", crt)).toBe(0);
    expect(isoToAnkiDay(null, crt)).toBe(0);
  });

  it("makeCrt: antes das 4h usa o dia anterior", () => {
    const early = makeCrt(new Date(2026, 0, 10, 2, 0, 0));
    expect(ankiDayToISO(0, early)).toBe("2026-01-09");
    const day = makeCrt(new Date(2026, 0, 10, 10, 0, 0));
    expect(ankiDayToISO(0, day)).toBe("2026-01-10");
  });
});

describe("ankiHistory: importar progresso", () => {
  const crt = Math.floor(new Date(2025, 5, 1, 4, 0, 0).getTime() / 1000);

  it("mapeia ivl para a caixa e due para dueAt", () => {
    const cards = [{ nid: 1, front: "a", back: "b" }];
    const prog = new Map([[1, { ivl: 8, factor: 2500, type: 2, queue: 2, reps: 3, due: 100 }]]);
    const out = applyProgressToCards(cards, prog, new Map(), crt);
    expect(out[0].box).toBe(3);
    expect(out[0].dueAt).toBe("2025-09-09");
    expect(out[0].lastReview).toBe("2025-09-01"); // due - ivl
  });

  it("a última revisão vem do id do revlog (horário), não da duração", () => {
    const cards = [{ nid: 1, front: "a", back: "b" }];
    const prog = new Map([[1, { ivl: 8, factor: 2500, type: 2, queue: 2, reps: 3, due: 100 }]]);
    const revlog = new Map([[1, [{ id: new Date(2025, 7, 30, 12).getTime(), time: 15000 }]]]);
    const out = applyProgressToCards(cards, prog, revlog, crt);
    expect(out[0].lastReview).toBe("2025-08-30");
  });

  it("cartão novo ou em aprendizado não ganha data de vencimento", () => {
    const cards = [{ nid: 1, front: "a", back: "b" }, { nid: 2, front: "c", back: "d" }];
    const prog = new Map([
      [1, { ivl: 0, factor: 0, type: 0, queue: 0, reps: 0, due: 5 }],          // posição na fila
      [2, { ivl: 0, factor: 2500, type: 1, queue: 1, reps: 1, due: 1790000000 }], // horário em segundos
    ]);
    const out = applyProgressToCards(cards, prog, new Map(), crt);
    expect(out[0].box).toBe(1);
    expect(out[0].dueAt).toBeNull();
    expect(out[1].box).toBe(1);
    expect(out[1].dueAt).toBeNull();
  });

  it("sem progresso no Anki entra como novo", () => {
    const out = applyProgressToCards([{ nid: 99, front: "a", back: "b" }], new Map(), new Map(), crt);
    expect(out[0].box).toBe(1);
    expect(out[0].dueAt).toBeNull();
  });
});

describe("ankiHistory: exportar progresso", () => {
  const crt = makeCrt();

  it("caixa 3 vira cartão em revisão com data, intervalo e revlog", () => {
    const decks = [{ id: "d1", name: "Teste", cards: [{ id: "c1", front: "a", back: "b", box: 3, dueAt: "2999-01-01", lastReview: "2026-01-25" }] }];
    const p = buildProgressForExport(decks, crt).byCardId.get("c1");
    expect(p.type).toBe(2);
    expect(p.ivl).toBeGreaterThan(0);
    expect(p.due).toBeGreaterThan(0);
    expect(p.revlog).toHaveLength(2); // saltos 1->2 e 2->3
    expect(p.revlog[0].id).toBeLessThanOrEqual(p.revlog[1].id);
    expect(p.revlog[1].id).toBe(new Date(2026, 0, 25, 12).getTime());
  });

  it("caixa 1 é cartão novo, sem revlog e sem data", () => {
    const decks = [{ id: "d", name: "x", cards: [{ id: "c", front: "a", back: "b", box: 1 }] }];
    const p = buildProgressForExport(decks, crt).byCardId.get("c");
    expect(p.revlog).toHaveLength(0);
    expect(p.type).toBe(0);
    expect(p.due).toBeNull();
  });

  it("o horário de cada revisão do revlog nunca é futuro", () => {
    const decks = [{ id: "d", name: "x", cards: [{ id: "c", front: "a", back: "b", box: 5, lastReview: "2999-01-01" }] }];
    const p = buildProgressForExport(decks, crt).byCardId.get("c");
    for (const r of p.revlog) expect(r.id).toBeLessThanOrEqual(Date.now());
  });
});
