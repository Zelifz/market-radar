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
              "You are a strategic advisor. Analyze research board cards and give a concise synthesis in 3-4 sentences. Identify: the strongest pattern, the best opportunity, and the single most critical next action. Be direct and actionable. No bullet points — flowing prose only.",
          },
          {
            role: "user",
            content: `Board cards:\n${cardsText}`,
          },
        ],
        max_tokens: 300,
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
