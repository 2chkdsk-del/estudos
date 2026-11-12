// libraryStore.js — armazenamento de PDFs em IndexedDB.
// O binário grande fica no IndexedDB; os metadados leves (nome, tamanho,
// matéria, anotações) ficam no localStorage, na chave "library-meta".

const DB_NAME = "plano-estudos-pdfs";
const DB_VERSION = 1;
const STORE = "pdfs";
const MAX_BYTES = 50 * 1024 * 1024;

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

export async function savePdf(file) {
  if (!file) throw new Error("Nenhum arquivo selecionado.");
  if (file.type && file.type !== "application/pdf") throw new Error("O arquivo precisa ser um PDF.");
  if (file.size > MAX_BYTES) {
    throw new Error(`O PDF é muito grande (limite: ${Math.round(MAX_BYTES / (1024 * 1024))} MB).`);
  }
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const id = `pdf_${uid()}`;
  const record = { id, name: file.name || "documento.pdf", size: file.size, mime: "application/pdf", dataUrl, createdAt: Date.now() };
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return { id, name: record.name, size: record.size, createdAt: record.createdAt };
}

export async function getPdf(id) {
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

export async function deletePdf(id) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function clearPdfs() {
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
    const mime = /data:([^;]+);/.exec(meta)?.[1] || "application/pdf";
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([arr], { type: mime }));
  } catch {
    return dataUrl;
  }
}
