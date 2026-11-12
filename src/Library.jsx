import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen, Trash2, Search, FileText, NotebookPen,
  StickyNote, Upload, ArrowLeft, ExternalLink, Download, Tag,
  ArrowUp, ArrowDown, Pin, PinOff, ListChecks, Square, CheckSquare,
  X, Highlighter, Type, Eraser, Undo2, ZoomIn, ZoomOut,
} from "lucide-react";
import RichTextEditor from "./RichTextEditor.jsx";
import { htmlToPlainText } from "./richText.js";
import { savePdf, getPdf, deletePdf, dataUrlToBlobUrl } from "./libraryStore.js";
import { loadPdfDocument, renderPdfPage, getTextItems } from "./pdfRenderer.js";

const COLORS = {
  bg: "#0F1826", bg2: "#0B121D", card: "#16233A", cardBorder: "#233350",
  text: "#EDEFF2", sub: "#93A2BA", gold: "#C9A24B", rose: "#D6685C", teal: "#3FA796",
};

const HIGHLIGHT_COLORS = [
  { key: "yellow", value: "#FFEB3B" },
  { key: "green",  value: "#4CAF50" },
  { key: "pink",   value: "#E91E63" },
  { key: "blue",   value: "#3FA7E7" },
];

const STORAGE_PREFIX = "plano-estudos:";
const META_KEY = "library-meta";
const NO_TOPIC_KEY = "__sem_topico__";
const uid = () => Math.random().toString(36).slice(2, 10);

const KIND = {
  pdf:     { label: "PDF",       icon: FileText,    color: COLORS.rose },
  resumo:  { label: "Resumo",    icon: NotebookPen, color: COLORS.teal },
  nota:    { label: "Anotação",  icon: StickyNote,  color: COLORS.gold },
};

async function loadMeta() {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${META_KEY}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
async function saveMeta(items) {
  try { window.localStorage.setItem(`${STORAGE_PREFIX}${META_KEY}`, JSON.stringify(items)); }
  catch (e) { console.error("library meta save failed", e); }
}

function sortByOrder(items) {
  return [...items].sort((a, b) => {
    const pa = a.pinned ? 1 : 0;
    const pb = b.pinned ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const oa = typeof a.order === "number" ? a.order : Number.MAX_SAFE_INTEGER;
    const ob = typeof b.order === "number" ? b.order : Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}
function reindexSection(allItems, sectionItems) {
  const byId = new Map();
  sectionItems.forEach((it, i) => { byId.set(it.id, { ...it, order: i }); });
  return allItems.map((it) => (byId.has(it.id) ? byId.get(it.id) : it));
}

export default function Library({ subjects = [] }) {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [filterKind, setFilterKind] = useState("todos");
  const [filterSubject, setFilterSubject] = useState("todos");
  const [filterTopic, setFilterTopic] = useState("todos");
  const [openId, setOpenId] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const fileRef = useRef(null);

  useEffect(() => {
    (async () => {
      const meta = await loadMeta();
      setItems(meta);
      setLoaded(true);
    })();
  }, []);
  useEffect(() => { if (loaded) saveMeta(items); }, [items, loaded]);

  const subjectName = (id) => (subjects.find((s) => s.id === id) || {}).name || "";
  const allTopics = useMemo(() => {
    const set = new Set();
    items.forEach((it) => { if (it.topic && it.topic.trim()) set.add(it.topic.trim()); });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [items]);

  const suggestionsFor = (item) => {
    const set = new Set(allTopics);
    if (item?.subjectId) {
      const subj = subjects.find((s) => s.id === item.subjectId);
      (subj?.subtopics || []).forEach((t) => { if (t.name) set.add(t.name); });
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((it) => filterKind === "todos" || it.kind === filterKind)
      .filter((it) => filterSubject === "todos" || it.subjectId === filterSubject)
      .filter((it) => {
        if (filterTopic === "todos") return true;
        if (filterTopic === NO_TOPIC_KEY) return !it.topic || !it.topic.trim();
        return (it.topic || "").trim() === filterTopic;
      })
      .filter((it) => {
        if (!q) return true;
        const hay = [
          it.title, it.topic, it.subjectId ? subjectName(it.subjectId) : "",
          it.kind === "pdf" ? it.fileName : htmlToPlainText(it.body || ""),
        ].join(" ").toLowerCase();
        return hay.includes(q);
      });
  }, [items, query, filterKind, filterSubject, filterTopic, subjects]);

  const groups = useMemo(() => {
    const map = new Map();
    filtered.forEach((it) => {
      const key = (it.topic || "").trim() || NO_TOPIC_KEY;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    });
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === NO_TOPIC_KEY) return 1;
      if (b === NO_TOPIC_KEY) return -1;
      return a.localeCompare(b, "pt-BR");
    });
    return keys.map((key) => ({
      key,
      label: key === NO_TOPIC_KEY ? "Sem tópico" : key,
      items: sortByOrder(map.get(key)),
    }));
  }, [filtered]);

  const openItem = items.find((it) => it.id === openId);
  const selectedCount = selected.size;
  const clearSelection = () => setSelected(new Set());
  const toggleSelected = (id) => setSelected((prev) => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });
  const selectAllInGroup = (group) => setSelected((prev) => {
    const n = new Set(prev);
    const allSelected = group.items.every((it) => n.has(it.id));
    if (allSelected) group.items.forEach((it) => n.delete(it.id));
    else group.items.forEach((it) => n.add(it.id));
    return n;
  });

  const onPickPdf = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const stored = await savePdf(file);
      const maxOrder = items.reduce((n, it) => Math.max(n, typeof it.order === "number" ? it.order : -1), -1);
      const item = {
        id: uid(), kind: "pdf", pdfId: stored.id,
        fileName: stored.name, fileSize: stored.size,
        title: stored.name.replace(/\.pdf$/i, ""),
        subjectId: null, topic: "", order: maxOrder + 1, pinned: false,
        body: "", annotations: [],
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      setItems((prev) => [item, ...prev]);
      setOpenId(item.id);
    } catch (err) { alert(err.message || "Não foi possível salvar o PDF."); }
  };

  const createNote = (kind) => {
    const now = Date.now();
    const maxOrder = items.reduce((n, it) => Math.max(n, typeof it.order === "number" ? it.order : -1), -1);
    const item = {
      id: uid(), kind, title: kind === "resumo" ? "Novo resumo" : "Nova anotação",
      subjectId: null, topic: "", order: maxOrder + 1, pinned: false,
      body: "", annotations: [],
      createdAt: now, updatedAt: now,
    };
    setItems((prev) => [item, ...prev]);
    setOpenId(item.id);
  };

  const updateItem = (id, patch) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch, updatedAt: Date.now() } : it)));
  };

  const removeItem = async (id) => {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    const label = it.title || it.fileName || "este item";
    if (!window.confirm(`Excluir "${label}"? Esta ação não pode ser desfeita.`)) return;
    if (it.kind === "pdf" && it.pdfId) { try { await deletePdf(it.pdfId); } catch { /* ignora */ } }
    setItems((prev) => prev.filter((x) => x.id !== id));
    if (openId === id) setOpenId(null);
  };

  const moveInSection = (sectionKey, itemId, direction) => {
    const group = groups.find((g) => g.key === sectionKey);
    if (!group) return;
    const list = [...group.items];
    const idx = list.findIndex((it) => it.id === itemId);
    if (idx === -1) return;
    const swap = direction === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= list.length) return;
    [list[idx], list[swap]] = [list[swap], list[idx]];
    setItems((prev) => reindexSection(prev, list));
  };
  const togglePin = (itemId) => {
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, pinned: !it.pinned, updatedAt: Date.now() } : it)));
  };

  const bulkMoveToTopic = (targetTopicRaw) => {
    if (!selectedCount) return;
    const target = String(targetTopicRaw || "").trim();
    const ids = new Set(selected);
    setItems((prev) => {
      const destMax = prev.reduce((n, it) => {
        const t = (it.topic || "").trim();
        if (t === target && typeof it.order === "number") return Math.max(n, it.order);
        return n;
      }, -1);
      let next = destMax + 1;
      return prev.map((it) => ids.has(it.id) ? { ...it, topic: target, order: next++, updatedAt: Date.now() } : it);
    });
    clearSelection();
  };
  const bulkSetPin = (pinned) => {
    if (!selectedCount) return;
    const ids = new Set(selected);
    setItems((prev) => prev.map((it) => (ids.has(it.id) ? { ...it, pinned, updatedAt: Date.now() } : it)));
    clearSelection();
  };
  const bulkDelete = async () => {
    if (!selectedCount) return;
    const list = items.filter((it) => selected.has(it.id));
    if (!window.confirm(`Excluir ${list.length} ${list.length === 1 ? "item" : "itens"}? Esta ação não pode ser desfeita.`)) return;
    for (const it of list) {
      if (it.kind === "pdf" && it.pdfId) { try { await deletePdf(it.pdfId); } catch { /* ignora */ } }
    }
    setItems((prev) => prev.filter((it) => !selected.has(it.id)));
    clearSelection();
    if (list.some((it) => it.id === openId)) setOpenId(null);
  };

  if (!loaded) {
    return <div className="flex items-center justify-center py-20 text-sm" style={{ color: COLORS.sub }}>Carregando biblioteca…</div>;
  }
  if (openItem) {
    return (
      <ItemDetail
        item={openItem}
        subjects={subjects}
        topicSuggestions={suggestionsFor(openItem)}
        onBack={() => setOpenId(null)}
        onChange={(patch) => updateItem(openItem.id, patch)}
        onDelete={() => removeItem(openItem.id)}
      />
    );
  }

  const topicOptions = [...allTopics];
  const barVisible = selectMode || selectedCount > 0;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border p-4" style={{ background: COLORS.card, borderColor: COLORS.cardBorder }}>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <BookOpen size={18} style={{ color: COLORS.gold }} />
          <h2 className="font-display text-xl">Biblioteca</h2>
          <span className="text-[11px] font-mono" style={{ color: COLORS.sub }}>
            {items.length} {items.length === 1 ? "item" : "itens"}
          </span>
          <div className="flex-1" />
          <button
            onClick={() => { setSelectMode((v) => !v); clearSelection(); }}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium"
            style={{
              border: `1px solid ${selectMode ? COLORS.gold : COLORS.cardBorder}`,
              background: selectMode ? COLORS.gold + "22" : "transparent",
              color: selectMode ? COLORS.gold : COLORS.sub,
            }}>
            <ListChecks size={13} /> {selectMode ? "Sair da seleção" : "Selecionar"}
          </button>
          <button onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium"
            style={{ background: COLORS.gold, color: "#12203A" }} title="Enviar um PDF">
            <Upload size={13} /> Enviar PDF
          </button>
          <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={onPickPdf} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg px-3 py-2 flex-1 min-w-[200px]" style={{ background: COLORS.bg2, border: `1px solid ${COLORS.cardBorder}` }}>
            <Search size={13} style={{ color: COLORS.sub }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por título, tópico, matéria ou conteúdo…"
              className="bg-transparent outline-none text-sm flex-1"
              style={{ color: COLORS.text }} />
          </div>
          <select value={filterKind} onChange={(e) => setFilterKind(e.target.value)}
            className="rounded-lg px-3 py-2 text-sm outline-none border"
            style={{ background: COLORS.bg2, borderColor: COLORS.cardBorder, color: COLORS.text }}>
            <option value="todos">Todos os tipos</option>
            <option value="pdf">PDFs</option>
            <option value="resumo">Resumos</option>
            <option value="nota">Anotações</option>
          </select>
          <select value={filterSubject} onChange={(e) => setFilterSubject(e.target.value)}
            className="rounded-lg px-3 py-2 text-sm outline-none border"
            style={{ background: COLORS.bg2, borderColor: COLORS.cardBorder, color: COLORS.text }}>
            <option value="todos">Todas as matérias</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={filterTopic} onChange={(e) => setFilterTopic(e.target.value)}
            className="rounded-lg px-3 py-2 text-sm outline-none border"
            style={{ background: COLORS.bg2, borderColor: COLORS.cardBorder, color: COLORS.text }}>
            <option value="todos">Todos os tópicos</option>
            {allTopics.map((t) => <option key={t} value={t}>{t}</option>)}
            <option value={NO_TOPIC_KEY}>Sem tópico</option>
          </select>
          <button onClick={() => createNote("resumo")}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium"
            style={{ border: `1px solid ${COLORS.cardBorder}`, color: COLORS.sub }}>
            <NotebookPen size={13} /> Novo resumo
          </button>
          <button onClick={() => createNote("nota")}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium"
            style={{ border: `1px solid ${COLORS.cardBorder}`, color: COLORS.sub }}>
            <StickyNote size={13} /> Nova anotação
          </button>
        </div>
      </div>

      {barVisible && (
        <div className="rounded-xl border p-3 flex flex-wrap items-center gap-2"
          style={{ background: COLORS.gold + "12", borderColor: COLORS.gold + "66" }}>
          <ListChecks size={14} style={{ color: COLORS.gold }} />
          <span className="text-xs font-medium" style={{ color: COLORS.gold }}>
            {selectMode ? (selectedCount > 0 ? `${selectedCount} selecionado${selectedCount > 1 ? "s" : ""}` : "Modo seleção — clique nos itens") : `${selectedCount} selecionado${selectedCount > 1 ? "s" : ""}`}
          </span>
          <div className="flex-1" />
          {selectedCount > 0 && (
            <>
              <select defaultValue=""
                onChange={(e) => {
                  const v = e.target.value; if (v === "") return;
                  bulkMoveToTopic(v === NO_TOPIC_KEY ? "" : v);
                  e.target.value = "";
                }}
                className="rounded-lg px-2 py-1.5 text-xs outline-none border"
                style={{ background: COLORS.bg2, borderColor: COLORS.cardBorder, color: COLORS.text }}
                title="Mover os selecionados para um tópico">
                <option value="">Mover para tópico…</option>
                {topicOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                <option value={NO_TOPIC_KEY}>Sem tópico</option>
              </select>
              <button onClick={() => bulkSetPin(true)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs"
                style={{ border: `1px solid ${COLORS.cardBorder}`, color: COLORS.sub }}>
                <Pin size={12} /> Fixar
              </button>
              <button onClick={() => bulkSetPin(false)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs"
                style={{ border: `1px solid ${COLORS.cardBorder}`, color: COLORS.sub }}>
                <PinOff size={12} /> Desafixar
              </button>
              <button onClick={bulkDelete} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs"
                style={{ border: `1px solid ${COLORS.rose}55`, color: COLORS.rose }}>
                <Trash2 size={12} /> Excluir ({selectedCount})
              </button>
              <button onClick={clearSelection} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs"
                style={{ color: COLORS.sub }}>
                <X size={12} /> Cancelar
              </button>
            </>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-xl border p-8 text-center" style={{ background: COLORS.card, borderColor: COLORS.cardBorder }}>
          <p className="text-sm mb-1" style={{ color: COLORS.text }}>
            {items.length === 0 ? "Sua biblioteca está vazia." : "Nada encontrado com esses filtros."}
          </p>
          <p className="text-[11px]" style={{ color: COLORS.sub }}>
            {items.length === 0 ? "Envie um PDF, crie um resumo ou uma anotação para começar." : "Tente limpar a busca ou trocar o filtro."}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => {
            const groupAllSelected = g.items.length > 0 && g.items.every((it) => selected.has(it.id));
            return (
              <div key={g.key} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <Tag size={13} style={{ color: g.key === NO_TOPIC_KEY ? COLORS.sub : COLORS.gold }} />
                  <span className="text-xs font-medium" style={{ color: g.key === NO_TOPIC_KEY ? COLORS.sub : COLORS.gold }}>
                    {g.label}
                  </span>
                  <span className="text-[10px] font-mono" style={{ color: COLORS.sub }}>
                    · {g.items.length} {g.items.length === 1 ? "item" : "itens"}
                  </span>
                  {selectMode && g.items.length > 0 && (
                    <button onClick={() => selectAllInGroup(g)}
                      className="ml-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
                      style={{ color: COLORS.sub, border: `1px solid ${COLORS.cardBorder}` }}>
                      {groupAllSelected ? <CheckSquare size={10} /> : <Square size={10} />}
                      {groupAllSelected ? "Desmarcar do tópico" : "Selecionar do tópico"}
                    </button>
                  )}
                </div>
                {g.items.map((it, idx) => (
                  <ItemRow key={it.id}
                    item={it} subjectName={subjectName(it.subjectId)}
                    isFirst={idx === 0} isLast={idx === g.items.length - 1}
                    selectMode={selectMode} isSelected={selected.has(it.id)}
                    onToggleSelected={() => toggleSelected(it.id)}
                    onOpen={() => setOpenId(it.id)}
                    onDelete={() => removeItem(it.id)}
                    onMoveUp={() => moveInSection(g.key, it.id, "up")}
                    onMoveDown={() => moveInSection(g.key, it.id, "down")}
                    onTogglePin={() => togglePin(it.id)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ItemRow({
  item, subjectName, isFirst, isLast, selectMode, isSelected,
  onToggleSelected, onOpen, onDelete, onMoveUp, onMoveDown, onTogglePin,
}) {
  const meta = KIND[item.kind] || KIND.nota;
  const Icon = meta.icon;
  const preview = item.kind === "pdf"
    ? `${(item.fileSize / (1024 * 1024)).toFixed(1)} MB · ${(item.annotations || []).length} anotações`
    : htmlToPlainText(item.body || "").slice(0, 120) || "(vazio)";
  const date = new Date(item.updatedAt || item.createdAt || Date.now());
  const dateStr = date.toLocaleDateString("pt-BR");

  return (
    <div className="rounded-xl border p-3" style={{
      background: isSelected ? COLORS.gold + "15" : COLORS.card,
      borderColor: isSelected ? COLORS.gold + "88" : (item.pinned ? COLORS.gold + "66" : COLORS.cardBorder),
    }}>
      <div className="flex items-start gap-2">
        <div className="flex flex-col items-center gap-0.5 shrink-0 pt-0.5">
          {selectMode ? (
            <button onClick={onToggleSelected} title={isSelected ? "Desmarcar" : "Selecionar"} className="p-1 rounded">
              {isSelected ? <CheckSquare size={15} style={{ color: COLORS.gold }} /> : <Square size={15} style={{ color: COLORS.sub }} />}
            </button>
          ) : (
            <>
              <button onClick={onMoveUp} disabled={isFirst} title="Mover para cima" className="p-1 rounded"
                style={{ color: isFirst ? COLORS.sub + "44" : COLORS.sub }}>
                <ArrowUp size={13} />
              </button>
              <button onClick={onMoveDown} disabled={isLast} title="Mover para baixo" className="p-1 rounded"
                style={{ color: isLast ? COLORS.sub + "44" : COLORS.sub }}>
                <ArrowDown size={13} />
              </button>
            </>
          )}
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: meta.color + "22", color: meta.color }}>
          <Icon size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <button onClick={onOpen} className="text-left w-full">
            <div className="flex items-center gap-2 flex-wrap">
              {item.pinned && <Pin size={11} style={{ color: COLORS.gold }} />}
              <span className="text-sm font-medium truncate" style={{ color: COLORS.text }}>{item.title || "(sem título)"}</span>
              <span className="text-[10px] font-mono uppercase" style={{ color: meta.color }}>{meta.label}</span>
              {subjectName && <span className="text-[10px]" style={{ color: COLORS.sub }}>· {subjectName}</span>}
            </div>
            <div className="text-[11px] mt-0.5 truncate" style={{ color: COLORS.sub }}>{preview}</div>
            <div className="text-[10px] font-mono mt-0.5" style={{ color: COLORS.sub }}>{dateStr}</div>
          </button>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {!selectMode && (
            <button onClick={onTogglePin} title={item.pinned ? "Desafixar" : "Fixar no topo"} className="p-1.5 rounded"
              style={{ color: item.pinned ? COLORS.gold : COLORS.sub }}>
              {item.pinned ? <PinOff size={14} /> : <Pin size={14} />}
            </button>
          )}
          <button onClick={onOpen} title="Abrir" className="p-1.5 rounded" style={{ color: COLORS.sub }}>
            <ExternalLink size={14} />
          </button>
          {!selectMode && (
            <button onClick={onDelete} title="Excluir" className="p-1.5 rounded" style={{ color: COLORS.rose }}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ItemDetail({ item, subjects, topicSuggestions, onBack, onChange, onDelete }) {
  const meta = KIND[item.kind] || KIND.nota;
  const Icon = meta.icon;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-3 flex items-center gap-2 flex-wrap"
        style={{ background: COLORS.card, borderColor: COLORS.cardBorder }}>
        <button onClick={onBack} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs" style={{ color: COLORS.sub }}>
          <ArrowLeft size={13} /> Voltar
        </button>
        <div className="flex items-center gap-1.5">
          <Icon size={14} style={{ color: meta.color }} />
          <span className="text-[10px] font-mono uppercase" style={{ color: meta.color }}>{meta.label}</span>
        </div>
        <div className="flex-1" />
        <button onClick={onDelete} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs" style={{ color: COLORS.rose }}>
          <Trash2 size={13} /> Excluir
        </button>
      </div>

      <div className="rounded-xl border p-4 space-y-3" style={{ background: COLORS.card, borderColor: COLORS.cardBorder }}>
        <label className="block">
          <span className="text-[11px]" style={{ color: COLORS.sub }}>Título</span>
          <input value={item.title || ""} onChange={(e) => onChange({ title: e.target.value })}
            className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none border"
            style={{ background: COLORS.bg2, borderColor: COLORS.cardBorder, color: COLORS.text }} />
        </label>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[11px]" style={{ color: COLORS.sub }}>Matéria (opcional)</span>
            <select value={item.subjectId || ""} onChange={(e) => onChange({ subjectId: e.target.value || null })}
              className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none border"
              style={{ background: COLORS.bg2, borderColor: COLORS.cardBorder, color: COLORS.text }}>
              <option value="">Sem matéria vinculada</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px]" style={{ color: COLORS.sub }}>
              Tópico (opcional) — agrupa itens na Biblioteca
            </span>
            <input list="library-topic-suggestions"
              value={item.topic || ""} onChange={(e) => onChange({ topic: e.target.value })}
              placeholder={item.subjectId ? "Ex.: Direitos fundamentais" : "Ex.: Aula 1, Revisão, Semana 3…"}
              className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none border"
              style={{ background: COLORS.bg2, borderColor: COLORS.cardBorder, color: COLORS.text }} />
            <datalist id="library-topic-suggestions">
              {topicSuggestions.map((t) => <option key={t} value={t} />)}
            </datalist>
            {item.subjectId && topicSuggestions.length > 0 && (
              <p className="text-[10px] mt-1" style={{ color: COLORS.sub }}>
                Sugestões: submatérias da matéria vinculada + tópicos já usados.
              </p>
            )}
          </label>
        </div>
      </div>

      {item.kind === "pdf" ? (
        <PdfSection item={item} onChange={onChange} />
      ) : (
        <div className="rounded-xl border p-3" style={{ background: COLORS.card, borderColor: COLORS.cardBorder }}>
          <RichTextEditor label="Conteúdo" value={item.body || ""} onChange={(v) => onChange({ body: v })} minHeight={260}
            placeholder={item.kind === "resumo" ? "Escreva o resumo aqui…" : "Escreva a anotação aqui…"} />
        </div>
      )}
    </div>
  );
}

function PdfSection({ item, onChange }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [missingPdf, setMissingPdf] = useState(false);
  const [relinking, setRelinking] = useState(false);
  const [doc, setDoc] = useState(null);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.5);
  const [tool, setTool] = useState("highlight");
  const [color, setColor] = useState(HIGHLIGHT_COLORS[0].value);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [textItems, setTextItems] = useState([]);
  const [undoStack, setUndoStack] = useState([]);
  const [pendingText, setPendingText] = useState(null);
  const [textValue, setTextValue] = useState("");
  const [totalPages, setTotalPages] = useState(0);

  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const dragRef = useRef(null);
  const relinkRef = useRef(null);

  const annotations = Array.isArray(item.annotations) ? item.annotations : [];

  useEffect(() => {
    let cancelled = false;
    let url = null;
    let loadedDoc = null;
    (async () => {
      setLoading(true); setError(""); setMissingPdf(false);
      try {
        const rec = await getPdf(item.pdfId);
        if (!rec) {
          if (!cancelled) setMissingPdf(true);
          throw new Error("PDF não encontrado no armazenamento.");
        }
        url = dataUrlToBlobUrl(rec.dataUrl);
        if (cancelled) return;
        setBlobUrl(url);
        const d = await loadPdfDocument(url);
        loadedDoc = d;
        if (cancelled) { d.destroy().catch(() => {}); return; }
        setDoc(d);
        setTotalPages(d.numPages);
        setPage(1);
      } catch (e) {
        if (!cancelled) setError(e.message || "Não foi possível carregar o PDF.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (loadedDoc) loadedDoc.destroy().catch(() => {});
      if (url) setTimeout(() => URL.revokeObjectURL(url), 500);
    };
  }, [item.pdfId]);

  useEffect(() => {
    if (!doc || !canvasRef.current || !page) return;
    let cancelled = false;
    (async () => {
      try {
        const { width, height } = await renderPdfPage(doc, page, canvasRef.current, scale);
        if (cancelled) return;
        setDims({ width, height });
        const items = await getTextItems(doc, page, scale);
        if (cancelled) return;
        setTextItems(items);
      } catch {
        if (!cancelled) setError("Não foi possível renderizar esta página.");
      }
    })();
    return () => { cancelled = true; };
  }, [doc, page, scale]);

  // Um texto pendente pertence à página/zoom em que foi aberto.
  useEffect(() => {
    setPendingText(null);
    setTextValue("");
  }, [page, scale, tool]);

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      undoLast();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undoStack]); // eslint-disable-line

  const updateAnnotations = (next, pushToUndo = true) => {
    if (pushToUndo) setUndoStack((s) => [...s, annotations]);
    onChange({ annotations: next });
  };
  const undoLast = () => {
    if (!undoStack.length) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    onChange({ annotations: prev });
  };

  const pageAnnotations = annotations.filter((a) => a.page === page);
  const factorFor = (a) => (a.v === 2 ? scale : 1);

  const addHighlight = (x, y, w, h) => {
    if (w < 2 || h < 2) return;
    // Coordenadas normalizadas (escala 1) para o destaque acompanhar o zoom.
    const a = {
      id: uid(), type: "highlight", page,
      x: x / scale, y: y / scale, w: w / scale, h: h / scale,
      color, createdAt: Date.now(), v: 2,
    };
    updateAnnotations([...annotations, a]);
  };

  const onMouseDown = (e) => {
    if (tool !== "highlight") return;
    const host = overlayRef.current?.getBoundingClientRect();
    if (!host) return;
    dragRef.current = { x: e.clientX - host.left, y: e.clientY - host.top };
  };

  const onMouseUp = (e) => {
    if (tool !== "highlight") return;
    const host = overlayRef.current?.getBoundingClientRect();
    if (!host) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount && overlayRef.current?.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      addHighlight(rect.left - host.left, rect.top - host.top, rect.width, rect.height);
      sel.removeAllRanges();
      dragRef.current = null;
      return;
    }
    // Fallback: arrastar um retângulo quando não há seleção de texto.
    const start = dragRef.current;
    dragRef.current = null;
    if (!start) return;
    const endX = e.clientX - host.left;
    const endY = e.clientY - host.top;
    const x = Math.min(start.x, endX);
    const y = Math.min(start.y, endY);
    const w = Math.abs(endX - start.x);
    const h = Math.abs(endY - start.y);
    if (w > 6 && h > 4) addHighlight(x, y, w, h);
  };

  const onClickOverlay = (e) => {
    const host = overlayRef.current?.getBoundingClientRect();
    if (!host) return;
    const x = e.clientX - host.left;
    const y = e.clientY - host.top;
    if (tool === "text") { setPendingText({ x, y }); setTextValue(""); return; }
    if (tool === "erase") {
      const hit = pageAnnotations.find((a) => {
        const k = factorFor(a);
        if (a.type === "text") return Math.abs(a.x * k - x) < 40 && Math.abs(a.y * k - y) < 20;
        return x >= a.x * k && x <= (a.x + a.w) * k && y >= a.y * k && y <= (a.y + a.h) * k;
      });
      if (hit) updateAnnotations(annotations.filter((a) => a.id !== hit.id));
    }
  };

  const confirmText = () => {
    if (!pendingText) return;
    const txt = textValue.trim();
    if (!txt) { setPendingText(null); setTextValue(""); return; }
    const a = {
      id: uid(), type: "text", page,
      x: pendingText.x / scale, y: pendingText.y / scale,
      text: txt, color, fontSize: 13 / scale, createdAt: Date.now(), v: 2,
    };
    updateAnnotations([...annotations, a]);
    setPendingText(null);
    setTextValue("");
  };

  const onRelink = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setRelinking(true);
    try {
      const stored = await savePdf(file);
      // Mantém o mesmo item (e as anotações), só aponta para o novo binário.
      onChange({ pdfId: stored.id, fileName: stored.name, fileSize: stored.size });
    } catch (err) {
      alert(err.message || "Não foi possível vincular o PDF.");
    } finally {
      setRelinking(false);
    }
  };

  const download = () => {
    if (!blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = item.fileName || `${item.title || "documento"}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border overflow-hidden" style={{ background: COLORS.card, borderColor: COLORS.cardBorder }}>
        <div className="flex items-center gap-2 px-3 py-2 border-b flex-wrap" style={{ borderColor: COLORS.cardBorder }}>
          <FileText size={14} style={{ color: COLORS.rose }} />
          <span className="text-xs truncate flex-1" style={{ color: COLORS.text }}>{item.fileName || "documento.pdf"}</span>
          <button onClick={download} disabled={!blobUrl} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px]"
            style={{ color: COLORS.sub }}>
            <Download size={12} /> Baixar original
          </button>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 border-b flex-wrap" style={{ borderColor: COLORS.cardBorder }}>
          <ToolBtn active={tool === "highlight"} onClick={() => setTool("highlight")} icon={Highlighter} label="Marca-texto" />
          <ToolBtn active={tool === "text"} onClick={() => setTool("text")} icon={Type} label="Texto" />
          <ToolBtn active={tool === "erase"} onClick={() => setTool("erase")} icon={Eraser} label="Borracha" />
          <span className="mx-1 h-4 w-px" style={{ background: COLORS.cardBorder }} />
          {HIGHLIGHT_COLORS.map((c) => (
            <button key={c.key} onClick={() => setColor(c.value)} title={c.key}
              className="h-5 w-5 rounded-full border"
              style={{ background: c.value, borderColor: color === c.value ? COLORS.gold : COLORS.cardBorder, boxShadow: color === c.value ? `0 0 0 2px ${COLORS.gold}66` : "none" }} />
          ))}
          <span className="mx-1 h-4 w-px" style={{ background: COLORS.cardBorder }} />
          <button onClick={() => setScale((s) => Math.max(0.8, s - 0.25))} title="Diminuir zoom" className="p-1.5 rounded" style={{ color: COLORS.sub }}>
            <ZoomOut size={14} />
          </button>
          <span className="text-[10px] font-mono" style={{ color: COLORS.sub }}>{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((s) => Math.min(3, s + 0.25))} title="Aumentar zoom" className="p-1.5 rounded" style={{ color: COLORS.sub }}>
            <ZoomIn size={14} />
          </button>
          <div className="flex-1" />
          <button onClick={undoLast} disabled={!undoStack.length} title="Desfazer (Ctrl+Z)" className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px]"
            style={{ color: undoStack.length ? COLORS.sub : COLORS.sub + "44" }}>
            <Undo2 size={12} /> Desfazer
          </button>
        </div>

        {totalPages > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 border-b" style={{ borderColor: COLORS.cardBorder }}>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-2 py-0.5 rounded text-[11px]"
              style={{ color: page <= 1 ? COLORS.sub + "44" : COLORS.sub }}>◀</button>
            <span className="text-[11px] font-mono" style={{ color: COLORS.sub }}>Página {page} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-2 py-0.5 rounded text-[11px]"
              style={{ color: page >= totalPages ? COLORS.sub + "44" : COLORS.sub }}>▶</button>
            <div className="flex-1" />
            <span className="text-[10px] font-mono" style={{ color: COLORS.sub }}>
              {pageAnnotations.length} anotação(ões) nesta página
            </span>
          </div>
        )}

        <div style={{ background: COLORS.bg2, padding: 12, minHeight: 200 }}>
          {loading && <p className="p-6 text-center text-xs" style={{ color: COLORS.sub }}>Carregando PDF…</p>}
          {error && (
            <div className="p-6 text-center space-y-2">
              <p className="text-xs" style={{ color: COLORS.rose }}>{error}</p>
              {missingPdf && (
                <>
                  <p className="text-[11px]" style={{ color: COLORS.sub }}>
                    Este item veio de um backup, mas o PDF não está neste dispositivo.
                    Escolha o arquivo original para reconectar as anotações.
                  </p>
                  <button onClick={() => relinkRef.current?.click()} disabled={relinking}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium"
                    style={{ background: COLORS.gold, color: "#12203A", opacity: relinking ? 0.6 : 1 }}>
                    <Upload size={13} /> {relinking ? "Vinculando…" : "Vincular PDF"}
                  </button>
                  <input ref={relinkRef} type="file" accept="application/pdf" className="hidden" onChange={onRelink} />
                </>
              )}
            </div>
          )}
          {!loading && !error && (
            <div className="relative mx-auto" style={{ width: dims.width || "100%", height: dims.height || 300 }}>
              <canvas ref={canvasRef} className="block" style={{ background: "#fff" }} />
              <div ref={overlayRef} onMouseDown={onMouseDown} onMouseUp={onMouseUp} onClick={onClickOverlay}
                className="absolute inset-0 overflow-hidden"
                style={{ cursor: tool === "text" ? "text" : tool === "erase" ? "not-allowed" : "crosshair" }}>
                {/* Camada de texto transparente: permite selecionar o texto do PDF para marcar. */}
                {textItems.filter((t) => t.text && t.text.trim()).map((t, i) => (
                  <span key={i} style={{
                    position: "absolute", left: t.x, top: t.y, width: t.w, height: t.h,
                    fontSize: t.h, lineHeight: 1, color: "transparent", whiteSpace: "pre",
                    overflow: "hidden", userSelect: "text",
                    pointerEvents: tool === "highlight" ? "auto" : "none",
                  }}>{t.text}</span>
                ))}
                {pageAnnotations.map((a) => {
                  const k = factorFor(a);
                  return a.type === "highlight" ? (
                    <div key={a.id} className="absolute"
                      style={{
                        left: a.x * k, top: a.y * k, width: a.w * k, height: a.h * k,
                        background: a.color, opacity: 0.35, borderRadius: 2, pointerEvents: "none",
                      }} />
                  ) : (
                    <div key={a.id} className="absolute"
                      style={{
                        left: a.x * k, top: a.y * k, color: a.color,
                        background: "rgba(255,255,255,0.85)", padding: "1px 4px", borderRadius: 3,
                        fontSize: (a.fontSize || 13) * k, fontWeight: 600,
                        userSelect: "none", pointerEvents: "none",
                      }}>
                      {a.text}
                    </div>
                  );
                })}
                {pendingText && (
                  <div className="absolute flex items-center gap-1"
                    style={{ left: pendingText.x, top: pendingText.y, background: COLORS.card, border: `1px solid ${COLORS.gold}`, borderRadius: 6, padding: 4, zIndex: 10 }}>
                    <input autoFocus value={textValue} onChange={(e) => setTextValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); confirmText(); }
                        else if (e.key === "Escape") { setPendingText(null); setTextValue(""); }
                      }}
                      placeholder="Digite e Enter…"
                      className="rounded px-2 py-1 text-xs outline-none"
                      style={{ background: COLORS.bg2, color: COLORS.text, border: `1px solid ${COLORS.cardBorder}`, minWidth: 140 }} />
                    <button onClick={confirmText} className="text-[10px] px-1" style={{ color: COLORS.teal }}>OK</button>
                    <button onClick={() => { setPendingText(null); setTextValue(""); }} className="text-[10px] px-1" style={{ color: COLORS.sub }}>×</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {pageAnnotations.length > 0 && (
        <div className="rounded-xl border p-3" style={{ background: COLORS.card, borderColor: COLORS.cardBorder }}>
          <div className="flex items-center gap-2 mb-2">
            <StickyNote size={14} style={{ color: COLORS.gold }} />
            <span className="text-sm font-medium">Anotações desta página</span>
          </div>
          <div className="space-y-1">
            {pageAnnotations.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-[11px] px-2 py-1 rounded"
                style={{ background: COLORS.bg2 }}>
                <span className="inline-block h-3 w-3 rounded" style={{ background: a.color }} />
                <span className="flex-1 truncate" style={{ color: COLORS.text }}>
                  {a.type === "highlight" ? "Destaque" : a.text}
                </span>
                <button onClick={() => updateAnnotations(annotations.filter((x) => x.id !== a.id))}
                  className="inline-flex items-center gap-1 text-[10px]" style={{ color: COLORS.rose }}>
                  <Trash2 size={10} /> Excluir
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolBtn({ active, onClick, icon: Icon, label }) {
  return (
    <button onClick={onClick} title={label}
      className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px]"
      style={{
        background: active ? COLORS.gold + "22" : "transparent",
        color: active ? COLORS.gold : COLORS.sub,
        border: `1px solid ${active ? COLORS.gold : COLORS.cardBorder}`,
      }}>
      <Icon size={12} /> {label}
    </button>
  );
}
