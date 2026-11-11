// Importação e exportação de flashcards no formato do Anki.
//  - Texto/CSV/TSV (File > Import do Anki, com cabeçalhos #separator, #html, #deck column...)
//  - Pacotes .apkg / .colpkg (baralhos completos, com ou sem progresso de revisão).
//    Exporta no formato "legado" (collection.anki2) com cartões + revlog, que todas as versões
//    atuais do Anki importam. Importa o legado e o novo (anki21b, zstd).
// As bibliotecas pesadas (JSZip, sql.js, fzstd) só são carregadas quando necessário.

import {
  readCrt, readCardProgress, readRevlog, applyProgressToCards, buildProgressForExport, makeCrt,
} from "./ankiHistory.js";
import { getImage } from "./imageStore.js";

export const SEP = "\x1f";
const CLOZE_TEST = /\{\{c\d+::/;
const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

/* ---------------- texto <-> html ---------------- */
function decodeEntities(s) {
  if (typeof document !== "undefined") {
    const t = document.createElement("textarea");
    t.innerHTML = s;
    return t.value;
  }
  return s
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

export function htmlToText(html) {
  if (html == null) return "";
  let s = String(html);
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p|tr|h[1-6])>/gi, "\n").replace(/<li[^>]*>/gi, "• ").replace(/<\/li>/gi, "\n");
  s = s.replace(/<img[^>]*>/gi, "[imagem]").replace(/\[sound:[^\]]*\]/g, "");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

export function textToHtml(text) {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, "<br>");
}


/* ---------------- cartões com formatação (editor rico) ---------------- */
// Cartões criados no editor rico têm html:true e guardam HTML (imagens como app://<id>).
// Cartões antigos/importados continuam texto puro.
function sideHtmlNoImages(text, isHtml) {
  return isHtml ? String(text ?? "").replace(/<img[^>]*>/gi, "") : textToHtml(text);
}
function sideToPlain(text, isHtml) {
  return isHtml ? htmlToText(text) : String(text ?? "");
}
async function resolveImagesForExport(html) {
  if (!html || !/app:\/\//.test(html)) return html;
  const ids = Array.from(new Set(Array.from(html.matchAll(/app:\/\/([^"]+)/g)).map((m) => m[1])));
  const map = {};
  for (const id of ids) {
    try { const rec = await getImage(id); if (rec) map[id] = rec.dataUrl; } catch { /* sem imagem: mantém o src */ }
  }
  return html.replace(/app:\/\/([^"]+)/g, (m, id) => map[id] || m);
}
async function sideHtmlForApkg(text, isHtml) {
  return isHtml ? resolveImagesForExport(String(text ?? "")) : textToHtml(text);
}

export function clozeToQA(field, extra = "") {
  const front = field.replace(CLOZE_RE, (_m, _n, _a, hint) => (hint ? `[${hint}]` : "[...]"));
  const back = field.replace(CLOZE_RE, (_m, _n, ans) => ans) + (extra ? `\n\n${extra}` : "");
  return { front, back };
}

/* ---------------- texto / CSV / TSV ---------------- */
const SEP_NAMES = { tab: "\t", comma: ",", semicolon: ";", space: " ", pipe: "|", colon: ":" };

function parseDelimited(body, sep) {
  const rows = [];
  let row = [];
  let field = "";
  let inQ = false;
  for (let k = 0; k < body.length; k++) {
    const c = body[k];
    if (inQ) {
      if (c === '"') {
        if (body[k + 1] === '"') { field += '"'; k++; } else inQ = false;
      } else field += c;
    } else if (c === '"' && field === "") {
      inQ = true;
    } else if (c === sep) {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && body[k + 1] === "\n") k++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

function detectSeparator(body) {
  const lines = body.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5);
  if (!lines.length) return "\t";
  for (const cand of ["\t", ";", "|", ","]) {
    if (lines.every((l) => l.includes(cand))) return cand;
  }
  for (const cand of ["\t", ";", "|", ","]) {
    if (lines[0].includes(cand)) return cand;
  }
  return null;
}

const FRONT_WORDS = ["front", "frente", "pergunta", "question", "anverso"];
const BACK_WORDS = ["back", "verso", "resposta", "answer", "reverso"];

export function parseAnkiText(raw, { defaultDeck = "Importados" } = {}) {
  const text = String(raw).replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  const meta = { sep: null, html: false, deckCol: null, tagsCol: null, guidCol: null, notetypeCol: null, deck: null };
  let i = 0;
  let hasHeaders = false;
  while (i < lines.length && lines[i].startsWith("#")) {
    hasHeaders = true;
    const m = lines[i].match(/^#\s*([^:]+):\s*(.*)$/);
    if (m) {
      const key = m[1].trim().toLowerCase();
      const val = m[2].trim();
      if (key === "separator") meta.sep = SEP_NAMES[val.toLowerCase()] ?? (val.length === 1 ? val : null);
      else if (key === "html") meta.html = val.toLowerCase() === "true";
      else if (key === "deck column") meta.deckCol = Number(val) || null;
      else if (key === "tags column") meta.tagsCol = Number(val) || null;
      else if (key === "guid column") meta.guidCol = Number(val) || null;
      else if (key === "notetype column") meta.notetypeCol = Number(val) || null;
      else if (key === "deck") meta.deck = val || null;
    }
    i++;
  }
  const body = lines.slice(i).join("\n");
  const sep = meta.sep || detectSeparator(body);
  if (!sep) return { cards: [], skipped: 0, error: "Não encontrei um separador entre frente e verso (use TAB, ponto e vírgula, vírgula ou |)." };

  let rows = parseDelimited(body, sep);
  if (!hasHeaders && rows.length > 1) {
    const a = (rows[0][0] || "").trim().toLowerCase();
    const b = (rows[0][1] || "").trim().toLowerCase();
    if (FRONT_WORDS.includes(a) && BACK_WORDS.includes(b)) rows = rows.slice(1);
  }

  const special = new Set([meta.deckCol, meta.tagsCol, meta.guidCol, meta.notetypeCol].filter(Boolean));
  const cards = [];
  let skipped = 0;
  for (const r of rows) {
    const fieldCols = [];
    r.forEach((_, idx) => { if (!special.has(idx + 1)) fieldCols.push(idx); });
    const conv = (v) => (meta.html ? htmlToText(v) : String(v ?? "").trim());
    let front = conv(r[fieldCols[0]]);
    let back = conv(fieldCols.length > 1 ? r[fieldCols[1]] : "");
    if (CLOZE_TEST.test(front)) {
      const qa = clozeToQA(front, back);
      front = qa.front; back = qa.back;
    }
    if (!front || !back) { skipped++; continue; }
    const deckRaw = meta.deckCol ? String(r[meta.deckCol - 1] ?? "").trim() : "";
    const guid = meta.guidCol ? String(r[meta.guidCol - 1] ?? "").trim() : "";
    cards.push({ deck: deckRaw || meta.deck || defaultDeck, front, back, guid: guid || undefined });
  }
  return { cards, skipped };
}

function quoteField(s, forceQuote = false) {
  const v = String(s).replace(/\t/g, " ");
  if (forceQuote || /["\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function buildAnkiText(decks, { includeDeckColumn = false } = {}) {
  const lines = ["#separator:tab", "#html:true"];
  if (includeDeckColumn) lines.push("#deck column:3");
  for (const d of decks) {
    for (const c of d.cards) {
      const front = sideHtmlNoImages(c.front, c.html);
      const cols = [quoteField(front, front.startsWith("#")), quoteField(sideHtmlNoImages(c.back, c.html))];
      if (includeDeckColumn) cols.push(quoteField(d.name));
      lines.push(cols.join("\t"));
    }
  }
  return lines.join("\n") + "\n";
}

/* ---------------- mesclar cartões importados ---------------- */
export function mergeImportedCards(decks, cards, makeId) {
  const out = decks.map((d) => ({ ...d, cards: [...d.cards] }));
  const seen = new Map();
  const keyOf = (c) => `${c.front}\u0000${c.back}`;
  const setFor = (deck) => {
    if (!seen.has(deck.id)) seen.set(deck.id, new Set(deck.cards.map(keyOf)));
    return seen.get(deck.id);
  };
  let added = 0;
  let dup = 0;
  const touched = new Set();
  for (const c of cards) {
    const name = (c.deck || "Importados").trim() || "Importados";
    let deck = out.find((d) => d.name.toLowerCase() === name.toLowerCase());
    if (!deck) { deck = { id: makeId(), name, cards: [] }; out.push(deck); }
    const set = setFor(deck);
    const k = keyOf(c);
    if (set.has(k)) { dup++; continue; }
    set.add(k);
    // Cartões vindos de .apkg trazem o progresso (caixa, próxima revisão, última revisão)
    const card = { id: makeId(), front: c.front, back: c.back, box: c.box || 1 };
    if (c.dueAt) card.dueAt = c.dueAt;
    if (c.lastReview) card.lastReview = c.lastReview;
    if (c.guid) card.guid = c.guid;
    deck.cards.push(card);
    added++;
    touched.add(deck.id);
  }
  return { decks: out, added, dup, deckCount: touched.size };
}

/* ---------------- carregamento sob demanda das bibliotecas ---------------- */
const CDN = {
  jszip: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  sqljs: "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.js",
  sqlBase: "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/",
  fzstd: "https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js",
};
const scriptLoads = {};
function loadScriptOnce(url) {
  if (!scriptLoads[url]) {
    scriptLoads[url] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.crossOrigin = "anonymous"; // resposta com CORS: pode ser guardada no cache offline
      s.onload = resolve;
      s.onerror = () => {
        delete scriptLoads[url];
        reject(new Error("Não foi possível carregar uma biblioteca necessária. Verifique a internet e tente de novo."));
      };
      document.head.appendChild(s);
    });
  }
  return scriptLoads[url];
}
async function getJSZip() {
  if (!window.JSZip) await loadScriptOnce(CDN.jszip);
  return window.JSZip;
}
let sqlPromise = null;
function getSqlJs() {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      await loadScriptOnce(CDN.sqljs);
      return window.initSqlJs({ locateFile: (f) => CDN.sqlBase + f });
    })().catch((e) => { sqlPromise = null; throw e; });
  }
  return sqlPromise;
}
async function getFzstd() {
  if (!window.fzstd) await loadScriptOnce(CDN.fzstd);
  return window.fzstd;
}

/* ---------------- leitura de coleção Anki (SQLite) ---------------- */
function rowsOf(db, sql) {
  const res = db.exec(sql);
  if (!res || !res.length) return [];
  const { columns, values } = res[0];
  return values.map((v) => {
    const o = {};
    columns.forEach((c, i) => { o[c] = v[i]; });
    return o;
  });
}
const normDeck = (n) => String(n ?? "").split(SEP).join("::").trim();

export function readCollection(db) {
  const tables = new Set(rowsOf(db, "SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name));
  const deckNames = {};
  if (tables.has("decks")) {
    // Esquema novo: usa NOT INDEXED para não depender da collation "unicase" do Anki.
    try { rowsOf(db, "SELECT id, name FROM decks NOT INDEXED").forEach((r) => { deckNames[r.id] = normDeck(r.name); }); } catch { /* sem nomes */ }
  } else if (tables.has("col")) {
    try {
      const r = rowsOf(db, "SELECT decks FROM col")[0];
      Object.values(JSON.parse(r.decks)).forEach((d) => { deckNames[d.id] = normDeck(d.name); });
    } catch { /* sem nomes */ }
  }
  const cardDeck = {};
  const cardIdToNid = new Map();
  rowsOf(db, "SELECT id, nid, did FROM cards ORDER BY nid, ord").forEach((r) => {
    cardIdToNid.set(r.id, r.nid);
    if (cardDeck[r.nid] === undefined) cardDeck[r.nid] = r.did;
  });
  const out = [];
  let skipped = 0;
  rowsOf(db, "SELECT id AS nid, guid, flds FROM notes").forEach((n) => {
    const parts = String(n.flds).split(SEP).map(htmlToText);
    const first = parts[0] || "";
    const rest = parts.slice(1).filter(Boolean);
    let front;
    let back;
    if (CLOZE_TEST.test(first)) ({ front, back } = clozeToQA(first, rest.join("\n\n")));
    else { front = first; back = rest.join("\n\n"); }
    if (!front || !back) { skipped++; return; }
    let deck = deckNames[cardDeck[n.nid]] || "Importados";
    if (deck.toLowerCase() === "default" || deck.toLowerCase() === "padrão") deck = "Importados";
    out.push({ deck, front, back, nid: n.nid, guid: n.guid ? String(n.guid) : undefined });
  });

  // Progresso de revisão (caixa, próxima revisão, última revisão). Se falhar, importa como novo.
  let cards = out;
  let withProgress = 0;
  try {
    cards = applyProgressToCards(out, readCardProgress(db), readRevlog(db, cardIdToNid), readCrt(db));
    withProgress = cards.filter((c) => c.box > 1 || c.dueAt).length;
  } catch { /* sem progresso */ }
  return { cards, skipped, withProgress };
}

export async function parseApkgFile(file, deps = {}) {
  const JSZip = deps.JSZip || (await getJSZip());
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  let name = ["collection.anki21b", "collection.anki21", "collection.anki2"].find((n) => zip.file(n));
  if (!name) throw new Error("Este arquivo não parece um pacote do Anki (.apkg/.colpkg).");
  let bytes = await zip.file(name).async("uint8array");
  if (name === "collection.anki21b") {
    const fz = deps.fzstd || (await getFzstd());
    bytes = fz.decompress(bytes);
  }
  const SQL = deps.SQL || (await getSqlJs());
  const db = new SQL.Database(bytes);
  try {
    return readCollection(db);
  } catch (e) {
    throw new Error("Não consegui ler este pacote. No Anki, exporte marcando \"Suporte para versões mais antigas do Anki\" (ou exporte como texto) e tente de novo.");
  } finally {
    try { db.close(); } catch { /* noop */ }
  }
}

/* ---------------- gravação de .apkg (formato legado) ---------------- */
const B91 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~";
function base91(n) {
  let s = "";
  do { s = B91[Number(n % 91n)] + s; n /= 91n; } while (n > 0n);
  return s;
}
async function sha1Hex(str) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function guidFor(card) {
  if (card.guid) return card.guid;
  const h = await sha1Hex(`plano-estudos:${card.id}`);
  return base91(BigInt("0x" + h.slice(0, 16)));
}

const MODEL_ID = 1770000000001;
const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

function deckJson(id, name, nowSec) {
  return {
    id, name, mod: nowSec, usn: -1, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0],
    collapsed: false, browserCollapsed: false, desc: "", dyn: 0, conf: 1, extendNew: 10, extendRev: 50,
  };
}

function modelJson(firstDeckId, nowSec) {
  const fld = (name, ord) => ({ name, ord, sticky: false, rtl: false, font: "Arial", size: 20, media: [] });
  return {
    id: MODEL_ID, name: "Basic (Plano de Estudos)", type: 0, mod: nowSec, usn: -1, sortf: 0, did: firstDeckId,
    tmpls: [{ name: "Card 1", ord: 0, qfmt: "{{Front}}", afmt: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}", bqfmt: "", bafmt: "", did: null, bfont: "", bsize: 0 }],
    flds: [fld("Front", 0), fld("Back", 1)],
    css: ".card {\n font-family: arial;\n font-size: 20px;\n text-align: center;\n color: black;\n background-color: white;\n}\n",
    latexPre: "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
    latexPost: "\\end{document}", latexsvg: false, req: [[0, "any", [0]]], tags: [], vers: [],
  };
}

const DCONF = {
  1: {
    autoplay: true, id: 1, lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 }, maxTaken: 60, mod: 0, name: "Default",
    new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true },
    replayq: true, rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 100 }, timer: 0, usn: 0,
  },
};

/**
 * Gera um .apkg.
 * @param {Array} decks
 * @param {{withHistory?: boolean}} opts  withHistory (padrão: true) inclui caixa/próxima revisão/revlog
 * @param {{JSZip?, SQL?, outputType?}} deps
 */
export async function buildApkgBlob(decks, opts = {}, deps = {}) {
  const withHistory = opts.withHistory !== false;
  const JSZip = deps.JSZip || (await getJSZip());
  const SQL = deps.SQL || (await getSqlJs());
  const db = new SQL.Database();
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  let seq = 0;
  const nextId = () => nowMs + 1000 + seq++;

  const deckMap = { 1: deckJson(1, "Default", nowSec) };
  const deckIds = decks.map((d, i) => {
    const id = nowMs + i + 1;
    deckMap[id] = deckJson(id, d.name, nowSec);
    return id;
  });
  const firstDeck = deckIds[0] || 1;
  const conf = {
    activeDecks: [1], addToCur: true, collapseTime: 1200, curDeck: 1, curModel: String(MODEL_ID), dueCounts: true, estTimes: true,
    newBury: true, newSpread: 0, nextPos: 1, sortBackwards: false, sortType: "noteFld", timeLim: 0,
  };
  const models = { [MODEL_ID]: modelJson(firstDeck, nowSec) };
  // `due` dos cartões em revisão conta dias desde a criação da coleção (crt)
  const crt = makeCrt();
  const { byCardId } = withHistory ? buildProgressForExport(decks, crt) : { byCardId: new Map() };
  const usedRevIds = new Set();

  try {
    db.run(SCHEMA);
    db.run("INSERT INTO col VALUES (1,?,?,?,11,0,0,0,?,?,?,?,?)", [
      crt, nowMs, nowMs, JSON.stringify(conf), JSON.stringify(models),
      JSON.stringify(deckMap), JSON.stringify(DCONF), "{}",
    ]);
    db.run("BEGIN");
    const insNote = db.prepare("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    const insCard = db.prepare("INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const insRev = db.prepare("INSERT INTO revlog VALUES (?,?,?,?,?,?,?,?,?)");
    let pos = 1;
    for (let di = 0; di < decks.length; di++) {
      for (const c of decks[di].cards) {
        const noteId = nextId();
        const cardId = nextId();
        const frontPlain = sideToPlain(c.front, c.html);
        const csum = parseInt((await sha1Hex(frontPlain)).slice(0, 8), 16);
        const flds = (await sideHtmlForApkg(c.front, c.html)) + SEP + (await sideHtmlForApkg(c.back, c.html));
        const prog = byCardId.get(c.id) || { ivl: 0, factor: 0, type: 0, queue: 0, reps: 0, due: null, revlog: [] };
        insNote.run([noteId, await guidFor(c), MODEL_ID, nowSec, -1, "", flds, frontPlain, csum, 0, ""]);
        // cartão novo: `due` é a posição na fila; em revisão: dia (desde crt) da próxima revisão
        insCard.run([cardId, noteId, deckIds[di], 0, nowSec, -1, prog.type, prog.queue, prog.due ?? pos, prog.ivl, prog.factor, prog.reps, 0, 0, 0, 0, 0, ""]);
        pos++;
        for (const r of prog.revlog || []) {
          let revId = r.id; // horário da revisão (ms), chave primária: precisa ser único
          while (usedRevIds.has(revId)) revId += 1;
          usedRevIds.add(revId);
          insRev.run([revId, cardId, -1, r.ease, r.ivl, r.lastIvl, r.factor, r.time, r.type]);
        }
      }
    }
    insNote.free();
    insCard.free();
    insRev.free();
    db.run("COMMIT");
    const bytes = db.export();
    const zip = new JSZip();
    zip.file("collection.anki2", bytes);
    zip.file("media", "{}");
    return await zip.generateAsync({ type: deps.outputType || "blob", compression: "DEFLATE" });
  } finally {
    try { db.close(); } catch { /* noop */ }
  }
}
