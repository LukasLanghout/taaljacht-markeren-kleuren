import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { getSupabase } from "@/lib/supabase";

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

const GEBRUIKER_PROMPT = (tekst: string, bestandsnaam: string) => `
Hier is de tekst uit het PDF-bestand "${bestandsnaam}":

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
    const body = await req.json();
    const tekst: string = body.tekst ?? "";
    const bestandsnaam: string = body.bestandsnaam ?? "onbekend.pdf";

    if (!tekst || tekst.trim().length < 50) {
      return NextResponse.json(
        { error: "Te weinig tekst om te verwerken." },
        { status: 422 }
      );
    }

    // Max 10.000 tekens voor Groq
    const tekst_gekort = tekst.substring(0, 10000);

    // ── Groq AI – opdrachten extraheren ────────────────────────────────
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEEM_PROMPT },
        { role: "user", content: GEBRUIKER_PROMPT(tekst_gekort, bestandsnaam) },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    });

    const antwoord = completion.choices[0]?.message?.content ?? "[]";

    // ── JSON parsen ─────────────────────────────────────────────────────
    let opdrachten: {
      les: string;
      type: "kleur" | "markeer";
      instructie: string;
      zinnen: { id: string; tekst: string }[];
      kleuren: string[];
    }[];

    try {
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

    // ── Opslaan in Supabase ─────────────────────────────────────────────
    const supabase = getSupabase();
    const opgeslagen = [];

    for (const op of opdrachten) {
      const { data, error } = await supabase
        .from("opdrachten")
        .insert({
          pdf_naam: bestandsnaam,
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
      { error: "Interne serverfout: " + String(err) },
      { status: 500 }
    );
  }
}
