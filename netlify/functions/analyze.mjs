const SYSTEM_PROMPTS = {
  analiz: `Sen Türkiye pazarı konusunda uzman bir iş ve girişim danışmanısın. Kullanıcının iş fikrini veya sektörünü Türkiye özelinde analiz et.
Şunları değerlendir:
- Türkiye'deki pazar büyüklüğü ve potansiyeli
- Hedef kitle profili ve büyüklüğü
- Temel fırsatlar ve tehditler
- Büyüme trendleri ve ivme
- Türkiye'ye özgü faktörler (ekonomi, kültür, düzenlemeler)
- Giriş için pratik adımlar

Yanıtını Türkçe, markdown formatında ver. Somut ve pratik ol, gereksiz süslü cümlelerden kaçın.`,

  haberler: `Sen Türk iş dünyası ve teknoloji haberleri konusunda uzman bir analistsin.
Kullanıcının belirttiği sektör veya fikirle ilgili şunları sun:
- Sektördeki son dönem önemli gelişmeler ve trendler
- Yatırım haberleri ve fonlama turları
- Hükümet politikaları, teşvikler ve düzenlemeler
- Global trendlerin Türkiye'ye yansıması
- Sektörü etkileyen makroekonomik faktörler

Yanıtını Türkçe, markdown formatında ver. Güncel ve bilgilendirici ol.`,

  rakipler: `Sen Türkiye pazarında rekabet analizi uzmanısın.
Kullanıcının belirttiği alan için:
- Türkiye'deki başlıca oyuncuları ve konumlanmalarını listele
- Her oyuncunun güçlü ve zayıf yönlerini analiz et
- Pazar payı dağılımını tahmin et
- Fiyatlama stratejilerini karşılaştır
- Rakiplerin göz ardı ettiği boş niş fırsatları tespit et
- Diferansiyasyon için somut öneriler sun

Yanıtını Türkçe, markdown formatında ver. Gerçek şirket isimlerine atıf yap.`,

  dogrulama: `Sen iş fikri doğrulama uzmanısın. Kullanıcının fikrini eleştirel ve dengeli bir gözle değerlendir.
Şunları analiz et:
- Fikrin güçlü yönleri (neden çalışabilir)
- Kritik riskler ve zayıflıklar (neden çalışmayabilir)
- Türkiye pazarına uygunluk ve zamanlama
- Doğrulama için önerilen MVP adımları
- İlk 6 ayda test etmen gereken varsayımlar
- Başarı için kritik faktörler (KSF)
- Genel değerlendirme: Devam et / Pivotla / Durdur

Dürüst ve doğrudan ol. Yanıtını Türkçe, markdown formatında ver.`,

  derinlik: `Sen derin sektör analizi yapan stratejik bir danışmansın.
Kullanıcının belirttiği konu için kapsamlı analiz sun:
- Sektörün Türkiye'deki tarihsel gelişimi ve mevcut durumu
- Porter'ın 5 Gücü analizi (Türkiye bağlamında)
- SWOT analizi
- Düzenleyici çerçeve ve lisans/sertifika gereksinimleri
- Tedarik zinciri ve ekosistem haritası
- Teknoloji trendleri ve dijital dönüşüm etkileri
- 3-5 yıllık pazar büyüme projeksiyonu
- Stratejik giriş önerileri

Akademik derinlikte ama pratik odaklı. Yanıtını Türkçe, markdown formatında ver.`,
};

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response("Geçersiz istek gövdesi", { status: 400 });
  }

  const { message, tab = "analiz" } = body;

  if (!message?.trim()) {
    return new Response("Mesaj boş olamaz", { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response("API anahtarı yapılandırılmamış", { status: 500 });
  }

  const systemPrompt = SYSTEM_PROMPTS[tab] || SYSTEM_PROMPTS.analiz;

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
        max_tokens: 2048,
        stream: true,
        system: systemPrompt,
        messages: [{ role: "user", content: message.trim() }],
      }),
    });
  } catch (err) {
    return new Response(`API bağlantı hatası: ${err.message}`, { status: 502 });
  }

  if (!anthropicRes.ok) {
    const errText = await anthropicRes.text();
    return new Response(`Anthropic API hatası: ${errText}`, { status: 502 });
  }

  // SSE akışını düz metin akışına dönüştür
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  (async () => {
    try {
      const reader = anthropicRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            if (
              parsed.type === "content_block_delta" &&
              parsed.delta?.type === "text_delta" &&
              parsed.delta.text
            ) {
              await writer.write(encoder.encode(parsed.delta.text));
            }
          } catch {
            // Hatalı SSE satırlarını atla
          }
        }
      }
    } catch (err) {
      console.error("Stream hatası:", err);
      await writer.write(encoder.encode(`\n\n**Hata:** ${err.message}`));
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
};

export const config = {
  path: "/api/analyze",
};
