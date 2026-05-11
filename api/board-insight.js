const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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
    return new Response(JSON.stringify({ insight: "API key not configured." }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const cardsText = cards
    .map((c, i) => `[${i + 1}] [${c.tag}] ${c.text}${c.note ? ` — Note: ${c.note}` : ""}`)
    .join("\n");

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
            content:
              "Sen stratejik bir danışmansın. Board kartlarını analiz et ve SADECE 3 madde döndür — fazlası değil. Her madde max 10 kelime, eyleme dönüştürülebilir, Türkçe. Format tam olarak şöyle olsun:\n• [madde 1]\n• [madde 2]\n• [madde 3]\nHiçbir giriş cümlesi, açıklama veya başlık ekleme. Sadece 3 madde.",
          },
          {
            role: "user",
            content: `Board cards:\n${cardsText}`,
          },
        ],
        max_tokens: 120,
        temperature: 0.4,
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
