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
  'a16z.com','sequoiacap.com','ycombinator.com','venturebeat.com',
  'thenextweb.com','arstechnica.com','nikkei.com','scmp.com',
]);

const LOW_QUALITY_DOMAINS = new Set([
  'quora.com','pinterest.com','instagram.com','facebook.com',
  'twitter.com','x.com','tiktok.com','snapchat.com','tumblr.com',
  'reddit.com','medium.com','substack.com','blogspot.com','wordpress.com',
  'yahoo.com','answers.com','ask.com','ehow.com','wikihow.com',
  'buzzfeed.com','huffpost.com','dailymail.co.uk','thesun.co.uk',
]);

function classifySource(url) {
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    if (TRUSTED_DOMAINS.has(domain)) return 'trusted';
    if (LOW_QUALITY_DOMAINS.has(domain)) return 'low';
    if (domain.includes('blogspot') || domain.includes('.blog.')) return 'low';
    return 'neutral';
  } catch { return 'neutral'; }
}

// ─── MODE DETECTION ──────────────────────────────────────────────────────────
// Determines HOW to respond, separate from WHAT tab is active.
// research  = structured data with sources (default)
// discuss   = deep thinking, perspective, context — flowing prose
// brainstorm= idea generation, creative exploration, open questions

function classifyMode(message, history = []) {
  const lower = message.toLowerCase();
  const len = message.trim().length;

  const brainstormSignals = [
    'fikir', 'beyin fırtınası', 'brainstorm', 'hayal', 'öneri ver', 'seçenek',
    'alternatif', 'ne yapabilirim', 'nasıl yaklaşayım', 'hangi yol', 'olasılık',
    'what if', 'how might', 'imagine', 'suggest', 'options', 'ideas for',
    'yenilik', 'inovasyon', 'farklı bir açı', 'daha iyi bir yol',
  ];

  const discussSignals = [
    'nasıl gelişecek', 'geleceği', 'gelecekte', 'evrimi', 'yönü nereye',
    'sence', 'ne dersin', 'düşüncen', 'görüşün', 'fikrin ne',
    'neden böyle', 'niye', 'mantığı ne', 'önemi ne', 'anlamı ne',
    'toplumsal', 'etki', 'dönüşüm', 'değişim nasıl', 'tarihsel',
    'why is', 'how will', 'what do you think', 'your view', 'in your opinion',
    'what makes', 'why does', 'how does this', 'peki ya', 'ya da',
  ];

  const hasBrainstorm = brainstormSignals.some(k => lower.includes(k));
  const hasDiscuss = discussSignals.some(k => lower.includes(k));

  if (hasBrainstorm) return 'brainstorm';
  if (hasDiscuss) return 'discuss';

  // Short follow-up mid-conversation = user wants to think, not research again
  if (history.length >= 4 && len < 80 && !lower.includes('pazar') && !lower.includes('market') && !lower.includes('rakip')) {
    return 'discuss';
  }

  return 'research';
}

// ─── DEPTH DETECTION (for research mode) ─────────────────────────────────────
function classifyDepth(message) {
  const lower = message.toLowerCase();
  const deepSignals = [
    'analyze','analysis','comprehensive','deep dive','compare','landscape',
    'sector','industry','market','competitive','validate','report','trends',
    'forecast','projection','strategy','opportunities','challenges','research',
    'analiz','pazar','rakip','sektör','strateji','fırsat','büyüme','tahmin',
  ];
  const simpleSignals = [
    'what is','what are','who is','when was','how much does','how many',
    'define','price of','cost of','founded','nedir','kimdir','ne zaman','kaç',
  ];
  const hasDeep = deepSignals.some(k => lower.includes(k));
  const hasSimple = simpleSignals.some(k => lower.includes(k));
  if (hasSimple && !hasDeep && message.length < 100) return 'simple';
  if (hasDeep || message.length > 120) return 'deep';
  return 'moderate';
}

function buildAngleQuery(message, tab) {
  const base = message.trim();
  const map = {
    analyze:     `${base} market size revenue statistics 2024 2025`,
    competitors: `${base} top companies market share comparison`,
    validate:    `${base} customer problems demand failure cases`,
    deep:        `${base} industry trends disruption future`,
    crosscheck:  base,
  };
  return map[tab] || `${base} latest report 2025`;
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

function dedupeAndSort(results) {
  const seen = new Set();
  return results
    .filter(r => { if (!r.url || seen.has(r.url)) return false; seen.add(r.url); return true; })
    .filter(r => classifySource(r.url) !== 'low')
    .sort((a, b) => {
      const rank = r => classifySource(r.url) === 'trusted' ? 2 : 1;
      return rank(b) - rank(a);
    });
}

function formatResultsForAI(results) {
  if (!results.length) return 'Arama sonucu bulunamadı.';
  return results.map((r, i) =>
    `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content?.slice(0, 500) || ''}`
  ).join('\n\n');
}

// ─── SYSTEM PROMPTS ───────────────────────────────────────────────────────────

const LANG_RULE = '🇹🇷 **DİL — KESİN KURAL: Yanıtını tamamen Türkçe yaz. Başka dil kullanma.**';

// Mode prompts (override tab prompts when mode != research)
const MODE_PROMPTS = {
  brainstorm: `${LANG_RULE}

Sen yaratıcı bir strateji ve inovasyon partnerisin. Kullanıcı artık veri değil, fikir ve olasılık istiyor.

YAPMA:
- ## başlıklar, madde madde liste, kaynak zorunluluğu
- "Pazar büyüklüğü X dolardır" gibi kuru veri tekrarı
- Her konuya aynı reçete

YAP:
- Beklenmedik açılardan yaklaş: "Herkes X yapıyor, ama şunu hiç düşündün mü?"
- Somut ve uygulabilir fikirler üret — soyut kalma
- Benzer alandaki başka sektörlerden analoji kur
- Kullanıcının söylediklerini birbirine bağla, yeni kombinasyonlar üret
- 1-2 açıcı soruyla bitir: kullanıcıyı bir sonraki adıma taşı

Ton: Enerjik, meraklı, ilham verici — ama sığ değil. Format: 2-3 akıcı paragraf.`,

  discuss: `${LANG_RULE}

Sen derin düşünen bir stratejik ve entelektüel partnerisin. Kullanıcı artık veri toplamıyor; anlamlandırmak, derinleşmek, perspektif kazanmak istiyor.

YAPMA:
- Madde madde liste, ## başlıklar, kuru veri dökümü
- "Araştırmalara göre..." gibi genel laflar
- Sıradan, tahmin edilebilir başlangıç cümleleri

YAP:
- İlk cümleyle dikkat çek: alışılmışın dışından başla
- "Çoğu kişi X sanıyor, ama aslında..." — gerçek perspektif getir
- Tarihsel veya karşılaştırmalı bağlam ver, orijinal bir bağlantı kur
- Çelişen görüşleri ortaya çıkar ve kendi değerlendirmeni söyle
- Konuşmanın gidişatına göre bir sonraki düşünce adımını öner

Ton: Düşünceli, cesur, meraklı. Format: 3-4 akıcı paragraf. Son paragraf: 1 açıcı soru veya sonraki yön.`,
};

// Research mode tab prompts
const COMMON_RESEARCH_SUFFIX = `

**FORMAT:**
## başlıkları kullan. Her başlık: 3-5 madde. Önemli rakamları **kalın** yaz.
Yanıt: 300-450 kelime. Daha derine gitmek gerekirse son maddeye "📎 Tam analiz için sor." ekle.

**DÜRÜSTLÜK:**
- Rakam + kaynak + yıl zorunlu. Belirsiz ifade yok.
- Kaynak etiketleme: ✅ 2+ kaynak | ⚠️ tek kaynak

Sona ekle: > **Güven:** ✅ YÜKSEK | ⚠️ ORTA | ❌ DÜŞÜK — [neden]

${LANG_RULE}`;

const TAB_PROMPTS = {
  analyze: `${LANG_RULE}

Sen sert bir pazar araştırma analistsin. Arama sonuçlarını birincil kaynak olarak kullan.

## Pazar Büyüklüğü — gerçek rakam, kaynak, yıl. Durağansa söyle.
## Kilit Oyuncular — kim kontrol ediyor? Fonlama?
## Giriş Engelleri — yeni oyuncuyu ne durdurur? Somut ol.
## Görülmeyen Açılım — çoğu analistin gözden kaçırdığı 1 fırsat.
## Karar — tek cümle: devam et / pivot / dur.${COMMON_RESEARCH_SUFFIX}`,

  competitors: `${LANG_RULE}

Sen bir rekabet istihbarat analistsin. Arama sonuçlarını kullan.

## Pazar Hakimiyeti — alan açık mı, kilitli mi?
## İlk 3-5 Rakip — İsim | Fonlama | Fiyat | En Büyük Zayıflık
## Gerçekçi Giriş Boşluğu — varsa ne?
## Farklılaşma Açısı — yeni oyuncunun sahiplenebileceği somut pozisyon.
## Görülmeyen Tehdit — rakiplerin henüz görmediği ama geliyor olan.${COMMON_RESEARCH_SUFFIX}`,

  validate: `${LANG_RULE}

Sen bir girişim fikri doğrulayıcısısın. Varsayılan tutum: şüphecilik.

## Problem Gerçekliği — insanlar bugün bunun için ödeme yapıyor mu?
## Pazar Kanıtı — TAM/SAM, kaynaklı. Veri yoksa söyle.
## Ölümcül Kusurlar — #1 katili önce söyle.
## Pazar Sinyalleri — benzer girişimler neden başarısız oldu?
## Karar — ✅ Devam / ⚠️ Pivot (tam olarak ne) / ❌ Dur${COMMON_RESEARCH_SUFFIX}`,

  deep: `${LANG_RULE}

Sen bir sektör araştırma analistsin. Her iddia kaynaklı.

## Sektör Büyüklüğü ve Büyümesi
## Rekabet Dinamikleri
## Önemli Riskler
## Büyüme Motorları
## Gizli Fırsat — çoğunun henüz görmediği 1 stratejik açılım.
## Giriş Önerisi${COMMON_RESEARCH_SUFFIX}`,

  crosscheck: `${LANG_RULE}

Sen bir gerçek kontrolcüsünsün. Her iddiayı arama sonuçlarıyla doğrula veya çürüt.

**İddia** → **Karar**: ✅ DOĞRULANDI | ⚠️ KISMEN | ❌ ÇÜRÜTÜLDÜ | ❓ DOĞRULANABİLİR DEĞİL
**En iyi destekleyen kaynak** | **En iyi çürüten kaynak**

Sona: genel güvenilirlik puanı + en önemli düzeltme.${COMMON_RESEARCH_SUFFIX}`,
};

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body;
  try { body = await req.json(); } catch { return new Response("Invalid request body", { status: 400 }); }

  const { message, tab = "analyze", history = [] } = body;
  if (!message?.trim()) return new Response("Message cannot be empty", { status: 400 });

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return new Response("Groq API key not configured", { status: 500 });

  const tavilyKey = process.env.TAVILY_API_KEY;

  // Determine response mode
  const mode = classifyMode(message, history);
  const depth = classifyDepth(message);

  // Select system prompt: mode overrides tab for non-research queries
  const systemPrompt = (mode !== 'research' && MODE_PROMPTS[mode])
    ? MODE_PROMPTS[mode]
    : (TAB_PROMPTS[tab] || TAB_PROMPTS.analyze);

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  (async () => {
    try {
      let allResults = [];
      let searchCount = 0;

      if (tavilyKey) {
        if (mode === 'brainstorm') {
          // Brainstorm: no search needed — pure creativity
          // (optionally a light inspirational search could go here)
        } else if (mode === 'discuss') {
          // Discuss: single light search for context/grounding
          await writer.write(encoder.encode(`<!--STATUS:🔍 Bağlam aranıyor...-->`));
          allResults = await search(message.trim(), tavilyKey, 'basic', 5);
          searchCount = 1;
        } else {
          // Research: full double search
          if (depth === 'simple') {
            await writer.write(encoder.encode(`<!--STATUS:🔍 Web'de aranıyor...-->`));
            allResults = await search(message.trim(), tavilyKey, 'basic', 6);
            searchCount = 1;
          } else {
            await writer.write(encoder.encode(`<!--STATUS:🔭 Çoklu kaynak taranıyor...-->`));
            const [primary, secondary] = await Promise.all([
              search(message.trim(), tavilyKey, depth, depth === 'deep' ? 10 : 8),
              search(buildAngleQuery(message.trim(), tab), tavilyKey, 'basic', 6),
            ]);
            allResults = dedupeAndSort([...primary, ...secondary]);
            searchCount = 2;
          }
        }
        allResults = dedupeAndSort(allResults);
      }

      const statusLabel = mode === 'brainstorm'
        ? '💡 Fikirler üretiliyor...'
        : mode === 'discuss'
          ? '🧠 Derinlemesine düşünülüyor...'
          : '🤖 Analiz yapılıyor...';
      await writer.write(encoder.encode(`<!--STATUS:${statusLabel}-->`));

      const searchContext = allResults.length
        ? `Arama sonuçları:\n\n${formatResultsForAI(allResults)}\n\n---\n\n`
        : '';

      const userContent = searchContext + message.trim()
        + '\n\n[Yanıtını tamamen Türkçe yaz.]';

      const trimmedHistory = history.slice(-10).map(m => ({
        role: m.role,
        content: m.content.slice(0, 800), // trim long history entries
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
          max_tokens: mode === 'research' ? 2800 : 1800,
          temperature: mode === 'brainstorm' ? 0.75 : mode === 'discuss' ? 0.6 : 0.45,
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
        if (done) { buffer += decoder.decode(); break; }
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
          if (text) { textAccumulator += text; await writer.write(encoder.encode(text)); }
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
          mode,
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
