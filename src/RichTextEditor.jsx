import React, { useRef, useState, useCallback } from "react";
import {
  Bold, Italic, Underline, Strikethrough, Highlighter,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Image as ImageIcon, Palette, Eraser, ClipboardPaste,
} from "lucide-react";
import { sanitizeHtml, isEmptyHtml, stripHtml, cleanHtmlKeepImages } from "./richText.js";
import { saveImage, getImage, dataUrlToBlobUrl } from "./imageStore.js";

const COLORS = {
  bg: "#0F1826", bg2: "#0B121D", card: "#16233A", cardBorder: "#233350",
  text: "#EDEFF2", sub: "#93A2BA", gold: "#C9A24B", rose: "#D6685C", teal: "#3FA796",
};

const FONT_COLORS = ["#EDEFF2", "#C9A24B", "#D6685C", "#3FA796", "#6C8CFF", "#E07BE0"];
const HIGHLIGHTS = ["#C9A24B55", "#D6685C55", "#3FA79655", "#6C8CFF55", "#E07BE055"];

function wrapSelection(textarea, before, after = "") {
  if (!textarea) return null;
  const { selectionStart: s, selectionEnd: e, value } = textarea;
  const selected = value.slice(s, e) || "texto";
  const next = value.slice(0, s) + before + selected + after + value.slice(e);
  const cursor = s + before.length + selected.length;
  return { next, cursor };
}

function applyStyle(styleString) {
  return (textarea) => {
    if (!textarea) return null;
    const { selectionStart: s, selectionEnd: e, value } = textarea;
    const selected = value.slice(s, e) || "texto";
    const tag = `<span style="${styleString}">${selected}</span>`;
    const next = value.slice(0, s) + tag + value.slice(e);
    return { next, cursor: s + tag.length };
  };
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = "",
  minHeight = 120,
  label,
}) {
  const textareaRef = useRef(null);
  const fileRef = useRef(null);
  const [showColors, setShowColors] = useState(false);
  const [showHighlight, setShowHighlight] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);
  const [toast, setToast] = useState("");

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(""), 1800); };

  const setValue = useCallback((next, cursor) => {
    onChange(next);
    if (cursor != null) {
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(cursor, cursor);
      });
    }
  }, [onChange]);

  const run = (fn) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const r = fn(ta);
    if (r) setValue(r.next, r.cursor);
  };

  const insertImageAtCursor = async (file) => {
    setError("");
    setUploading(true);
    try {
      const img = await saveImage(file);
      const ta = textareaRef.current;
      const tag = `<img src="app://${img.id}" alt="${file.name || "colada"}" style="max-width: 100%; height: auto;" />`;
      if (ta) {
        const { selectionStart: s, value: v } = ta;
        const next = v.slice(0, s) + tag + v.slice(s);
        setValue(next, s + tag.length);
      } else {
        setValue(value + tag);
      }
      flash("Imagem colada");
    } catch (err) {
      setError(err.message || "Falha ao salvar a imagem.");
    } finally {
      setUploading(false);
    }
  };

  const onPickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await insertImageAtCursor(file);
  };

  const onPaste = async (e) => {
    const items = e.clipboardData?.items;
    if (!items || !items.length) return;
    let imageFile = null;
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) { imageFile = f; break; }
      }
    }
    if (!imageFile) return;
    e.preventDefault();
    if (!imageFile.name || imageFile.name === "image.png") {
      const ext = imageFile.type.split("/")[1] || "png";
      imageFile = new File([imageFile], `colada-${Date.now()}.${ext}`, { type: imageFile.type });
    }
    await insertImageAtCursor(imageFile);
  };

  const pasteFromClipboard = async () => {
    setError("");
    try {
      if (!navigator.clipboard || !navigator.clipboard.read) {
        setError("Seu navegador não permite ler o clipboard por botão. Use Ctrl+V dentro do campo.");
        return;
      }
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgType = item.types.find((t) => t.startsWith("image/"));
        if (imgType) {
          const blob = await item.getType(imgType);
          const ext = imgType.split("/")[1] || "png";
          const file = new File([blob], `colada-${Date.now()}.${ext}`, { type: imgType });
          await insertImageAtCursor(file);
          return;
        }
      }
      setError("Não encontrei imagem no clipboard. Copie um print primeiro.");
    } catch (err) {
      if (err && err.name === "NotAllowedError") {
        setError("Permissão de leitura do clipboard negada. Use Ctrl+V dentro do campo.");
      } else {
        setError("Não consegui ler o clipboard. Use Ctrl+V dentro do campo.");
      }
    }
  };

  const erase = (e) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: en, value: v } = ta;
    if (e.shiftKey) { const clean = stripHtml(v); setValue(clean, clean.length); return; }
    if (e.altKey) { const clean = cleanHtmlKeepImages(v); setValue(clean, clean.length); return; }
    if (s === en) {
      const left = v.lastIndexOf(" ", s - 1);
      const right = v.indexOf(" ", en);
      const a = left === -1 ? 0 : left + 1;
      const b = right === -1 ? v.length : right;
      const selected = v.slice(a, b);
      const plain = stripHtml(selected);
      setValue(v.slice(0, a) + plain + v.slice(b), a + plain.length);
      return;
    }
    const selected = v.slice(s, en);
    const plain = stripHtml(selected);
    setValue(v.slice(0, s) + plain + v.slice(en), s + plain.length);
  };

  const buttons = [
    { icon: Bold, title: "Negrito (Ctrl+B)", fn: () => run((t) => wrapSelection(t, "<b>", "</b>")) },
    { icon: Italic, title: "Itálico (Ctrl+I)", fn: () => run((t) => wrapSelection(t, "<i>", "</i>")) },
    { icon: Underline, title: "Sublinhado (Ctrl+U)", fn: () => run((t) => wrapSelection(t, "<u>", "</u>")) },
    { icon: Strikethrough, title: "Riscado", fn: () => run((t) => wrapSelection(t, "<s>", "</s>")) },
    { icon: AlignLeft, title: "Alinhar à esquerda", fn: () => run(applyStyle("text-align: left; display: block;")) },
    { icon: AlignCenter, title: "Centralizar", fn: () => run(applyStyle("text-align: center; display: block;")) },
    { icon: AlignRight, title: "Alinhar à direita", fn: () => run(applyStyle("text-align: right; display: block;")) },
    { icon: AlignJustify, title: "Justificar", fn: () => run(applyStyle("text-align: justify; display: block;")) },
  ];

  const onKeyDown = (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "b") { e.preventDefault(); run((t) => wrapSelection(t, "<b>", "</b>")); }
    else if (k === "i") { e.preventDefault(); run((t) => wrapSelection(t, "<i>", "</i>")); }
    else if (k === "u") { e.preventDefault(); run((t) => wrapSelection(t, "<u>", "</u>")); }
  };

  const previewHtml = useResolvedPreview(value, preview);

  return (
    <div className="rounded-lg border" style={{ borderColor: COLORS.cardBorder, background: COLORS.bg2 }}>
      {label && (
        <div className="px-3 pt-2 text-[11px] font-medium" style={{ color: COLORS.sub }}>{label}</div>
      )}
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b" style={{ borderColor: COLORS.cardBorder }}>
        {buttons.map((b, i) => {
          const Icon = b.icon;
          return (
            <button key={i} type="button" onClick={b.fn} title={b.title} aria-label={b.title}
              className="p-1.5 rounded hover:opacity-80" style={{ color: COLORS.sub }}>
              <Icon size={14} />
            </button>
          );
        })}
        <span className="mx-1 h-4 w-px" style={{ background: COLORS.cardBorder }} />
        <div className="relative">
          <button type="button" onClick={() => { setShowColors((v) => !v); setShowHighlight(false); }}
            title="Cor da fonte" className="p-1.5 rounded" style={{ color: COLORS.sub }}>
            <Palette size={14} />
          </button>
          {showColors && (
            <div className="absolute z-30 mt-1 flex gap-1 rounded-lg border p-1.5"
              style={{ background: COLORS.card, borderColor: COLORS.cardBorder }}>
              {FONT_COLORS.map((c) => (
                <button key={c} type="button"
                  onClick={() => { run(applyStyle(`color: ${c};`)); setShowColors(false); }}
                  className="h-5 w-5 rounded-full border"
                  style={{ background: c, borderColor: COLORS.cardBorder }} title={c} />
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          <button type="button" onClick={() => { setShowHighlight((v) => !v); setShowColors(false); }}
            title="Marca-texto" className="p-1.5 rounded" style={{ color: COLORS.sub }}>
            <Highlighter size={14} />
          </button>
          {showHighlight && (
            <div className="absolute z-30 mt-1 flex gap-1 rounded-lg border p-1.5"
              style={{ background: COLORS.card, borderColor: COLORS.cardBorder }}>
              {HIGHLIGHTS.map((c) => (
                <button key={c} type="button"
                  onClick={() => { run(applyStyle(`background-color: ${c};`)); setShowHighlight(false); }}
                  className="h-5 w-5 rounded-full border"
                  style={{ background: c, borderColor: COLORS.cardBorder }} title={c} />
              ))}
            </div>
          )}
        </div>
        <span className="mx-1 h-4 w-px" style={{ background: COLORS.cardBorder }} />
        <button type="button" onClick={() => fileRef.current?.click()}
          disabled={uploading} title="Inserir imagem do arquivo"
          className="p-1.5 rounded" style={{ color: COLORS.sub }}>
          <ImageIcon size={14} />
        </button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden" onChange={onPickImage} />
        <button type="button" onClick={pasteFromClipboard}
          disabled={uploading} title="Colar imagem do clipboard (alternativa ao Ctrl+V)"
          className="p-1.5 rounded" style={{ color: COLORS.sub }}>
          <ClipboardPaste size={14} />
        </button>
        <span className="mx-1 h-4 w-px" style={{ background: COLORS.cardBorder }} />
        <button type="button" onClick={erase}
          title="Limpar formatação da seleção · Shift+clique: limpar tudo · Alt+clique: limpar texto e manter imagens"
          className="p-1.5 rounded hover:opacity-80" style={{ color: COLORS.rose }}>
          <Eraser size={14} />
        </button>
        <span className="mx-1 h-4 w-px" style={{ background: COLORS.cardBorder }} />
        <button type="button" onClick={() => setPreview((v) => !v)}
          title="Pré-visualizar" className="text-[11px] px-1.5 py-1 rounded"
          style={{ color: preview ? COLORS.gold : COLORS.sub }}>
          {preview ? "Editar" : "Ver"}
        </button>
        {uploading && <span className="text-[10px] ml-1" style={{ color: COLORS.sub }}>enviando imagem…</span>}
      </div>
      {preview ? (
        <div className="px-3 py-2 text-sm whitespace-pre-wrap"
          style={{ minHeight, color: COLORS.text }}
          dangerouslySetInnerHTML={{ __html: previewHtml }} />
      ) : (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          className="w-full resize-y px-3 py-2 text-sm outline-none bg-transparent"
          style={{ color: COLORS.text, minHeight }}
        />
      )}
      {toast && (
        <div className="mx-3 mb-2 inline-block rounded-full px-2 py-0.5 text-[10px]"
          style={{ background: COLORS.teal + "22", color: COLORS.teal }}>{toast}</div>
      )}
      {error && <p className="px-3 pb-2 text-[11px]" style={{ color: COLORS.rose }}>{error}</p>}
      {!preview && !isEmptyHtml(value) && (
        <div className="px-3 pb-2 text-[10px]" style={{ color: COLORS.sub }}>
          Cole uma imagem com Ctrl+V (ou botão da prancheta). O Anki entende.
        </div>
      )}
    </div>
  );
}

function useResolvedPreview(value, active) {
  const [html, setHtml] = useState("");
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!active) { setHtml(""); return; }
      const safe = sanitizeHtml(value || "");
      if (!/app:\/\//.test(safe)) { setHtml(safe); return; }
      const ids = Array.from(safe.matchAll(/app:\/\/([^"]+)/g)).map((m) => m[1]);
      const map = {};
      for (const id of ids) {
        try {
          const rec = await getImage(id);
          if (rec) map[id] = dataUrlToBlobUrl(rec.dataUrl);
        } catch { /* ignore */ }
      }
      const resolved = safe.replace(/app:\/\/([^"]+)/g, (m, id) => map[id] || m);
      if (!cancelled) setHtml(resolved);
    })();
    return () => { cancelled = true; };
  }, [value, active]);
  return html;
}
