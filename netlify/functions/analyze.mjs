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
  if (hasSimple && !hasDeep && message.length < 120) return { depth: 'simple', maxSearches: 2 };
  if (hasDeep || message.length > 150) return { depth: 'deep', maxSearches: 3 };
  return { depth: 'moderate', maxSearches: 2 };
}

const COMMON_SUFFIX = `

**VIABILITY GATE — check this first:**
If the request is physically impossible, fictional, clearly illegal, or makes no business sense (e.g. "flying kumpir", "selling air"), respond in 2 sentences max: state why it's not viable, then suggest what realistic adjacent idea might work. Do NOT research it. Stop there.

**FORMAT — strict:**
Use ## headers. Under each header: 2-3 bullet points MAX. No prose paragraphs. Bold every number and source name.
Total response: 150-220 words. If more depth is needed, end the last bullet with "📎 Full breakdown available — ask for it."

**HONESTY — non-negotiable:**
- Every market size claim needs a number + source + year. No "large market", no "booming sector".
- Name the biggest obstacle first, not last.
- If a well-funded giant already owns this space, lead with that.
- If the idea needs a pivot to work, say exactly what that pivot is.

**Session efficiency:** Check conversation history before searching — don't repeat recent searches.

End with:
> **Confidence:** ✅ HIGH — [reason] | ⚠️ MEDIUM — [reason] | ❌ LOW — [reason]`;

const SYSTEM_PROMPTS = {
  analyze: `You are a hard-nosed market research analyst. Search for real data — never guess.

Structure every response with these exact headers and max 3 bullets each:
## Market Size — real number, source, year. If declining or flat, say so.
## Key Players — who owns this space already? Funding levels?
## Entry Barriers — what stops a new player? Be specific.
## Verdict — one sentence: proceed / pivot / avoid, and why.

Cite every number: **$X.XB** ([Source](URL), Year)${COMMON_SUFFIX}`,

  competitors: `You are a competitive intelligence analyst. Search for real competitor data only — no guesses.

Structure:
## Market Control — is this space open or locked up by incumbents?
## Top 3-5 Competitors — Name | Funding | Pricing | Biggest Weakness (one line each)
## Realistic Entry Gap — what specific gap exists, if any?
## Differentiation — one concrete angle a new entrant could own

Cite sources. ⚠️ mark anything unverified.${COMMON_SUFFIX}`,

  validate: `You are a startup idea validator. Default stance: skepticism. Find reasons it WON'T work before reasons it will.

Structure:
## Problem Reality — do people actually pay to solve this today?
## Market Evidence — TAM/SAM with source. If no data exists, say so.
## Fatal Flaws — regulation, incumbents, unit economics, timing. Name the #1 killer.
## Verdict — ✅ Proceed / ⚠️ Pivot (suggest the pivot) / ❌ Stop

Be direct. Don't soften.${COMMON_SUFFIX}`,

  deep: `You are a sector research analyst. Use multiple web searches. Every claim needs a source.

Structure (2-3 bullets each):
## Sector Size & Growth — number, CAGR, source, year
## Competitive Dynamics — who controls the market, concentration level
## Key Risks — regulatory, tech disruption, cyclicality
## Growth Drivers — what's actually pulling the market forward
## Entry Recommendation — specific, honest, actionable

📎 If full Porter's Five Forces / SWOT is needed, user can ask for it.${COMMON_SUFFIX}`,

  crosscheck: `You are a fact-checker. For each claim: search for support AND contradiction.

Per claim:
**Claim**: [claim]
**Verdict**: ✅ VERIFIED | ⚠️ PARTIALLY TRUE | ❌ CONTRADICTED | ❓ UNVERIFIABLE
**Best supporting source**: [source + date]
**Best contradicting source**: [source + date, or "none found"]

End with overall reliability score and the single most important correction.${COMMON_SUFFIX}`,
};

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response("API key not configured", { status: 500 });
  }

  const { depth, maxSearches } = classifyDepth(message);
  const systemPrompt = SYSTEM_PROMPTS[tab] || SYSTEM_PROMPTS.analyze;
  const trimmedHistory = history.slice(-12);
  const messages = [
    ...trimmedHistory,
    { role: "user", content: message.trim() },
  ];

  let anthropicRes;
  try {
    anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2200,
        stream: true,
        system: systemPrompt,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: maxSearches,
          },
        ],
        messages,
      }),
    });
  } catch (err) {
    return new Response(`API connection error: ${err.message}`, { status: 502 });
  }

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    return new Response(`Anthropic API error: ${errText}`, { status: 502 });
  }

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  (async () => {
    try {
      const reader = anthropicRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const allSources = [];
      const seenUrls = new Set();
      let searchCount = 0;
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
          if (rawLine === "[DONE]") continue;

          let evt;
          try { evt = JSON.parse(rawLine); } catch { continue; }

          if (
            evt.type === "content_block_start" &&
            evt.content_block?.type === "tool_use" &&
            evt.content_block?.name === "web_search"
          ) {
            searchCount++;
            const icon = depth === 'simple' ? '🔍' : depth === 'deep' ? '🔭' : '🔎';
            await writer.write(
              encoder.encode(`<!--STATUS:${icon} Search ${searchCount}/${maxSearches}...-->`)
            );
          }

          if (evt.type === "content_block_start") {
            const block = evt.content_block;
            const items =
              block?.type === "web_search_tool_result"
                ? (block.content || [])
                : block?.type === "tool_result" && Array.isArray(block.content)
                  ? block.content.filter(i => i.type === "web_search_result")
                  : [];

            for (const item of items) {
              const url = item.url;
              if (url && !seenUrls.has(url)) {
                seenUrls.add(url);
                allSources.push({
                  url,
                  title: item.title || url,
                  page_age: item.page_age,
                  quality: classifySource(url),
                });
              }
            }
          }

          if (
            evt.type === "content_block_delta" &&
            evt.delta?.type === "text_delta" &&
            evt.delta.text
          ) {
            textAccumulator += evt.delta.text;
            await writer.write(encoder.encode(evt.delta.text));
          }
        }
      }

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
