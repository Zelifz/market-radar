const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const TRUSTED_DOMAINS = new Set([
  'reuters.com','bloomberg.com','wsj.com','ft.com','economist.com',
  'apnews.com','bbc.com','bbc.co.uk','nytimes.com','theguardian.com',
  'techcrunch.com','wired.com','forbes.com','businessinsider.com','fortune.com',
  'cnbc.com','hbr.org','harvard.edu','mit.edu','stanford.edu',
  'mckinsey.com','bcg.com','bain.com','deloitte.com','pwc.com','kpmg.com',
  'statista.com','grandviewresearch.com','mordorintelligence.com',
  'marketsandmarkets.com','cbinsights.com','crunchbase.com','pitchbook.com',
  'sec.gov','census.gov','bls.gov','worldbank.org','imf.org','oecd.org',
  'gartner.com','idc.com','forrester.com','nielsen.com',
  'nature.com','science.org','arxiv.org','investopedia.com','wikipedia.org',
]);

const LOW_QUALITY_DOMAINS = new Set([
  'quora.com','pinterest.com','instagram.com','facebook.com',
  'twitter.com','x.com','tiktok.com','snapchat.com','tumblr.com',
]);

function classifySource(url) {
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    if (TRUSTED_DOMAINS.has(domain)) return 'trusted';
    if (LOW_QUALITY_DOMAINS.has(domain)) return 'low';
    return 'neutral';
  } catch { return 'neutral'; }
}

function classifyDepth(message) {
  const lower = message.toLowerCase();
  const deepSignals = [
    'analyze','analysis','comprehensive','deep dive','deep-dive','compare','comparison',
    'landscape','sector','industry','market','competitive','validate','report',
    'trends','forecast','projection','strategy','opportunities','challenges',
    'full','complete','overview','breakdown','research',
  ];
  const simpleSignals = [
    'what is','what are','who is','when was','when did','where is',
    'how much does','how many','define','definition','price of','cost of',
    'founded','headquarters',
  ];
  const hasDeep = deepSignals.some(k => lower.includes(k));
  const hasSimple = simpleSignals.some(k => lower.includes(k));
  if (hasSimple && !hasDeep && message.length < 120) return 'simple';
  if (hasDeep || message.length > 150) return 'deep';
  return 'moderate';
}

// ── Tavily search ──
async function search(query, apiKey, depth = 'moderate') {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: depth === 'deep' ? 'advanced' : 'basic',
        max_results: 6,
        include_answer: false,
        include_raw_content: false,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch { return []; }
}

function formatResultsForAI(results) {
  if (!results.length) return 'No search results found.';
  return results.map((r, i) =>
    `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content?.slice(0, 400) || ''}`
  ).join('\n\n');
}

const COMMON_SUFFIX = `

**FORMAT — strict:**
Use ## headers. Under each header: 2-3 bullet points MAX. No prose paragraphs. Bold every number and source name.
Total response: 150-220 words. If more depth needed, end last bullet with "📎 Full breakdown available — ask for it."

**HONESTY — non-negotiable:**
- Every market size claim needs number + source + year. No "large market", no "booming sector".
- Name the biggest obstacle first, not last.
- If a giant already owns this space, lead with that.
- If the idea needs a pivot to work, say exactly what that pivot is.
- If the idea is physically impossible or fictional, say so in one line then suggest the closest realistic version.

**CITATIONS — tag verification level:**
- 2+ sources agree: ✅ **$X** *(Reuters + Statista, 2024)*
- 1 source only: ⚠️ **$X** *(Forbes, 2024 — single source)*

End with:
> **Confidence:** ✅ HIGH — [reason] | ⚠️ MEDIUM — [reason] | ❌ LOW — [reason]`;

const SYSTEM_PROMPTS = {
  analyze: `You are a hard-nosed market research analyst. Search results are provided — use them as your primary data source.

Structure every response with these exact headers and max 3 bullets each:
## Market Size — real number, source, year. If declining or flat, say so.
## Key Players — who owns this space already? Funding levels?
## Entry Barriers — what stops a new player? Be specific.
## Verdict — one sentence: proceed / pivot / avoid, and why.

Cite every number: **$X.XB** ([Source Name](URL), Year)${COMMON_SUFFIX}`,

  competitors: `You are a competitive intelligence analyst. Search results are provided — use them, no guessing.

Structure:
## Market Control — is this space open or locked up by incumbents?
## Top 3-5 Competitors — Name | Funding | Pricing | Biggest Weakness (one line each)
## Realistic Entry Gap — what specific gap exists, if any?
## Differentiation — one concrete angle a new entrant could own

Cite sources. ⚠️ mark anything not found in the provided results.${COMMON_SUFFIX}`,

  validate: `You are a startup idea validator. Search results are provided. Default stance: skepticism. Find reasons it WON'T work before reasons it will.

Structure:
## Problem Reality — do people actually pay to solve this today?
## Market Evidence — TAM/SAM with source. If no data exists, say so.
## Fatal Flaws — regulation, incumbents, unit economics, timing. Name the #1 killer.
## Verdict — ✅ Proceed / ⚠️ Pivot (suggest the pivot) / ❌ Stop

Be direct. Don't soften.${COMMON_SUFFIX}`,

  deep: `You are a sector research analyst. Search results are provided — every claim needs a source from them.

Structure (2-3 bullets each):
## Sector Size & Growth — number, CAGR, source, year
## Competitive Dynamics — who controls the market, concentration level
## Key Risks — regulatory, tech disruption, cyclicality
## Growth Drivers — what's actually pulling the market forward
## Entry Recommendation — specific, honest, actionable

📎 Full Porter's Five Forces / SWOT available on request.${COMMON_SUFFIX}`,

  crosscheck: `You are a fact-checker. Search results are provided — use them to verify or refute each claim.

Per claim:
**Claim**: [claim]
**Verdict**: ✅ VERIFIED | ⚠️ PARTIALLY TRUE | ❌ CONTRADICTED | ❓ UNVERIFIABLE
**Best supporting source**: [source + date]
**Best contradicting source**: [source + date, or "none found"]

End with overall reliability score and the single most important correction.${COMMON_SUFFIX}`,
};

// Convert Anthropic-style history to Gemini format
function toGeminiHistory(history) {
  return history.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
}

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
    return new Response("Invalid request body", { status: 400 });
  }

  const { message, tab = "analyze", history = [] } = body;

  if (!message?.trim()) {
    return new Response("Message cannot be empty", { status: 400 });
  }

  const googleKey = process.env.GOOGLE_API_KEY;
  if (!googleKey) {
    return new Response("Google API key not configured", { status: 500 });
  }

  const tavilyKey = process.env.TAVILY_API_KEY;
  const depth = classifyDepth(message);
  const systemPrompt = SYSTEM_PROMPTS[tab] || SYSTEM_PROMPTS.analyze;

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  (async () => {
    try {
      // ── Tavily search ──
      let searchResults = [];
      let allSources = [];
      let searchCount = 0;

      if (tavilyKey) {
        await writer.write(encoder.encode(`<!--STATUS:🔍 Searching the web...-->`));
        searchResults = await search(message.trim(), tavilyKey, depth);
        searchCount = 1;

        const seenUrls = new Set();
        for (const r of searchResults) {
          if (r.url && !seenUrls.has(r.url)) {
            seenUrls.add(r.url);
            allSources.push({
              url: r.url,
              title: r.title || r.url,
              quality: classifySource(r.url),
            });
          }
        }
      }

      await writer.write(encoder.encode(`<!--STATUS:🤖 Analyzing...-->`));

      // ── Build message with search context ──
      const searchContext = tavilyKey && searchResults.length
        ? `Current web search results for: "${message.trim()}"\n\n${formatResultsForAI(searchResults)}\n\n---\n\n`
        : '';

      const userContent = searchContext + message.trim();

      // ── Build Gemini request ──
      const trimmedHistory = history.slice(-12);
      const geminiHistory = toGeminiHistory(trimmedHistory);

      const geminiBody = {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [
          ...geminiHistory,
          { role: 'user', parts: [{ text: userContent }] },
        ],
        generationConfig: {
          maxOutputTokens: 1800,
          temperature: 0.4,
        },
      };

      // ── Call Gemini ──
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${googleKey}`;

      let geminiRes;
      try {
        geminiRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiBody),
        });
      } catch (err) {
        await writer.write(encoder.encode(`\n\n**Connection error:** ${err.message}`));
        return;
      }

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        await writer.write(encoder.encode(`\n\n**API error:** ${errText}`));
        return;
      }

      // ── Stream Gemini response ──
      const reader = geminiRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let textAccumulator = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const rawLine = line.slice(6).trim();
          if (!rawLine || rawLine === "[DONE]") continue;

          let evt;
          try { evt = JSON.parse(rawLine); } catch { continue; }

          const text = evt.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            textAccumulator += text;
            await writer.write(encoder.encode(text));
          }
        }
      }

      // ── Write DATA sentinel ──
      const qualitySources = allSources.filter(s => s.quality !== 'low');
      const verifiedCount = allSources.filter(s => s.quality === 'trusted').length;
      const conflictingCount = (textAccumulator.match(/⚠️/g) || []).length;

      const payload = JSON.stringify({
        sources: qualitySources,
        meta: {
          scanned: allSources.length,
          verified: verifiedCount,
          conflicting: conflictingCount,
          searchCount,
          depth,
        },
      });
      await writer.write(encoder.encode(`<!--DATA:${payload}-->`));

    } catch (err) {
      console.error("Stream error:", err);
      await writer.write(encoder.encode(`\n\n**Error:** ${err.message}`));
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      ...CORS,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
};

export const config = { path: "/api/analyze" };
