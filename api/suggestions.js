const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const PRIMARY_MODEL  = 'llama-3.3-70b-versatile';
const FALLBACK_MODEL = 'llama-3.1-8b-instant';

const SYSTEM_PROMPT = `Sen pazar araştırması yapay zeka yanıtlarından sonra takip seçenekleri öneren bir asistansın.

Yanıtı ve kullanıcının sorusunu analiz et. 2-3 adet konuya özel, dinamik takip butonu üret.

TEMEL KURALLAR:
- Kısa/basit olgusal yanıtlar için 0 buton döndür
- Her buton FARKLI bir açı keşfetmeli — asla benzer iki buton üretme
- Butonlar konuşmaya özel olsun, jenerik/genel sorular üretme
- Yanıt "📎" ile bitiyorsa ilk buton "📎 Tam analiz" olsun
- Etiketler: max 4 kelime, Türkçe, emoji ile başla
- Sorgular: bağımsız (önceki bağlam olmadan da anlaşılır), Türkçe
- Emoji paleti: 📊 pazar/veri, ⚔️ rakipler, 🚀 büyüme, 💰 gelir, ⚠️ risk, 🌍 coğrafya, 📈 trend, 🔍 doğrulama, ⚙️ teknoloji, 🧠 strateji, ✨ fikir

MARKET RADAR BUTONU — özel kural:
Konuşma pazar büyüklüğü / rakipler / gelir modeli / sektör analizi içermiyorsa (yani kullanıcı fikir/strateji/teknoloji konuşuyor ama henüz pazar araştırması yapmamışsa), butonların SONUNA şunu ekle:
{"label":"📊 Market Radar","query":"[konuya özel] pazarının büyüklüğü, başlıca rakipleri ve gelir modelleri nelerdir?"}
Konuşma zaten pazar araştırması içeriyorsa bu butonu EKLEME.

SADECE geçerli JSON döndür — açıklama yok:
{"buttons":[{"label":"...","query":"..."}]}
0 buton için: {"buttons":[]}`;

async function callGroq(model, groqKey, body) {
  return fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
    body: JSON.stringify({ model, ...body }),
  });
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ buttons: [] }), { headers: { ...CORS, "Content-Type": "application/json" } });
  }

  const { responseText = "", tab = "analyze", userQuery = "" } = body;

  if (!responseText.trim()) {
    return new Response(JSON.stringify({ buttons: [] }), { headers: { ...CORS, "Content-Type": "application/json" } });
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return new Response(JSON.stringify({ buttons: [] }), { headers: { ...CORS, "Content-Type": "application/json" } });
  }

  const reqBody = {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Tab: ${tab}\nKullanıcı sordu: "${userQuery.slice(0, 200)}"\n\nYanıt (ilk 1200 karakter):\n${responseText.slice(0, 1200)}`,
      },
    ],
    max_tokens: 300,
    temperature: 0.3,
  };

  try {
    let res = await callGroq(PRIMARY_MODEL, groqKey, reqBody);

    if (!res.ok && res.status === 429) {
      res = await callGroq(FALLBACK_MODEL, groqKey, reqBody);
    }

    if (!res.ok) {
      return new Response(JSON.stringify({ buttons: [] }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content || "").trim();

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

    return new Response(JSON.stringify(parsed), { headers: { ...CORS, "Content-Type": "application/json" } });

  } catch {
    return new Response(JSON.stringify({ buttons: [] }), { headers: { ...CORS, "Content-Type": "application/json" } });
  }
}

export const config = { runtime: 'edge' };
