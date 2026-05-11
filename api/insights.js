const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SYSTEM = `You are a strategic advisor analyzing research notes and conversation history.

Return ONLY valid JSON, no markdown, no explanation:
{
  "connections": [
    {"text": "Specific pattern or link between items (1 sentence)", "color": "#7c6df0"}
  ],
  "blocker": "The single most important thing blocking progress (1-2 sentences, or empty string if none)",
  "suggestions": [
    "Specific actionable suggestion 1",
    "Specific actionable suggestion 2",
    "Specific actionable suggestion 3"
  ]
}

Rules:
- connections: 2-3 items MAX. Each must be a specific, non-obvious insight.
- blocker: 1 concrete blocker. Empty string if none detected.
- suggestions: 2-3 specific, actionable next steps based on the research.
- Available colors: #7c6df0 (purple), #3ecfb8 (teal), #f0b86d (orange), #4ecb7a (green). Vary them.`;

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body;
  try { body = await req.json(); } catch { return new Response("Invalid body", { status: 400 }); }

  const { cards = [], history = [] } = body;
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return new Response(JSON.stringify({ connections: [], blocker: "", suggestions: [] }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const cardsText = cards.length
    ? `Board notes:\n${cards.map((c, i) => `[${i + 1}] [${c.tag}] ${c.text}`).join("\n")}`
    : "No board notes yet.";

  const histSummary = history
    .slice(-8)
    .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
    .join("\n");
  const histText = histSummary ? `\n\nConversation context:\n${histSummary}` : "";

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
          { role: "system", content: SYSTEM },
          { role: "user", content: `${cardsText}${histText}` },
        ],
        max_tokens: 600,
        temperature: 0.4,
      }),
    });
    if (!res.ok) throw new Error("Groq error");
    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content || "").trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let parsed = { connections: [], blocker: "", suggestions: [] };
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); } catch { /* keep default */ }
    }
    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ connections: [], blocker: "", suggestions: [] }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
}

export const config = { runtime: "edge" };
