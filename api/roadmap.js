const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const PRIMARY_MODEL  = 'llama-3.3-70b-versatile';
const FALLBACK_MODEL = 'llama-3.1-8b-instant';

async function callGroq(model, groqKey, body) {
  return fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
    body: JSON.stringify({ model, ...body }),
  });
}

const SYSTEM = `You are a startup strategist. Create a 5-step roadmap from research conversation history.

Return ONLY valid JSON, no markdown, no explanation:
{
  "steps": [
    {
      "id": 1,
      "title": "Short step title (3-5 words)",
      "description": "One sentence description of this step",
      "status": "done",
      "phase": "Discovery"
    }
  ],
  "blocker": "The main current blocker or empty string",
  "canvas": {
    "problem": "Core problem being solved (1 sentence)",
    "solution": "Proposed solution (1 sentence)",
    "market": "Target market (1 sentence)",
    "revenue": "Revenue model (1 sentence)",
    "risk": "Primary risk (1 sentence)",
    "advantage": "Key competitive advantage (1 sentence)"
  }
}

Rules:
- Exactly 5 steps. Status values: "done" | "current" | "pending"
- Exactly 1 step must be "current" — the most logical immediate next action.
- Steps already completed in the conversation should be "done".
- Phase values: Discovery | Validation | Build | Launch | Scale
- Canvas fields: derive from conversation. Use "TBD" if not discussed.
- Keep everything brief — this renders in a narrow 300px sidebar.`;

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body;
  try { body = await req.json(); } catch { return new Response("Invalid body", { status: 400 }); }

  const { history = [], cards = [] } = body;
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return new Response(JSON.stringify({ steps: [], blocker: "", canvas: {} }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  if (!history.length) {
    return new Response(
      JSON.stringify({
        steps: [],
        blocker: "Start a conversation first to generate a roadmap.",
        canvas: {},
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }

  const histText = history
    .slice(-12)
    .map((m) => `${m.role}: ${m.content.slice(0, 250)}`)
    .join("\n");
  const cardsText = cards.length
    ? `\n\nBoard notes:\n${cards.map((c) => `[${c.tag}] ${c.text}`).join("\n")}`
    : "";

  const reqBody = {
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Conversation history:\n${histText}${cardsText}` },
    ],
    max_tokens: 900,
    temperature: 0.3,
  };

  try {
    let res = await callGroq(PRIMARY_MODEL, groqKey, reqBody);
    if (!res.ok && res.status === 429) res = await callGroq(FALLBACK_MODEL, groqKey, reqBody);
    if (!res.ok) throw new Error("Groq error");
    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content || "").trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let parsed = { steps: [], blocker: "", canvas: {} };
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); } catch { /* keep default */ }
    }
    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ steps: [], blocker: "", canvas: {} }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
}

export const config = { runtime: "edge" };
