exports.handler = async function (event, context) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { topic } = JSON.parse(event.body || "{}");
    if (!topic) {
      return { statusCode: 400, body: JSON.stringify({ error: "Topic is required" }) };
    }

    const apiKey = process.env.GEMINI_API_KEY; // Sua chave gratuita do Gemini
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "Gemini API Key não configurada" }) };
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Você cria questões de múltipla escolha estilo banca de concurso público brasileiro.
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
}`
                }
              ]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: data.error?.message || "Erro na API do Gemini" }),
      };
    }

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = JSON.parse(rawText);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Falha ao gerar questões", details: error.message }),
    };
  }
};
