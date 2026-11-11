// imageStore.js — armazenamento de imagens em IndexedDB.
// Cada imagem vira { id, mime, dataUrl, createdAt }. O cartão guarda só o id.
// No export, o id vira base64 inline no HTML do Anki.

const DB_NAME = "plano-estudos-images";
const DB_VERSION = 1;
const STORE = "images";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export async function saveImage(file) {
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("O arquivo precisa ser uma imagem (jpg, png, gif, webp).");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("A imagem é muito grande (limite: 5 MB por imagem).");
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const id = `img_${uid()}.${file.type.split("/")[1] || "png"}`;
  const record = { id, mime: file.type, dataUrl, createdAt: Date.now() };
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return { id, mime: record.mime, dataUrl };
}

export async function getImage(id) {
  const db = await openDB();
  const record = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return record;
}

export async function deleteImage(id) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function clearImages() {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export function dataUrlToBlobUrl(dataUrl) {
  try {
    const [meta, b64] = dataUrl.split(",");
    const mime = /data:([^;]+);/.exec(meta)?.[1] || "image/png";
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([arr], { type: mime }));
  } catch {
    return dataUrl;
  }
}

export function extractImageIds(html) {
  if (!html) return [];
  const ids = [];
  const re = /src="app:\/\/([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) ids.push(m[1]);
  return ids;
}
