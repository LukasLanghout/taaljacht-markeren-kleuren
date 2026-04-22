"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase, type Opdracht, type Zin } from "@/lib/supabase";

// ── Kleur-configuratie ────────────────────────────────────────────────────────
const KLEUR_CONFIG: Record<string, { bg: string; border: string; text: string; label: string }> = {
  geel:    { bg: "bg-yellow-200", border: "border-yellow-400", text: "text-yellow-900", label: "Geel – Start"   },
  blauw:   { bg: "bg-blue-200",   border: "border-blue-400",   text: "text-blue-900",   label: "Blauw – Midden" },
  groen:   { bg: "bg-green-200",  border: "border-green-400",  text: "text-green-900",  label: "Groen – Slot"   },
  markeer: { bg: "bg-yellow-200", border: "border-yellow-400", text: "text-yellow-900", label: "📌 Markeer"     },
  rood:    { bg: "bg-red-200",    border: "border-red-400",    text: "text-red-900",    label: "Rood"           },
  paars:   { bg: "bg-purple-200", border: "border-purple-400", text: "text-purple-900", label: "Paars"          },
};

function zinBg(kleur: string | undefined): string {
  if (!kleur) return "bg-white border-gray-200 hover:bg-gray-50";
  const cfg = KLEUR_CONFIG[kleur];
  return cfg ? `${cfg.bg} ${cfg.border}` : "bg-white border-gray-200";
}

export default function OpdrachtPage() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [naam, setNaam] = useState("");
  const [opdracht, setOpdracht] = useState<Opdracht | null>(null);
  const [loading, setLoading] = useState(true);
  const [actieveKleur, setActieveKleur] = useState<string>("geel");
  const [gekleurd, setGekleurd] = useState<Record<string, string>>({});
  const [welkeNiet, setWelkeNiet] = useState<string>("");
  const [savStatus, setSavStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Leerling naam ophalen
  useEffect(() => {
    const n = sessionStorage.getItem("leerling_naam");
    if (!n) router.replace("/");
    else setNaam(n);
  }, [router]);

  // Opdracht ophalen uit Supabase
  useEffect(() => {
    if (!id) return;
    supabase
      .from("opdrachten")
      .select("*")
      .eq("id", id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          setLoading(false);
          return;
        }
        const op = data as Opdracht;
        setOpdracht(op);
        // Standaard eerste kleur instellen
        const beschikbaar = op.extra?.kleuren ?? [];
        if (op.type === "markeer") {
          setActieveKleur("markeer");
        } else if (beschikbaar.length > 0) {
          setActieveKleur(beschikbaar[0]);
        }
        setLoading(false);
      });
  }, [id]);

  const klikOpZin = useCallback(
    (zinId: string) => {
      setGekleurd((prev) => {
        if (prev[zinId] === actieveKleur) {
          const next = { ...prev };
          delete next[zinId];
          return next;
        }
        return { ...prev, [zinId]: actieveKleur };
      });
    },
    [actieveKleur]
  );

  async function opslaan() {
    if (!opdracht) return;
    setSavStatus("saving");
    const { error } = await supabase.from("antwoorden").insert({
      leerling_naam: naam,
      opdracht_id: opdracht.id,
      kleuren: gekleurd,
      extra: welkeNiet ? { welke_kleur_niet: welkeNiet } : {},
    });
    setSavStatus(error ? "error" : "saved");
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin w-10 h-10 border-4 border-pink-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-gray-500">Opdracht laden...</p>
        </div>
      </main>
    );
  }

  if (!opdracht) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-600 text-lg">❌ Opdracht niet gevonden.</p>
          <button onClick={() => router.push("/")} className="mt-4 text-pink-500 underline">
            Terug naar home
          </button>
        </div>
      </main>
    );
  }

  const beschikbareKleuren =
    opdracht.type === "markeer"
      ? ["markeer"]
      : (opdracht.extra?.kleuren ?? ["geel", "blauw", "groen"]);

  const isKleurOpdracht = opdracht.type === "kleur";
  const heeftVraagD =
    isKleurOpdracht && beschikbareKleuren.length >= 2;

  const aantalGekleurd = Object.keys(gekleurd).length;

  // Thema-kleur op basis van type
  const themaKleur =
    isKleurOpdracht
      ? { header: "bg-yellow-400", accent: "text-yellow-700", light: "bg-yellow-50 border-yellow-300" }
      : { header: "bg-purple-500", accent: "text-purple-700", light: "bg-purple-50 border-purple-300" };

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-50 to-white px-4 py-10">
      <div className="max-w-2xl mx-auto">
        {/* Terug */}
        <button
          onClick={() => router.push("/")}
          className="text-gray-400 hover:text-gray-600 mb-6 flex items-center gap-1 text-sm"
        >
          ← Terug naar opdrachten
        </button>

        {/* Header */}
        <div className={`${themaKleur.header} rounded-2xl px-6 py-4 mb-2 flex items-center gap-3 shadow`}>
          <span className="text-white font-extrabold text-2xl">{opdracht.les}</span>
          <span className="text-white/80 font-semibold text-lg">
            {isKleurOpdracht ? "🎨 Kleuren" : "📌 Markeren"}
          </span>
        </div>

        {/* Instructie */}
        <div className={`${themaKleur.light} border-l-4 rounded-xl px-5 py-4 mb-6`}>
          <p className="font-bold text-sm uppercase tracking-wide mb-1 text-gray-600">Opdracht</p>
          <p className="text-gray-800 text-sm leading-relaxed">{opdracht.instructie}</p>
        </div>

        {/* Kleur-palet (alleen bij kleur-type) */}
        {isKleurOpdracht && (
          <div className="flex gap-2 mb-6 flex-wrap">
            {beschikbareKleuren.map((k) => {
              const cfg = KLEUR_CONFIG[k];
              if (!cfg) return null;
              return (
                <button
                  key={k}
                  onClick={() => setActieveKleur(k)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold border-2 transition-all text-sm
                    ${actieveKleur === k
                      ? `${cfg.bg} ${cfg.border} ${cfg.text} shadow-md scale-105`
                      : "bg-white border-gray-300 text-gray-600 hover:border-gray-400"
                    }`}
                >
                  <span className={`w-4 h-4 rounded-full ${cfg.bg} border ${cfg.border}`} />
                  {cfg.label}
                </button>
              );
            })}
            <button
              onClick={() => setActieveKleur("gum")}
              className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold border-2 transition-all text-sm
                ${actieveKleur === "gum"
                  ? "bg-gray-200 border-gray-500 text-gray-700 shadow-md scale-105"
                  : "bg-white border-gray-300 text-gray-600 hover:border-gray-400"
                }`}
            >
              🧹 Gum
            </button>
          </div>
        )}

        {/* De tekst / brief */}
        <div className="bg-white rounded-2xl shadow-md p-6 mb-6 border border-gray-100">
          <p className="text-xs text-gray-400 italic text-center mb-4">
            {isKleurOpdracht
              ? "Klik op een zin om hem te kleuren · nogmaals klikken = verwijderen"
              : "Klik op een zin om hem te markeren · nogmaals klikken = verwijderen"}
          </p>

          <div className="space-y-2">
            {(opdracht.zinnen as Zin[]).map((zin) => {
              const huidig = gekleurd[zin.id];
              const isGemarkeerd = !!huidig;

              return (
                <button
                  key={zin.id}
                  onClick={() =>
                    actieveKleur === "gum"
                      ? setGekleurd((prev) => {
                          const next = { ...prev };
                          delete next[zin.id];
                          return next;
                        })
                      : klikOpZin(zin.id)
                  }
                  className={`w-full text-left px-4 py-2.5 rounded-xl border-2 transition-all duration-100
                    text-gray-800 font-serif leading-relaxed
                    focus:outline-none focus:ring-2 focus:ring-pink-400
                    ${zinBg(huidig)}`}
                >
                  {!isKleurOpdracht && isGemarkeerd && (
                    <span className="mr-1 text-yellow-600 text-xs">📌</span>
                  )}
                  {zin.tekst}
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-xs text-gray-400 text-right">
            {aantalGekleurd} van {opdracht.zinnen.length} zinnen{" "}
            {isKleurOpdracht ? "gekleurd" : "gemarkeerd"}
          </p>
        </div>

        {/* Samenvatting gemarkeerde zinnen (bij markeer-type) */}
        {!isKleurOpdracht && aantalGekleurd > 0 && (
          <div className="bg-yellow-50 border-2 border-yellow-300 rounded-2xl p-4 mb-6">
            <p className="font-semibold text-yellow-900 text-sm mb-2">
              📌 Jij hebt {aantalGekleurd} zin{aantalGekleurd !== 1 ? "nen" : ""} gemarkeerd:
            </p>
            <ul className="list-disc list-inside text-sm text-yellow-800 space-y-1">
              {(opdracht.zinnen as Zin[])
                .filter((z) => !!gekleurd[z.id])
                .map((z) => (
                  <li key={z.id}>{z.tekst}</li>
                ))}
            </ul>
          </div>
        )}

        {/* Vraag d – welke kleur niet gebruikt? */}
        {heeftVraagD && (
          <div className="bg-white rounded-2xl shadow p-6 mb-6">
            <p className="font-bold text-gray-800 mb-3">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-pink-500 text-white text-sm font-extrabold mr-2">
                d
              </span>
              Welke kleur heb je <strong>niet</strong> gebruikt? Kruis aan.
            </p>
            <div className="flex gap-4 flex-wrap">
              {beschikbareKleuren.map((k) => {
                const cfg = KLEUR_CONFIG[k];
                if (!cfg) return null;
                return (
                  <label key={k} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="welkeNiet"
                      value={k}
                      checked={welkeNiet === k}
                      onChange={() => setWelkeNiet(k)}
                      className="w-4 h-4 accent-pink-500"
                    />
                    <span className={`px-3 py-1 rounded-full text-sm font-bold ${cfg.bg} ${cfg.text}`}>
                      {cfg.label.split(" – ")[0]}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Opslaan */}
        <button
          onClick={opslaan}
          disabled={
            savStatus === "saving" ||
            savStatus === "saved" ||
            aantalGekleurd === 0
          }
          className={`w-full py-4 rounded-2xl font-extrabold text-lg transition-all shadow
            ${savStatus === "saved"
              ? "bg-green-500 text-white cursor-default"
              : savStatus === "error"
              ? "bg-red-500 text-white"
              : aantalGekleurd === 0
              ? "bg-gray-200 text-gray-400 cursor-not-allowed"
              : "bg-pink-500 hover:bg-pink-600 text-white"
            }`}
        >
          {savStatus === "saving" && "Opslaan..."}
          {savStatus === "saved"  && "✅ Opgeslagen!"}
          {savStatus === "error"  && "❌ Fout – probeer opnieuw"}
          {savStatus === "idle" && aantalGekleurd === 0 && `${isKleurOpdracht ? "Kleur" : "Markeer"} eerst iets`}
          {savStatus === "idle" && aantalGekleurd > 0  && "Opslaan →"}
        </button>

        {savStatus === "saved" && (
          <div className="mt-4 text-center">
            <button
              onClick={() => router.push("/")}
              className="text-pink-500 hover:text-pink-700 font-semibold underline text-sm"
            >
              Terug naar opdrachten
            </button>
          </div>
        )}

        <p className="mt-8 text-center text-xs text-gray-400">
          {opdracht.les} · Taal Jacht Groep 5 Blok 7
        </p>
      </div>
    </main>
  );
}
