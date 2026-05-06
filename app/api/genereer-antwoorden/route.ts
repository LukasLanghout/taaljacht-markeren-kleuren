import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "gemini-2.5-flash-lite";

const SYSTEEM_PROMPT = `
Je bent een Nederlandse leerkracht die de juiste antwoorden bepaalt voor een
markeer/kleur-opdracht uit Taal Jacht (groep 5).

Je krijgt: instructie, subtype, beschikbare kleuren, en een lijst zinnen
(elke zin heeft een id en optioneel een context).

Bepaal voor elke zin het juiste antwoord:

(A) Subtype "kleur_zinnen" — meestal start/midden/slot van een brief:
    - "start"  = begroeting + opening (Lieve oma, Ik heb zin om...)         → kleur 1 (vaak geel)
    - "midden" = de inhoud/vragen/verhaal                                    → kleur 2 (vaak blauw)
    - "slot"   = afsluiting + groet (Kijk eens aan! ... Groet, naam)         → kleur 3 (vaak groen)
    Geef voor elke zin de juiste kleur uit de beschikbare-kleuren-lijst.
    Zinnen die niet gekleurd hoeven kun je weglaten of "" geven.

(B) Subtype "markeer":
    Welke zin(nen) bevatten het antwoord op de vraag uit de instructie?
    Markeer alleen die met true. Andere zinnen niet opnemen of false geven.

(C) Subtype "kleur_woord_zin":
    Per groep zinnen (gegroepeerd op "context") staan 2-3 woordopties.
    Kies in elke groep het ene woord dat het best past bij de context-zin.
    Markeer dat woord met true.

(D) Subtype "kleur_woord_rij":
    Per context-groep staan 4-6 woordopties.
    Markeer per groep precies "aantal_per_groep" woorden die het beste passen
    bij de context (vaak synoniemen of bijbehorende uitleg). Markeer met true.

(E) Subtype "kleur_woord_plaatje":
    Per context-groep (een plaatje) staan meerdere woorden.
    Markeer "aantal_per_groep" woorden die bij het plaatje horen met true.

Bij "vraag_d" (welke kleur heb je niet gebruikt): bepaal welke kleur niet
voorkomt in je antwoorden voor de hoofdopdracht.

Geef het resultaat als geldige JSON. Geen uitleg, geen markdown.
`.trim();

const GEBRUIKER_PROMPT = (op: {
  les: string;
  instructie: string;
  subtype: string;
  kleuren: string[];
  vraag_d: string | null;
  aantal_per_groep: number | null;
  zinnen: { id: string; tekst: string; context?: string }[];
}) => `
Les: ${op.les}
Instructie: ${op.instructie}
Subtype: ${op.subtype}
Beschikbare kleuren: ${op.kleuren.length > 0 ? op.kleuren.join(", ") : "(geen specifieke kleur — gewoon highlight)"}
Aantal per groep: ${op.aantal_per_groep ?? "n.v.t."}
Vraag d: ${op.vraag_d ?? "(geen)"}

Zinnen:
${op.zinnen.map((z) => `- ${z.id}: "${z.tekst}"${z.context ? `  [context: ${z.context}]` : ""}`).join("\n")}

Geef het antwoord exact in dit JSON-formaat:
{
  "antwoorden": {
    "z0": "geel",
    "z1": true,
    "z2": ""
  },
  "vraag_d_antwoord": "groen"
}

- Voor kleur_zinnen: gebruik de kleur-string als waarde, of "" voor "niet kleuren".
- Voor markeer/kleur_woord_*: gebruik true voor "moet gekleurd/gemarkeerd worden".
- Laat zinnen die niet gekleurd hoeven gewoon weg of geef "".
- "vraag_d_antwoord" alleen invullen als er een vraag d is, anders weglaten of null.
`.trim();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const id: string = body.id ?? "";
    if (!id) {
      return NextResponse.json({ error: "id ontbreekt" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY ontbreekt." },
        { status: 500 }
      );
    }

    const supabase = getSupabase();

    // ── Opdracht ophalen ────────────────────────────────────────────────
    const { data: opdracht, error: ophaalErr } = await supabase
      .from("opdrachten")
      .select("*")
      .eq("id", id)
      .single();

    if (ophaalErr || !opdracht) {
      return NextResponse.json(
        { error: "Opdracht niet gevonden", detail: ophaalErr?.message },
        { status: 404 }
      );
    }

    if (!Array.isArray(opdracht.zinnen) || opdracht.zinnen.length === 0) {
      return NextResponse.json(
        { error: "Opdracht heeft geen zinnen om te beoordelen" },
        { status: 422 }
      );
    }

    const opData = {
      les: opdracht.les ?? "",
      instructie: opdracht.instructie ?? "",
      subtype: opdracht.extra?.subtype ?? (opdracht.type === "markeer" ? "markeer" : "kleur_zinnen"),
      kleuren: opdracht.extra?.kleuren ?? [],
      vraag_d: opdracht.extra?.vraag_d ?? null,
      aantal_per_groep: opdracht.extra?.aantal_per_groep ?? null,
      zinnen: opdracht.zinnen,
    };

    // ── Gemini-call met retry ───────────────────────────────────────────
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
    const MAX_POGINGEN = 3;
    let laatsteFout: { message: string; status: number } | null = null;
    let resultaat: { antwoorden?: Record<string, string | boolean>; vraag_d_antwoord?: string | null } | null = null;

    for (let poging = 1; poging <= MAX_POGINGEN; poging++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEEM_PROMPT }] },
          contents: [
            { role: "user", parts: [{ text: GEBRUIKER_PROMPT(opData) }] },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4096,
            responseMimeType: "application/json",
          },
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const tekst: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
        try {
          const schoon = tekst.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
          resultaat = JSON.parse(schoon);
          if (typeof resultaat !== "object" || resultaat === null) throw new Error();
          break;
        } catch {
          return NextResponse.json(
            { error: "AI gaf ongeldige JSON", ai_antwoord: tekst.substring(0, 400) },
            { status: 500 }
          );
        }
      }

      const errText = await res.text();
      laatsteFout = { message: errText, status: res.status };

      if (res.status !== 429 && res.status !== 503) {
        return NextResponse.json(
          { error: `Gemini API-fout (${res.status})`, detail: errText.substring(0, 400) },
          { status: res.status === 401 ? 401 : 500 }
        );
      }

      if (poging === MAX_POGINGEN) break;

      let wachtMs = 5000 * poging;
      const retryMatch = errText.match(/"retryDelay"\s*:\s*"(\d+)s"/);
      if (retryMatch) wachtMs = Math.min(parseInt(retryMatch[1], 10) * 1000 + 500, 15_000);
      await new Promise((r) => setTimeout(r, wachtMs));
    }

    if (!resultaat) {
      return NextResponse.json(
        {
          error: "Gemini rate-limit (server-retry uitgeput).",
          gemini_message: laatsteFout?.message?.substring(0, 400),
          gemini_status: laatsteFout?.status,
        },
        { status: 429 }
      );
    }

    // ── Schoonmaken: alleen geldige zin-id's, lege waarden eruit ────────
    const geldigeIds = new Set<string>(
      (opdracht.zinnen as { id: string }[]).map((z) => z.id)
    );
    const antwoordenSchoon: Record<string, string | boolean> = {};
    for (const [zinId, waarde] of Object.entries(resultaat.antwoorden ?? {})) {
      if (!geldigeIds.has(zinId)) continue;
      if (waarde === "" || waarde === false || waarde === null) continue;
      antwoordenSchoon[zinId] = waarde as string | boolean;
    }

    const nieuweExtra = {
      ...opdracht.extra,
      antwoorden: antwoordenSchoon,
      vraag_d_antwoord: resultaat.vraag_d_antwoord ?? null,
    };

    const { error: updateErr } = await supabase
      .from("opdrachten")
      .update({ extra: nieuweExtra })
      .eq("id", id);

    if (updateErr) {
      return NextResponse.json(
        { error: "Opslaan in DB mislukt", detail: updateErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      id,
      les: opdracht.les,
      aantal_antwoorden: Object.keys(antwoordenSchoon).length,
      antwoorden: antwoordenSchoon,
      vraag_d_antwoord: resultaat.vraag_d_antwoord ?? null,
    });
  } catch (err) {
    console.error("genereer-antwoorden fout:", err);
    return NextResponse.json(
      { error: "Interne serverfout: " + String(err) },
      { status: 500 }
    );
  }
}
