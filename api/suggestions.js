const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const PRIMARY_MODEL  = 'llama-3.3-70b-versatile';
const FALLBACK_MODEL = 'llama-3.1-8b-instant';

const SYSTEM_PROMPT = `Sen kısa, ilham verici takip soruları öneren bir asistansın. Kullanıcının aklına yeni fikirler getir, farklı açılar keşfettir.

2-3 buton üret. Her biri FARKLI bir boyutu merak ettirsin.

BUTON KURALLARI:
- Etiket: max 4 kelime, emoji ile başla, çarpıcı ve merak uyandırıcı
- Sorgu: bağımsız (önceki bağlam gerektirmez), Türkçe, spesifik
- Birbirini tekrar eden buton üretme
- Kısa/olgusal yanıtlar için 0 buton
- Yanıt "📎" ile bitiyorsa ilk buton "📎 Tam analiz"

EMOJİ PALETİ: 📊 🏆 💡 ⚔️ 🚀 💰 ⚠️ 🌍 📈 🔍 ⚙️ 🧠 ✨ 🎯 🔮 💎 🛡️ 🌱

MARKET RADAR KURALI:
Konuşmada henüz pazar büyüklüğü / rakip / gelir analizi yoksa son butona şunu ekle:
{"label":"📊 Market Radar","query":"[konuya özel] pazarının büyüklüğü, rakipleri ve gelir modelleri nedir?"}
Zaten pazar araştırması yapıldıysa EKLEME.

SADECE geçerli JSON: {"buttons":[{"label":"...","query":"..."}]}
0 buton: {"buttons":[]}`;

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
