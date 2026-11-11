import React, { useEffect, useState } from "react";
import { sanitizeHtml } from "./richText.js";
import { getImage } from "./imageStore.js";

// Mostra um lado de cartão. Cartões antigos (texto puro) mantêm o comportamento de antes;
// cartões do editor rico (html: true) são sanitizados e as imagens app://<id> são resolvidas
// a partir do IndexedDB.
export default function RichFace({ text, html, className = "" }) {
  const [resolved, setResolved] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!html) { setResolved(""); return; }
      const safe = sanitizeHtml(text || "");
      const ids = Array.from(new Set(Array.from(safe.matchAll(/app:\/\/([^"]+)/g)).map((m) => m[1])));
      const map = {};
      for (const id of ids) {
        try { const rec = await getImage(id); if (rec) map[id] = rec.dataUrl; } catch { /* ignora */ }
      }
      const out = safe.replace(/app:\/\/([^"]+)/g, (m, id) => map[id] || "");
      if (!cancelled) setResolved(out);
    })();
    return () => { cancelled = true; };
  }, [text, html]);

  if (!html) return <p className={`whitespace-pre-wrap ${className}`}>{text}</p>;
  return <div className={className} dangerouslySetInnerHTML={{ __html: resolved }} />;
}
