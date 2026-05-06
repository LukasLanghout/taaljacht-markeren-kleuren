import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "gemini-2.5-flash";

const SYSTEEM_PROMPT = `
Je bent een assistent die opdrachten extraheert uit Nederlandse basisschoolboeken (Taal Jacht, groep 5).

Je taak: zoek ALLEEN opdrachten waarbij leerlingen iets moeten MARKEREN of KLEUREN.
Er zijn DRIE varianten:

1) "kleur_zinnen" — Kleur hele zinnen op basis van een categorie/kleur.
   Voorbeeld: "Kleur de zinnen die bij de start horen geel, het midden blauw, het slot groen."
   → zinnen = ALLE zinnen van de aangewezen brontekst (de leerling kiest welke kleur).
   → kleuren = de toegestane kleuren, bv. ["geel","blauw","groen"].

2) "markeer" — Markeer een specifiek woord/zin/antwoord in een tekst.
   Voorbeeld: "Markeer het antwoord in de brief."
   → zinnen = de zinnen of fragmenten waaruit de leerling kan kiezen.
   → kleuren = [] (geen specifieke kleur, gewoon highlight).

3) "kleur_woord" — Kies één of meerdere woorden uit een rij opties en kleur ze.
   Voorbeeld: "Welk woord past het best bij de zin? Kleur dat woord." (met 2-3 woordopties per zin)
   Voorbeeld: "Drie woorden passen bij het plaatje. Kleur die woorden."
   → zinnen = de woordopties (elk woord is één 'zin').
   → context = de zin/het plaatje waar het bij hoort (per groepje).
   → kleuren = [] (gewoon highlight).

Geef het resultaat als een JSON array. Geen uitleg, geen markdown, ALLEEN geldige JSON.
`.trim();

const GEBRUIKER_PROMPT = (tekst: string, bestandsnaam: string) => `
Hier is de tekst uit het PDF-bestand "${bestandsnaam}":

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
      {"id": "z0", "tekst": "Eerste zin uit de brontekst."},
      {"id": "z1", "tekst": "Tweede zin..."}
    ],
    "kleuren": ["geel", "blauw", "groen"],
    "vraag_d": "Welke kleur heb je niet gebruikt?"
  }
]

Velden:
- "les": "Les 5", "Les 6", "Taak 5", enz. — pak het op uit de paginakop.
- "type": "kleur" of "markeer".
- "subtype": "kleur_zinnen" | "markeer" | "kleur_woord". Verplicht.
- "instructie": de letterlijke opdrachttekst.
- "bron": pagina-aanduiding van de brontekst, bv. "p14" of "p16". Leeg laten als niet duidelijk.
- "zinnen": array met objecten {id, tekst}. Bij kleur_zinnen/markeer = zinnen uit de brontekst; bij kleur_woord = de woordopties.
- "kleuren": array met toegestane kleurnamen ("geel"/"blauw"/"groen") of leeg array.
- "vraag_d": optionele vervolgvraag, alleen als die in de opdracht staat (bv. "Welke kleur heb je niet gebruikt?").

Regels:
- Voeg ALLEEN echte markeer/kleur-opdrachten toe. Sla "kruis aan", "trek lijntjes", "schrijf op", "vul in" en woordenlijsten over.
- Als de brontekst (waar de zinnen vandaan komen) op een ANDERE pagina staat dan de opdracht, zoek die pagina op in de meegestuurde tekst en haal daar de zinnen vandaan.
- Bij "kleur_zinnen": neem de brontekst zin-voor-zin op, niet samengevat. Splits op leestekens (./?/!).
- Geef bij geen opdrachten een lege array: [].
`.trim();

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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY ontbreekt in environment variables." },
        { status: 500 }
      );
    }

    // Max 30.000 tekens — Gemini 2.5 Flash heeft ruim contextvenster
    const tekst_gekort = tekst.substring(0, 30000);

    // ── Gemini 2.5 Flash – opdrachten extraheren als JSON ───────────────
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

    const MAX_POGINGEN = 4;
    let laatsteFout: { message: string; status?: number } | null = null;
    let antwoord = "[]";

    for (let poging = 1; poging <= MAX_POGINGEN; poging++) {
      const geminiRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEEM_PROMPT }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: GEBRUIKER_PROMPT(tekst_gekort, bestandsnaam) }],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
          },
        }),
      });

      if (geminiRes.ok) {
        const json = await geminiRes.json();
        antwoord =
          json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
        laatsteFout = null;
        break;
      }

      const errText = await geminiRes.text();
      laatsteFout = { message: errText, status: geminiRes.status };

      if (geminiRes.status !== 429 && geminiRes.status !== 503) {
        console.error(`Gemini extract-fout (${geminiRes.status}):`, errText);
        return NextResponse.json(
          {
            error: `Gemini API-fout (${geminiRes.status})`,
            detail: errText.substring(0, 400),
          },
          { status: geminiRes.status === 401 ? 401 : 500 }
        );
      }

      if (poging === MAX_POGINGEN) break;

      let wachtMs = 5000 * poging;
      const retryMatch = errText.match(/"retryDelay"\s*:\s*"(\d+)s"/);
      if (retryMatch) {
        wachtMs = parseInt(retryMatch[1], 10) * 1000 + 500;
      }
      const veiligeWacht = Math.min(wachtMs, 45_000);
      console.log(
        `verwerk-pdf rate-limited, poging ${poging}/${MAX_POGINGEN}, wacht ${veiligeWacht}ms`
      );
      await new Promise((r) => setTimeout(r, veiligeWacht));
    }

    if (laatsteFout) {
      return NextResponse.json(
        {
          error: "Gemini rate-limit bereikt na alle retries.",
          gemini_message: laatsteFout.message?.substring(0, 500) ?? null,
          gemini_status: laatsteFout.status ?? null,
        },
        { status: 429 }
      );
    }

    // ── JSON parsen ─────────────────────────────────────────────────────
    let opdrachten: {
      les: string;
      type: "kleur" | "markeer";
      subtype?: "kleur_zinnen" | "markeer" | "kleur_woord";
      instructie: string;
      bron?: string;
      zinnen: { id: string; tekst: string }[];
      kleuren: string[];
      vraag_d?: string;
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
          extra: {
            kleuren: op.kleuren ?? [],
            subtype:
              op.subtype ?? (op.type === "markeer" ? "markeer" : "kleur_zinnen"),
            bron: op.bron ?? null,
            vraag_d: op.vraag_d ?? null,
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
