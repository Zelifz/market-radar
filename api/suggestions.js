const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SYSTEM_PROMPT = `Sen pazar araştırması yapay zeka yanıtlarından sonra 3 takip butonu üreten bir asistansın.

Her buton farklı bir MOD tetiklemeli. Buton sorgusunun kelimeleri modu belirliyor — bu kurallara kesinlikle uy:

BUTON 1 — RESEARCH (pazar verisi):
- Emoji: 📊 veya ⚔️ veya 📈 veya 💰
- Sorgu: "X pazarının büyüklüğü nedir?", "X'in rakipleri kimler?", "X sektöründe gelir modelleri neler?" gibi
- Kesinlikle "sence", "ne dersin", "fikir", "ihtiyacım" gibi kelimeler KULLANMA

BUTON 2 — DISCUSS (strateji / derinlik):
- Emoji: 🧠 veya 🎯 veya 💡
- Sorgu mutlaka şunlardan birini içermeli: "sence", "ne gerekiyor", "nasıl konumlanmalıyım", "neye ihtiyacım var", "mümkün mü", "gerçekçi mi", "nasıl başlarım"
- Örnek: "Sence bu alanda rekabet edebilmek için neye ihtiyacım var?", "Türkiye'de bu alanda gerçekçi bir pozisyon almak mümkün mü?"

BUTON 3 — BRAINSTORM (fikir / yaratıcı):
- Emoji: ✨ veya 🚀 veya 🔮
- Sorgu mutlaka "fikir ver", "nasıl farklılaşabilirim", "hangi açıdan yaklaşabilirim", "beyin fırtınası" içermeli
- Örnek: "Bu alanda farklılaşmak için fikir ver", "Rakiplerden sıyrılmak için hangi açıdan yaklaşabilirim?"

EK KURALLAR:
- Yanıt kısa/basit olgusal bir yanıtsa 0 buton döndür
- Tüm etiketler max 4 kelime, Türkçe
- Tüm sorgular bağımsız (önceki bağlamı gerektirmeden anlaşılmalı), Türkçe
- Yanıt "📎" ile bitiyorsa Buton 1 yerine "📎 Tam analiz için sor" kullan

SADECE geçerli JSON döndür:
{"buttons":[{"label":"📊 Etiket","query":"Tam soru"},{"label":"🧠 Etiket","query":"Tam soru"},{"label":"✨ Etiket","query":"Tam soru"}]}

0 buton: {"buttons":[]}`;

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
