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

  const googleKey = process.env.GOOGLE_API_KEY;
  if (!googleKey) {
    return new Response(JSON.stringify({ buttons: [] }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const userContent = `Tab: ${tab}\nUser asked: "${userQuery.slice(0, 200)}"\n\nAI response (first 1500 chars):\n${responseText.slice(0, 1500)}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash-latest:generateContent?key=${googleKey}`;

    const res = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: userContent }] }],
        generationConfig: {
          maxOutputTokens: 256,
          temperature: 0.3,
        },
      }),
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ buttons: [] }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();

    let parsed = { buttons: [] };
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { buttons: [] };
    } catch { /* silent */ }

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
