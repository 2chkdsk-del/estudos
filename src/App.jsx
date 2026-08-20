import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Plus, Trash2, Check, X, Clock, Calendar as CalendarIcon, Play, Pause,
  RotateCcw, BookOpen, Brain, BarChart3, Lightbulb, Newspaper, Bell,
  ChevronLeft, ChevronRight, Shuffle, Flame, Star, CircleDot, Sparkles,
  Volume2, Award, Layers, ClipboardList, Wand2, Download, Upload
} from "lucide-react";
import {
  RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer, Legend
} from "recharts";

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
const DATA_KEYS = ["subjects", "schedule", "agenda", "decks", "pomo-settings", "concursos"];

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
   AUDIO — subtle bell chime (Web Audio API, no assets needed)
----------------------------------------------------------------*/
function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.18);
      gain.gain.linearRampToValueAtTime(0.12, now + i * 0.18 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 1.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 1.2);
    });
  } catch (e) { /* audio unavailable */ }
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

  useEffect(() => {
    (async () => {
      const [s, sc, ag, dk, ps] = await Promise.all([
        loadKey("subjects", null),
        loadKey("schedule", null),
        loadKey("agenda", []),
        loadKey("decks", []),
        loadKey("pomo-settings", null),
      ]);
      setSubjects(s || seedSubjects());
      setSchedule(sc || (() => { const o = {}; DAYS.forEach((d) => (o[d.key] = [])); return o; })());
      setAgenda(ag || []);
      setDecks(dk || []);
      setPomoSettings(ps || { work: 25, short: 5, long: 15, cyclesUntilLong: 4 });
      setLoaded(true);
    })();
  }, []);

  useEffect(() => { if (loaded) saveKey("subjects", subjects); }, [subjects, loaded]);
  useEffect(() => { if (loaded) saveKey("schedule", schedule); }, [schedule, loaded]);
  useEffect(() => { if (loaded) saveKey("agenda", agenda); }, [agenda, loaded]);
  useEffect(() => { if (loaded) saveKey("decks", decks); }, [decks, loaded]);
  useEffect(() => { if (loaded) saveKey("pomo-settings", pomoSettings); }, [pomoSettings, loaded]);

  const tabs = [
    { key: "cronograma", label: "Cronograma", icon: ClipboardList },
    { key: "agenda", label: "Agenda", icon: CalendarIcon },
    { key: "pomodoro", label: "Pomodoro", icon: Clock },
    { key: "flashcards", label: "Flashcards", icon: Layers },
    { key: "questoes", label: "Questões", icon: Brain },
    { key: "desempenho", label: "Desempenho", icon: BarChart3 },
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
      <Header />
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
          <Cronograma subjects={subjects} setSubjects={setSubjects} schedule={schedule} setSchedule={setSchedule} />
        )}
        {tab === "agenda" && <Agenda agenda={agenda} setAgenda={setAgenda} />}
        {tab === "pomodoro" && <Pomodoro settings={pomoSettings} setSettings={setPomoSettings} />}
        {tab === "flashcards" && <Flashcards decks={decks} setDecks={setDecks} />}
        {tab === "questoes" && <Questoes />}
        {tab === "desempenho" && <Desempenho subjects={subjects} />}
        {tab === "dicas" && <Dicas />}
        {tab === "concursos" && <Concursos />}
      </main>
    </div>
  );
}

function Header() {
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
        <div className="flex items-center gap-2">
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
function Cronograma({ subjects, setSubjects, schedule, setSchedule }) {
  const [activeDay, setActiveDay] = useState("seg");
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
            return (
              <div key={s.id} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: COLORS.bg2 }}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PRIORITY[s.priority].color }} />
                <span className="text-sm flex-1 truncate">{s.name}</span>
                <span className="text-[10px] font-mono" style={{ color: COLORS.sub }}>{doneCount}/{s.subtopics.length} · dif. {s.difficulty}</span>
                <button onClick={() => removeSubject(s.id)}><Trash2 size={14} style={{ color: COLORS.rose }} /></button>
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
function Pomodoro({ settings, setSettings }) {
  const [mode, setMode] = useState("work"); // work | short | long
  const [secondsLeft, setSecondsLeft] = useState(settings.work * 60);
  const [running, setRunning] = useState(false);
  const [cycles, setCycles] = useState(0);
  const intervalRef = useRef(null);

  useEffect(() => { if (!running) setSecondsLeft(settings[mode === "work" ? "work" : mode] * 60); }, [settings, mode]); // eslint-disable-line

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) {
            clearInterval(intervalRef.current);
            playChime();
            setRunning(false);
            if (mode === "work") {
              const nextCycles = cycles + 1;
              setCycles(nextCycles);
              const nextMode = nextCycles % settings.cyclesUntilLong === 0 ? "long" : "short";
              setMode(nextMode);
              return settings[nextMode] * 60;
            } else {
              setMode("work");
              return settings.work * 60;
            }
          }
          return s - 1;
        });
      }, 1000);
    }
    return () => clearInterval(intervalRef.current);
  }, [running]); // eslint-disable-line

  const total = settings[mode] * 60;
  const pct = Math.max(0, Math.min(100, ((total - secondsLeft) / total) * 100));
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const modeLabel = { work: "Foco", short: "Pausa curta", long: "Pausa longa" }[mode];
  const modeColor = { work: COLORS.rose, short: COLORS.teal, long: COLORS.gold }[mode];

  const reset = () => { setRunning(false); setSecondsLeft(settings[mode] * 60); };
  const switchMode = (m) => { setRunning(false); setMode(m); setSecondsLeft(settings[m] * 60); };

  return (
    <div className="space-y-5">
      <Card className="flex flex-col items-center py-8">
        <div className="flex gap-2 mb-6">
          {["work", "short", "long"].map((m) => (
            <button key={m} onClick={() => switchMode(m)} className="px-3 py-1 rounded-full text-xs font-medium"
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
            <span className="font-mono text-4xl">{mm}:{ss}</span>
            <span className="text-[10px] uppercase tracking-widest mt-1" style={{ color: modeColor }}>{modeLabel}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-6">
          <Btn onClick={() => setRunning((r) => !r)}>{running ? <Pause size={15} /> : <Play size={15} />} {running ? "Pausar" : "Iniciar"}</Btn>
          <Btn onClick={reset} variant="ghost"><RotateCcw size={15} /> Reiniciar</Btn>
        </div>
        <div className="flex items-center gap-1.5 mt-3 text-xs" style={{ color: COLORS.sub }}>
          <Flame size={13} style={{ color: COLORS.gold }} /> {cycles} ciclo(s) de foco concluído(s) hoje
        </div>
        <div className="flex items-center gap-1 mt-1 text-[11px]" style={{ color: COLORS.sub }}><Volume2 size={11} /> Som suave ao concluir o tempo</div>
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
function Flashcards({ decks, setDecks }) {
  const [deckName, setDeckName] = useState("");
  const [activeDeckId, setActiveDeckId] = useState(null);
  const [form, setForm] = useState({ front: "", back: "" });
  const [studyIndex, setStudyIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const activeDeck = decks.find((d) => d.id === activeDeckId);

  const addDeck = () => {
    if (!deckName.trim()) return;
    const d = { id: uid(), name: deckName.trim(), cards: [] };
    setDecks((prev) => [...prev, d]);
    setDeckName("");
    setActiveDeckId(d.id);
  };
  const removeDeck = (id) => { setDecks((prev) => prev.filter((d) => d.id !== id)); if (activeDeckId === id) setActiveDeckId(null); };
  const addCard = () => {
    if (!form.front.trim() || !form.back.trim() || !activeDeckId) return;
    setDecks((prev) => prev.map((d) => d.id === activeDeckId ? { ...d, cards: [...d.cards, { id: uid(), front: form.front, back: form.back, box: 1 }] } : d));
    setForm({ front: "", back: "" });
  };
  const removeCard = (cardId) => setDecks((prev) => prev.map((d) => d.id === activeDeckId ? { ...d, cards: d.cards.filter((c) => c.id !== cardId) } : d));
  const markCard = (know) => {
    setDecks((prev) => prev.map((d) => d.id === activeDeckId ? { ...d, cards: d.cards.map((c, i) => i === studyIndex ? { ...c, box: know ? Math.min(3, c.box + 1) : 1 } : c) } : d));
    setFlipped(false);
    setStudyIndex((i) => (i + 1) % Math.max(1, activeDeck.cards.length));
  };

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle icon={Layers}>Baralhos</SectionTitle>
        <div className="flex gap-2 mb-3">
          <Input placeholder="Nome do baralho (ex: Direito Administrativo)" value={deckName} onChange={(e) => setDeckName(e.target.value)} className="flex-1" />
          <Btn onClick={addDeck}><Plus size={14} /> Criar</Btn>
        </div>
        <div className="flex flex-wrap gap-2">
          {decks.map((d) => (
            <div key={d.id} className="flex items-center gap-1.5">
              <button onClick={() => { setActiveDeckId(d.id); setStudyIndex(0); setFlipped(false); }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: activeDeckId === d.id ? COLORS.teal : COLORS.bg2, color: activeDeckId === d.id ? "#0B121D" : COLORS.sub }}>
                {d.name} ({d.cards.length})
              </button>
              <button onClick={() => removeDeck(d.id)}><Trash2 size={12} style={{ color: COLORS.rose }} /></button>
            </div>
          ))}
          {!decks.length && <p className="text-xs" style={{ color: COLORS.sub }}>Crie seu primeiro baralho para começar.</p>}
        </div>
      </Card>

      {activeDeck && (
        <>
          <Card>
            <SectionTitle icon={Plus}>Novo cartão em "{activeDeck.name}"</SectionTitle>
            <div className="grid sm:grid-cols-2 gap-2">
              <Input placeholder="Frente (pergunta)" value={form.front} onChange={(e) => setForm({ ...form, front: e.target.value })} />
              <Input placeholder="Verso (resposta)" value={form.back} onChange={(e) => setForm({ ...form, back: e.target.value })} />
            </div>
            <Btn onClick={addCard} className="mt-2"><Check size={14} /> Adicionar cartão</Btn>
            <div className="mt-3 space-y-1">
              {activeDeck.cards.map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded" style={{ background: COLORS.bg2 }}>
                  <span className="flex-1 truncate">{c.front}</span>
                  <button onClick={() => removeCard(c.id)}><Trash2 size={12} style={{ color: COLORS.rose }} /></button>
                </div>
              ))}
            </div>
          </Card>

          {activeDeck.cards.length > 0 && (
            <Card className="flex flex-col items-center py-8">
              <SectionTitle icon={Sparkles}>Modo estudo</SectionTitle>
              <div onClick={() => setFlipped((f) => !f)} className="w-full max-w-md h-52 rounded-xl border-2 flex items-center justify-center text-center px-6 cursor-pointer select-none"
                style={{ borderColor: COLORS.gold, background: COLORS.bg2 }}>
                <p className="font-display text-lg">{flipped ? activeDeck.cards[studyIndex % activeDeck.cards.length].back : activeDeck.cards[studyIndex % activeDeck.cards.length].front}</p>
              </div>
              <p className="text-[11px] mt-2" style={{ color: COLORS.sub }}>Toque no cartão para virar</p>
              <div className="flex items-center gap-3 mt-4">
                <Btn onClick={() => markCard(false)} variant="danger"><X size={14} /> Não sabia</Btn>
                <Btn onClick={() => markCard(true)}><Check size={14} /> Sabia</Btn>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/* ================= QUESTÕES (geração automática via API) ================= */
function Questoes() {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);

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
              <Btn onClick={() => setSubmitted(true)}><Check size={14} /> Corrigir</Btn>
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
function Desempenho({ subjects }) {
  const data = subjects.map((s) => {
    const total = s.subtopics.length || 1;
    const done = s.subtopics.filter((t) => t.done).length;
    const pct = Math.round((done / total) * 100);
    return { name: s.name, pct, fill: PRIORITY[s.priority].color, priority: s.priority, done, total };
  });

  const commentFor = (pct) => {
    if (pct >= 80) return "Excelente domínio — mantenha revisões espaçadas.";
    if (pct >= 50) return "Bom progresso — reforce os subtemas pendentes.";
    if (pct >= 20) return "Início do caminho — aumente a frequência desta matéria.";
    return "Atenção: praticamente sem avanço — priorize no cronograma.";
  };

  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle icon={BarChart3}>Desempenho por matéria</SectionTitle>
        {!data.length && <p className="text-xs" style={{ color: COLORS.sub }}>Cadastre matérias no Cronograma para ver seu desempenho.</p>}
        <div className="grid sm:grid-cols-2 gap-4">
          {data.map((d) => (
            <div key={d.name} className="rounded-lg p-3" style={{ background: COLORS.bg2 }}>
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
              <p className="text-[11px] text-center mt-1.5" style={{ color: d.fill }}>{commentFor(d.pct)}</p>
            </div>
          ))}
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
function Concursos() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ orgao: "", abrangencia: "federal", estado: "", municipio: "", status: "aguardando edital", link: "", provaEm: "" });
  const [loadedFlag, setLoadedFlag] = useState(false);

  useEffect(() => { (async () => setItems(await loadKey("concursos", [])))().finally(() => setLoadedFlag(true)); }, []);
  useEffect(() => { if (loadedFlag) saveKey("concursos", items); }, [items, loadedFlag]);

  const [filtroEstado, setFiltroEstado] = useState("todos");
  const add = () => {
    if (!form.orgao.trim()) return;
    setItems((prev) => [...prev, { id: uid(), ...form }]);
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
