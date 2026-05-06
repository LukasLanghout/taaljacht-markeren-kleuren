import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Lazy singleton – wordt pas aangemaakt als het echt nodig is (niet tijdens build)
let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase-omgevingsvariabelen ontbreken. Voeg NEXT_PUBLIC_SUPABASE_URL en NEXT_PUBLIC_SUPABASE_ANON_KEY toe aan .env.local"
    );
  }
  _client = createClient(url, key);
  return _client;
}

// Handige alias voor kortere imports
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabase() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// ─── Types ───────────────────────────────────────────────────────────────────

export type Zin = {
  id: string;
  tekst: string;
  /** Optionele groep-aanduiding: bij kleur_woord_* hoort de zin/optie bij deze context. */
  context?: string;
};

export type OpdrachtSubtype =
  | "kleur_zinnen"
  | "markeer"
  | "kleur_woord_zin"
  | "kleur_woord_rij"
  | "kleur_woord_plaatje";

/**
 * Correcte antwoorden voor een opdracht.
 * - kleur_zinnen:        { "z0": "geel", "z1": "blauw", ... }
 * - markeer:             { "z5": true }
 * - kleur_woord_*:       { "z0": true, "z2": true } (welke woorden gekleurd moeten zijn)
 */
export type Antwoorden = Record<string, string | boolean>;

export type Opdracht = {
  id: string;
  pdf_naam: string;
  les: string;
  type: "kleur" | "markeer";
  instructie: string;
  zinnen: Zin[];
  extra: {
    kleuren?: string[];
    vraag_d?: string | boolean | null;
    subtype?: OpdrachtSubtype;
    bron?: string | null;
    aantal_per_groep?: number | null;
    /** Correcte antwoorden uit het antwoordenboek (door juf ingevuld of AI-extractie). */
    antwoorden?: Antwoorden;
    /** Bij vraag_d: welke kleur is het juiste antwoord (bv. "groen" als die niet gebruikt is). */
    vraag_d_antwoord?: string | null;
  };
  aangemaakt_op: string;
};

export type Antwoord = {
  id?: string;
  leerling_naam: string;
  opdracht_id: string;
  kleuren: Record<string, string>;
  extra?: Record<string, string>;
  opgeslagen_op?: string;
};
