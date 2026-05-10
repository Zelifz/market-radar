const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SYSTEM_PROMPT = `You are a UX assistant that decides what follow-up options to offer after an AI market research response.

Analyze the AI response and return 0-3 follow-up button suggestions. Each button must cover a COMPLETELY DIFFERENT angle — no overlapping topics.

Rules:
- Return 0 buttons for simple factual answers (definitions, basic facts, short direct answers under 3 sentences)
- Return 1-3 buttons for analysis, research, or complex topic responses
- If the response ends with "📎" or "ask for it", always include a "📎 Full analysis" button as first option
- Button labels: max 4 words, start with a relevant emoji, action-oriented
- Button queries: specific and standalone — must work without prior context
- Each button must explore a DIFFERENT dimension: e.g., one on market data, one on competitors, one on entry strategy — never two strategy buttons or two competitor buttons
- Diverse emoji palette: 📊 for market/data, ⚔️ for competitors, 🚀 for go-to-market, 💰 for funding/revenue, ⚠️ for risks, 🌍 for geography, 📈 for growth, 🔍 for validation, ⚙️ for tech/product

Return ONLY valid JSON — no explanation, no markdown:
{"buttons":[{"label":"📊 Label text","query":"Full question to send"}]}

If 0 buttons: {"buttons":[]}`;

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ buttons: [] }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const { responseText = "", tab = "analyze", userQuery = "" } = body;

  if (!responseText.trim()) {
    return new Response(JSON.stringify({ buttons: [] }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ buttons: [] }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 256,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: `Tab: ${tab}\nUser asked: "${userQuery.slice(0, 200)}"\n\nAI response (first 1500 chars):\n${responseText.slice(0, 1500)}`,
        }],
      }),
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ buttons: [] }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    const text = (data.content?.[0]?.text || "").trim();

    let parsed = { buttons: [] };
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { buttons: [] };
    } catch { /* silent */ }

    // Sanitize: max 3 buttons, truncate long labels
    if (Array.isArray(parsed.buttons)) {
      parsed.buttons = parsed.buttons.slice(0, 3).filter(b => b.label && b.query);
    } else {
      parsed.buttons = [];
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch {
    return new Response(JSON.stringify({ buttons: [] }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
};

export const config = { path: "/api/suggestions" };
