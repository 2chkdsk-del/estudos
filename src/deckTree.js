// deckTree.js — helpers puros para baralhos hierárquicos.
//
// Internamente os decks continuam uma lista plana: { id, name: "A::B", cards }
// A árvore é DERIVADA do `name` (separador `::`, como no Anki).
// Isso mantém compatibilidade total com export/import do .apkg e não exige
// migrar dados existentes.
//
// Operações:
//   buildTree(decks)                       → árvore de nós
//   flattenTree(tree, expanded)            → lista de nós em ordem de exibição
//   countCards(node)                       → cartões no nó + descendentes
//   countDue(node, isDueFn)                → vencidos no nó + descendentes
//   parentPath(name)                       → "A::B::C" → "A::B"
//   leafName(name)                         → "A::B::C" → "C"
//   normalizePath(name)                    → trima cada parte
//   createChildName(parentName, leaf)      → "A" + "B" → "A::B"
//   renameDeckPath(decks, id, newName)     → renomeia o deck e os descendentes
//   moveDeckPath(decks, id, newParentName) → move o deck (e filhos) para outro pai
//   uniqueDeckName(decks, base)            → evita nomes duplicados no mesmo nível

export const SEP = "::";

/* ---------------- caminho <-> nome ---------------- */
export function parentPath(name) {
  const parts = String(name || "").split(SEP).filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join(SEP) : "";
}
export function leafName(name) {
  const parts = String(name || "").split(SEP).filter(Boolean);
  return parts[parts.length - 1] || "";
}
export function normalizePath(name) {
  return String(name || "").split(SEP).map((p) => p.trim()).filter(Boolean).join(SEP);
}

/* ---------------- árvore ---------------- */
export function buildTree(decks) {
  const root = {
    name: "", path: "", children: [], cards: [], isLeaf: false, deckId: null, parent: null,
  };
  const byPath = new Map([["", root]]);

  const ensureNode = (path, parent) => {
    if (byPath.has(path)) return byPath.get(path);
    const node = {
      name: leafName(path),
      path,
      children: [],
      cards: [],
      isLeaf: false,
      deckId: null,
      parent,
    };
    byPath.set(path, node);
    if (parent) parent.children.push(node);
    return node;
  };

  const sorted = [...decks].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  for (const deck of sorted) {
    const path = normalizePath(deck.name);
    if (!path) continue;
    const parts = path.split(SEP).filter(Boolean);
    let parent = root;
    let acc = "";
    for (let i = 0; i < parts.length; i++) {
      acc = acc ? `${acc}${SEP}${parts[i]}` : parts[i];
      parent = ensureNode(acc, parent);
    }
    const leaf = byPath.get(path);
    leaf.isLeaf = true;
    leaf.deckId = deck.id;
    leaf.cards = deck.cards;
  }

  const sortTree = (node) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    node.children.forEach(sortTree);
  };
  sortTree(root);
  return root;
}

/* ---------------- achatar para renderizar ---------------- */
export function flattenTree(root, expanded) {
  const out = [];
  const walk = (node, depth) => {
    for (const child of node.children) {
      const hasChildren = child.children.length > 0;
      const isOpen = expanded.has(child.path);
      out.push({
        node: child,
        depth,
        hasChildren,
        isOpen,
        isLeaf: child.isLeaf,
      });
      if (hasChildren && isOpen) walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

/* ---------------- contagem ---------------- */
export function countCards(node) {
  let n = node.cards.length;
  for (const c of node.children) n += countCards(c);
  return n;
}

export function countDue(node, isDueFn) {
  let n = 0;
  if (typeof isDueFn === "function") n += node.cards.filter((c) => isDueFn(c)).length;
  for (const c of node.children) n += countDue(c, isDueFn);
  return n;
}

/* ---------------- renomear (move a subárvore) ---------------- */
// Renomeia o deck `oldId` e todos os descendentes dele para o novo caminho.
// Ex.: renomear "A" para "X::A" move "A", "A::B", "A::B::C" para
// "X::A", "X::A::B", "X::A::B::C" — preservando o id de cada um.
export function renameDeckPath(decks, oldId, newName) {
  const target = decks.find((d) => d.id === oldId);
  if (!target) return decks;
  const oldPath = normalizePath(target.name);
  const newPath = normalizePath(newName);
  if (!newPath) return decks;

  return decks.map((d) => {
    const p = normalizePath(d.name);
    if (d.id === oldId) return { ...d, name: newPath };
    if (p.startsWith(`${oldPath}${SEP}`)) {
      const rest = p.slice(oldPath.length + SEP.length);
      return { ...d, name: `${newPath}${SEP}${rest}` };
    }
    return d;
  });
}

/* ---------------- mover ---------------- */
// Move o deck `id` para dentro do pai `newParentName` (string vazia = raiz).
// Preserva o nome-folha e move os descendentes junto.
export function moveDeckPath(decks, id, newParentName) {
  const target = decks.find((d) => d.id === id);
  if (!target) return decks;
  const leaf = leafName(target.name);
  const parent = normalizePath(newParentName);
  const newName = parent ? `${parent}${SEP}${leaf}` : leaf;
  if (newName === normalizePath(target.name)) return decks;
  return renameDeckPath(decks, id, newName);
}

/* ---------------- criar filho ---------------- */
export function createChildName(parentName, leaf) {
  const parent = normalizePath(parentName);
  const child = String(leaf || "").trim();
  if (!child) return parent;
  return parent ? `${parent}${SEP}${child}` : child;
}

/* ---------------- nomes únicos ---------------- */
export function uniqueDeckName(decks, base) {
  const existing = new Set(decks.map((d) => normalizePath(d.name).toLowerCase()));
  let candidate = base;
  let i = 2;
  while (existing.has(candidate.toLowerCase())) {
    candidate = `${base} ${i++}`;
  }
  return candidate;
}
