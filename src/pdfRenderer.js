// pdfRenderer.js — carrega o PDF.js via CDN dinamicamente e expõe helpers
// para renderizar uma página do PDF em um <canvas> e ler o texto da página.
//
// O PDF.js não entra no bundle (fica leve). É carregado só quando o usuário
// abre um PDF pela primeira vez. Depois fica em cache (o SW do PWA já cacheia
// cdnjs.cloudflare.com via Workbox).

const PDFJS_VERSION = "4.7.76";
const CDN = {
  lib: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`,
  worker: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`,
};

let pdfjsPromise = null;

export function getPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* @vite-ignore */ CDN.lib).then((mod) => {
      const lib = mod.default || mod;
      if (lib.GlobalWorkerOptions) lib.GlobalWorkerOptions.workerSrc = CDN.worker;
      return lib;
    }).catch(() => {
      pdfjsPromise = null;
      throw new Error("Não foi possível carregar o leitor de PDF. Verifique a internet e tente de novo.");
    });
  }
  return pdfjsPromise;
}

export async function loadPdfDocument(blobUrl) {
  const pdfjs = await getPdfJs();
  return await pdfjs.getDocument(blobUrl).promise;
}

export async function renderPdfPage(doc, pageNumber, canvasEl, scale = 1.5) {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const dpr = window.devicePixelRatio || 1;
  const ctx = canvasEl.getContext("2d");
  canvasEl.width = Math.floor(viewport.width * dpr);
  canvasEl.height = Math.floor(viewport.height * dpr);
  canvasEl.style.width = `${viewport.width}px`;
  canvasEl.style.height = `${viewport.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { width: viewport.width, height: viewport.height };
}

export async function getTextItems(doc, pageNumber, scale = 1.5) {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const content = await page.getTextContent();
  return content.items.map((item) => {
    const [, , , , e, f] = item.transform;
    const w = item.width || 0;
    const h = item.height || 0;
    return {
      text: item.str,
      x: e * scale,
      y: viewport.height - (f + h) * scale,
      w: w * scale,
      h: h * scale,
    };
  });
}
