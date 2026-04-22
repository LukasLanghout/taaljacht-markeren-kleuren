import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * OCR op één PDF-pagina via het Groq vision-model.
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

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const completion = await groq.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `Dit is pagina ${paginaNum} uit een Nederlands basisschoolwerkboek. ` +
                `Geef ALLE tekst die je op deze pagina ziet, woordelijk en in leesvolgorde. ` +
                `Geen uitleg, geen markdown, geen samenvatting — alleen de pure tekst zoals ze erop staat. ` +
                `Behoud opdrachtnummers (zoals "Les 5", "a", "b") en behoud zinnen volledig.`,
            },
            {
              type: "image_url",
              image_url: { url: image },
            },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 2048,
    });

    const tekst = completion.choices[0]?.message?.content ?? "";

    return NextResponse.json({ tekst });
  } catch (err) {
    console.error("ocr-pagina fout:", err);
    return NextResponse.json(
      { error: "OCR mislukt: " + String(err) },
      { status: 500 }
    );
  }
}
