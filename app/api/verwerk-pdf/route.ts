import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEEM_PROMPT = `
Je bent een assistent die opdrachten extraheert uit Nederlandse basisschoolboeken.

Je taak: zoek ALLEEN opdrachten waarbij leerlingen iets moeten MARKEREN of KLEUREN in een tekst.
Voorbeelden van zulke opdrachten:
- "Kleur de zinnen die bij de start horen geel, het midden blauw en het slot groen."
- "Markeer het antwoord in de brief."
- "Kleur de woorden die passen bij het plaatje."

Geef het resultaat als een JSON array. Geen uitleg, geen markdown, ALLEEN geldige JSON.
`;

const GEBRUIKER_PROMPT = (tekst: string) => `
Hier is de tekst uit het PDF-bestand (Taal Jacht, Groep 5, Blok 7):

${tekst}

Geef een JSON array met opdrachten in precies dit formaat:
[
  {
    "les": "Les 5",
    "type": "kleur",
    "instructie": "Volledige tekst van de opdracht hier.",
    "zinnen": [
      {"id": "z0", "tekst": "Eerste zin of fragment van de tekst die leerlingen moeten kleuren."},
      {"id": "z1", "tekst": "Tweede zin..."}
    ],
    "kleuren": ["geel", "blauw", "groen"]
  },
  {
    "les": "Les 6",
    "type": "markeer",
    "instructie": "Markeer het antwoord in de brief van oma.",
    "zinnen": [
      {"id": "f0", "tekst": "Eerste zin van de brief."},
      {"id": "f1", "tekst": "Tweede zin..."}
    ],
    "kleuren": []
  }
]

Regels:
- "type" is altijd "kleur" of "markeer"
- "zinnen" bevat de tekstfragmenten die leerlingen interactief moeten kleuren/markeren
- "kleuren" bevat de beschikbare kleuren (leeg array als er geen specifieke kleuren zijn)
- Voeg ALLEEN markeer/kleur-opdrachten toe, geen andere opdrachten
- Als er geen markeer/kleur-opdrachten zijn, geef dan een lege array: []
`;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("pdf") as File | null;

    if (!file || file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "Geen geldig PDF-bestand ontvangen." },
        { status: 400 }
      );
    }

    // ── Stap 1: PDF-tekst extraheren ────────────────────────────────────────
    const buffer = Buffer.from(await file.arrayBuffer());

    // Dynamische import om Next.js ESM-conflict te vermijden
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse");
    const pdfData = await pdfParse(buffer);
    const tekst: string = pdfData.text;

    if (!tekst || tekst.trim().length < 50) {
      return NextResponse.json(
        { error: "PDF-tekst kon niet worden gelezen. Probeer een andere PDF." },
        { status: 422 }
      );
    }

    // Stuur max 10.000 tekens naar Groq (meer past niet goed in één prompt)
    const tekst_gekort = tekst.substring(0, 10000);

    // ── Stap 2: Groq AI – opdrachten extraheren ─────────────────────────────
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEEM_PROMPT },
        { role: "user", content: GEBRUIKER_PROMPT(tekst_gekort) },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    });

    const antwoord = completion.choices[0]?.message?.content ?? "[]";

    // ── Stap 3: JSON parsen ──────────────────────────────────────────────────
    let opdrachten: {
      les: string;
      type: "kleur" | "markeer";
      instructie: string;
      zinnen: { id: string; tekst: string }[];
      kleuren: string[];
    }[];

    try {
      // Verwijder eventuele markdown code-blokken
      const schoon = antwoord
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/g, "")
        .trim();
      opdrachten = JSON.parse(schoon);
      if (!Array.isArray(opdrachten)) throw new Error("Geen array");
    } catch {
      return NextResponse.json(
        {
          error: "AI kon de opdrachten niet goed structureren.",
          ai_antwoord: antwoord,
        },
        { status: 500 }
      );
    }

    // ── Stap 4: Opslaan in Supabase ──────────────────────────────────────────
    const opgeslagen = [];

    for (const op of opdrachten) {
      const { data, error } = await supabase
        .from("opdrachten")
        .insert({
          pdf_naam: file.name,
          les: op.les ?? "Onbekend",
          type: op.type,
          instructie: op.instructie,
          zinnen: op.zinnen ?? [],
          extra: { kleuren: op.kleuren ?? [] },
        })
        .select()
        .single();

      if (!error && data) opgeslagen.push(data);
    }

    return NextResponse.json({
      success: true,
      gevonden: opdrachten.length,
      opgeslagen: opgeslagen.length,
      opdrachten: opgeslagen,
    });
  } catch (err) {
    console.error("verwerk-pdf fout:", err);
    return NextResponse.json(
      { error: "Interne serverfout. Controleer de logs." },
      { status: 500 }
    );
  }
}
