// richText.js — helpers para o HTML do editor.
// O cartão guarda HTML na frente/verso. Aqui: sanitização, conversão para
// texto puro e limpeza de formatação (borracha).

const ALLOWED_TAGS = new Set([
  "b", "strong", "i", "em", "u", "s", "strike", "br", "p", "div", "span",
  "ul", "ol", "li", "sub", "sup", "img", "mark", "small", "big",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "code", "pre",
]);
const ALLOWED_ATTRS = new Set([
  "style", "src", "alt", "title", "width", "height", "align", "class",
]);
const ALLOWED_STYLES = /^(color|background-color|font-weight|font-style|text-decoration|text-align|font-size|font-family|width|height|max-width)\s*:/i;

function sanitizeStyle(style) {
  return String(style)
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s && ALLOWED_STYLES.test(s))
    .filter((s) => !/url\s*\(/i.test(s))
    .filter((s) => !/javascript\s*:/i.test(s))
    .join("; ");
}

export function sanitizeHtml(html) {
  if (!html) return "";
  const tpl = document.createElement("template");
  tpl.innerHTML = String(html);
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_ELEMENT, null);
  const toRemove = [];
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (!ALLOWED_TAGS.has(el.tagName.toLowerCase())) {
      toRemove.push(el);
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const val = attr.value;
      if (!ALLOWED_ATTRS.has(name)) { el.removeAttribute(attr.name); continue; }
      if (name === "style") {
        const safe = sanitizeStyle(val);
        if (safe) el.setAttribute("style", safe); else el.removeAttribute("style");
        continue;
      }
      if (name === "src") {
        if (!/^(app:\/\/|data:image\/|https:\/\/|blob:)/i.test(val)) {
          el.removeAttribute("src");
        }
      }
    }
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.toLowerCase().startsWith("on")) el.removeAttribute(attr.name);
    }
  }
  for (const el of toRemove) {
    if (["script", "style", "iframe", "object", "embed"].includes(el.tagName.toLowerCase())) {
      el.remove();
    } else {
      el.replaceWith(...el.childNodes);
    }
  }
  return tpl.innerHTML;
}

export function htmlToPlainText(html) {
  if (!html) return "";
  const tpl = document.createElement("template");
  tpl.innerHTML = String(html);
  const text = tpl.content.textContent || "";
  return text.replace(/\s+/g, " ").trim();
}

export function isEmptyHtml(html) {
  if (!html) return true;
  if (/<img\b/i.test(html)) return false;
  return htmlToPlainText(html).length === 0;
}

export function countImages(html) {
  if (!html) return 0;
  return (html.match(/<img\b/gi) || []).length;
}

export function stripHtml(html) {
  if (!html) return "";
  let s = String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|h[1-6]|li|tr|blockquote)>/gi, "\n")
    .replace(/<(div|p|h[1-6]|li|tr|blockquote)[^>]*>/gi, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "");
  const tpl = document.createElement("template");
  tpl.innerHTML = s;
  s = tpl.content.textContent || "";
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

export function cleanHtmlKeepImages(html) {
  if (!html) return "";
  const tpl = document.createElement("template");
  tpl.innerHTML = String(html);
  const imgs = Array.from(tpl.content.querySelectorAll("img")).map((el) => el.outerHTML);
  const text = stripHtml(html);
  return (text + (imgs.length ? "\n\n" + imgs.join("\n") : "")).trim();
}

export function markdownLiteToHtml(text) {
  if (!text) return "";
  let s = String(text);
  s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/__([^_]+)__/g, "<b>$1</b>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<i>$2</i>");
  s = s.replace(/(^|[^_])_([^_]+)_/g, "$1<i>$2</i>");
  s = s.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  s = s.replace(/\r?\n/g, "<br>");
  return s;
}
