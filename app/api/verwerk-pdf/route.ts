import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "gemini-2.5-flash-lite";

const SYSTEEM_PROMPT = `
Je bent een assistent die opdrachten extraheert uit Nederlandse basisschoolboeken
(Taal Jacht, groep 5).

Je taak: zoek ALLE opdrachten waarbij leerlingen iets moeten MARKEREN of KLEUREN.
Sla "kruis aan", "trek lijntjes", "schrijf op", "vul in", woordenlijsten en rubrics over.

Er zijn vijf subtypes — gebruik exact deze waardes voor "subtype":

(A) "kleur_zinnen"
    Kleur hele zinnen in een brontekst, op basis van categorieën (start/midden/slot, e.d.).
    Voorbeeld: "Kleur de zinnen die bij de start horen geel, het midden blauw, het slot groen."
    De brontekst staat meestal op een ANDERE pagina (vaak één eerder).
    → zinnen: ALLE zinnen van de brontekst, op volgorde, gesplitst op . ? !
    → kleuren: bv. ["geel","blauw","groen"]
    → context op zinnen: niet nodig.

(B) "markeer"
    Markeer een specifiek woord/zin/antwoord in een tekst (vaak een brief).
    Voorbeeld: "In de brief geeft oma antwoord op de vraag. Markeer het antwoord."
    → zinnen: alle zinnen/regels uit de brontekst waaruit gekozen kan worden
    → kleuren: []

(C) "kleur_woord_zin"
    Per zin staan 2-3 woordopties; de leerling kleurt het woord dat het best past.
    Voorbeeld: "Welk woord past het best bij de zin? Kleur dat woord."
    → zinnen: elk woordoptie is één 'zin' { id, tekst, context }
    → context = de bijbehorende zin/het zin-fragment ("Hij rende ___ weg.")
    → kleuren: []

(D) "kleur_woord_rij"
    Per rij staan 4-6 woorden; de leerling kleurt 2 (of meer) woorden in elke rij die bij een
    bepaald begrip horen.
    Voorbeelden:
      - "Welke woorden hebben met elkaar te maken? Kleur in elke rij twee woorden."
      - "Wat hoort bij het vetgedrukte woord? Kleur in elke rij twee woorden."
    → context = de aanduiding/het kop-woord van die rij (bv. "rij 1: bij groot")
    → kleuren: []

(E) "kleur_woord_plaatje"
    Bij een plaatje staan meerdere woorden; de leerling kleurt de woorden die bij het plaatje passen.
    Voorbeeld: "Drie woorden passen bij het plaatje. Kleur die woorden."
    → context = beschrijving van het plaatje
    → kleuren: []

Eén pagina kan meerdere opdrachten bevatten — geef ze dan alle als losse objecten in de array.

Geef het resultaat ALLEEN als geldige JSON array. Geen markdown, geen uitleg.
`.trim();

const GEBRUIKER_PROMPT = (tekst: string, bestandsnaam: string, deelInfo: string) => `
Hier is een deel van de tekst uit het PDF-bestand "${bestandsnaam}" (${deelInfo}).
Pagina-markers staan tussen "=== Pagina N ===".

${tekst}

Geef een JSON array met opdrachten in precies dit formaat:
[
  {
    "les": "Les 5",
    "type": "kleur",
    "subtype": "kleur_zinnen",
    "instructie": "Volledige tekst van de opdracht hier.",
    "bron": "p14",
    "zinnen": [
      {"id": "z0", "tekst": "Eerste zin uit de brontekst.", "context": ""},
      {"id": "z1", "tekst": "Tweede zin...", "context": ""}
    ],
    "kleuren": ["geel", "blauw", "groen"],
    "vraag_d": "Welke kleur heb je niet gebruikt?",
    "aantal_per_groep": 1
  }
]

Velden:
- "les": "Les 5", "Les 6", "Taak 2", "Tussenstand Les 7-8-9", enz. — pak het op uit de paginakop.
- "type": "kleur" of "markeer".
- "subtype": "kleur_zinnen" | "markeer" | "kleur_woord_zin" | "kleur_woord_rij" | "kleur_woord_plaatje".
- "instructie": de letterlijke opdrachttekst.
- "bron": pagina-aanduiding van de brontekst (bv. "p14"), leeg laten als niet relevant.
- "zinnen": array met objecten { id, tekst, context }. Bij C/D/E is "context" verplicht.
- "kleuren": array met toegestane kleurnamen of leeg array.
- "vraag_d": optionele vervolgvraag, alleen als die in de opdracht staat.
- "aantal_per_groep": hoeveel woorden de leerling per context-groep moet kleuren (1, 2 of 3).

BELANGRIJK:
- Als de brontekst op een ANDERE pagina staat dan de opdracht, zoek die pagina op en haal
  daar de zinnen vandaan.
- Bij "kleur_zinnen": neem de brontekst zin-voor-zin op, niet samengevat.
- Eén pagina kan meerdere opdrachten bevatten.
- Geef bij geen opdrachten een lege array: [].
`.trim();

type ExtractOp = {
  les: string;
  type: "kleur" | "markeer";
  subtype?:
    | "kleur_zinnen"
    | "markeer"
    | "kleur_woord_zin"
    | "kleur_woord_rij"
    | "kleur_woord_plaatje";
  instructie: string;
  bron?: string;
  zinnen: { id: string; tekst: string; context?: string }[];
  kleuren: string[];
  vraag_d?: string;
  aantal_per_groep?: number;
};

/**
 * Verwerk één chunk OCR-tekst:
 * Input:  { tekst: string, bestandsnaam: string, deelInfo?: string }
 * Output: { gevonden, opgeslagen, opdrachten }
 *
 * De client splitst de OCR-tekst in chunks en roept dit endpoint per chunk aan.
 * Zo blijft elke call ruim onder Vercel's 60s function-timeout.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tekst: string = body.tekst ?? "";
    const bestandsnaam: string = body.bestandsnaam ?? "onbekend.pdf";
    const deelInfo: string = body.deelInfo ?? "deel 1 van 1";

    if (!tekst || tekst.trim().length < 30) {
      return NextResponse.json({ gevonden: 0, opgeslagen: 0, opdrachten: [] });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY ontbreekt in environment variables." },
        { status: 500 }
      );
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
    const MAX_POGINGEN = 3;
    let laatsteFout: { message: string; status: number } | null = null;
    let opdrachten: ExtractOp[] = [];

    for (let poging = 1; poging <= MAX_POGINGEN; poging++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEEM_PROMPT }] },
          contents: [
            {
              role: "user",
              parts: [{ text: GEBRUIKER_PROMPT(tekst, bestandsnaam, deelInfo) }],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
          },
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const antwoord: string =
          json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
        try {
          const schoon = antwoord.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
          const parsed = JSON.parse(schoon);
          if (!Array.isArray(parsed)) throw new Error("Geen array");
          opdrachten = parsed as ExtractOp[];
          laatsteFout = null;
          break;
        } catch {
          return NextResponse.json(
            { error: "AI gaf ongeldige JSON.", ai_antwoord: antwoord.substring(0, 500) },
            { status: 500 }
          );
        }
      }

      const errText = await res.text();
      laatsteFout = { message: errText, status: res.status };

      // Niet-retryable
      if (res.status !== 429 && res.status !== 503) {
        console.error(`Gemini extract-fout (${res.status}):`, errText.substring(0, 300));
        return NextResponse.json(
          {
            error: `Gemini API-fout (${res.status})`,
            detail: errText.substring(0, 400),
          },
          { status: res.status === 401 ? 401 : 500 }
        );
      }

      if (poging === MAX_POGINGEN) break;

      // Korte server-side retry: max 15s totaal blijft veilig binnen 60s.
      let wachtMs = 5000 * poging;
      const retryMatch = errText.match(/"retryDelay"\s*:\s*"(\d+)s"/);
      if (retryMatch) {
        wachtMs = Math.min(parseInt(retryMatch[1], 10) * 1000 + 500, 15_000);
      }
      console.log(
        `verwerk-pdf rate-limited (${deelInfo}), poging ${poging}/${MAX_POGINGEN}, wacht ${wachtMs}ms`
      );
      await new Promise((r) => setTimeout(r, wachtMs));
    }

    if (laatsteFout) {
      return NextResponse.json(
        {
          error: "Gemini rate-limit (server-retry uitgeput).",
          gemini_message: laatsteFout.message?.substring(0, 500) ?? null,
          gemini_status: laatsteFout.status,
        },
        { status: 429 }
      );
    }

    // ── Opslaan in Supabase ─────────────────────────────────────────────
    const supabase = getSupabase();
    const opgeslagen = [];

    for (const op of opdrachten) {
      const zinnen = (op.zinnen ?? []).map((z, idx) => ({
        id: z.id ?? `z${idx}`,
        tekst: z.tekst ?? "",
        ...(z.context && z.context.length > 0 ? { context: z.context } : {}),
      }));

      const subtype =
        op.subtype ??
        (op.type === "markeer"
          ? "markeer"
          : op.kleuren && op.kleuren.length > 0
          ? "kleur_zinnen"
          : "kleur_woord_zin");

      const { data, error } = await supabase
        .from("opdrachten")
        .insert({
          pdf_naam: bestandsnaam,
          les: op.les ?? "Onbekend",
          type: op.type,
          instructie: op.instructie,
          zinnen,
          extra: {
            kleuren: op.kleuren ?? [],
            subtype,
            bron: op.bron ?? null,
            vraag_d: op.vraag_d ?? null,
            aantal_per_groep: op.aantal_per_groep ?? null,
          },
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
