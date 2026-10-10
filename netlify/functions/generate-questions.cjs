// Gera questões de múltipla escolha com o Gemini (fetch puro, sem SDK).
// Formato devolvido ao app: { questions: [{ question, options[4], correctIndex, explanation }] }

// Tenta os modelos em ordem; se um for aposentado (404) ou indisponível, passa para o próximo.
const MODELS = ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-2.5-flash-lite"];

function buildPrompt(topic) {
  return `Você cria questões de múltipla escolha estilo banca de concurso público brasileiro.
Crie 3 questões de múltipla escolha (4 alternativas cada) sobre o tema: "${topic}".
Responda ESTRITAMENTE em formato JSON válido, sem qualquer texto ou marcação markdown antes ou depois.

Formato esperado:
{
  "questions": [
    {
      "question": "Texto da pergunta",
      "options": ["A) Opção 1", "B) Opção 2", "C) Opção 3", "D) Opção 4"],
      "correctIndex": 0,
      "explanation": "Explicação do gabarito"
    }
  ]
}`;
}

// Garante exatamente a estrutura que o App.jsx espera.
function normalize(parsed) {
  const list = Array.isArray(parsed) ? parsed : parsed && parsed.questions;
  if (!Array.isArray(list)) throw new Error("Resposta fora do formato esperado");
  const questions = list
    .map((q) => ({
      question: String(q.question || "").trim(),
      options: Array.isArray(q.options) ? q.options.map((o) => String(o)) : [],
      correctIndex: Number.isInteger(q.correctIndex) ? q.correctIndex : Number(q.correctIndex),
      explanation: String(q.explanation || "").trim(),
    }))
    .filter((q) => q.question && q.options.length >= 2 && Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < q.options.length);
  if (!questions.length) throw new Error("Nenhuma questão válida na resposta");
  return { questions };
}

async function callModel(model, apiKey, topic) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(topic) }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const err = new Error((data.error && data.error.message) || `Erro ${response.status}`);
    err.status = response.status;
    throw err;
  }
  const raw = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
  if (!raw) throw new Error("Resposta vazia do modelo");
  return normalize(JSON.parse(String(raw).replace(/```json|```/g, "").trim()));
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let topic;
  try {
    ({ topic } = JSON.parse(event.body || "{}"));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Requisição inválida" }) };
  }
  if (!topic || !String(topic).trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: "Topic is required" }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Gemini API Key não configurada (GEMINI_API_KEY)" }) };
  }

  let lastError = null;
  for (const model of MODELS) {
    try {
      const result = await callModel(model, apiKey, String(topic).trim());
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) };
    } catch (err) {
      lastError = err;
      console.error(`Falha com ${model}:`, err.message);
      // Chave inválida/sem permissão: trocar de modelo não ajuda
      if (err.status === 400 || err.status === 401 || err.status === 403) break;
    }
  }

  return {
    statusCode: 500,
    body: JSON.stringify({ error: "Falha ao gerar questões", details: lastError ? lastError.message : "desconhecido" }),
  };
};
