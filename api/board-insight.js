const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function search(query, apiKey) {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: 5,
        include_answer: false,
        include_raw_content: false,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch { return []; }
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body;
  try { body = await req.json(); } catch { return new Response("Invalid body", { status: 400 }); }

  const { cards = [] } = body;
  if (!cards.length) {
    return new Response(JSON.stringify({ insight: "" }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return new Response(JSON.stringify({ insight: "" }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const tavilyKey = process.env.TAVILY_API_KEY;

  // Build search query from card content to ground the insight in real data
  const cardsSummary = cards.map(c => c.text).join(' ').slice(0, 300);
  const searchQuery = `${cardsSummary} nasıl yapılır strateji 2024 2025`;

  let searchContext = '';
  if (tavilyKey) {
    const results = await search(searchQuery, tavilyKey);
    if (results.length > 0) {
      searchContext = '\n\nWeb araştırma verisi (önerilerini buna dayandır):\n'
        + results.map((r, i) => `[${i + 1}] ${r.title}\n${r.content?.slice(0, 300) || ''}`).join('\n\n');
    }
  }

  const cardsText = cards
    .map((c, i) => `[${i + 1}] [${c.tag}] ${c.text}${c.note ? ` — Not: ${c.note}` : ''}`)
    .join('\n');

  const prompt = `Board kartları:
${cardsText}
${searchContext}

GÖREV: Yukarıdaki board kartlarına ve arama verilerine dayanarak TAM OLARAK 3 madde yaz.

KURALLAR — KESİN:
1. Sadece kartlarda veya arama verisinde GERÇEKten var olan bilgilere dayan. Şirket adı, kişi adı, rakam UYDURMA.
2. Her madde: ne yapılacak + neden (karttan kanıt) + nasıl (somut ilk adım).
3. Bir şey öneriyorsan tam olarak nasıl yapılacağını söyle. "X ile görüş" değil, "X'in web sitesindeki Y formu doldur" gibi.
4. Her madde max 15 kelime. Türkçe.
5. Hiçbir giriş cümlesi, başlık, açıklama ekleme.

FORMAT — sadece bu:
• [madde 1]
• [madde 2]
• [madde 3]`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content: "Sen gerçekçi ve dürüst bir stratejik danışmansın. Asla kart içeriğinde olmayan şirket, kişi veya rakam uydurmazsın. Önerilerini web araştırma verisine dayandırırsın. Yanıtın sadece 3 madde içerir, başka hiçbir şey.",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: 180,
        temperature: 0.3,
      }),
    });
    if (!res.ok) throw new Error("Groq error");
    const data = await res.json();
    const insight = data.choices?.[0]?.message?.content?.trim() || "";
    return new Response(JSON.stringify({ insight }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ insight: "" }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
}

export const config = { runtime: "edge" };
