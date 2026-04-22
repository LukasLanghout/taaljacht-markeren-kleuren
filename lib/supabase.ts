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
};

export type Opdracht = {
  id: string;
  pdf_naam: string;
  les: string;
  type: "kleur" | "markeer";
  instructie: string;
  zinnen: Zin[];
  extra: {
    kleuren?: string[];
    vraag_d?: boolean;
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
