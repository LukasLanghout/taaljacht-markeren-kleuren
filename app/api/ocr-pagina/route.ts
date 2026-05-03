import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * OCR op één PDF-pagina via Groq's Llama 4 Scout vision-model.
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

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: "GROQ_API_KEY ontbreekt in environment variables." },
        { status: 500 }
      );
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const messages = [
      {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text:
              `Dit is pagina ${paginaNum} uit een Nederlands basisschoolwerkboek (Taal Jacht, groep 5). ` +
              `Geef ALLE tekst die je op deze pagina ziet, woordelijk en in leesvolgorde. ` +
              `Geen uitleg, geen markdown, geen samenvatting — alleen de pure tekst zoals ze erop staat. ` +
              `Behoud opdrachtnummers (zoals "Les 5", "a", "b", "c", "d") en behoud zinnen volledig. ` +
              `Bij opdrachten waarin leerlingen iets moeten markeren of kleuren, schrijf je de instructie ` +
              `en daarna alle zinnen/fragmenten die gekleurd of gemarkeerd moeten worden uit.`,
          },
          {
            type: "image_url" as const,
            image_url: { url: image },
          },
        ],
      },
    ];

    // ── Retry-loop voor 429 rate-limits ─────────────────────────────────────
    const MAX_POGINGEN = 4;
    let laatsteFout: unknown = null;

    for (let poging = 1; poging <= MAX_POGINGEN; poging++) {
      try {
        const completion = await groq.chat.completions.create({
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          messages,
          temperature: 0.1,
          max_tokens: 4096,
        });
        const tekst = completion.choices[0]?.message?.content ?? "";
        return NextResponse.json({ tekst });
      } catch (err: unknown) {
        laatsteFout = err;
        const status = (err as { status?: number })?.status;

        if (status !== 429) throw err; // alleen retry op rate-limit

        if (poging === MAX_POGINGEN) break;

        // Probeer "Please try again in 12.345s" uit het bericht te halen
        const msg = String((err as { message?: string })?.message ?? "");
        const m = msg.match(/try again in ([\d.]+)s/i);
        const wachtMs = m
          ? Math.ceil(parseFloat(m[1]) * 1000) + 500
          : 5000 * poging; // fallback exponentieel

        // Cap op 45s zodat we binnen maxDuration=60 blijven
        const veiligeWacht = Math.min(wachtMs, 45_000);
        console.log(
          `Pagina ${paginaNum} rate-limited, poging ${poging}/${MAX_POGINGEN}, wacht ${veiligeWacht}ms`
        );
        await new Promise((r) => setTimeout(r, veiligeWacht));
      }
    }

    // Alle pogingen op; geef volledige Groq-foutdetails terug
    const fout = laatsteFout as {
      message?: string;
      status?: number;
      error?: { message?: string; code?: string };
      headers?: Record<string, string>;
    };
    return NextResponse.json(
      {
        error: "Groq rate-limit bereikt na alle retries.",
        groq_message: fout?.error?.message ?? fout?.message ?? String(laatsteFout),
        groq_code: fout?.error?.code ?? null,
        retry_after_header: fout?.headers?.["retry-after"] ?? null,
        tip: "Open https://console.groq.com/settings/limits om je quota te zien. " +
             "Vision-requests hebben aparte (lagere) limieten dan tekst-requests.",
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
