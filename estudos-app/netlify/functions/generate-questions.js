// Proxy server-side para a API da Anthropic.
// Mantém sua chave de API em segredo (variável de ambiente no Netlify),
// já que chamadas diretas do navegador para api.anthropic.com não funcionam.
export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "ANTHROPIC_API_KEY não configurada nas variáveis de ambiente do Netlify." }),
    };
  }

  try {
    const { topic } = JSON.parse(event.body || "{}");
    if (!topic || !topic.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: "Informe um tema." }) };
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1200,
        system:
          'Você cria questões de múltipla escolha estilo banca de concurso público brasileiro. Responda APENAS com JSON válido, sem markdown e sem texto fora do JSON, no formato: {"questions":[{"question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correctIndex":0,"explanation":"..."}]}',
        messages: [{ role: "user", content: `Crie 3 questões de múltipla escolha (4 alternativas cada) sobre: ${topic}` }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return { statusCode: response.status, body: JSON.stringify({ error: data.error?.message || "Erro na API da Anthropic." }) };
    }

    const text = (data.content || []).map((b) => b.text || "").join("\n").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(text);

    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Falha ao gerar questões: " + err.message }) };
  }
}
