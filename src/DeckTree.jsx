import React, { useMemo, useState } from "react";
import {
  Plus, Folder, FolderOpen, ChevronRight, ChevronDown,
  Pencil, Trash2, FolderInput,
} from "lucide-react";
import {
  buildTree, flattenTree, countCards, countDue,
  normalizePath, leafName, parentPath, createChildName,
  renameDeckPath, moveDeckPath, uniqueDeckName,
} from "./deckTree.js";

const COLORS = {
  bg2: "#0B121D", card: "#16233A", cardBorder: "#233350",
  text: "#EDEFF2", sub: "#93A2BA", gold: "#C9A24B", rose: "#D6685C", teal: "#3FA796",
};

function InlineNameInput({ initial, onSubmit, onCancel }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="flex items-center gap-1 flex-1">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit(value);
          else if (e.key === "Escape") onCancel();
        }}
        className="rounded px-2 py-1 text-xs outline-none border w-full"
        style={{ background: COLORS.bg2, borderColor: COLORS.gold, color: COLORS.text }}
      />
      <button onClick={() => onSubmit(value)} title="Salvar" className="text-[10px] px-1" style={{ color: COLORS.teal }}>OK</button>
      <button onClick={onCancel} title="Cancelar" className="text-[10px] px-1" style={{ color: COLORS.sub }}>×</button>
    </div>
  );
}

export default function DeckTree({
  decks,
  activeDeckId,
  onSelectDeck,
  onRenameDeck,
  onDeleteDeck,
  onCreateChild,
  onCreateRoot,
  onMoveDeck,
  isDueFn,
}) {
  const [expanded, setExpanded] = useState(() => new Set());
  const [renamingId, setRenamingId] = useState(null);
  const [creatingIn, setCreatingIn] = useState(null);
  const [creatingRoot, setCreatingRoot] = useState(false);
  const [movingId, setMovingId] = useState(null);

  const tree = useMemo(() => buildTree(decks), [decks]);
  const flat = useMemo(() => flattenTree(tree, expanded), [tree, expanded]);

  const toggle = (path) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const allFolderPaths = useMemo(() => {
    const out = [];
    const walk = (n) => n.children.forEach((c) => { if (c.children.length) out.push(c.path); walk(c); });
    walk(tree);
    return out;
  }, [tree]);
  const expandAll = () => setExpanded(new Set(allFolderPaths));
  const collapseAll = () => setExpanded(new Set());

  const confirmCreate = (parentName, value) => {
    const name = String(value || "").trim();
    if (!name) { setCreatingIn(null); setCreatingRoot(false); return; }
    const parent = normalizePath(parentName);
    const full = createChildName(parent, name);
    if (parent) onCreateChild(parent, full); else onCreateRoot(full);
    // Expande o pai para o usuário ver o filho recém-criado
    if (parent) setExpanded((prev) => new Set(prev).add(parent));
    setCreatingIn(null);
    setCreatingRoot(false);
  };

  return (
    <div className="rounded-lg border" style={{ borderColor: COLORS.cardBorder, background: COLORS.bg2 }}>
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: COLORS.cardBorder }}>
        <span className="text-xs font-medium" style={{ color: COLORS.sub }}>
          Baralhos ({decks.length})
        </span>
        <div className="flex items-center gap-1">
        {allFolderPaths.length > 0 && (
          <>
            <button onClick={expandAll} className="text-[11px] px-2 py-1 rounded" style={{ color: COLORS.sub }} title="Expandir todos">Expandir tudo</button>
            <button onClick={collapseAll} className="text-[11px] px-2 py-1 rounded" style={{ color: COLORS.sub }} title="Recolher todos">Recolher tudo</button>
          </>
        )}
        <button
          onClick={() => setCreatingRoot(true)}
          className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded"
          style={{ color: COLORS.gold, background: COLORS.gold + "15" }}
          title="Criar baralho na raiz"
        >
          <Plus size={12} /> Baralho
        </button>
        </div>
      </div>

      <div className="max-h-[420px] overflow-auto py-1">
        {creatingRoot && (
          <div className="flex items-center gap-2 px-3 py-1.5">
            <Folder size={13} style={{ color: COLORS.sub }} />
            <InlineNameInput
              initial=""
              onSubmit={(v) => confirmCreate("", v)}
              onCancel={() => setCreatingRoot(false)}
            />
          </div>
        )}

        {flat.length === 0 && !creatingRoot && (
          <p className="px-3 py-3 text-xs" style={{ color: COLORS.sub }}>
            Nenhum baralho. Clique em <span style={{ color: COLORS.gold }}>+ Baralho</span> para começar.
          </p>
        )}

        {flat.map(({ node, depth, hasChildren, isOpen, isLeaf }) => {
          const isActive = isLeaf && node.deckId === activeDeckId;
          const isRenaming = renamingId === node.deckId;
          const total = countCards(node);
          const due = isDueFn ? countDue(node, isDueFn) : 0;
          const isMoving = movingId === node.deckId;

          return (
            <div key={node.path}>
              <div
                className="flex items-center gap-1 px-2 py-1"
                style={{ paddingLeft: 8 + depth * 16, background: isActive ? COLORS.gold + "18" : "transparent" }}
              >
                {/* Chevron para recolher/expandir quando há filhos */}
                {hasChildren ? (
                  <button onClick={() => toggle(node.path)} title={isOpen ? "Recolher" : "Expandir"} className="shrink-0 p-0.5">
                    {isOpen
                      ? <ChevronDown size={13} style={{ color: COLORS.sub }} />
                      : <ChevronRight size={13} style={{ color: COLORS.sub }} />}
                  </button>
                ) : (
                  <span className="shrink-0 inline-block" style={{ width: 17 }} />
                )}

                <span className="shrink-0">
                  {isLeaf
                    ? (isOpen ? <FolderOpen size={14} style={{ color: COLORS.gold }} /> : <Folder size={14} style={{ color: COLORS.gold }} />)
                    : <Folder size={14} style={{ color: COLORS.sub }} />}
                </span>

                {isRenaming ? (
                  <InlineNameInput
                    initial={node.name}
                    onSubmit={(v) => {
                      const parent = parentPath(node.path);
                      const newLeaf = String(v || "").trim();
                      if (newLeaf && newLeaf !== node.name) {
                        onRenameDeck(node.deckId, createChildName(parent, newLeaf));
                      }
                      setRenamingId(null);
                    }}
                    onCancel={() => setRenamingId(null)}
                  />
                ) : (
                  <button
                    onClick={() => { if (isLeaf) onSelectDeck(node.deckId); else toggle(node.path); }}
                    className="flex-1 text-left text-xs truncate py-0.5"
                    style={{ color: isActive ? COLORS.gold : COLORS.text, fontWeight: isActive ? 600 : 400 }}
                    title={node.path}
                  >
                    {node.name}
                    <span className="ml-2 text-[10px] font-mono" style={{ color: COLORS.sub }}>
                      ({total}{due ? ` · ${due} p/ revisar` : ""})
                    </span>
                  </button>
                )}

                {!isRenaming && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => { setCreatingIn({ parentPath: node.path }); setExpanded((prev) => new Set(prev).add(node.path)); }}
                      title="Criar sub-baralho" className="p-0.5"
                    >
                      <Plus size={12} style={{ color: COLORS.sub }} />
                    </button>
                    {isLeaf && (<>
                    <button onClick={() => setMovingId(isMoving ? null : node.deckId)} title="Mover para outro pai" className="p-0.5">
                      <FolderInput size={12} style={{ color: COLORS.sub }} />
                    </button>
                    <button onClick={() => setRenamingId(node.deckId)} title="Renomear" className="p-0.5">
                      <Pencil size={12} style={{ color: COLORS.sub }} />
                    </button>
                    <button onClick={() => onDeleteDeck(node.deckId)} title="Excluir" className="p-0.5">
                      <Trash2 size={12} style={{ color: COLORS.rose }} />
                    </button>
                    </>)}
                  </div>
                )}
              </div>

              {/* Input de criar filho inline */}
              {creatingIn && creatingIn.parentPath === node.path && (
                <div className="flex items-center gap-2" style={{ paddingLeft: 8 + (depth + 1) * 16, paddingTop: 4, paddingBottom: 4 }}>
                  <Folder size={13} style={{ color: COLORS.sub }} />
                  <InlineNameInput
                    initial=""
                    onSubmit={(v) => confirmCreate(node.path, v)}
                    onCancel={() => setCreatingIn(null)}
                  />
                </div>
              )}

              {/* Select de pai para mover */}
              {isMoving && (
                <div className="px-3 py-2" style={{ paddingLeft: 8 + (depth + 1) * 16 }}>
                  <label className="text-[10px] block mb-1" style={{ color: COLORS.sub }}>
                    Mover "<b>{node.name}</b>" para:
                  </label>
                  <select
                    defaultValue=""
                    onChange={(e) => { onMoveDeck(node.deckId, e.target.value); setMovingId(null); }}
                    className="rounded px-2 py-1 text-xs outline-none border w-full"
                    style={{ background: COLORS.bg2, borderColor: COLORS.cardBorder, color: COLORS.text }}
                  >
                    <option value="">(raiz)</option>
                    {decks
                      .filter((d) => {
                        const p = normalizePath(d.name);
                        return d.id !== node.deckId && p !== node.path && !p.startsWith(node.path + "::");
                      })
                      .map((d) => (
                        <option key={d.id} value={normalizePath(d.name)}>{d.name}</option>
                      ))}
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
