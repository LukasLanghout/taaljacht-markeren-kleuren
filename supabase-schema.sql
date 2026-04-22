-- Taal Jacht – Markeren & Kleuren
-- Voer dit uit in de Supabase SQL Editor

-- ─────────────────────────────────────────────
-- Tabel 1: Geëxtraheerde opdrachten uit de PDF
-- ─────────────────────────────────────────────
create table if not exists opdrachten (
  id            uuid default gen_random_uuid() primary key,
  pdf_naam      text not null,
  les           text,                    -- bijv. "Les 5"
  type          text not null,           -- "kleur" | "markeer"
  instructie    text not null,           -- de volledige opdrachttekst
  zinnen        jsonb not null default '[]', -- [{id:"z0", tekst:"..."}, ...]
  extra         jsonb default '{}',      -- {kleuren: ["geel","blauw","groen"], vraag_d: true}
  aangemaakt_op timestamptz default now()
);

-- ─────────────────────────────────────────────
-- Tabel 2: Antwoorden van leerlingen
-- ─────────────────────────────────────────────
create table if not exists antwoorden (
  id            uuid default gen_random_uuid() primary key,
  leerling_naam text not null,
  opdracht_id   uuid references opdrachten(id) on delete cascade,
  kleuren       jsonb not null default '{}', -- {"z0":"geel", "z1":"blauw", ...}
  extra         jsonb default '{}',           -- {"welke_kleur_niet": "groen"}
  opgeslagen_op timestamptz default now()
);

-- ─────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────
alter table opdrachten  enable row level security;
alter table antwoorden  enable row level security;

-- Iedereen mag opdrachten lezen (leerlingen)
create policy "Iedereen mag opdrachten lezen"
  on opdrachten for select using (true);

-- Iedereen mag opdrachten toevoegen (beheer-pagina zonder login)
create policy "Iedereen mag opdrachten toevoegen"
  on opdrachten for insert with check (true);

-- Iedereen mag antwoorden opslaan
create policy "Iedereen mag antwoord opslaan"
  on antwoorden for insert with check (true);

-- Iedereen mag antwoorden lezen
create policy "Iedereen mag antwoorden lezen"
  on antwoorden for select using (true);
