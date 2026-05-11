const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SYSTEM_PROMPT = `Sen pazar araştırması yapay zeka yanıtlarından sonra takip seçenekleri öneren bir asistansın.

Yanıtı analiz et ve 0-3 takip butonu öner. Her buton TAMAMEN FARKLI bir açı kapsamalı.

Kurallar:
- Kısa, olgusal yanıtlar için 0 buton döndür
- Analiz veya karmaşık yanıtlar için 1-3 buton döndür
- Yanıt "📎" ile bitiyorsa ilk buton "📎 Tam analiz" olsun
- Buton etiketleri: max 4 kelime, emoji ile başla, eyleme yönelik — TÜRKÇE yaz
- Buton sorguları: spesifik ve bağımsız — önceki bağlamı gerektirmesin — TÜRKÇE yaz
- Her buton FARKLI bir boyutu keşfetmeli: biri pazar verisi, biri rakipler, biri giriş stratejisi gibi
- Emoji paleti: 📊 pazar/veri, ⚔️ rakipler, 🚀 pazara giriş, 💰 finansman/gelir, ⚠️ riskler, 🌍 coğrafya, 📈 büyüme, 🔍 doğrulama, ⚙️ teknoloji/ürün

SADECE geçerli JSON döndür — açıklama veya markdown yok:
{"buttons":[{"label":"📊 Etiket metni","query":"Gönderilecek tam Türkçe soru"}]}

0 buton için: {"buttons":[]}`;

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

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return new Response(JSON.stringify({ buttons: [] }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Tab: ${tab}\nUser asked: "${userQuery.slice(0, 200)}"\n\nAI response (first 1500 chars):\n${responseText.slice(0, 1500)}`,
          },
        ],
        max_tokens: 256,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ buttons: [] }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
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

    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch {
    return new Response(JSON.stringify({ buttons: [] }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
}

export const config = { runtime: 'edge' };
