const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SYSTEM_PROMPTS = {
  analyze: `You are a senior global market research analyst. You have web search access — use it for EVERY analysis to find real, current data.

Required for every response:
- Search for actual market size figures (cite the source and year)
- Find recent news and funding activity in this space (last 12 months)
- Identify key demand signals (search trends, community activity, job postings)
- Look for regulatory or geographic considerations
- Flag any data points that seem outdated or conflicting

Structure your response:
## Market Overview
## Opportunity Signals
## Key Risks & Challenges
## Regional Considerations
## Next Steps

After every data point, add a source link in format: ([Source Name](URL))
Use real numbers. Never say "large market" — say "$12.4B (Statista 2024)".`,

  competitors: `You are a competitive intelligence analyst. Use web search to find REAL competitor data — not guesses.

For each competitor found:
1. Search their website, Crunchbase, LinkedIn for funding/team size
2. Find pricing (check their pricing page directly)
3. Search G2, Capterra, Trustpilot for reviews — find actual weaknesses
4. Check recent news for strategic moves

Structure:
## Competitive Landscape Overview
## Key Players
(Name | Founded | Funding | Target Market | Pricing | Key Weakness)
## Market Gaps & Opportunities
## Differentiation Playbook

Cite every source. Mark unverified estimates clearly with ⚠️.`,

  validate: `You are a rigorous startup idea validator. Use web search to prove or disprove every assumption — challenge the idea hard.

Validation framework (run web searches for each):
1. **Problem Reality Check** — Is this a real problem people pay to solve? Find evidence.
2. **Market Size Verification** — Find TAM/SAM data from analyst reports (not guesses)
3. **Existing Solutions** — Who is already solving this? Why do they succeed or fail?
4. **Demand Signals** — Search Reddit, forums, job boards, Google Trends for genuine demand
5. **Business Model Comparables** — Find similar business models and their unit economics
6. **Fatal Flaw Check** — What could kill this idea? Regulation, timing, competition?

Cross-check every major claim against 2+ sources. If sources conflict, highlight it.

End with:
## ✅ Proceed / ⚠️ Pivot / ❌ Stop
**Verdict**: [Your honest assessment]
**Confidence Level**: High / Medium / Low
**Key Assumptions to Test First**: [list]`,

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

Every data point must have a source citation. Note data recency.`,

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

At the end, provide an overall reliability score for the research and flag the most critical corrections.`,
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

  const systemPrompt = SYSTEM_PROMPTS[tab] || SYSTEM_PROMPTS.analyze;

  // Keep last 12 messages to avoid token overflow
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
            max_uses: 5,
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
      const sources = [];
      let searchCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") continue;

          let evt;
          try { evt = JSON.parse(raw); } catch { continue; }

          // Tool use started — signal "searching" to frontend
          if (
            evt.type === "content_block_start" &&
            evt.content_block?.type === "tool_use" &&
            evt.content_block?.name === "web_search"
          ) {
            searchCount++;
            await writer.write(
              encoder.encode(`<!--STATUS:Searching the web (${searchCount})...-->`)
            );
          }

          // Extract sources from web_search_tool_result blocks
          if (evt.type === "content_block_start") {
            const block = evt.content_block;

            // web_search_tool_result type (built-in search results)
            if (block?.type === "web_search_tool_result") {
              const items = block.content || [];
              for (const item of items) {
                if (item.url && !sources.find((s) => s.url === item.url)) {
                  sources.push({ url: item.url, title: item.title || item.url, page_age: item.page_age });
                }
              }
            }

            // Regular tool_result containing web_search_result items
            if (block?.type === "tool_result") {
              const items = Array.isArray(block.content) ? block.content : [];
              for (const item of items) {
                if (item.type === "web_search_result" && item.url) {
                  if (!sources.find((s) => s.url === item.url)) {
                    sources.push({ url: item.url, title: item.title || item.url, page_age: item.page_age });
                  }
                }
              }
            }
          }

          // Stream text deltas
          if (
            evt.type === "content_block_delta" &&
            evt.delta?.type === "text_delta" &&
            evt.delta.text
          ) {
            await writer.write(encoder.encode(evt.delta.text));
          }
        }
      }

      // Append sources as a final sentinel chunk
      if (sources.length > 0) {
        await writer.write(
          encoder.encode(`<!--SOURCES:${JSON.stringify(sources)}-->`)
        );
      }
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
