import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "mistralai/Mistral-7B-Instruct-v0.2";
const HF_URL = "https://api-inference.huggingface.co/v1/chat/completions";

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

(B) Subtype "markeer":
    Welke zin(nen) bevatten het antwoord op de vraag uit de instructie?
    Markeer alleen die met true.

(C) Subtype "kleur_woord_zin":
    Per groep zinnen (gegroepeerd op "context") staan 2-3 woordopties.
    Kies in elke groep het ene woord dat het best past bij de context-zin.
    Markeer dat woord met true.

(D) Subtype "kleur_woord_rij":
    Per context-groep staan 4-6 woordopties.
    Markeer per groep precies "aantal_per_groep" woorden met true.

(E) Subtype "kleur_woord_plaatje":
    Per context-groep staan meerdere woorden.
    Markeer "aantal_per_groep" woorden die bij het plaatje horen met true.

Bij "vraag_d": bepaal welke kleur niet voorkomt in je antwoorden.

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
Beschikbare kleuren: ${op.kleuren.length > 0 ? op.kleuren.join(", ") : "(geen — gewoon highlight)"}
Aantal per groep: ${op.aantal_per_groep ?? "n.v.t."}
Vraag d: ${op.vraag_d ?? "(geen)"}

Zinnen:
${op.zinnen.map((z) => `- ${z.id}: "${z.tekst}"${z.context ? `  [context: ${z.context}]` : ""}`).join("\n")}

Geef het antwoord exact in dit JSON-formaat (ALLEEN JSON, geen uitleg):
{
  "antwoorden": {
    "z0": "geel",
    "z1": true,
    "z2": ""
  },
  "vraag_d_antwoord": "groen"
}

- Voor kleur_zinnen: gebruik de kleur-string als waarde, of "" voor niet kleuren.
- Voor markeer/kleur_woord_*: gebruik true voor moet gekleurd worden.
- "vraag_d_antwoord" alleen invullen als er een vraag d is, anders null.
`.trim();

async function callHF(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string
): Promise<{ ok: true; content: string } | { ok: false; status: number; message: string }> {
  const MAX_POGINGEN = 3;

  for (let poging = 1; poging <= MAX_POGINGEN; poging++) {
    const res = await fetch(HF_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 4096,
        temperature: 0.1,
      }),
    });

    if (res.ok) {
      const json = await res.json();
      const content: string = json?.choices?.[0]?.message?.content ?? "{}";
      return { ok: true, content };
    }

    const errText = await res.text();

    if (res.status === 503) {
      if (poging === MAX_POGINGEN) break;
      let wachtMs = 20_000;
      try {
        const errJson = JSON.parse(errText);
        if (errJson.estimated_time) wachtMs = Math.min(errJson.estimated_time * 1000 + 1000, 40_000);
      } catch { /* niet-JSON */ }
      await new Promise((r) => setTimeout(r, wachtMs));
      continue;
    }

    if (res.status === 429) {
      if (poging === MAX_POGINGEN) break;
      await new Promise((r) => setTimeout(r, 15_000 * poging));
      continue;
    }

    return { ok: false, status: res.status, message: errText.substring(0, 400) };
  }

  return { ok: false, status: 503, message: "HF model niet bereikbaar na alle pogingen." };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const id: string = body.id ?? "";
    if (!id) {
      return NextResponse.json({ error: "id ontbreekt" }, { status: 400 });
    }

    const apiKey = process.env.HUGGINGFACE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "HUGGINGFACE_API_KEY ontbreekt." }, { status: 500 });
    }

    const supabase = getSupabase();

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

    const resultaat = await callHF(apiKey, SYSTEEM_PROMPT, GEBRUIKER_PROMPT(opData));

    if (!resultaat.ok) {
      let userMsg = `HuggingFace API-fout (${resultaat.status})`;
      if (resultaat.status === 401) userMsg = "HuggingFace API-key ongeldig. Check HUGGINGFACE_API_KEY in Vercel env-vars.";
      if (resultaat.status === 503) userMsg = "HuggingFace model laadt. Probeer over 30s opnieuw.";
      return NextResponse.json({ error: userMsg, detail: resultaat.message }, { status: resultaat.status });
    }

    // JSON parsen
    let parsed: { antwoorden?: Record<string, string | boolean>; vraag_d_antwoord?: string | null } | null = null;
    try {
      const schoon = resultaat.content
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/g, "")
        .trim();
      // Zoek het JSON object in de tekst
      const objMatch = schoon.match(/\{[\s\S]*\}/);
      const toParse = objMatch ? objMatch[0] : schoon;
      parsed = JSON.parse(toParse);
      if (typeof parsed !== "object" || parsed === null) throw new Error();
    } catch {
      return NextResponse.json(
        { error: "AI gaf ongeldige JSON", ai_antwoord: resultaat.content.substring(0, 400) },
        { status: 500 }
      );
    }

    // Schoonmaken
    const geldigeIds = new Set<string>(
      (opdracht.zinnen as { id: string }[]).map((z) => z.id)
    );
    const antwoordenSchoon: Record<string, string | boolean> = {};
    for (const [zinId, waarde] of Object.entries(parsed.antwoorden ?? {})) {
      if (!geldigeIds.has(zinId)) continue;
      if (waarde === "" || waarde === false || waarde === null) continue;
      antwoordenSchoon[zinId] = waarde as string | boolean;
    }

    const nieuweExtra = {
      ...opdracht.extra,
      antwoorden: antwoordenSchoon,
      vraag_d_antwoord: parsed.vraag_d_antwoord ?? null,
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
      vraag_d_antwoord: parsed.vraag_d_antwoord ?? null,
    });
  } catch (err) {
    console.error("genereer-antwoorden fout:", err);
    return NextResponse.json(
      { error: "Interne serverfout: " + String(err) },
      { status: 500 }
    );
  }
}
