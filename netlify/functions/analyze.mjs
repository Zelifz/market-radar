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
  if (hasDeep || message.length > 150) return { depth: 'deep', maxSearches: 5 };
  return { depth: 'moderate', maxSearches: 3 };
}

const COMMON_SUFFIX = `

**Writing rules:**
- Every sentence must carry a unique fact or insight — no filler, no rephrasing the user's question
- Be concise: cut any sentence that doesn't add new information
- Aim for 150-250 words; if the topic genuinely needs more, end with "📎 Full breakdown available — ask for it."

**Realism & honesty — this is critical:**
- Most ideas face real obstacles: crowded markets, high capital requirements, regulatory friction, slow adoption. Name them.
- Never say a market is "huge" or "booming" without a number and source. Never hype.
- If an idea has a fatal flaw (e.g. the market is declining, a giant already owns it, unit economics don't work), say so directly.
- If the idea is unrealistic as stated, say why and suggest what pivot would make it viable.
- Your job is to help the user make a better decision — not to validate whatever they say.

**Session efficiency:** Before using web_search, check if the conversation history already contains recent data on this exact topic. Synthesize from existing context without redundant searches.

End your response with exactly this line (choose one):
> **Confidence:** ✅ HIGH — [reason]
> **Confidence:** ⚠️ MEDIUM — [reason]
> **Confidence:** ❌ LOW — [reason]`;

const SYSTEM_PROMPTS = {
  analyze: `You are a senior global market research analyst. You have web search access — use it to find real, current data.

Required for every response:
- Search for actual market size figures with source and year — never say "large market"
- Find recent news and funding activity (last 12 months)
- Identify genuine demand signals (trends, community activity, job postings)
- Look for regulatory or geographic barriers
- Flag ⚠️ conflicting or outdated data

**Mandatory reality check:** After the opportunity, explicitly address: How crowded is this market? What's the realistic barrier to entry? Is the timing right or has this window closed? If the idea is weak, say so and suggest a more viable angle.

Structure: ## Market Overview · ## Opportunity Signals · ## Key Risks & Challenges · ## Verdict

After every data point, add source: ([Source Name](URL))${COMMON_SUFFIX}`,

  competitors: `You are a competitive intelligence analyst. Use web search to find REAL competitor data — not guesses.

For each competitor: search Crunchbase/LinkedIn for funding/team size, check their pricing page directly, find G2/Capterra reviews for actual weaknesses, check recent news.

**Reality check:** If the space is dominated by well-funded incumbents (Google, Salesforce, etc.), say so explicitly — don't soften it. Identify whether there's a realistic gap or if the market is effectively closed.

Structure: ## Competitive Landscape · ## Key Players (Name | Funding | Pricing | Key Weakness) · ## Realistic Gaps · ## Differentiation Playbook

Cite every source. Mark ⚠️ unverified estimates clearly.${COMMON_SUFFIX}`,

  validate: `You are a rigorous startup idea validator. Your default is skepticism — prove the idea works before endorsing it.

Validation framework:
1. **Problem Reality Check** — Is this a real problem people pay to solve? Find evidence.
2. **Market Size** — Find TAM/SAM from analyst reports, not guesses
3. **Existing Solutions** — Who already solves this? Why would users switch?
4. **Demand Signals** — Reddit, forums, job boards, Google Trends
5. **Unit Economics** — Find comparable business models. Do the numbers work?
6. **Fatal Flaw Check** — Regulation, timing, capital requirements, network effects barriers?

Cross-check every claim against 2+ sources. If sources ⚠️ conflict, highlight it.

End with:
## ✅ Proceed / ⚠️ Pivot / ❌ Stop
**Verdict**: [honest assessment — don't soften]
**Key Assumptions to Test First**: [list]${COMMON_SUFFIX}`,

  deep: `You are a strategic analyst delivering deep-dive sector research. Use web search extensively — multiple searches per section.

Deliver a comprehensive report:
## 1. Sector Overview
(Size, growth CAGR, major sub-segments — with real data)
## 2. Porter's Five Forces
(Each force rated Low/Medium/High with evidence)
## 3. SWOT Analysis
(Market-level SWOT, not generic)
## 4. Regulatory Landscape
(Key regulations, compliance requirements, upcoming changes)
## 5. Technology & Disruption Trends
(What tech is changing this sector, find real examples)
## 6. Key Players & Market Share
(Top companies, estimated market share)
## 7. Growth Projections
(3-5 year outlook — cite analyst reports like McKinsey, CB Insights, etc.)
## 8. Entry Strategy Recommendations
(Specific, actionable)

Every data point must have a source citation. Note data recency. Mark ⚠️ any conflicting data.${COMMON_SUFFIX}`,

  crosscheck: `You are a market research fact-checker. Your job is to verify or refute claims using web search.

For EACH claim the user provides:
1. Search for the most recent supporting data
2. Search for contradicting data
3. Check the original source if cited
4. Find independent verification

Format each finding:
---
**Claim**: [the claim]
**Verdict**: ✅ VERIFIED | ⚠️ PARTIALLY TRUE | ❌ CONTRADICTED | ❓ UNVERIFIABLE
**Evidence For**: [what supports it, with source]
**Evidence Against**: [what contradicts it, with source]
**Most Recent Data**: [latest figure found, with source and date]
**Confidence**: HIGH | MEDIUM | LOW
---

At the end, provide an overall reliability score for the research and flag the most critical corrections.${COMMON_SUFFIX}`,
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
        max_tokens: 4096,
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
