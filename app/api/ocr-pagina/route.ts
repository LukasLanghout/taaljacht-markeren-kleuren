import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "gemini-2.5-flash-lite";

/**
 * OCR op één PDF-pagina via Google Gemini 2.5 Flash Lite.
 * Input:  { image: "data:image/jpeg;base64,...", paginaNum: number }
 * Output: { tekst: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const image: string = body.image ?? "";
    const paginaNum: number = body.paginaNum ?? 0;

    if (!image.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "Geen geldige afbeelding ontvangen." },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY ontbreekt in environment variables." },
        { status: 500 }
      );
    }

    const match = image.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) {
      return NextResponse.json(
        { error: "Afbeelding heeft geen geldig data-URL-formaat." },
        { status: 400 }
      );
    }
    const mimeType = match[1];
    const base64Data = match[2];

    const prompt =
      `Dit is pagina ${paginaNum} uit een Nederlands basisschoolwerkboek (Taal Jacht, groep 5). ` +
      `Geef ALLE tekst die je op deze pagina ziet, woordelijk en in leesvolgorde. ` +
      `Geen uitleg, geen markdown, geen samenvatting — alleen de pure tekst zoals ze erop staat. ` +
      `Behoud opdrachtnummers (zoals "Les 5", "a", "b", "c", "d") en behoud zinnen volledig. ` +
      `Bij opdrachten waarin leerlingen iets moeten markeren of kleuren, schrijf je de instructie ` +
      `en daarna alle zinnen/fragmenten die gekleurd of gemarkeerd moeten worden uit. ` +
      `Bij handgeschreven brieven: lees zo nauwkeurig mogelijk, splits per zin met punt/vraagteken/uitroepteken.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

    // ── Retry-loop voor 429 rate-limits ────────────────────────────────
    const MAX_POGINGEN = 4;
    let laatsteFout: { message: string; status?: number } | null = null;

    for (let poging = 1; poging <= MAX_POGINGEN; poging++) {
      const geminiRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType, data: base64Data } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4096,
          },
        }),
      });

      if (geminiRes.ok) {
        const json = await geminiRes.json();
        const tekst: string =
          json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        return NextResponse.json({ tekst });
      }

      const errText = await geminiRes.text();
      laatsteFout = { message: errText, status: geminiRes.status };

      // Alleen retryen op 429 of 503 (overload)
      if (geminiRes.status !== 429 && geminiRes.status !== 503) {
        const isLeaked = /leaked|API key.*reported/i.test(errText);
        let userMsg = `Gemini API-fout (${geminiRes.status})`;
        if (isLeaked) {
          userMsg =
            "Gemini API-key is door Google als gelekt gemarkeerd. " +
            "Maak een nieuwe key aan op https://aistudio.google.com/apikey " +
            "en zet die in Vercel env-vars (GEMINI_API_KEY).";
        } else if (geminiRes.status === 403) {
          userMsg = "Gemini permission denied (403). Check API-key in Vercel env-vars.";
        } else if (geminiRes.status === 401) {
          userMsg = "Gemini API-key ongeldig (401). Check Vercel env-vars.";
        }
        console.error(`Gemini API-fout (${geminiRes.status}):`, errText.substring(0, 300));
        return NextResponse.json(
          { error: userMsg, detail: errText.substring(0, 400) },
          { status: geminiRes.status }
        );
      }

      if (poging === MAX_POGINGEN) break;

      // Probeer "retryDelay": "Xs" of "retry-after"-info uit de body te halen
      let wachtMs = 5000 * poging;
      const retryMatch = errText.match(/"retryDelay"\s*:\s*"(\d+)s"/);
      if (retryMatch) {
        wachtMs = parseInt(retryMatch[1], 10) * 1000 + 500;
      }
      const veiligeWacht = Math.min(wachtMs, 45_000);
      console.log(
        `Pagina ${paginaNum} rate-limited, poging ${poging}/${MAX_POGINGEN}, wacht ${veiligeWacht}ms`
      );
      await new Promise((r) => setTimeout(r, veiligeWacht));
    }

    // Alle pogingen uitgeput
    return NextResponse.json(
      {
        error: "Gemini rate-limit bereikt na alle retries.",
        gemini_message: laatsteFout?.message?.substring(0, 500) ?? null,
        gemini_status: laatsteFout?.status ?? null,
        tip:
          "Check je quota op https://aistudio.google.com/apikey. " +
          `Op de gratis tier heeft ${MODEL} ~15 RPM en 1000 RPD.`,
      },
      { status: 429 }
    );
  } catch (err) {
    console.error("ocr-pagina fout:", err);
    return NextResponse.json(
      { error: "OCR mislukt: " + String(err) },
      { status: 500 }
    );
  }
}
