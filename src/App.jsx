import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Plus, Trash2, Check, X, Clock, Calendar as CalendarIcon, Play, Pause,
  RotateCcw, BookOpen, Brain, BarChart3, Lightbulb, Newspaper, Bell,
  ChevronLeft, ChevronRight, Shuffle, Flame, Star, CircleDot, Sparkles,
  Volume2, Award, Layers, ClipboardList, Wand2, Download, Upload, BellRing, Coffee, Trophy, Pencil, Hourglass,
  FolderInput, Square, CheckSquare, ListChecks, Undo2
} from "lucide-react";
import {
  RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer, Legend
} from "recharts";
import {
  makePomoState, pomoRemainingMs, pomoStart, pomoPause, pomoSwitch, pomoReset, pomoAdvance, formatClock,
} from "./pomodoroLogic.js";
import { buildCelebration } from "./encouragement.js";
import RichTextEditor from "./RichTextEditor.jsx";
import RichFace from "./RichFace.jsx";
import { isEmptyHtml, htmlToPlainText } from "./richText.js";
import {
  makeGamState, normalizeGam, award, GAM_STORAGE_KEY, todayISO, weekKey,
} from "./gamification.js";
import {
  RATING, rateCard, previewIntervals, isDue, isLearning,
  snapshotScheduling, restoreScheduling, withScheduling, cardStatusLabel,
} from "./fsrs.js";
import { GamHeaderStrip, DailyGoalBar, RewardToast, AchievementsScreen } from "./GamificationUI.jsx";
import { greeting, streakWarning, comebackMessage, narrativeForAction, goalHitMessage } from "./gamificationNarrative.js";
import { estimateCompletion, examInfo, subtopicHours, MAX_DAYS } from "./estimate.js";
import {
  parseAnkiText, buildAnkiText, buildApkgBlob, parseApkgFile, mergeImportedCards,
} from "./anki.js";
import DeckTree from "./DeckTree.jsx";
import { moveDeckPath, renameDeckPath, uniqueDeckName } from "./deckTree.js";

/* ---------------------------------------------------------------
   TOKENS — "Diário Oficial de Estudos"
   Ink navy + carimbo (stamp) motifs, protocolo-style numbering.
   Alta = vermelho (urgência) · Média = ouro · Baixa = verde-azulado
----------------------------------------------------------------*/
const COLORS = {
  bg: "#0F1826",
  bg2: "#0B121D",
  card: "#16233A",
  cardBorder: "#233350",
  text: "#EDEFF2",
  sub: "#93A2BA",
  gold: "#C9A24B",
  rose: "#D6685C",
  teal: "#3FA796",
};
const PRIORITY = {
  alta: { label: "Alta prioridade", color: COLORS.rose, weight: 3 },
  media: { label: "Média prioridade", color: COLORS.gold, weight: 2 },
  baixa: { label: "Baixa prioridade", color: COLORS.teal, weight: 1 },
};
const DAYS = [
  { key: "seg", label: "Segunda" },
  { key: "ter", label: "Terça" },
  { key: "qua", label: "Quarta" },
  { key: "qui", label: "Quinta" },
  { key: "sex", label: "Sexta" },
  { key: "sab", label: "Sábado" },
  { key: "dom", label: "Domingo" },
];
const uid = () => Math.random().toString(36).slice(2, 10);

const FONT_STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
.font-display{font-family:'Fraunces',serif;}
.font-body{font-family:'Inter',sans-serif;}
.font-mono{font-family:'JetBrains Mono',monospace;}
::-webkit-scrollbar{width:8px;height:8px;}
::-webkit-scrollbar-thumb{background:#233350;border-radius:4px;}
::-webkit-scrollbar-track{background:transparent;}
`;

/* ---------------------------------------------------------------
   SEED DATA
----------------------------------------------------------------*/
const seedSubjects = () => [
  {
    id: uid(), name: "Direito Constitucional", priority: "alta", difficulty: 4,
    subtopics: [
      { id: uid(), name: "Direitos fundamentais", done: false },
      { id: uid(), name: "Organização do Estado", done: false },
      { id: uid(), name: "Controle de constitucionalidade", done: false },
    ],
  },
  {
    id: uid(), name: "Língua Portuguesa", priority: "media", difficulty: 2,
    subtopics: [
      { id: uid(), name: "Crase", done: false },
      { id: uid(), name: "Concordância verbal", done: false },
    ],
  },
  {
    id: uid(), name: "Raciocínio Lógico", priority: "baixa", difficulty: 3,
    subtopics: [
      { id: uid(), name: "Proposições", done: false },
      { id: uid(), name: "Sequências", done: false },
    ],
  },
];

/* ---------------------------------------------------------------
   STORAGE HELPERS
----------------------------------------------------------------*/
const STORAGE_PREFIX = "plano-estudos:";
const DATA_KEYS = ["subjects", "schedule", "agenda", "decks", "pomo-settings", "plan-settings", "concursos", "gamification"];

async function loadKey(key, fallback) {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
async function saveKey(key, value) {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value));
  } catch (e) {
    console.error("storage save failed", key, e);
  }
}

function exportAllData() {
  const payload = { app: "diario-oficial-estudos", version: 1, exportedAt: new Date().toISOString(), data: {} };
  DATA_KEYS.forEach((key) => {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (raw !== null) {
      try { payload.data[key] = JSON.parse(raw); } catch { /* skip corrupted key */ }
    }
  });
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `registro-estudos-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importAllData(file, onDone) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const data = parsed?.data && typeof parsed.data === "object" ? parsed.data : parsed;
      DATA_KEYS.forEach((key) => {
        if (data[key] !== undefined) {
          window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(data[key]));
        }
      });
      onDone(true);
    } catch (e) {
      onDone(false, e.message);
    }
  };
  reader.onerror = () => onDone(false, "Não foi possível ler o arquivo.");
  reader.readAsText(file);
}

/* ---------------------------------------------------------------
   AUDIO + ALERTAS (som, vibração, notificação do sistema)
----------------------------------------------------------------*/
let _audioCtx = null;
function getAudioCtx() {
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    if (!_audioCtx) _audioCtx = new C();
    return _audioCtx;
  } catch { return null; }
}
// Chamar dentro de um clique: libera o áudio no celular/navegador.
function unlockAudio() {
  const c = getAudioCtx();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}
function playChime(kind = "soft") {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const seqs = { soft: [880, 1320], "focus-done": [660, 880, 1100], "break-done": [1100, 880, 1100, 880] };
  const notes = seqs[kind] || seqs.soft;
  const vol = kind === "soft" ? 0.12 : 0.25;
  const now = ctx.currentTime;
  notes.forEach((freq, i) => {
    const t0 = now + i * 0.24;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.0);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 1.1);
  });
}
function vibrateAlert() {
  try { if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 800]); } catch { /* sem vibração */ }
}
function notifSupported() { return typeof window !== "undefined" && "Notification" in window; }
function requestNotifPermission() {
  try {
    if (notifSupported() && Notification.permission === "default") return Notification.requestPermission();
  } catch { /* noop */ }
  return Promise.resolve(notifSupported() ? Notification.permission : "unsupported");
}
async function showSystemNotification(title, body, tag) {
  try {
    if (!notifSupported() || Notification.permission !== "granted") return;
    const opts = { body, tag, renotify: true, requireInteraction: true, vibrate: [400, 200, 400, 200, 800], icon: "/icon-192.png", badge: "/icon-192.png" };
    const reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null;
    if (reg && reg.showNotification) await reg.showNotification(title, opts);
    else new Notification(title, opts);
  } catch { /* notificação indisponível */ }
}
async function closeSystemNotifications(tag) {
  try {
    const reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null;
    if (reg && reg.getNotifications) (await reg.getNotifications({ tag })).forEach((n) => n.close());
  } catch { /* noop */ }
}
function fireAlert(alert) {
  const focus = alert.kind === "focus-done";
  const title = focus ? "Foco concluído!" : "Descanso acabou!";
  const body = focus
    ? `Hora de descansar ${Math.round(alert.breakMs / 60000)} min. O descanso já começou.`
    : "Hora de voltar aos estudos.";
  playChime(alert.kind);
  vibrateAlert();
  showSystemNotification(title, body, "pomodoro");
}

/* ---------------------------------------------------------------
   WEIGHTED ROUND ROBIN — distribui matérias mescladas por peso
   (prioridade x dificuldade), tipo smooth-WRR de balanceador.
----------------------------------------------------------------*/
function weightedRoundRobinPick(subjects, count) {
  const items = subjects.map((s) => ({
    id: s.id,
    weight: PRIORITY[s.priority].weight * s.difficulty,
    current: 0,
  }));
  const total = items.reduce((a, b) => a + b.weight, 0) || 1;
  const seq = [];
  for (let n = 0; n < count; n++) {
    items.forEach((it) => (it.current += it.weight));
    let best = items[0];
    items.forEach((it) => { if (it.current > best.current) best = it; });
    best.current -= total;
    seq.push(best.id);
  }
  return seq;
}

/* ---------------------------------------------------------------
   FORMATAÇÃO DAS ESTIMATIVAS
----------------------------------------------------------------*/
const fmtDate = (d) => (d ? d.toLocaleDateString("pt-BR") : "");
const fmtH = (x) => `${Number(x).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;
function fmtSpan(days) {
  if (days === 1) return "1 dia";
  if (days < 14) return `${days} dias`;
  if (days < 60) return `${days} dias (~${Math.round(days / 7)} semanas)`;
  return `${days} dias (~${Math.round(days / 30.4)} meses)`;
}
// Texto curto do estado de cada matéria/geral
function estimateLabel(est, noCapacity, over) {
  if (!est) return "";
  if (est.days === 0) return "Concluída";
  if (noCapacity) return "Sem horários";
  if (over || est.days == null) return `+${Math.round(MAX_DAYS / 365)} anos`;
  return `≈ ${fmtSpan(est.days)}`;
}

/* ---------------------------------------------------------------
   POMODORO — estado no topo do app (continua rodando em qualquer aba)
----------------------------------------------------------------*/
function usePomodoro(settings, giveXP) {
  const [state, setState] = useState(() => makePomoState(settings));
  const [alertInfo, setAlertInfo] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const stateRef = useRef(state);
  const settingsRef = useRef(settings);
  const wakeRef = useRef(null);
  const giveXPRef = useRef(giveXP);
  settingsRef.current = settings;
  giveXPRef.current = giveXP;

  const apply = useCallback((ns) => { stateRef.current = ns; setState(ns); }, []);

  const tick = useCallback(() => {
    const t = Date.now();
    if (stateRef.current.running) setNow(Math.floor(t / 1000) * 1000);
    const cyclesBefore = stateRef.current.cycles;
    const r = pomoAdvance(stateRef.current, t, settingsRef.current);
    if (r.changed) apply(r.state);
    // XP por bloco de foco concluído (mesmo se o app ficou em segundo plano)
    const blocks = r.state.cycles - cyclesBefore;
    if (blocks > 0 && giveXPRef.current) for (let i = 0; i < blocks; i++) giveXPRef.current("pomodoroFocus");
    if (r.alert) { setAlertInfo(r.alert); fireAlert(r.alert); }
  }, [apply]);

  useEffect(() => {
    const iv = setInterval(tick, 500);
    const onVis = () => tick();
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [tick]);

  // Quando parado, acompanha mudanças nas configurações de tempo
  useEffect(() => {
    if (!stateRef.current.running) apply(pomoSwitch(stateRef.current, stateRef.current.mode, settings));
  }, [settings.work, settings.short, settings.long]); // eslint-disable-line

  // Mantém a tela acesa enquanto o timer roda (evita o celular suspender o app)
  useEffect(() => {
    const want = state.running;
    const acquire = async () => {
      try {
        if (want && "wakeLock" in navigator && !wakeRef.current) {
          wakeRef.current = await navigator.wakeLock.request("screen");
          wakeRef.current.addEventListener("release", () => { wakeRef.current = null; });
        }
      } catch { /* sem wake lock */ }
    };
    if (want) acquire();
    else if (wakeRef.current) { const w = wakeRef.current; wakeRef.current = null; w.release().catch(() => {}); }
    const onVis = () => { if (document.visibilityState === "visible" && want) acquire(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [state.running]);

  const start = () => {
    unlockAudio();
    requestNotifPermission();
    setNow(Date.now());
    apply(pomoStart(stateRef.current, Date.now()));
  };
  const pause = () => apply(pomoPause(stateRef.current, Date.now()));
  const reset = () => apply(pomoReset(stateRef.current, settingsRef.current));
  const switchMode = (m) => apply(pomoSwitch(stateRef.current, m, settingsRef.current));
  const dismiss = () => { setAlertInfo(null); closeSystemNotifications("pomodoro"); };
  const startFocusNow = () => {
    unlockAudio();
    dismiss();
    const sw = pomoSwitch(stateRef.current, "work", settingsRef.current);
    setNow(Date.now());
    apply(pomoStart(sw, Date.now()));
  };
  const testAlert = () => {
    unlockAudio();
    requestNotifPermission().then(() => {
      const a = { kind: "focus-done", breakMode: "short", breakMs: settingsRef.current.short * 60000, at: Date.now(), test: true };
      setAlertInfo(a);
      fireAlert(a);
    });
  };

  return { state, now, alertInfo, start, pause, reset, switchMode, dismiss, startFocusNow, testAlert };
}

function PomodoroAlert({ pomo }) {
  const a = pomo.alertInfo;
  useEffect(() => {
    if (!a) return undefined;
    const original = document.title;
    const msg = a.kind === "focus-done" ? "Foco concluído!" : "Descanso acabou!";
    let n = 0;
    const flash = setInterval(() => { document.title = n++ % 2 === 0 ? `⏰ ${msg}` : original; }, 900);
    let repeats = 0;
    const again = setInterval(() => {
      if (++repeats > 5) { clearInterval(again); return; }
      playChime(a.kind);
      vibrateAlert();
    }, 7000);
    return () => { clearInterval(flash); clearInterval(again); document.title = original; };
  }, [a]);

  if (!a) return null;
  const focusDone = a.kind === "focus-done";
  const color = focusDone ? COLORS.teal : COLORS.rose;
  const Icon = focusDone ? Coffee : BellRing;
  const breakLeft = pomo.state.running && pomo.state.mode !== "work"
    ? formatClock(pomoRemainingMs(pomo.state, pomo.now))
    : formatClock(a.breakMs || 0);

  return (
    <div role="alertdialog" aria-live="assertive" className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(5,10,18,0.88)", backdropFilter: "blur(6px)" }}>
      <div className="w-full max-w-sm rounded-2xl border-2 p-6 text-center" style={{ background: COLORS.card, borderColor: color, boxShadow: `0 0 40px ${color}55` }}>
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full animate-pulse" style={{ background: color, color: "#0B121D" }}>
          <Icon size={30} />
        </div>
        {a.test && <div className="mb-1 text-[10px] font-mono uppercase tracking-widest" style={{ color: COLORS.sub }}>Teste de alerta</div>}
        <h2 className="font-display text-2xl mb-2">{focusDone ? "Foco concluído!" : "O descanso acabou!"}</h2>
        {focusDone ? (
          <>
            <p className="text-sm mb-3" style={{ color: COLORS.sub }}>Levante, beba água e descanse a vista. O descanso já começou:</p>
            <div className="font-mono text-4xl mb-1" style={{ color }}>{breakLeft}</div>
            <p className="text-[11px] mb-5" style={{ color: COLORS.sub }}>{a.breakMode === "long" ? "Pausa longa" : "Pausa curta"} em andamento. Você será avisado quando acabar.</p>
            <Btn onClick={pomo.dismiss} className="w-full justify-center"><Check size={15} /> Entendi</Btn>
          </>
        ) : (
          <>
            <p className="text-sm mb-5" style={{ color: COLORS.sub }}>Hora de voltar aos estudos. Pronto para o próximo bloco de foco?</p>
            <div className="flex flex-col gap-2">
              <Btn onClick={pomo.startFocusNow} className="w-full justify-center"><Play size={15} /> Iniciar foco agora</Btn>
              <Btn onClick={pomo.dismiss} variant="ghost" className="w-full justify-center">Fechar</Btn>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PomodoroChip({ pomo, tab, setTab }) {
  if (!pomo.state.running || tab === "pomodoro") return null;
  const modeLabel = { work: "Foco", short: "Pausa", long: "Pausa longa" }[pomo.state.mode];
  const color = { work: COLORS.rose, short: COLORS.teal, long: COLORS.gold }[pomo.state.mode];
  return (
    <button onClick={() => setTab("pomodoro")} className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 rounded-full border px-4 py-2 shadow-lg"
      style={{ background: COLORS.card, borderColor: color, color: COLORS.text }}>
      <Clock size={14} style={{ color }} />
      <span className="font-mono text-sm">{formatClock(pomoRemainingMs(pomo.state, pomo.now))}</span>
      <span className="text-[10px] uppercase tracking-widest" style={{ color }}>{modeLabel}</span>
    </button>
  );
}

function CelebrationToast({ celebration, onClose }) {
  useEffect(() => {
    if (!celebration) return undefined;
    const t = setTimeout(onClose, celebration.kind === "subject" ? 10000 : 7000);
    return () => clearTimeout(t);
  }, [celebration]); // eslint-disable-line
  if (!celebration) return null;
  const big = celebration.kind === "subject";
  const color = big ? COLORS.gold : COLORS.teal;
  const Icon = big ? Trophy : Star;
  return (
    <div className="fixed left-1/2 top-4 z-[90] w-[92%] max-w-md -translate-x-1/2" role="status" aria-live="polite">
      <div className={`flex gap-3 rounded-xl border-2 ${big ? "p-5" : "p-4"}`} style={{ background: COLORS.card, borderColor: color, boxShadow: `0 8px 30px ${color}44` }}>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ background: color, color: "#0B121D" }}>
          <Icon size={big ? 24 : 20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className={`font-display ${big ? "text-lg" : "text-base"}`}>{celebration.title}</p>
          <p className="mt-1 text-xs" style={{ color: COLORS.text }}>{celebration.text}</p>
          <p className="mt-1.5 font-mono text-[10px]" style={{ color }}>{celebration.progress}</p>
        </div>
        <button onClick={onClose} aria-label="Fechar"><X size={14} style={{ color: COLORS.sub }} /></button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   GAMIFICAÇÃO — junta recompensas que chegam quase juntas (ex.: submatéria + matéria)
----------------------------------------------------------------*/
function mergeReward(prev, r, actionMsg) {
  return {
    gainedXP: prev.gainedXP + r.gainedXP,
    levelUp: prev.levelUp || r.levelUp,
    prevLevel: prev.prevLevel,
    newLevel: r.newLevel,
    newBadges: [...prev.newBadges, ...r.newBadges],
    missionsDone: [...prev.missionsDone, ...r.missionsDone],
    goalHit: prev.goalHit || r.goalHit,
    actionMsg: prev.goalHit ? prev.actionMsg : actionMsg,
    ts: Date.now(),
  };
}

/* ---------------------------------------------------------------
   MAIN APP
----------------------------------------------------------------*/
export default function StudyPlanner() {
  const [tab, setTab] = useState("cronograma");
  const [loaded, setLoaded] = useState(false);

  const [subjects, setSubjects] = useState([]);
  const [schedule, setSchedule] = useState(() => {
    const o = {}; DAYS.forEach((d) => (o[d.key] = [])); return o;
  });
  const [agenda, setAgenda] = useState([]);
  const [decks, setDecks] = useState([]);
  const [pomoSettings, setPomoSettings] = useState({ work: 25, short: 5, long: 15, cyclesUntilLong: 4 });
  const [planSettings, setPlanSettings] = useState({ defaultHours: 2 });
  const [celebration, setCelebration] = useState(null);

  // Gamificação: o estado mais recente fica numa ref para que ações seguidas somem XP corretamente
  const [gam, setGam] = useState(makeGamState);
  const gamRef = useRef(gam);
  const [reward, setReward] = useState(null);
  const rewardTimeoutRef = useRef(null);

  const giveXP = useCallback((action, ctx = {}) => {
    const r = award(gamRef.current, action, ctx);
    gamRef.current = r.gam;
    setGam(r.gam);
    if (r.skipped) return r;
    if (r.gainedXP > 0 || r.levelUp || r.newBadges.length || r.missionsDone.length) {
      const actionMsg = r.goalHit ? goalHitMessage() : narrativeForAction(action);
      setReward((prev) => (prev && Date.now() - prev.ts < 1500 ? mergeReward(prev, r, actionMsg) : { ...r, actionMsg, ts: Date.now() }));
      if (rewardTimeoutRef.current) clearTimeout(rewardTimeoutRef.current);
      rewardTimeoutRef.current = setTimeout(() => setReward(null), 5000);
    }
    return r;
  }, []);

  // Desfazer: devolve o estado de XP de antes da ação. Se algo mudou o XP nesse meio tempo
  // (ex.: um Pomodoro terminou), só desconta o que a ação tinha dado.
  const getGam = useCallback(() => gamRef.current, []);
  const undoXP = useCallback((before, after) => {
    if (!before || !after) return;
    let next;
    if (gamRef.current === after) next = before;
    else {
      const diff = Math.max(0, after.xp - before.xp);
      const cur = gamRef.current;
      next = {
        ...cur,
        xp: Math.max(0, cur.xp - diff),
        today: { ...cur.today, xp: Math.max(0, cur.today.xp - diff), flashcards: Math.max(0, cur.today.flashcards - 1) },
        counters: { ...cur.counters, flashcards: Math.max(0, cur.counters.flashcards - 1) },
      };
    }
    gamRef.current = next;
    setGam(next);
    setReward(null);
  }, []);

  const pomo = usePomodoro(pomoSettings, giveXP);

  // Vira o dia (zera a meta diária) ou a semana (renova as missões) com o app aberto
  useEffect(() => {
    const iv = setInterval(() => {
      const g = gamRef.current;
      const needsDayReset = g.today?.date && g.today.date !== todayISO();
      const needsWeekReset = g.missions && g.missions.weekKey !== weekKey();
      if (needsDayReset || needsWeekReset) {
        const n = normalizeGam(g);
        gamRef.current = n;
        setGam(n);
      }
    }, 60000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    (async () => {
      const [s, sc, ag, dk, ps, pl, gm] = await Promise.all([
        loadKey("subjects", null),
        loadKey("schedule", null),
        loadKey("agenda", []),
        loadKey("decks", []),
        loadKey("pomo-settings", null),
        loadKey("plan-settings", null),
        loadKey(GAM_STORAGE_KEY, null),
      ]);
      setSubjects(s || seedSubjects());
      setSchedule(sc || (() => { const o = {}; DAYS.forEach((d) => (o[d.key] = [])); return o; })());
      setAgenda(ag || []);
      setDecks(dk || []);
      setPomoSettings(ps || { work: 25, short: 5, long: 15, cyclesUntilLong: 4 });
      setPlanSettings(pl || { defaultHours: 2 });
      const g = normalizeGam(gm);
      gamRef.current = g;
      setGam(g);
      setLoaded(true);
    })();
  }, []);

  useEffect(() => { if (loaded) saveKey("subjects", subjects); }, [subjects, loaded]);
  useEffect(() => { if (loaded) saveKey("schedule", schedule); }, [schedule, loaded]);
  useEffect(() => { if (loaded) saveKey("agenda", agenda); }, [agenda, loaded]);
  useEffect(() => { if (loaded) saveKey("decks", decks); }, [decks, loaded]);
  useEffect(() => { if (loaded) saveKey("pomo-settings", pomoSettings); }, [pomoSettings, loaded]);
  useEffect(() => { if (loaded) saveKey("plan-settings", planSettings); }, [planSettings, loaded]);
  useEffect(() => { if (loaded) saveKey(GAM_STORAGE_KEY, gam); }, [gam, loaded]);

  // Mensagem do "treinador" no topo do Cronograma
  const coach = useMemo(() => {
    const w = streakWarning(gam);
    if (w) return { text: w, tone: "risk" };
    const c = comebackMessage(gam);
    if (c) return { text: c, tone: "back" };
    return { text: greeting(), tone: "normal" };
  }, [gam.streak.last, gam.streak.current]); // eslint-disable-line

  // Estimativa de dias para concluir (geral e por matéria) + comparação com a prova
  const estimate = useMemo(
    () => estimateCompletion({ subjects, schedule, defaultHours: planSettings.defaultHours }),
    [subjects, schedule, planSettings.defaultHours]
  );
  const exam = useMemo(
    () => examInfo({ agenda, overallDays: estimate.overall.days, totalPending: estimate.totalPending, weeklyHours: estimate.weeklyHours }),
    [agenda, estimate]
  );

  const tabs = [
    { key: "cronograma", label: "Cronograma", icon: ClipboardList },
    { key: "agenda", label: "Agenda", icon: CalendarIcon },
    { key: "pomodoro", label: "Pomodoro", icon: Clock },
    { key: "flashcards", label: "Flashcards", icon: Layers },
    { key: "questoes", label: "Questões", icon: Brain },
    { key: "desempenho", label: "Desempenho", icon: BarChart3 },
    { key: "conquistas", label: "Conquistas", icon: Award },
    { key: "dicas", label: "Dicas", icon: Lightbulb },
    { key: "concursos", label: "Concursos", icon: Newspaper },
  ];

  if (!loaded) {
    return (
      <div style={{ background: COLORS.bg, color: COLORS.text }} className="font-body min-h-screen flex items-center justify-center">
        <style>{FONT_STYLE}</style>
        <div className="animate-pulse text-sm" style={{ color: COLORS.sub }}>Carregando protocolo de estudos…</div>
      </div>
    );
  }

  return (
    <div style={{ background: COLORS.bg, color: COLORS.text }} className="font-body min-h-screen w-full">
      <style>{FONT_STYLE}</style>
      <Header gam={gam} />
      <nav className="sticky top-0 z-20 border-b overflow-x-auto" style={{ background: "rgba(15,24,38,0.92)", backdropFilter: "blur(8px)", borderColor: COLORS.cardBorder }}>
        <div className="flex gap-1 px-3 py-2 min-w-max">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap"
                style={{
                  background: active ? COLORS.gold : "transparent",
                  color: active ? "#12203A" : COLORS.sub,
                }}
              >
                <Icon size={14} strokeWidth={2.2} />
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>

      <main className="px-3 sm:px-6 py-5 max-w-5xl mx-auto">
        {tab === "cronograma" && (
          <Cronograma subjects={subjects} setSubjects={setSubjects} schedule={schedule} setSchedule={setSchedule} onCelebrate={setCelebration}
            estimate={estimate} planSettings={planSettings} setPlanSettings={setPlanSettings}
            giveXP={giveXP} gam={gam} coach={coach} />
        )}
        {tab === "agenda" && <Agenda agenda={agenda} setAgenda={setAgenda} />}
        {tab === "pomodoro" && <Pomodoro pomo={pomo} settings={pomoSettings} setSettings={setPomoSettings} />}
        {tab === "flashcards" && <Flashcards decks={decks} setDecks={setDecks} giveXP={giveXP} undoXP={undoXP} getGam={getGam} />}
        {tab === "questoes" && <Questoes giveXP={giveXP} />}
        {tab === "desempenho" && <Desempenho subjects={subjects} estimate={estimate} exam={exam} planSettings={planSettings} />}
        {tab === "conquistas" && (
          <AchievementsScreen gam={gam} onSetGoal={(v) => setGam((g) => { const n = { ...g, dailyGoal: v }; gamRef.current = n; return n; })} />
        )}
        {tab === "dicas" && <Dicas />}
        {tab === "concursos" && <Concursos giveXP={giveXP} />}
      </main>

      <PomodoroChip pomo={pomo} tab={tab} setTab={setTab} />
      <CelebrationToast celebration={celebration} onClose={() => setCelebration(null)} />
      <RewardToast reward={reward} onClose={() => setReward(null)} />
      <PomodoroAlert pomo={pomo} />
    </div>
  );
}

function Header({ gam }) {
  const fileInputRef = useRef(null);
  const [msg, setMsg] = useState(null);

  const handleImportClick = () => fileInputRef.current?.click();
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!window.confirm("Importar este arquivo vai substituir os dados atuais do app neste dispositivo. Deseja continuar?")) {
      e.target.value = "";
      return;
    }
    importAllData(file, (ok, error) => {
      if (ok) {
        setMsg({ type: "ok", text: "Registro importado! Recarregando…" });
        setTimeout(() => window.location.reload(), 900);
      } else {
        setMsg({ type: "err", text: `Falha ao importar: ${error || "arquivo inválido"}` });
      }
    });
    e.target.value = "";
  };

  return (
    <header className="px-4 sm:px-6 pt-6 pb-4 border-b" style={{ borderColor: COLORS.cardBorder }}>
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] tracking-[0.25em] uppercase font-mono" style={{ color: COLORS.gold }}>
            Protocolo de Estudos
          </div>
          <h1 className="font-display text-2xl sm:text-3xl" style={{ color: COLORS.text }}>
            Diário Oficial da Aprovação
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {gam && <GamHeaderStrip gam={gam} />}
          <Btn onClick={exportAllData} variant="ghost" small><Download size={13} /> Salvar registro</Btn>
          <Btn onClick={handleImportClick} variant="ghost" small><Upload size={13} /> Abrir registro</Btn>
          <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleFileChange} />
          <div className="hidden sm:flex items-center justify-center w-14 h-14 rounded-full border-2" style={{ borderColor: COLORS.gold, color: COLORS.gold }}>
            <Award size={24} />
          </div>
        </div>
      </div>
      {msg && (
        <div className="max-w-5xl mx-auto mt-2 text-xs" style={{ color: msg.type === "ok" ? COLORS.teal : COLORS.rose }}>
          {msg.text}
        </div>
      )}
    </header>
  );
}

/* ================= CARD / UI PRIMITIVES ================= */
function Card({ children, className = "", style = {} }) {
  return (
    <div className={`rounded-xl border p-4 ${className}`} style={{ background: COLORS.card, borderColor: COLORS.cardBorder, ...style }}>
      {children}
    </div>
  );
}
function SectionTitle({ children, icon: Icon }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {Icon && <Icon size={18} style={{ color: COLORS.gold }} />}
      <h2 className="font-display text-xl">{children}</h2>
    </div>
  );
}
function Btn({ children, onClick, variant = "solid", className = "", small, type = "button" }) {
  const styles = {
    solid: { background: COLORS.gold, color: "#12203A" },
    ghost: { background: "transparent", color: COLORS.sub, border: `1px solid ${COLORS.cardBorder}` },
    danger: { background: "transparent", color: COLORS.rose, border: `1px solid ${COLORS.rose}55` },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg font-medium transition-transform active:scale-95 ${small ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm"} ${className}`}
      style={styles[variant]}
    >
      {children}
    </button>
  );
}
function Input(props) {
  return (
    <input
      {...props}
      className={`rounded-lg px-3 py-2 text-sm outline-none border ${props.className || ""}`}
      style={{ background: COLORS.bg2, borderColor: COLORS.cardBorder, color: COLORS.text, ...(props.style || {}) }}
    />
  );
}
function Select(props) {
  return (
    <select
      {...props}
      className={`rounded-lg px-3 py-2 text-sm outline-none border ${props.className || ""}`}
      style={{ background: COLORS.bg2, borderColor: COLORS.cardBorder, color: COLORS.text, ...(props.style || {}) }}
    >
      {props.children}
    </select>
  );
}

/* ================= CRONOGRAMA ================= */
function Cronograma({ subjects, setSubjects, schedule, setSchedule, onCelebrate, estimate, planSettings, setPlanSettings, giveXP, gam, coach }) {
  const [activeDay, setActiveDay] = useState("seg");
  const [editingId, setEditingId] = useState(null);
  const [newSubtopic, setNewSubtopic] = useState("");
  const [newSubj, setNewSubj] = useState({ name: "", priority: "media", difficulty: 3, subtopics: "" });
  const [newSlot, setNewSlot] = useState({ start: "19:00", end: "20:00" });
  const [showAddSubject, setShowAddSubject] = useState(false);

  const addSubject = () => {
    if (!newSubj.name.trim()) return;
    const subtopics = newSubj.subtopics.split(",").map((s) => s.trim()).filter(Boolean).map((n) => ({ id: uid(), name: n, done: false }));
    setSubjects((prev) => [...prev, { id: uid(), name: newSubj.name.trim(), priority: newSubj.priority, difficulty: Number(newSubj.difficulty), subtopics: subtopics.length ? subtopics : [{ id: uid(), name: "Geral", done: false }] }]);
    setNewSubj({ name: "", priority: "media", difficulty: 3, subtopics: "" });
    setShowAddSubject(false);
  };
  const removeSubject = (id) => {
    setSubjects((prev) => prev.filter((s) => s.id !== id));
    setSchedule((prev) => {
      const next = {};
      Object.entries(prev).forEach(([k, arr]) => { next[k] = arr.map((sl) => (sl.subjectId === id ? { ...sl, subjectId: null, subtopicId: null } : sl)); });
      return next;
    });
  };

  /* ---- edição de matérias e submatérias ---- */
  const updateSubject = (id, patch) => setSubjects((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const updateSubtopic = (subjectId, subtopicId, patch) =>
    setSubjects((prev) => prev.map((s) => (s.id === subjectId
      ? { ...s, subtopics: s.subtopics.map((t) => (t.id === subtopicId ? { ...t, ...patch } : t)) } : s)));
  const addSubtopic = (subjectId) => {
    const name = newSubtopic.trim();
    if (!name) return;
    setSubjects((prev) => prev.map((s) => (s.id === subjectId ? { ...s, subtopics: [...s.subtopics, { id: uid(), name, done: false }] } : s)));
    setNewSubtopic("");
  };
  const removeSubtopic = (subjectId, subtopicId) => {
    const subj = subjects.find((s) => s.id === subjectId);
    if (!subj || subj.subtopics.length <= 1) return;
    const remaining = subj.subtopics.filter((t) => t.id !== subtopicId);
    const fallback = remaining.find((t) => !t.done) || remaining[0];
    setSubjects((prev) => prev.map((s) => (s.id === subjectId ? { ...s, subtopics: remaining } : s)));
    // horários que apontavam para a submatéria apagada passam para outra da mesma matéria
    setSchedule((prev) => {
      const next = {};
      Object.entries(prev).forEach(([k, arr]) => {
        next[k] = arr.map((sl) => (sl.subtopicId === subtopicId ? { ...sl, subtopicId: fallback.id, done: false } : sl));
      });
      return next;
    });
  };
  // Mensagem de incentivo + XP quando uma submatéria passa de pendente para concluída
  const rewardSubtopic = (subj, sub) => {
    const total = subj.subtopics.length;
    const doneCount = subj.subtopics.filter((t) => t.done).length + 1;
    const wholeSubject = doneCount >= total;
    if (onCelebrate) {
      onCelebrate(buildCelebration({
        kind: wholeSubject ? "subject" : "sub",
        subjectName: subj.name, subtopicName: sub.name, done: doneCount, total,
      }));
    }
    if (giveXP) {
      // onceKey: marcar e desmarcar a mesma submatéria não rende XP de novo
      giveXP("subtopicDone", { onceKey: `sub:${sub.id}` });
      if (wholeSubject) giveXP("subjectDone", { onceKey: `subj:${subj.id}` });
    }
  };
  const setSubtopicDone = (subjectId, subtopicId, done) => {
    const subj = subjects.find((s) => s.id === subjectId);
    const sub = subj?.subtopics.find((t) => t.id === subtopicId);
    if (!subj || !sub) return;
    updateSubtopic(subjectId, subtopicId, { done });
    if (done && !sub.done) rewardSubtopic(subj, sub);
  };

  const addSlot = () => {
    setSchedule((prev) => ({
      ...prev,
      [activeDay]: [...prev[activeDay], { id: uid(), start: newSlot.start, end: newSlot.end, subjectId: null, subtopicId: null, done: false }].sort((a, b) => a.start.localeCompare(b.start)),
    }));
  };
  const removeSlot = (id) => setSchedule((prev) => ({ ...prev, [activeDay]: prev[activeDay].filter((s) => s.id !== id) }));

  const toggleDone = (dayKey, slotId) => {
    setSchedule((prev) => ({
      ...prev,
      [dayKey]: prev[dayKey].map((sl) => {
        if (sl.id !== slotId) return sl;
        const nowDone = !sl.done;
        return { ...sl, done: nowDone };
      }),
    }));
    // reflect into subtopic done state
    const slot = schedule[dayKey].find((s) => s.id === slotId);
    if (slot?.subjectId && slot?.subtopicId) {
      setSubjects((prev) => prev.map((s) => s.id === slot.subjectId ? { ...s, subtopics: s.subtopics.map((t) => t.id === slot.subtopicId ? { ...t, done: !slot.done } : t) } : s));
      // Mensagem de incentivo: só quando a submatéria passa de pendente para concluída
      if (!slot.done) {
        const subj = subjects.find((s) => s.id === slot.subjectId);
        const sub = subj?.subtopics.find((t) => t.id === slot.subtopicId);
        if (subj && sub && !sub.done) rewardSubtopic(subj, sub);
      }
    }
  };

  const assignSlot = (dayKey, slotId, subjectId) => {
    const subj = subjects.find((s) => s.id === subjectId);
    const nextSubtopic = subj?.subtopics.find((t) => !t.done) || subj?.subtopics[0] || null;
    setSchedule((prev) => ({
      ...prev,
      [dayKey]: prev[dayKey].map((sl) => sl.id === slotId ? { ...sl, subjectId: subjectId || null, subtopicId: nextSubtopic?.id || null, done: false } : sl),
    }));
  };
  const assignSubtopic = (dayKey, slotId, subtopicId) => {
    setSchedule((prev) => ({ ...prev, [dayKey]: prev[dayKey].map((sl) => sl.id === slotId ? { ...sl, subtopicId } : sl) }));
  };

  const autoOrganize = () => {
    if (!subjects.length) return;
    const emptySlots = [];
    DAYS.forEach((d) => schedule[d.key].forEach((sl) => { if (!sl.subjectId) emptySlots.push({ day: d.key, id: sl.id }); }));
    if (!emptySlots.length) return;
    const picks = weightedRoundRobinPick(subjects, emptySlots.length);
    const pointers = {};
    setSchedule((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      let lastSubjectByDay = {};
      emptySlots.forEach((slot, i) => {
        let subjectId = picks[i];
        // avoid same subject as immediately previous slot on same day when alternatives exist
        if (lastSubjectByDay[slot.day] === subjectId && subjects.length > 1) {
          const altIndex = picks.findIndex((p, j) => j > i && p !== subjectId);
          if (altIndex !== -1) { const tmp = picks[i]; picks[i] = picks[altIndex]; picks[altIndex] = tmp; subjectId = picks[i]; }
        }
        lastSubjectByDay[slot.day] = subjectId;
        const subj = subjects.find((s) => s.id === subjectId);
        if (!subj) return;
        pointers[subjectId] = pointers[subjectId] ?? 0;
        const notDone = subj.subtopics.filter((t) => !t.done);
        const pool = notDone.length ? notDone : subj.subtopics;
        const subtopic = pool[pointers[subjectId] % pool.length];
        pointers[subjectId] += 1;
        const arr = next[slot.day];
        const idx = arr.findIndex((s) => s.id === slot.id);
        arr[idx] = { ...arr[idx], subjectId, subtopicId: subtopic?.id || null };
      });
      return next;
    });
  };

  const clearDaySlots = () => setSchedule((prev) => ({ ...prev, [activeDay]: prev[activeDay].map((s) => ({ ...s, subjectId: null, subtopicId: null, done: false })) }));

  return (
    <div className="space-y-5">
      {gam && <DailyGoalBar gam={gam} />}
      {coach && (
        <div className="rounded-lg p-3 border-l-4" data-testid="coach"
          style={{ borderColor: coach.tone === "risk" ? COLORS.rose : COLORS.gold, background: COLORS.card }}>
          <p className="text-xs" style={{ color: COLORS.text }}>{coach.text}</p>
        </div>
      )}
      {/* Legend */}
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          {Object.entries(PRIORITY).map(([k, v]) => (
            <div key={k} className="flex items-center gap-1.5 text-xs" style={{ color: COLORS.sub }}>
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: v.color }} />
              {v.label}
            </div>
          ))}
          <div className="flex-1" />
          <Btn onClick={autoOrganize} small><Wand2 size={13} /> Organizar automaticamente</Btn>
        </div>
      </Card>

      {/* Subjects manager */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <SectionTitle icon={BookOpen}>Matérias</SectionTitle>
          <Btn onClick={() => setShowAddSubject((v) => !v)} variant="ghost" small><Plus size={13} /> Matéria</Btn>
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-3 text-xs" style={{ color: COLORS.sub }}>
          <Hourglass size={13} style={{ color: COLORS.gold }} />
          <span>Horas por submatéria (padrão):</span>
          <Input type="number" min={0.5} step={0.5} className="w-20" value={planSettings.defaultHours}
            onChange={(e) => setPlanSettings({ ...planSettings, defaultHours: Math.max(0.5, Number(e.target.value) || 0.5) })} />
          <span className="font-mono" style={{ color: COLORS.gold }}>
            Previsão geral: {estimate.noCapacity ? "cadastre horários abaixo" : estimateLabel(estimate.overall, estimate.noCapacity, estimate.over)}
            {estimate.overall.date && estimate.overall.days > 0 ? ` · até ${fmtDate(estimate.overall.date)}` : ""}
          </span>
        </div>
        {showAddSubject && (
          <div className="grid sm:grid-cols-2 gap-2 mb-3 p-3 rounded-lg" style={{ background: COLORS.bg2 }}>
            <Input placeholder="Nome da matéria" value={newSubj.name} onChange={(e) => setNewSubj({ ...newSubj, name: e.target.value })} />
            <Input placeholder="Subtemas separados por vírgula" value={newSubj.subtopics} onChange={(e) => setNewSubj({ ...newSubj, subtopics: e.target.value })} />
            <Select value={newSubj.priority} onChange={(e) => setNewSubj({ ...newSubj, priority: e.target.value })}>
              {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: COLORS.sub }}>Dificuldade</span>
              <input type="range" min={1} max={5} value={newSubj.difficulty} onChange={(e) => setNewSubj({ ...newSubj, difficulty: e.target.value })} className="flex-1" />
              <span className="font-mono text-xs">{newSubj.difficulty}</span>
            </div>
            <Btn onClick={addSubject} className="sm:col-span-2"><Check size={14} /> Adicionar matéria</Btn>
          </div>
        )}
        <div className="space-y-1.5">
          {subjects.map((s) => {
            const doneCount = s.subtopics.filter((t) => t.done).length;
            const isEditing = editingId === s.id;
            const est = estimate.perSubject[s.id];
            return (
              <div key={s.id} className="rounded-lg" style={{ background: COLORS.bg2 }}>
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PRIORITY[s.priority].color }} />
                  <span className="text-sm flex-1 truncate">{s.name || "(sem nome)"}</span>
                  <span className="text-[10px] font-mono" style={{ color: COLORS.sub }}>{doneCount}/{s.subtopics.length} · dif. {s.difficulty}</span>
                  {est && !estimate.noCapacity && (
                    <span className="hidden sm:inline text-[10px] font-mono" style={{ color: COLORS.gold }}>{estimateLabel(est, estimate.noCapacity, estimate.over)}</span>
                  )}
                  <button onClick={() => { setEditingId(isEditing ? null : s.id); setNewSubtopic(""); }} aria-label={`Editar ${s.name}`} title="Editar matéria e submatérias">
                    <Pencil size={14} style={{ color: isEditing ? COLORS.gold : COLORS.sub }} />
                  </button>
                  <button onClick={() => { if (window.confirm(`Excluir "${s.name}" e todas as suas submatérias?`)) removeSubject(s.id); }} aria-label={`Excluir ${s.name}`} title="Excluir matéria">
                    <Trash2 size={14} style={{ color: COLORS.rose }} />
                  </button>
                </div>

                {isEditing && (
                  <div className="border-t px-3 py-3 space-y-3" style={{ borderColor: COLORS.cardBorder }}>
                    <div className="grid sm:grid-cols-2 gap-2">
                      <label className="text-[11px] sm:col-span-2" style={{ color: COLORS.sub }}>
                        Nome da matéria
                        <Input className="w-full mt-1" value={s.name} onChange={(e) => updateSubject(s.id, { name: e.target.value })} />
                      </label>
                      <label className="text-[11px]" style={{ color: COLORS.sub }}>
                        Prioridade
                        <Select className="w-full mt-1" value={s.priority} onChange={(e) => updateSubject(s.id, { priority: e.target.value })}>
                          {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </Select>
                      </label>
                      <label className="text-[11px]" style={{ color: COLORS.sub }}>
                        Dificuldade: <span className="font-mono">{s.difficulty}</span>
                        <input type="range" min={1} max={5} value={s.difficulty} className="w-full mt-3"
                          onChange={(e) => updateSubject(s.id, { difficulty: Number(e.target.value) })} />
                      </label>
                    </div>

                    <div>
                      <p className="text-[11px] mb-1.5" style={{ color: COLORS.sub }}>
                        Submatérias (marque as concluídas · horas estimadas de estudo, vazio = padrão de {fmtH(planSettings.defaultHours)})
                      </p>
                      <div className="space-y-1.5">
                        {s.subtopics.map((t) => (
                          <div key={t.id} className="flex items-center gap-2">
                            <button onClick={() => setSubtopicDone(s.id, t.id, !t.done)} aria-label={t.done ? "Desmarcar como concluída" : "Marcar como concluída"}
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border"
                              style={{ background: t.done ? COLORS.teal : "transparent", borderColor: t.done ? COLORS.teal : COLORS.cardBorder, color: "#0B121D" }}>
                              {t.done && <Check size={13} />}
                            </button>
                            <Input className="flex-1 min-w-0" value={t.name} placeholder="Nome da submatéria"
                              onChange={(e) => updateSubtopic(s.id, t.id, { name: e.target.value })} />
                            <Input type="number" min={0.5} step={0.5} className="w-20" title="Horas estimadas"
                              placeholder={String(planSettings.defaultHours)} value={t.hours ?? ""}
                              onChange={(e) => updateSubtopic(s.id, t.id, { hours: e.target.value === "" ? undefined : Number(e.target.value) })} />
                            <button onClick={() => removeSubtopic(s.id, t.id)} disabled={s.subtopics.length <= 1}
                              aria-label="Excluir submatéria" title={s.subtopics.length <= 1 ? "A matéria precisa ter ao menos uma submatéria" : "Excluir submatéria"}
                              style={{ opacity: s.subtopics.length <= 1 ? 0.3 : 1 }}>
                              <Trash2 size={13} style={{ color: COLORS.rose }} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2 mt-2">
                        <Input className="flex-1 min-w-0" placeholder="Nova submatéria" value={newSubtopic}
                          onChange={(e) => setNewSubtopic(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addSubtopic(s.id); }} />
                        <Btn onClick={() => addSubtopic(s.id)} small variant="ghost"><Plus size={13} /> Adicionar</Btn>
                      </div>
                    </div>
                    <Btn onClick={() => setEditingId(null)} small><Check size={13} /> Concluir edição</Btn>
                  </div>
                )}
              </div>
            );
          })}
          {!subjects.length && <p className="text-xs" style={{ color: COLORS.sub }}>Nenhuma matéria cadastrada ainda.</p>}
        </div>
      </Card>

      {/* Weekly schedule */}
      <Card>
        <SectionTitle icon={ClipboardList}>Cronograma semanal</SectionTitle>
        <div className="flex gap-1 overflow-x-auto mb-3 pb-1">
          {DAYS.map((d) => (
            <button key={d.key} onClick={() => setActiveDay(d.key)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap"
              style={{ background: activeDay === d.key ? COLORS.teal : COLORS.bg2, color: activeDay === d.key ? "#0B121D" : COLORS.sub }}>
              {d.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs" style={{ color: COLORS.sub }}>Horário disponível:</span>
          <Input type="time" value={newSlot.start} onChange={(e) => setNewSlot({ ...newSlot, start: e.target.value })} />
          <span className="text-xs" style={{ color: COLORS.sub }}>até</span>
          <Input type="time" value={newSlot.end} onChange={(e) => setNewSlot({ ...newSlot, end: e.target.value })} />
          <Btn onClick={addSlot} small><Plus size={13} /> Adicionar horário</Btn>
          <Btn onClick={clearDaySlots} variant="ghost" small>Limpar atribuições do dia</Btn>
        </div>

        <div className="space-y-2">
          {schedule[activeDay].map((slot) => {
            const subj = subjects.find((s) => s.id === slot.subjectId);
            const color = subj ? PRIORITY[subj.priority].color : COLORS.cardBorder;
            return (
              <div key={slot.id} className="rounded-lg p-3 border-l-4" style={{ background: COLORS.bg2, borderColor: color }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs" style={{ color: COLORS.gold }}>{slot.start}–{slot.end}</span>
                  <Select value={slot.subjectId || ""} onChange={(e) => assignSlot(activeDay, slot.id, e.target.value)} className="min-w-[140px]">
                    <option value="">Sem matéria</option>
                    {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                  {subj && (
                    <Select value={slot.subtopicId || ""} onChange={(e) => assignSubtopic(activeDay, slot.id, e.target.value)} className="min-w-[140px]">
                      {subj.subtopics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </Select>
                  )}
                  <div className="flex-1" />
                  <button onClick={() => toggleDone(activeDay, slot.id)}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium"
                    style={{ background: slot.done ? COLORS.teal : "transparent", color: slot.done ? "#0B121D" : COLORS.sub, border: `1px solid ${slot.done ? COLORS.teal : COLORS.cardBorder}` }}>
                    <Check size={12} /> {slot.done ? "Concluído" : "Marcar feito"}
                  </button>
                  <button onClick={() => removeSlot(slot.id)}><Trash2 size={14} style={{ color: COLORS.rose }} /></button>
                </div>
              </div>
            );
          })}
          {!schedule[activeDay].length && <p className="text-xs" style={{ color: COLORS.sub }}>Nenhum horário cadastrado para {DAYS.find(d=>d.key===activeDay).label}.</p>}
        </div>
      </Card>
    </div>
  );
}

/* ================= AGENDA ================= */
function Agenda({ agenda, setAgenda }) {
  const [form, setForm] = useState({ title: "", date: "", time: "", type: "estudo", reminderMinutes: 30, note: "" });
  const notifiedRef = useRef(new Set());

  useEffect(() => {
    const iv = setInterval(() => {
      const now = new Date();
      agenda.forEach((ev) => {
        if (!ev.date || !ev.time) return;
        const evTime = new Date(`${ev.date}T${ev.time}`);
        const remindAt = new Date(evTime.getTime() - ev.reminderMinutes * 60000);
        const key = ev.id;
        if (!notifiedRef.current.has(key) && now >= remindAt && now < evTime) {
          notifiedRef.current.add(key);
          playChime();
          if (window.Notification && Notification.permission === "granted") {
            new Notification("Lembrete de estudos", { body: `${ev.title} às ${ev.time}` });
          }
        }
      });
    }, 20000);
    return () => clearInterval(iv);
  }, [agenda]);

  const requestPerm = () => { if (window.Notification && Notification.permission !== "granted") Notification.requestPermission(); };

  const addEvent = () => {
    if (!form.title.trim() || !form.date) return;
    setAgenda((prev) => [...prev, { id: uid(), ...form, title: form.title.trim() }].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)));
    setForm({ title: "", date: "", time: "", type: "estudo", reminderMinutes: 30, note: "" });
  };
  const removeEvent = (id) => setAgenda((prev) => prev.filter((e) => e.id !== id));

  const typeColor = { prova: COLORS.rose, estudo: COLORS.teal, edital: COLORS.gold, outro: COLORS.sub };

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle icon={CalendarIcon}>Nova entrada na agenda</SectionTitle>
        <div className="grid sm:grid-cols-2 gap-2">
          <Input placeholder="Título (ex: Prova — edital nº 12/2026)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="sm:col-span-2" />
          <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
          <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="estudo">Sessão de estudo</option>
            <option value="prova">Data da prova</option>
            <option value="edital">Publicação de edital</option>
            <option value="outro">Outro</option>
          </Select>
          <Select value={form.reminderMinutes} onChange={(e) => setForm({ ...form, reminderMinutes: Number(e.target.value) })}>
            <option value={0}>Sem lembrete</option>
            <option value={15}>Lembrar 15 min antes</option>
            <option value={30}>Lembrar 30 min antes</option>
            <option value={60}>Lembrar 1 hora antes</option>
            <option value={1440}>Lembrar 1 dia antes</option>
          </Select>
          <Input placeholder="Observações / link do edital" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className="sm:col-span-2" />
        </div>
        <div className="flex items-center gap-2 mt-3">
          <Btn onClick={addEvent}><Plus size={14} /> Adicionar à agenda</Btn>
          <Btn onClick={requestPerm} variant="ghost" small><Bell size={13} /> Ativar notificações do navegador</Btn>
        </div>
        <p className="text-[11px] mt-2" style={{ color: COLORS.sub }}>
          O lembrete toca um sinal sonoro e (se autorizado) uma notificação enquanto este app estiver aberto no navegador. Para um alarme real do dispositivo — por exemplo no dia da prova — basta me pedir no chat: "coloque um alarme para o dia X".
        </p>
      </Card>

      <Card>
        <SectionTitle icon={CalendarIcon}>Próximos eventos</SectionTitle>
        <div className="space-y-2">
          {agenda.map((ev, i) => (
            <div key={ev.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg border-l-4" style={{ background: COLORS.bg2, borderColor: typeColor[ev.type] }}>
              <span className="font-mono text-[10px]" style={{ color: COLORS.sub }}>Nº {String(i + 1).padStart(4, "0")}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{ev.title}</div>
                <div className="text-[11px] font-mono" style={{ color: COLORS.sub }}>{ev.date} {ev.time && `· ${ev.time}`} {ev.note && `· ${ev.note}`}</div>
              </div>
              <button onClick={() => removeEvent(ev.id)}><Trash2 size={14} style={{ color: COLORS.rose }} /></button>
            </div>
          ))}
          {!agenda.length && <p className="text-xs" style={{ color: COLORS.sub }}>Nenhum evento cadastrado.</p>}
        </div>
      </Card>
    </div>
  );
}

/* ================= POMODORO ================= */
function Pomodoro({ pomo, settings, setSettings }) {
  const { state } = pomo;
  const mode = state.mode;
  const [perm, setPerm] = useState(notifSupported() ? Notification.permission : "unsupported");

  const totalMs = settings[mode] * 60000;
  const remaining = pomoRemainingMs(state, pomo.now);
  const pct = Math.max(0, Math.min(100, ((totalMs - remaining) / totalMs) * 100));
  const modeLabel = { work: "Foco", short: "Pausa curta", long: "Pausa longa" }[mode];
  const modeColor = { work: COLORS.rose, short: COLORS.teal, long: COLORS.gold }[mode];

  const askPerm = async () => { setPerm(await requestNotifPermission()); };

  return (
    <div className="space-y-5">
      <Card className="flex flex-col items-center py-8">
        <div className="flex gap-2 mb-6">
          {["work", "short", "long"].map((m) => (
            <button key={m} onClick={() => pomo.switchMode(m)} className="px-3 py-1 rounded-full text-xs font-medium"
              style={{ background: mode === m ? modeColor : "transparent", color: mode === m ? "#0B121D" : COLORS.sub, border: `1px solid ${mode===m?modeColor:COLORS.cardBorder}` }}>
              {{ work: "Foco", short: "Pausa curta", long: "Pausa longa" }[m]}
            </button>
          ))}
        </div>

        {/* Stamp-style circular timer */}
        <div className="relative w-56 h-56 flex items-center justify-center">
          <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="44" fill="none" stroke={COLORS.cardBorder} strokeWidth="4" />
            <circle cx="50" cy="50" r="44" fill="none" stroke={modeColor} strokeWidth="4" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 44} strokeDashoffset={2 * Math.PI * 44 * (1 - pct / 100)} style={{ transition: "stroke-dashoffset 1s linear" }} />
          </svg>
          <div className="rounded-full border-2 border-dashed w-44 h-44 flex flex-col items-center justify-center" style={{ borderColor: modeColor + "77" }}>
            <span className="font-mono text-4xl">{formatClock(remaining)}</span>
            <span className="text-[10px] uppercase tracking-widest mt-1" style={{ color: modeColor }}>{modeLabel}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-6">
          <Btn onClick={state.running ? pomo.pause : pomo.start}>{state.running ? <Pause size={15} /> : <Play size={15} />} {state.running ? "Pausar" : "Iniciar"}</Btn>
          <Btn onClick={pomo.reset} variant="ghost"><RotateCcw size={15} /> Reiniciar</Btn>
        </div>
        <div className="flex items-center gap-1.5 mt-3 text-xs" style={{ color: COLORS.sub }}>
          <Flame size={13} style={{ color: COLORS.gold }} /> {state.cycles} ciclo(s) de foco concluído(s) hoje
        </div>
        <p className="mt-1 max-w-xs text-center text-[11px]" style={{ color: COLORS.sub }}>
          Ao fim do foco o descanso começa sozinho, e você é avisado quando ele acabar.
        </p>
      </Card>

      <Card>
        <SectionTitle icon={BellRing}>Alertas</SectionTitle>
        <p className="text-xs mb-3" style={{ color: COLORS.sub }}>
          No fim de cada etapa o app mostra um aviso em tela cheia, toca um som, vibra (no celular) e envia uma notificação do sistema, que aparece por cima de outros apps.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {perm === "default" && <Btn onClick={askPerm} small><Bell size={13} /> Ativar notificações do sistema</Btn>}
          {perm === "granted" && <span className="text-xs" style={{ color: COLORS.teal }}>Notificações do sistema ativadas</span>}
          {perm === "denied" && <span className="text-xs" style={{ color: COLORS.rose }}>Notificações bloqueadas: libere nas configurações do site/app no navegador.</span>}
          {perm === "unsupported" && <span className="text-xs" style={{ color: COLORS.sub }}>Este navegador não oferece notificações do sistema.</span>}
          <Btn onClick={pomo.testAlert} variant="ghost" small><Volume2 size={13} /> Testar alerta</Btn>
        </div>
        <p className="text-[11px] mt-3" style={{ color: COLORS.sub }}>
          Dica: deixe o app aberto enquanto estuda. Enquanto o timer roda, o app pede para a tela não apagar; se o sistema suspender o navegador em segundo plano, o aviso pode chegar com atraso.
        </p>
      </Card>

      <Card>
        <SectionTitle icon={Clock}>Configurações</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[["work", "Foco (min)"], ["short", "Pausa curta (min)"], ["long", "Pausa longa (min)"], ["cyclesUntilLong", "Ciclos p/ pausa longa"]].map(([k, label]) => (
            <label key={k} className="text-xs" style={{ color: COLORS.sub }}>
              {label}
              <Input type="number" min={1} value={settings[k]} onChange={(e) => setSettings({ ...settings, [k]: Number(e.target.value) || 1 })} className="w-full mt-1" />
            </label>
          ))}
        </div>
      </Card>
    </div>
  );
}

/* ================= FLASHCARDS ================= */
const escHtml = (t) => String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br>");
// Cartões antigos são texto puro; ao editar, viram HTML (sem perder quebras de linha)
const cardSideHtml = (c, side) => (c.html ? c[side] : escHtml(c[side]));
const cardPlain = (c, side) => (c.html ? htmlToPlainText(c[side]) : String(c[side] ?? ""));

function MoveCardsDialog({ decks, fromDeckId, count, onMove, onCreateAndMove, onClose }) {
  const [newName, setNewName] = useState("");
  const targets = decks.filter((d) => d.id !== fromDeckId);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(5,9,16,0.7)" }} onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border p-4" style={{ background: COLORS.card, borderColor: COLORS.cardBorder }} onClick={(e) => e.stopPropagation()}>
        <SectionTitle icon={FolderInput}>Mover {count} {count === 1 ? "cartão" : "cartões"}</SectionTitle>
        <p className="text-[11px] mb-3" style={{ color: COLORS.sub }}>O progresso de revisão (memória e data) é mantido.</p>
        <div className="space-y-1 max-h-52 overflow-auto mb-3">
          {targets.map((d) => (
            <button key={d.id} onClick={() => onMove(d.id)} className="w-full text-left text-sm px-3 py-2 rounded-lg"
              style={{ background: COLORS.bg2, color: COLORS.text }}>
              {d.name} <span className="text-[11px]" style={{ color: COLORS.sub }}>({d.cards.length})</span>
            </button>
          ))}
          {!targets.length && <p className="text-xs" style={{ color: COLORS.sub }}>Não há outro baralho. Crie um abaixo.</p>}
        </div>
        <div className="flex gap-2 mb-3">
          <Input placeholder="Novo baralho..." value={newName} onChange={(e) => setNewName(e.target.value)} className="flex-1" />
          <Btn small onClick={() => newName.trim() && onCreateAndMove(newName.trim())}><Plus size={13} /> Criar e mover</Btn>
        </div>
        <Btn variant="ghost" small onClick={onClose}>Cancelar</Btn>
      </div>
    </div>
  );
}

function Flashcards({ decks, setDecks, giveXP, undoXP, getGam }) {
  const [activeDeckId, setActiveDeckId] = useState(null);
  const [form, setForm] = useState({ front: "", back: "" });
  const [queue, setQueue] = useState([]);
  const [studyAll, setStudyAll] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ front: "", back: "" });
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [moveIds, setMoveIds] = useState(null);
  const [undoInfo, setUndoInfo] = useState(null);

  const activeDeck = decks.find((d) => d.id === activeDeckId);

  const buildQueue = (deck, all) => (deck ? deck.cards.filter((c) => all || isDue(c)).map((c) => c.id) : []);
  const startSession = (deck, all = false) => {
    setStudyAll(all);
    setQueue(buildQueue(deck, all));
    setReviewed(0);
    setFlipped(false);
    setUndoInfo(null);
  };
  useEffect(() => {
    startSession(activeDeck, studyAll);
  }, [activeDeckId, activeDeck ? activeDeck.cards.length : 0]); // eslint-disable-line
  useEffect(() => { setSelected(new Set()); setSelectMode(false); setEditingId(null); }, [activeDeckId]);

  const current = activeDeck && queue.length ? activeDeck.cards.find((c) => c.id === queue[0]) : null;

  /* ---------- operações de baralho (via DeckTree) ---------- */
  // Cria na raiz ou dentro de um pai. Usa `uniqueDeckName` para não duplicar.
  const createDeck = (fullName) => {
    const name = uniqueDeckName(decks, fullName);
    const d = { id: uid(), name, cards: [] };
    setDecks((prev) => [...prev, d]);
    setActiveDeckId(d.id);
  };
  const removeDeck = (id) => {
    const deck = decks.find((d) => d.id === id);
    if (!deck) return;
    const msg = deck.cards.length
      ? `Excluir "${deck.name}" e seus ${deck.cards.length} cartão(ões)?`
      : `Excluir "${deck.name}"?`;
    if (!window.confirm(msg)) return;
    setDecks((prev) => prev.filter((d) => d.id !== id));
    if (activeDeckId === id) setActiveDeckId(null);
  };

  const addCard = () => {
    if (isEmptyHtml(form.front) || isEmptyHtml(form.back) || !activeDeckId) return;
    setDecks((prev) => prev.map((d) => d.id === activeDeckId
      ? { ...d, cards: [...d.cards, { id: uid(), front: form.front, back: form.back, box: 1, html: true }] }
      : d));
    setForm({ front: "", back: "" });
  };
  const removeCard = (cardId) => {
    setDecks((prev) => prev.map((d) => d.id === activeDeckId ? { ...d, cards: d.cards.filter((c) => c.id !== cardId) } : d));
    setSelected((s) => { const n = new Set(s); n.delete(cardId); return n; });
  };
  const removeSelected = () => {
    if (!selected.size) return;
    setDecks((prev) => prev.map((d) => d.id === activeDeckId ? { ...d, cards: d.cards.filter((c) => !selected.has(c.id)) } : d));
    setSelected(new Set());
  };

  const startEdit = (c) => { setEditingId(c.id); setEditForm({ front: cardSideHtml(c, "front"), back: cardSideHtml(c, "back") }); };
  const saveEdit = () => {
    if (isEmptyHtml(editForm.front) || isEmptyHtml(editForm.back)) return;
    setDecks((prev) => prev.map((d) => d.id === activeDeckId
      ? { ...d, cards: d.cards.map((c) => (c.id === editingId ? { ...c, front: editForm.front, back: editForm.back, html: true } : c)) }
      : d));
    setEditingId(null);
  };

  const moveCards = (ids, targetId) => {
    const idSet = new Set(ids);
    setDecks((prev) => {
      const moving = [];
      const without = prev.map((d) => {
        const keep = [];
        for (const c of d.cards) (idSet.has(c.id) ? moving : keep).push(c);
        return { ...d, cards: keep };
      });
      return without.map((d) => (d.id === targetId ? { ...d, cards: [...d.cards, ...moving] } : d));
    });
    setSelected(new Set());
    setSelectMode(false);
    setMoveIds(null);
  };
  const createAndMove = (name) => {
    const ids = moveIds || [];
    const idSet = new Set(ids);
    const newId = uid();
    setDecks((prev) => {
      const moving = prev.flatMap((d) => d.cards.filter((c) => idSet.has(c.id)));
      const without = prev.map((d) => ({ ...d, cards: d.cards.filter((c) => !idSet.has(c.id)) }));
      return [...without, { id: newId, name: uniqueDeckName(without, name), cards: moving }];
    });
    setSelected(new Set());
    setSelectMode(false);
    setMoveIds(null);
  };
  const toggleSelect = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const markCard = (rating) => {
    if (!current) return;
    const know = rating !== RATING.AGAIN;
    const before = getGam ? getGam() : null;
    let after = null;
    if (know && giveXP) { const r = giveXP("flashcardKnow"); after = r && r.gam; }
    const updated = rateCard(current, rating);
    setUndoInfo({
      cardId: current.id,
      prev: snapshotScheduling(current),
      know, before, after,
    });
    setDecks((prev) => prev.map((d) => d.id === activeDeckId
      ? { ...d, cards: d.cards.map((c) => (c.id === current.id ? withScheduling(c, updated) : c)) }
      : d));
    setQueue((q) => (isLearning(updated) ? [...q.slice(1), q[0]] : q.slice(1)));
    setReviewed((n) => n + 1);
    setFlipped(false);
  };

  const undoLast = () => {
    if (!undoInfo) return;
    const { cardId, prev, know, before, after } = undoInfo;
    setDecks((p) => p.map((d) => ({
      ...d,
      cards: d.cards.map((c) => {
        if (c.id !== cardId) return c;
        return restoreScheduling(c, prev);
      }),
    })));
    if (activeDeck && activeDeck.cards.some((c) => c.id === cardId)) setQueue((q) => [cardId, ...q.filter((x) => x !== cardId)]);
    setReviewed((n) => Math.max(0, n - 1));
    setFlipped(false);
    if (know && undoXP) undoXP(before, after);
    setUndoInfo(null);
  };
  const undoRef = useRef(undoLast);
  undoRef.current = undoLast;
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      undoRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="space-y-5">
      {/* ---------- Baralhos (árvore) ---------- */}
      <Card>
        <SectionTitle icon={Layers}>Baralhos</SectionTitle>
        <DeckTree
          decks={decks}
          activeDeckId={activeDeckId}
          onSelectDeck={(id) => { setActiveDeckId(id); setFlipped(false); }}
          onRenameDeck={(id, newName) => setDecks((prev) => renameDeckPath(prev, id, newName))}
          onDeleteDeck={removeDeck}
          onCreateChild={(_parent, full) => createDeck(full)}
          onCreateRoot={(full) => createDeck(full)}
          onMoveDeck={(id, newParent) => setDecks((prev) => moveDeckPath(prev, id, newParent))}
          isDueFn={isDue}
        />
      </Card>

      {activeDeck && (
        <>
          <Card>
            <SectionTitle icon={Plus}>Novo cartão em "{activeDeck.name}"</SectionTitle>
            <div className="grid sm:grid-cols-2 gap-2">
              <RichTextEditor label="Frente" placeholder="Frente (pergunta)" value={form.front} onChange={(v) => setForm((f) => ({ ...f, front: v }))} />
              <RichTextEditor label="Verso" placeholder="Verso (resposta)" value={form.back} onChange={(v) => setForm((f) => ({ ...f, back: v }))} />
            </div>
            <Btn onClick={addCard} className="mt-2"><Check size={14} /> Adicionar cartão</Btn>

            {activeDeck.cards.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mt-4 mb-2">
                <Btn small variant={selectMode ? "solid" : "ghost"} onClick={() => { setSelectMode((v) => !v); setSelected(new Set()); }}>
                  <ListChecks size={13} /> {selectMode ? "Sair da seleção" : "Selecionar"}
                </Btn>
                {selectMode && (
                  <>
                    <Btn small variant="ghost" onClick={() => setSelected(selected.size === activeDeck.cards.length ? new Set() : new Set(activeDeck.cards.map((c) => c.id)))}>
                      {selected.size === activeDeck.cards.length ? "Limpar" : "Todos"}
                    </Btn>
                    <Btn small variant="ghost" onClick={() => selected.size && setMoveIds(Array.from(selected))}><FolderInput size={13} /> Mover ({selected.size})</Btn>
                    <Btn small variant="danger" onClick={removeSelected}><Trash2 size={13} /> Excluir ({selected.size})</Btn>
                  </>
                )}
              </div>
            )}

            <div className="mt-2 space-y-1">
              {activeDeck.cards.map((c) => (
                editingId === c.id ? (
                  <div key={c.id} className="rounded-lg border p-2 space-y-2" style={{ borderColor: COLORS.gold, background: COLORS.bg2 }}>
                    <RichTextEditor label="Frente" value={editForm.front} onChange={(v) => setEditForm((f) => ({ ...f, front: v }))} />
                    <RichTextEditor label="Verso" value={editForm.back} onChange={(v) => setEditForm((f) => ({ ...f, back: v }))} />
                    <div className="flex gap-2">
                      <Btn small onClick={saveEdit}><Check size={13} /> Salvar</Btn>
                      <Btn small variant="ghost" onClick={() => setEditingId(null)}>Cancelar</Btn>
                    </div>
                    <p className="text-[10px]" style={{ color: COLORS.sub }}>Editar mantém o progresso e a data de revisão do cartão.</p>
                  </div>
                ) : (
                  <div key={c.id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded" style={{ background: COLORS.bg2 }}>
                    {selectMode && (
                      <button onClick={() => toggleSelect(c.id)} title="Selecionar">
                        {selected.has(c.id) ? <CheckSquare size={14} style={{ color: COLORS.gold }} /> : <Square size={14} style={{ color: COLORS.sub }} />}
                      </button>
                    )}
                    <span className="flex-1 truncate">{cardPlain(c, "front") || "[imagem]"}</span>
                    <span className="text-[10px] font-mono" style={{ color: COLORS.sub }}>{cardStatusLabel(c)}</span>
                    <button onClick={() => startEdit(c)} title="Editar cartão"><Pencil size={12} style={{ color: COLORS.sub }} /></button>
                    <button onClick={() => setMoveIds([c.id])} title="Mover para outro baralho"><FolderInput size={12} style={{ color: COLORS.sub }} /></button>
                    <button onClick={() => removeCard(c.id)} title="Excluir cartão"><Trash2 size={12} style={{ color: COLORS.rose }} /></button>
                  </div>
                )
              ))}
            </div>
          </Card>

          {activeDeck.cards.length > 0 && (
            <Card className="flex flex-col items-center py-8" data-testid="study">
              <SectionTitle icon={Sparkles}>Modo estudo</SectionTitle>
              {current ? (
                <>
                  <p className="text-[11px] mb-2 font-mono" style={{ color: COLORS.sub }}>
                    {studyAll ? "Todos os cartões" : "Revisão de hoje"} · na fila: {queue.length} · revisados: {reviewed}
                  </p>
                  <div onClick={() => setFlipped((f) => !f)} className="w-full max-w-md min-h-[13rem] rounded-xl border-2 flex items-center justify-center text-center px-6 py-4 cursor-pointer select-none"
                    style={{ borderColor: COLORS.gold, background: COLORS.bg2 }}>
                    <RichFace className="font-display text-lg max-h-full overflow-auto" html={current.html} text={flipped ? current.back : current.front} />
                  </div>
                  <p className="text-[11px] mt-2" style={{ color: COLORS.sub }}>Toque no cartão para virar · {cardStatusLabel(current)}</p>
                  <div className="grid grid-cols-4 gap-2 mt-4 w-full max-w-md">
                    {[
                      { rating: RATING.AGAIN, key: "again", label: "De novo", variant: "danger" },
                      { rating: RATING.HARD, key: "hard", label: "Difícil", variant: "ghost" },
                      { rating: RATING.GOOD, key: "good", label: "Bom", variant: "solid" },
                      { rating: RATING.EASY, key: "easy", label: "Fácil", variant: "ghost" },
                    ].map((b) => (
                      <Btn key={b.key} variant={b.variant} onClick={() => markCard(b.rating)} className="flex-col justify-center !gap-0.5">
                        <span>{b.label}</span>
                        <span className="text-[10px] font-mono opacity-80">{previewIntervals(current)[b.key]}</span>
                      </Btn>
                    ))}
                  </div>
                  {undoInfo && <Btn onClick={undoLast} variant="ghost" small className="mt-3"><Undo2 size={13} /> Desfazer última resposta (Ctrl+Z)</Btn>}
                </>
              ) : (
                <div className="text-center">
                  <p className="text-sm mb-1" style={{ color: COLORS.teal }}>
                    {reviewed > 0 ? "Sessão concluída!" : "Nenhum cartão para revisar hoje."}
                  </p>
                  <p className="text-[11px] mb-3" style={{ color: COLORS.sub }}>
                    {reviewed > 0
                      ? "Os cartões voltam na data certa, conforme o agendamento de cada um."
                      : "Os cartões voltam na data da próxima revisão. Você também pode estudar tudo agora."}
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    {undoInfo && <Btn onClick={undoLast} variant="ghost" small><Undo2 size={13} /> Desfazer última resposta</Btn>}
                    <Btn onClick={() => startSession(activeDeck, true)} variant="ghost" small><RotateCcw size={13} /> Estudar todos os cartões</Btn>
                  </div>
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {moveIds && (
        <MoveCardsDialog decks={decks} fromDeckId={activeDeckId} count={moveIds.length}
          onMove={(targetId) => moveCards(moveIds, targetId)} onCreateAndMove={createAndMove} onClose={() => setMoveIds(null)} />
      )}

      <AnkiPanel decks={decks} setDecks={setDecks} activeDeck={activeDeck} />
    </div>
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function AnkiPanel({ decks, setDecks, activeDeck }) {
  const [scope, setScope] = useState("all");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [withHistory, setWithHistory] = useState(true);
  const fileRef = useRef(null);

  const useCurrent = scope === "current" && !!activeDeck;
  const target = useCurrent ? [activeDeck] : decks;
  const totalCards = target.reduce((n, d) => n + d.cards.length, 0);
  const stamp = new Date().toISOString().slice(0, 10);
  const baseName = useCurrent
    ? activeDeck.name.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "") || "baralho"
    : "todos-os-baralhos";

  const exportTxt = () => {
    if (!totalCards) { setStatus({ type: "err", text: "Não há cartões para exportar." }); return; }
    const text = buildAnkiText(target, { includeDeckColumn: !useCurrent });
    downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `anki-${baseName}-${stamp}.txt`);
    setStatus({ type: "ok", text: `${totalCards} cartão(ões) exportado(s) em texto. No Anki: Arquivo > Importar.` });
  };

  const exportApkg = async () => {
    if (!totalCards) { setStatus({ type: "err", text: "Não há cartões para exportar." }); return; }
    setBusy(true); setStatus(null);
    try {
      const blob = await buildApkgBlob(target.filter((d) => d.cards.length), { withHistory });
      downloadBlob(blob, `anki-${baseName}-${stamp}.apkg`);
      setStatus({ type: "ok", text: `${totalCards} cartão(ões) exportado(s) em .apkg${withHistory ? " com o progresso de revisão" : ""}. Abra o arquivo com o Anki (ou Arquivo > Importar).` });
    } catch (e) {
      setStatus({ type: "err", text: e.message || "Não foi possível gerar o .apkg." });
    } finally { setBusy(false); }
  };

  const finishImport = (cards, skipped, extra = "", withProgress = 0) => {
    if (!cards.length) { setStatus({ type: "err", text: "Nenhum cartão válido encontrado no arquivo." + extra }); return; }
    const merged = mergeImportedCards(decks, cards, uid);
    setDecks(merged.decks);
    const parts = [`${merged.added} cartão(ões) importado(s) em ${merged.deckCount} baralho(s)`];
    if (merged.dup) parts.push(`${merged.dup} repetido(s) ignorado(s)`);
    if (withProgress) parts.push(`${withProgress} com progresso de revisão preservado`);
    if (skipped) parts.push(`${skipped} sem frente/verso ignorado(s)`);
    setStatus({ type: "ok", text: parts.join(" · ") + "." + extra });
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true); setStatus(null);
    try {
      if (/\.(apkg|colpkg)$/i.test(file.name)) {
        const r = await parseApkgFile(file);
        finishImport(r.cards, r.skipped, " Imagens e áudios não são importados.", r.withProgress || 0);
      } else {
        const text = await file.text();
        const r = parseAnkiText(text, { defaultDeck: activeDeck?.name || file.name.replace(/\.[^.]+$/, "") });
        if (r.error) setStatus({ type: "err", text: r.error });
        else finishImport(r.cards, r.skipped);
      }
    } catch (err) {
      setStatus({ type: "err", text: err.message || "Falha ao importar o arquivo." });
    } finally { setBusy(false); }
  };

  const importPasted = () => {
    if (!pasteText.trim()) return;
    const r = parseAnkiText(pasteText, { defaultDeck: activeDeck?.name || "Importados" });
    if (r.error) { setStatus({ type: "err", text: r.error }); return; }
    finishImport(r.cards, r.skipped);
    if (r.cards.length) setPasteText("");
  };

  return (
    <Card>
      <SectionTitle icon={Download}>Importar e exportar (Anki)</SectionTitle>

      <p className="text-xs mb-2" style={{ color: COLORS.sub }}>Exportar</p>
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <Select value={useCurrent ? "current" : "all"} onChange={(e) => setScope(e.target.value)}>
          <option value="all">Todos os baralhos</option>
          <option value="current" disabled={!activeDeck}>Baralho selecionado{activeDeck ? ` (${activeDeck.name})` : ""}</option>
        </Select>
        <Btn onClick={exportTxt} small variant="ghost"><Download size={13} /> Texto (.txt)</Btn>
        <Btn onClick={exportApkg} small><Download size={13} /> Pacote Anki (.apkg)</Btn>
        <label className="flex items-center gap-1.5 text-[11px] cursor-pointer" style={{ color: COLORS.sub }}>
          <input type="checkbox" checked={withHistory} onChange={(e) => setWithHistory(e.target.checked)} />
          Incluir progresso de revisão (.apkg)
        </label>
      </div>
      <p className="text-[11px] mb-4" style={{ color: COLORS.sub }}>
        O .txt traz o nome do baralho em cada linha (ao exportar todos) e o .apkg já cria os baralhos no Anki. O .txt sempre leva só o texto; no .apkg, com a opção marcada, o Anki recebe o intervalo e a próxima revisão de cada cartão (o Anki recalcula o resto com o algoritmo dele); desmarcada, os cartões entram como novos.
      </p>

      <p className="text-xs mb-2" style={{ color: COLORS.sub }}>Importar</p>
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <Btn onClick={() => fileRef.current?.click()} small><Upload size={13} /> Escolher arquivo</Btn>
        <input ref={fileRef} type="file" accept=".txt,.csv,.tsv,.apkg,.colpkg,text/plain,text/csv" className="hidden" onChange={onFile} />
        {busy && <span className="text-xs animate-pulse" style={{ color: COLORS.sub }}>Processando…</span>}
      </div>
      <p className="text-[11px] mb-3" style={{ color: COLORS.sub }}>
        Aceita .apkg e .colpkg (baralhos completos, com o progresso de revisão) e texto/CSV/TSV exportados do Anki ou de planilhas (frente na 1ª coluna, verso na 2ª). Cartões repetidos são ignorados. Se for texto sem nome de baralho, vai para o baralho selecionado (ou para um novo com o nome do arquivo).
      </p>

      <p className="text-xs mb-2" style={{ color: COLORS.sub }}>Colar vários cartões de uma vez</p>
      <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={4}
        placeholder={"Uma linha por cartão: frente ; verso\nQual a capital do Brasil? ; Brasília"}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none border"
        style={{ background: COLORS.bg2, borderColor: COLORS.cardBorder, color: COLORS.text }} />
      <Btn onClick={importPasted} small className="mt-2"><Plus size={13} /> Importar texto colado</Btn>

      {status && (
        <p className="text-xs mt-3" style={{ color: status.type === "ok" ? COLORS.teal : COLORS.rose }}>{status.text}</p>
      )}
    </Card>
  );
}

/* ================= QUESTÕES (geração automática via API) ================= */
function Questoes({ giveXP }) {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);

  const checkAnswers = () => {
    setSubmitted(true);
    const correct = quiz.reduce((n, q, i) => n + (answers[i] === q.correctIndex ? 1 : 0), 0);
    if (giveXP) for (let i = 0; i < correct; i++) giveXP("questionRight");
  };

  const generate = async () => {
    if (!topic.trim()) return;
    setLoading(true); setError(""); setQuiz(null); setAnswers({}); setSubmitted(false);
    try {
      const response = await fetch("/.netlify/functions/generate-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      const parsed = await response.json();
      if (!response.ok) throw new Error(parsed.error || "Erro ao gerar questões.");
      setQuiz(parsed.questions || []);
    } catch (e) {
      setError(e.message.includes("GEMINI_API_KEY")
        ? "Configure sua chave da API do Gemini nas variáveis de ambiente do Netlify (GEMINI_API_KEY) para usar este recurso."
        : "Não foi possível gerar as questões agora. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const score = quiz && submitted ? quiz.reduce((acc, q, i) => acc + (answers[i] === q.correctIndex ? 1 : 0), 0) : 0;

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle icon={Brain}>Gerar questões automaticamente</SectionTitle>
        <div className="flex gap-2 flex-wrap">
          <Input placeholder="Tema (ex: Princípios da Administração Pública)" value={topic} onChange={(e) => setTopic(e.target.value)} className="flex-1 min-w-[220px]" />
          <Btn onClick={generate}><Sparkles size={14} /> {loading ? "Gerando..." : "Gerar 3 questões"}</Btn>
        </div>
        {error && <p className="text-xs mt-2" style={{ color: COLORS.rose }}>{error}</p>}
      </Card>

      {quiz && (
        <Card>
          <div className="space-y-5">
            {quiz.map((q, i) => (
              <div key={i}>
                <p className="text-sm font-medium mb-2">{i + 1}. {q.question}</p>
                <div className="space-y-1.5">
                  {q.options.map((opt, oi) => {
                    const isSelected = answers[i] === oi;
                    const isCorrect = submitted && oi === q.correctIndex;
                    const isWrong = submitted && isSelected && oi !== q.correctIndex;
                    return (
                      <button key={oi} disabled={submitted} onClick={() => setAnswers((a) => ({ ...a, [i]: oi }))}
                        className="w-full text-left px-3 py-2 rounded-lg text-sm border"
                        style={{
                          background: isCorrect ? COLORS.teal + "33" : isWrong ? COLORS.rose + "33" : isSelected ? COLORS.gold + "22" : COLORS.bg2,
                          borderColor: isCorrect ? COLORS.teal : isWrong ? COLORS.rose : isSelected ? COLORS.gold : COLORS.cardBorder,
                        }}>
                        {opt}
                      </button>
                    );
                  })}
                </div>
                {submitted && <p className="text-xs mt-1.5" style={{ color: COLORS.sub }}>{q.explanation}</p>}
              </div>
            ))}
            {!submitted ? (
              <Btn onClick={checkAnswers}><Check size={14} /> Corrigir</Btn>
            ) : (
              <p className="text-sm font-medium" style={{ color: COLORS.gold }}>Resultado: {score}/{quiz.length} acertos</p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ================= DESEMPENHO ================= */
function Desempenho({ subjects, estimate, exam, planSettings }) {
  const data = subjects.map((s) => {
    const total = s.subtopics.length || 1;
    const done = s.subtopics.filter((t) => t.done).length;
    const pct = Math.round((done / total) * 100);
    return { id: s.id, name: s.name || "(sem nome)", pct, fill: PRIORITY[s.priority].color, priority: s.priority, done, total };
  });

  const commentFor = (pct) => {
    if (pct >= 80) return "Excelente domínio — mantenha revisões espaçadas.";
    if (pct >= 50) return "Bom progresso — reforce os subtemas pendentes.";
    if (pct >= 20) return "Início do caminho — aumente a frequência desta matéria.";
    return "Atenção: praticamente sem avanço — priorize no cronograma.";
  };

  const overall = estimate.overall;
  const finished = overall.days === 0;
  let headline;
  if (!subjects.length) headline = "Cadastre matérias para calcular";
  else if (finished) headline = "Tudo concluído!";
  else if (estimate.noCapacity) headline = "Cadastre horários no cronograma semanal";
  else if (estimate.over || overall.days == null) headline = `Mais de ${Math.round(MAX_DAYS / 365)} anos`;
  else headline = fmtSpan(overall.days);

  let examMsg = null;
  if (exam && !finished && !estimate.noCapacity) {
    const when = `${fmtDate(exam.date)} (em ${exam.daysToExam} ${exam.daysToExam === 1 ? "dia" : "dias"})`;
    if (exam.marginDays == null) {
      examMsg = { ok: false, text: `Prova em ${when}. No ritmo atual você não termina o conteúdo a tempo.` };
    } else if (exam.marginDays >= 0) {
      examMsg = { ok: true, text: `Prova em ${when}. Pelo ritmo atual você termina ${exam.marginDays} ${exam.marginDays === 1 ? "dia" : "dias"} antes, sobrando tempo para revisão.` };
    } else {
      const need = exam.neededWeeklyHours != null ? ` Para terminar até a prova seriam necessárias cerca de ${fmtH(exam.neededWeeklyHours)} por semana (hoje: ${fmtH(estimate.weeklyHours)}).` : "";
      examMsg = { ok: false, text: `Prova em ${when}. No ritmo atual você termina ${-exam.marginDays} ${-exam.marginDays === 1 ? "dia" : "dias"} depois dela.${need}` };
    }
  } else if (exam && finished) {
    examMsg = { ok: true, text: `Prova em ${fmtDate(exam.date)} (em ${exam.daysToExam} ${exam.daysToExam === 1 ? "dia" : "dias"}). Conteúdo concluído: foque em revisão e questões.` };
  }

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle icon={Hourglass}>Estimativa para concluir os estudos</SectionTitle>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div>
            <div className="font-display text-3xl" style={{ color: COLORS.gold }}>{headline}</div>
            {overall.date && overall.days > 0 && (
              <div className="text-xs font-mono" style={{ color: COLORS.sub }}>término previsto em {fmtDate(overall.date)}</div>
            )}
          </div>
          <div className="flex gap-5 text-xs" style={{ color: COLORS.sub }}>
            <div><div className="font-mono text-sm" style={{ color: COLORS.text }}>{fmtH(estimate.totalPending)}</div>pendentes</div>
            <div><div className="font-mono text-sm" style={{ color: COLORS.text }}>{fmtH(estimate.weeklyHours)}</div>por semana</div>
          </div>
        </div>
        {examMsg && (
          <p className="text-xs mt-3" style={{ color: examMsg.ok ? COLORS.teal : COLORS.rose }}>{examMsg.text}</p>
        )}
        <p className="text-[11px] mt-3" style={{ color: COLORS.sub }}>
          Como é calculado: horas pendentes das submatérias (padrão de {fmtH(planSettings.defaultHours)} cada, ajustável na edição da matéria) divididas pelas horas dos seus horários semanais, contando a partir de hoje. As horas de cada dia são repartidas entre as matérias por prioridade × dificuldade, e quando uma termina as horas dela passam para as outras.
        </p>
      </Card>

      <Card>
        <SectionTitle icon={BarChart3}>Desempenho por matéria</SectionTitle>
        {!data.length && <p className="text-xs" style={{ color: COLORS.sub }}>Cadastre matérias no Cronograma para ver seu desempenho.</p>}
        <div className="grid sm:grid-cols-2 gap-4">
          {data.map((d) => {
            const est = estimate.perSubject[d.id];
            return (
              <div key={d.id} className="rounded-lg p-3" style={{ background: COLORS.bg2 }}>
                <div style={{ width: "100%", height: 160 }}>
                  <ResponsiveContainer>
                    <RadialBarChart innerRadius="65%" outerRadius="100%" data={[d]} startAngle={90} endAngle={-270}>
                      <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                      <RadialBar background={{ fill: COLORS.cardBorder }} dataKey="pct" cornerRadius={8} fill={d.fill} />
                    </RadialBarChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-center -mt-24 mb-16">
                  <span className="font-display text-2xl">{d.pct}%</span>
                </div>
                <p className="text-sm font-medium text-center">{d.name}</p>
                <p className="text-[11px] text-center font-mono" style={{ color: COLORS.sub }}>{d.done}/{d.total} subtemas concluídos</p>
                {est && (
                  <p className="text-[11px] text-center font-mono mt-1" style={{ color: COLORS.gold }}>
                    {est.days === 0
                      ? "Matéria concluída"
                      : `Faltam ${fmtH(est.pendingHours)}${estimate.noCapacity ? "" : ` · ${estimateLabel(est, estimate.noCapacity, estimate.over)}${est.date ? ` (até ${fmtDate(est.date)})` : ""}`}`}
                  </p>
                )}
                <p className="text-[11px] text-center mt-1.5" style={{ color: d.fill }}>{commentFor(d.pct)}</p>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

/* ================= DICAS ================= */
const TIPS = [
  { title: "Leitura dinâmica", text: "Evite subvocalizar (repetir as palavras mentalmente). Use o dedo ou o cursor como guia para acelerar o movimento dos olhos e reduza regressões (voltar a ler trechos já lidos)." },
  { title: "Recordação ativa (active recall)", text: "Em vez de reler o material, feche o livro e tente reconstruir o conteúdo de memória. Use os flashcards deste app logo após estudar um tema novo." },
  { title: "Repetição espaçada", text: "Revise um assunto em intervalos crescentes (1 dia, 3 dias, 7 dias, 15 dias). Isso combate a curva do esquecimento muito melhor que reler tudo de uma vez." },
  { title: "Técnica Pomodoro", text: "Blocos de 25 minutos de foco total, sem celular por perto, seguidos de 5 minutos de pausa. A cada 4 ciclos, uma pausa mais longa de 15–20 minutos." },
  { title: "Mapas mentais", text: "Para matérias muito conceituais (Direito, Administração), transforme o texto em diagramas com hierarquia visual — isso ajuda a memorizar relações entre institutos." },
  { title: "Simulados cronometrados", text: "Faça simulados sob o tempo real da prova pelo menos uma vez por semana na reta final, para treinar gestão de tempo e ansiedade." },
  { title: "Regra dos 2 minutos para revisão", text: "Ao errar uma questão, não apenas leia o gabarito — escreva em uma frase por que errou (falta de conteúdo, pegadinha, desatenção) para identificar seu padrão de erro." },
];
function Dicas() {
  return (
    <div className="space-y-3">
      {TIPS.map((t) => (
        <Card key={t.title}>
          <div className="flex gap-3">
            <Lightbulb size={18} style={{ color: COLORS.gold }} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm mb-1">{t.title}</p>
              <p className="text-xs" style={{ color: COLORS.sub }}>{t.text}</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ================= CONCURSOS (acompanhamento manual) ================= */
function Concursos({ giveXP }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ orgao: "", abrangencia: "federal", estado: "", municipio: "", status: "aguardando edital", link: "", provaEm: "" });
  const [loadedFlag, setLoadedFlag] = useState(false);

  useEffect(() => { (async () => setItems(await loadKey("concursos", [])))().finally(() => setLoadedFlag(true)); }, []);
  useEffect(() => { if (loadedFlag) saveKey("concursos", items); }, [items, loadedFlag]);

  const [filtroEstado, setFiltroEstado] = useState("todos");
  const add = () => {
    if (!form.orgao.trim()) return;
    setItems((prev) => [...prev, { id: uid(), ...form }]);
    if (giveXP) giveXP("misc", { concursosCount: items.length + 1 });
    setForm({ orgao: "", abrangencia: "federal", estado: "", municipio: "", status: "aguardando edital", link: "", provaEm: "" });
  };
  const remove = (id) => setItems((prev) => prev.filter((i) => i.id !== id));

  const estados = ["todos", ...Array.from(new Set(items.map((i) => i.estado).filter(Boolean)))];
  const filtered = items.filter((i) => filtroEstado === "todos" || i.estado === filtroEstado || i.abrangencia === "federal");

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle icon={Newspaper}>Concursos acompanhados</SectionTitle>
        <p className="text-[11px] mb-3" style={{ color: COLORS.sub }}>
          Este app não acessa a internet sozinho, então não monitora editais em tempo real por conta própria. Cadastre aqui os concursos que você já está de olho, e a qualquer momento me peça no chat, por exemplo: "busque editais abertos em SP e nos federais" — eu pesquiso agora e você traz o resultado para cá.
        </p>
        <div className="grid sm:grid-cols-2 gap-2">
          <Input placeholder="Órgão / instituição" value={form.orgao} onChange={(e) => setForm({ ...form, orgao: e.target.value })} />
          <Select value={form.abrangencia} onChange={(e) => setForm({ ...form, abrangencia: e.target.value })}>
            <option value="federal">Federal</option>
            <option value="estadual">Estadual</option>
            <option value="municipal">Municipal</option>
          </Select>
          {form.abrangencia !== "federal" && <Input placeholder="Estado (UF)" value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value.toUpperCase() })} />}
          {form.abrangencia === "municipal" && <Input placeholder="Município" value={form.municipio} onChange={(e) => setForm({ ...form, municipio: e.target.value })} />}
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option>aguardando edital</option>
            <option>edital publicado</option>
            <option>inscrições abertas</option>
            <option>prova marcada</option>
            <option>encerrado</option>
          </Select>
          <Input type="date" placeholder="Data da prova" value={form.provaEm} onChange={(e) => setForm({ ...form, provaEm: e.target.value })} />
          <Input placeholder="Link do edital" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} className="sm:col-span-2" />
        </div>
        <Btn onClick={add} className="mt-2"><Plus size={14} /> Adicionar concurso</Btn>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <SectionTitle icon={Newspaper}>Meus concursos</SectionTitle>
          <Select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
            {estados.map((e) => <option key={e} value={e}>{e === "todos" ? "Todos + federais" : e}</option>)}
          </Select>
        </div>
        <div className="space-y-2">
          {filtered.map((i) => (
            <div key={i.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg" style={{ background: COLORS.bg2 }}>
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{i.orgao} <span className="text-[10px] font-mono uppercase" style={{ color: COLORS.gold }}>{i.abrangencia}{i.estado ? ` · ${i.estado}` : ""}{i.municipio ? ` · ${i.municipio}` : ""}</span></div>
                <div className="text-[11px]" style={{ color: COLORS.sub }}>{i.status}{i.provaEm ? ` · prova em ${i.provaEm}` : ""}</div>
              </div>
              <button onClick={() => remove(i.id)}><Trash2 size={14} style={{ color: COLORS.rose }} /></button>
            </div>
          ))}
          {!filtered.length && <p className="text-xs" style={{ color: COLORS.sub }}>Nenhum concurso cadastrado com esse filtro.</p>}
        </div>
      </Card>
    </div>
  );
}
