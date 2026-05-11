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
  'shopify.com/blog','a16z.com','sequoiacap.com','ycombinator.com',
  'venturebeat.com','thenextweb.com','arstechnica.com','theatlantic.com',
  'ft.com','handelsblatt.com','nikkei.com','scmp.com',
]);

const LOW_QUALITY_DOMAINS = new Set([
  'quora.com','pinterest.com','instagram.com','facebook.com',
  'twitter.com','x.com','tiktok.com','snapchat.com','tumblr.com',
  'reddit.com','medium.com','substack.com','blogspot.com','wordpress.com',
  'yahoo.com','answers.com','ask.com','ehow.com','wikihow.com',
  'buzzfeed.com','huffpost.com','dailymail.co.uk','thesun.co.uk',
  'fiverr.com','upwork.com','freelancer.com','guru.com',
]);

function classifySource(url) {
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    if (TRUSTED_DOMAINS.has(domain)) return 'trusted';
    if (LOW_QUALITY_DOMAINS.has(domain)) return 'low';
    // Extra low-quality signals
    if (domain.includes('blog.') || domain.endsWith('.blogspot.com')) return 'low';
    return 'neutral';
  } catch { return 'neutral'; }
}

function classifyDepth(message) {
  const lower = message.toLowerCase();
  const deepSignals = [
    'analyze','analysis','comprehensive','deep dive','deep-dive','compare','comparison',
    'landscape','sector','industry','market','competitive','validate','report',
    'trends','forecast','projection','strategy','opportunities','challenges',
    'full','complete','overview','breakdown','research','analiz','pazar','rekabet',
    'sektör','strateji','fırsat','tehdit','büyüme','gelecek','tahmin',
  ];
  const simpleSignals = [
    'what is','what are','who is','when was','when did','where is',
    'how much does','how many','define','definition','price of','cost of',
    'founded','headquarters','nedir','kimdir','ne zaman','kaç',
  ];
  const hasDeep = deepSignals.some(k => lower.includes(k));
  const hasSimple = simpleSignals.some(k => lower.includes(k));
  if (hasSimple && !hasDeep && message.length < 100) return 'simple';
  if (hasDeep || message.length > 120) return 'deep';
  return 'moderate';
}

function buildAngleQuery(message, tab) {
  const base = message.trim();
  const suffixes = {
    analyze:     `${base} market size revenue statistics 2024 2025`,
    competitors: `${base} top companies competitors market share comparison`,
    validate:    `${base} customer problems demand pain points failure cases`,
    deep:        `${base} industry outlook trends disruption future growth`,
    crosscheck:  base,
  };
  return suffixes[tab] || `${base} latest data report 2025`;
}

async function search(query, apiKey, depth = 'moderate', maxResults = 8) {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: depth === 'deep' ? 'advanced' : 'basic',
        max_results: maxResults,
        include_answer: false,
        include_raw_content: false,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch { return []; }
}

function dedupeResults(results) {
  const seen = new Set();
  return results.filter(r => {
    if (!r.url || seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

function sortByQuality(results) {
  const rank = r => {
    const q = classifySource(r.url);
    if (q === 'low') return 0;
    if (q === 'trusted') return 2;
    return 1;
  };
  return [...results].sort((a, b) => rank(b) - rank(a));
}

function formatResultsForAI(results) {
  if (!results.length) return 'Arama sonucu bulunamadı.';
  return results.map((r, i) =>
    `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content?.slice(0, 500) || ''}`
  ).join('\n\n');
}

// ─── SYSTEM PROMPTS ──────────────────────────────────────────────────────────
// All prompts enforce Turkish language as the very first and last rule.

const COMMON_SUFFIX = `

**FORMAT — katı kural:**
## başlıkları kullan. Her başlık altında 3-5 madde. Önemli rakamları ve kaynak adlarını **kalın** yaz.
Toplam yanıt: 300-450 kelime. Daha fazla derinlik gerekiyorsa son maddeye "📎 Tam analiz için sor." ekle.

**DÜRÜSTLÜK — pazarlık götürmez:**
- Her piyasa büyüklüğü iddiasında: rakam + kaynak + yıl zorunlu. "Büyük pazar" gibi belirsiz ifade kullanma.
- Alanda güçlü bir oyuncu varsa ilk cümlede söyle.
- Pivot gerekiyorsa tam olarak ne olduğunu belirt.
- Fikir imkânsızsa söyle, sonra en yakın gerçekçi versiyonu öner.

**KAYNAK ETİKETLEME:**
- 2+ kaynak onaylıyor: ✅ **$X** *(Reuters + Statista, 2024)*
- Tek kaynak: ⚠️ **$X** *(Forbes, 2024 — tek kaynak)*

Sona ekle:
> **Güven:** ✅ YÜKSEK — [neden] | ⚠️ ORTA — [neden] | ❌ DÜŞÜK — [neden]

**🇹🇷 DİL — KESİN KURAL: Yanıtını tamamen Türkçe yaz. İngilizce, Tayca veya başka bir dil kesinlikle kullanma.**`;

const SYSTEM_PROMPTS = {
  analyze: `🇹🇷 **DİL KURALI: Bu yanıtı tamamen Türkçe yaz.**

Sen sert bir pazar araştırma analistsin. Sağlanan arama sonuçlarını birincil kaynak olarak kullan.

Her yanıtı şu başlıklarla yapılandır (her birinde 3-5 madde):
## Pazar Büyüklüğü — gerçek rakam, kaynak, yıl. Durağan veya küçülüyorsa söyle.
## Kilit Oyuncular — bu alanı kim kontrol ediyor? Fonlama seviyeleri?
## Giriş Engelleri — yeni bir oyuncuyu ne durdurur? Somut ol.
## Görülmeyen Açılım — çoğu analistin gözden kaçırdığı 1 fırsat veya köşe nokta.
## Karar — tek cümle: devam et / pivot yap / dur, nedeniyle birlikte.

Her rakamı kaynaklıyarak yaz: **$X.XB** ([Kaynak Adı](URL), Yıl)${COMMON_SUFFIX}`,

  competitors: `🇹🇷 **DİL KURALI: Bu yanıtı tamamen Türkçe yaz.**

Sen bir rekabet istihbarat analistsin. Arama sonuçlarını kullan, tahmin yürütme.

Yapı:
## Pazar Hakimiyeti — alan açık mı yoksa büyük oyuncular tarafından kilitli mi?
## İlk 3-5 Rakip — İsim | Fonlama | Fiyatlandırma | En Büyük Zayıflık (her biri tek satır)
## Gerçekçi Giriş Boşluğu — varsa hangi spesifik boşluk var?
## Farklılaşma Açısı — yeni bir oyuncunun sahiplenebileceği somut bir pozisyon.
## Görülmeyen Tehdit — rakiplerin henüz görmediği ama geliyor olan.

Kaynakları belirt. Arama sonuçlarında bulunamayan her şeyi ⚠️ ile işaretle.${COMMON_SUFFIX}`,

  validate: `🇹🇷 **DİL KURALI: Bu yanıtı tamamen Türkçe yaz.**

Sen bir girişim fikri doğrulayıcısısın. Arama sonuçlarını kullan. Varsayılan tutum: şüphecilik. Çalışmayacağı nedenleri çalışacağı nedenlerden önce bul.

Yapı:
## Problem Gerçekliği — insanlar bugün bu sorunu çözmek için ödeme yapıyor mu?
## Pazar Kanıtı — kaynaklı TAM/SAM. Veri yoksa söyle.
## Ölümcül Kusurlar — regülasyon, büyük rakipler, birim ekonomisi, zamanlama. #1 katili önce söyle.
## Pazar Sinyalleri — benzer girişimler başarısız olduysa nedeni neydi?
## Karar — ✅ Devam Et / ⚠️ Pivot Yap (tam olarak ne yapılmalı) / ❌ Dur

Yumuşatma yok. Doğrudan ol.${COMMON_SUFFIX}`,

  deep: `🇹🇷 **DİL KURALI: Bu yanıtı tamamen Türkçe yaz.**

Sen bir sektör araştırma analistsin. Her iddia arama sonuçlarından kaynaklanmalı.

Yapı (her başlıkta 3-5 madde):
## Sektör Büyüklüğü ve Büyümesi — rakam, CAGR, kaynak, yıl
## Rekabet Dinamikleri — piyasayı kim kontrol ediyor, yoğunlaşma seviyesi
## Önemli Riskler — regülasyon, teknoloji disrupsiyonu, döngüsellik
## Büyüme Motorları — piyasayı gerçekte ne ileri itiyor?
## Gizli Fırsat — bu sektörde çoğu oyuncunun henüz görmediği 1 stratejik açılım.
## Giriş Önerisi — spesifik, dürüst, eyleme dönüştürülebilir.

📎 Tam Porter Beş Kuvvet / SWOT istek üzerine mevcut.${COMMON_SUFFIX}`,

  crosscheck: `🇹🇷 **DİL KURALI: Bu yanıtı tamamen Türkçe yaz.**

Sen bir gerçek kontrolcüsünsün. Arama sonuçlarını kullanarak her iddiayı doğrula veya çürüt.

Her iddia için:
**İddia**: [iddia]
**Karar**: ✅ DOĞRULANDI | ⚠️ KISMEN DOĞRU | ❌ ÇÜRÜTÜLDÜ | ❓ DOĞRULANABİLİR DEĞİL
**En iyi destekleyen kaynak**: [kaynak + tarih]
**En iyi çürüten kaynak**: [kaynak + tarih, yoksa "bulunamadı"]

Sona genel güvenilirlik puanı ve en önemli düzeltmeyi ekle.${COMMON_SUFFIX}`,
};

export default async function handler(req) {
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

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return new Response("Groq API key not configured", { status: 500 });
  }

  const tavilyKey = process.env.TAVILY_API_KEY;
  const depth = classifyDepth(message);
  const systemPrompt = SYSTEM_PROMPTS[tab] || SYSTEM_PROMPTS.analyze;

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  (async () => {
    try {
      let allResults = [];
      let searchCount = 0;

      if (tavilyKey) {
        await writer.write(encoder.encode(`<!--STATUS:🔍 Web'de aranıyor...-->`));

        if (depth === 'simple') {
          // Single fast search, fewer results
          allResults = await search(message.trim(), tavilyKey, 'simple', 6);
          searchCount = 1;
        } else {
          // Two parallel searches: main + angle
          await writer.write(encoder.encode(`<!--STATUS:🔭 Çoklu kaynak taranıyor...-->`));
          const angleQuery = buildAngleQuery(message.trim(), tab);
          const [primary, secondary] = await Promise.all([
            search(message.trim(), tavilyKey, depth, depth === 'deep' ? 10 : 8),
            search(angleQuery, tavilyKey, 'basic', 6),
          ]);
          allResults = dedupeResults([...primary, ...secondary]);
          searchCount = 2;
        }

        // Sort: trusted first, low quality last; then filter out low
        allResults = sortByQuality(allResults).filter(r => classifySource(r.url) !== 'low');
      }

      await writer.write(encoder.encode(`<!--STATUS:🤖 Analiz yapılıyor...-->`));

      const searchContext = tavilyKey && allResults.length
        ? `Arama sonuçları ("${message.trim()}" için):\n\n${formatResultsForAI(allResults)}\n\n---\n\n`
        : '';

      // Append language reminder to user message too
      const userContent = searchContext + message.trim()
        + '\n\n[Yanıtını tamamen Türkçe yaz. Başka dil kullanma.]';

      const trimmedHistory = history.slice(-10).map(m => ({
        role: m.role,
        content: m.content,
      }));

      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            ...trimmedHistory,
            { role: 'user', content: userContent },
          ],
          stream: true,
          max_tokens: 2800,
          temperature: 0.45,
        }),
      });

      if (!groqRes.ok) {
        const errText = await groqRes.text();
        await writer.write(encoder.encode(`\n\n**API hatası:** ${errText}`));
        return;
      }

      const reader = groqRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let textAccumulator = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const rawLine = line.slice(6).trim();
          if (!rawLine || rawLine === "[DONE]") continue;

          let evt;
          try { evt = JSON.parse(rawLine); } catch { continue; }

          const text = evt.choices?.[0]?.delta?.content;
          if (text) {
            textAccumulator += text;
            await writer.write(encoder.encode(text));
          }
        }
      }

      const allSources = allResults.map(r => ({
        url: r.url,
        title: r.title || r.url,
        quality: classifySource(r.url),
      }));

      const verifiedCount = allSources.filter(s => s.quality === 'trusted').length;
      const conflictingCount = (textAccumulator.match(/⚠️/g) || []).length;

      const payload = JSON.stringify({
        sources: allSources,
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
      await writer.write(encoder.encode(`\n\n**Hata:** ${err.message}`));
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
}

export const config = { runtime: 'edge' };
