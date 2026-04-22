import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * OCR op één PDF-pagina via Google Gemini 2.5 Flash.
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

    // "data:image/jpeg;base64,AAAA..." → mime + base64 splitsen
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
      `en daarna alle zinnen/fragmenten die gekleurd of gemarkeerd moeten worden uit.`;

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

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

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API-fout:", errText);
      return NextResponse.json(
        { error: `Gemini API-fout (${geminiRes.status}): ${errText.substring(0, 300)}` },
        { status: 500 }
      );
    }

    const json = await geminiRes.json();
    const tekst: string =
      json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    return NextResponse.json({ tekst });
  } catch (err) {
    console.error("ocr-pagina fout:", err);
    return NextResponse.json(
      { error: "OCR mislukt: " + String(err) },
      { status: 500 }
    );
  }
}
