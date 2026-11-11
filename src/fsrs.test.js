// fsrs.test.js
import { describe, it, expect } from "vitest";
import { State } from "ts-fsrs";
import {
  RATING, rateCard, previewIntervals, formatInterval, isDue, isLearning,
  ensureFsrs, snapshotScheduling, restoreScheduling, withScheduling, cardStatusLabel,
} from "./fsrs.js";
import { BOX_INTERVALS } from "./gamification.js";
import { buildProgressForExport, makeCrt } from "./ankiHistory.js";

const NOW = new Date(2026, 0, 10, 12, 0, 0); // 10/jan/2026 12:00 local
const novo = () => ({ id: "n", front: "a", back: "b", box: 1, html: true });
const dueMs = (c) => new Date(c.due).getTime();

describe("fsrs: respostas de 4 botões", () => {
  it("De novo em cartão novo vai para aprendizado, com revisão em minutos", () => {
    const c = rateCard(novo(), RATING.AGAIN, NOW);
    expect(c.fsrs).toBe(true);
    expect(c.state).toBe(State.Learning);
    expect(c.scheduled_days).toBe(0);
    expect(dueMs(c)).toBeGreaterThan(NOW.getTime());
    expect(dueMs(c) - NOW.getTime()).toBeLessThan(86400000);
  });

  it("Fácil em cartão novo vai direto para revisão, com intervalo em dias", () => {
    const c = rateCard(novo(), RATING.EASY, NOW);
    expect(c.state).toBe(State.Review);
    expect(c.scheduled_days).toBeGreaterThanOrEqual(1);
    expect(c.stability).toBeGreaterThan(0);
    expect(c.dueAt > "2026-01-10").toBe(true);
  });

  it("a ordem dos prazos é De novo <= Difícil <= Bom <= Fácil", () => {
    const [a, h, g, e] = [RATING.AGAIN, RATING.HARD, RATING.GOOD, RATING.EASY].map((r) => dueMs(rateCard(novo(), r, NOW)));
    expect(a).toBeLessThanOrEqual(h);
    expect(h).toBeLessThanOrEqual(g);
    expect(g).toBeLessThanOrEqual(e);
  });

  it("em cartão em revisão, Fácil dá intervalo >= Bom >= Difícil", () => {
    const base = rateCard(novo(), RATING.EASY, NOW);
    const later = new Date(base.due);
    const [h, g, e] = [RATING.HARD, RATING.GOOD, RATING.EASY].map((r) => rateCard(base, r, later).scheduled_days);
    expect(e).toBeGreaterThanOrEqual(g);
    expect(g).toBeGreaterThanOrEqual(h);
  });

  it("errar um cartão em revisão conta um lapso e vai para reaprendizado", () => {
    const base = rateCard(novo(), RATING.EASY, NOW);
    const c = rateCard(base, RATING.AGAIN, new Date(base.due));
    expect(c.state).toBe(State.Relearning);
    expect(c.lapses).toBe(base.lapses + 1);
  });

  it("resposta inválida lança erro", () => {
    expect(() => rateCard(novo(), 0, NOW)).toThrow();
    expect(() => rateCard(novo(), 5, NOW)).toThrow();
  });

  it("não muta o cartão original e preserva frente, verso e id", () => {
    const orig = novo();
    const copy = JSON.parse(JSON.stringify(orig));
    const c = rateCard(orig, RATING.GOOD, NOW);
    expect(orig).toEqual(copy);
    expect(c.id).toBe("n");
    expect(c.front).toBe("a");
    expect(c.back).toBe("b");
  });

  it("o cartão sobrevive a JSON (datas viram texto) e dá o mesmo resultado", () => {
    const c = rateCard(novo(), RATING.EASY, NOW);
    const roundTrip = JSON.parse(JSON.stringify(c));
    const later = new Date(c.due);
    expect(rateCard(roundTrip, RATING.GOOD, later)).toEqual(rateCard(c, RATING.GOOD, later));
  });
});

describe("fsrs: prévia dos botões", () => {
  it("devolve 4 textos legíveis", () => {
    const p = previewIntervals(novo(), NOW);
    for (const k of ["again", "hard", "good", "easy"]) expect(p[k]).toMatch(/^(<1 min|\d+ (min|h|dias?|meses|mês|anos?))$/);
  });

  it("formatInterval escolhe a unidade certa", () => {
    expect(formatInterval(30 * 1000)).toBe("<1 min");
    expect(formatInterval(60 * 1000)).toBe("1 min");
    expect(formatInterval(10 * 60 * 1000)).toBe("10 min");
    expect(formatInterval(3 * 3600 * 1000)).toBe("3 h");
    expect(formatInterval(86400000)).toBe("1 dia");
    expect(formatInterval(4 * 86400000)).toBe("4 dias");
    expect(formatInterval(60 * 86400000)).toBe("2 meses");
    expect(formatInterval(400 * 86400000)).toBe("1 ano");
  });
});

describe("fsrs: vencimento", () => {
  it("cartão em revisão vence no dia (dueAt <= hoje)", () => {
    expect(isDue({ fsrs: true, state: State.Review, dueAt: "2026-01-10" }, NOW)).toBe(true);
    expect(isDue({ fsrs: true, state: State.Review, dueAt: "2026-01-09" }, NOW)).toBe(true);
    expect(isDue({ fsrs: true, state: State.Review, dueAt: "2026-01-11" }, NOW)).toBe(false);
  });

  it("cartão em aprendizado vence quando o horário chega", () => {
    const antes = new Date(2026, 0, 10, 12, 5).toISOString();
    const depois = new Date(2026, 0, 10, 11, 55).toISOString();
    expect(isDue({ fsrs: true, state: State.Learning, due: antes }, NOW)).toBe(false);
    expect(isDue({ fsrs: true, state: State.Learning, due: depois }, NOW)).toBe(true);
  });

  it("cartão antigo (caixas) segue a regra por dia", () => {
    expect(isDue({ box: 2, dueAt: "2026-01-11" }, NOW)).toBe(false);
    expect(isDue({ box: 2, dueAt: "2026-01-10" }, NOW)).toBe(true);
    expect(isDue({ box: 1 }, NOW)).toBe(true);
  });

  it("isLearning é falso só para cartões em revisão", () => {
    expect(isLearning({ fsrs: true, state: State.Review })).toBe(false);
    expect(isLearning({ fsrs: true, state: State.Learning })).toBe(true);
    expect(isLearning({ fsrs: true, state: State.Relearning })).toBe(true);
  });
});

describe("fsrs: migração de cartões antigos", () => {
  it("caixa 1 vira cartão novo", () => {
    const c = ensureFsrs({ id: "x", box: 1 }, NOW);
    expect(c.fsrs).toBe(true);
    expect(c.state).toBe(State.New);
  });

  it("caixa > 1 sem datas usa o intervalo da tabela", () => {
    const c = ensureFsrs({ id: "x", box: 3 }, NOW);
    expect(c.state).toBe(State.Review);
    expect(c.stability).toBe(BOX_INTERVALS[3]);
    expect(c.scheduled_days).toBe(BOX_INTERVALS[3]);
  });

  it("caixa > 1 com datas usa o intervalo real entre a última revisão e o vencimento", () => {
    const c = ensureFsrs({ id: "x", box: 3, lastReview: "2026-01-01", dueAt: "2026-01-11" }, NOW);
    expect(c.stability).toBe(10);
    expect(c.dueAt).toBe("2026-01-11");
    expect(c.lastReview).toBe("2026-01-01");
  });

  it("cartão já migrado não é alterado", () => {
    const c = rateCard(novo(), RATING.EASY, NOW);
    expect(ensureFsrs(c, NOW)).toBe(c);
  });

  it("cartão antigo é migrado ao responder e mantém id e texto", () => {
    const antigo = { id: "x", front: "f", back: "v", box: 3, lastReview: "2026-01-01", dueAt: "2026-01-08", html: true };
    const c = rateCard(antigo, RATING.GOOD, NOW);
    expect(c.fsrs).toBe(true);
    expect(c.state).toBe(State.Review);
    expect(c.front).toBe("f");
    expect(c.scheduled_days).toBeGreaterThanOrEqual(7);
  });
});

describe("fsrs: desfazer", () => {
  it("restoreScheduling devolve um cartão antigo ao estado anterior", () => {
    const antigo = { id: "x", front: "f", back: "v", box: 2, dueAt: "2026-01-09", lastReview: "2026-01-06" };
    const snap = snapshotScheduling(antigo);
    const respondido = withScheduling(antigo, rateCard(antigo, RATING.GOOD, NOW));
    expect(respondido.fsrs).toBe(true);
    expect(restoreScheduling(respondido, snap)).toEqual(antigo);
  });

  it("restoreScheduling devolve um cartão FSRS ao estado anterior sem tocar no texto", () => {
    const base = rateCard(novo(), RATING.EASY, NOW);
    const snap = snapshotScheduling(base);
    const respondido = withScheduling({ ...base, front: "editado" }, rateCard(base, RATING.AGAIN, new Date(base.due)));
    const restaurado = restoreScheduling(respondido, snap);
    expect(restaurado.front).toBe("editado");
    expect(restaurado.state).toBe(base.state);
    expect(restaurado.due).toBe(base.due);
    expect(restaurado.lapses).toBe(base.lapses);
  });
});

describe("fsrs: rótulo para a UI", () => {
  it("mostra caixa, novo, aprendendo ou o intervalo", () => {
    expect(cardStatusLabel({ box: 2 })).toBe("cx 2");
    expect(cardStatusLabel({ fsrs: true, state: State.New })).toBe("novo");
    expect(cardStatusLabel({ fsrs: true, state: State.Learning })).toBe("aprendendo");
    expect(cardStatusLabel({ fsrs: true, state: State.Review, scheduled_days: 12 })).toBe("12 dias");
  });
});

describe("export para o Anki com cartões FSRS", () => {
  const crt = makeCrt();

  it("cartão em revisão exporta o intervalo real, a data e um revlog", () => {
    const decks = [{ id: "d", name: "T", cards: [{
      id: "c1", front: "a", back: "b", fsrs: true, state: State.Review,
      scheduled_days: 12, reps: 4, lapses: 1, dueAt: "2999-01-01", lastReview: "2026-01-25",
    }] }];
    const p = buildProgressForExport(decks, crt).byCardId.get("c1");
    expect(p.type).toBe(2);
    expect(p.queue).toBe(2);
    expect(p.ivl).toBe(12);
    expect(p.factor).toBe(2500);
    expect(p.due).toBeGreaterThan(0);
    expect(p.revlog).toHaveLength(1);
    expect(p.revlog[0].ivl).toBe(12);
    expect(p.revlog[0].id).toBeLessThanOrEqual(Date.now());
  });

  it("cartão novo ou em aprendizado exporta como novo, sem data nem revlog", () => {
    for (const state of [State.New, State.Learning, State.Relearning]) {
      const decks = [{ id: "d", name: "T", cards: [{ id: "c", front: "a", back: "b", fsrs: true, state, scheduled_days: 0, reps: 1 }] }];
      const p = buildProgressForExport(decks, crt).byCardId.get("c");
      expect(p.type).toBe(0);
      expect(p.due).toBeNull();
      expect(p.revlog).toHaveLength(0);
    }
  });
});
