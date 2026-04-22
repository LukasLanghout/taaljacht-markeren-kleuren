"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// ─────────────────────────────────────────────
// Brief van oma (pagina 16, Taal Jacht Les 6)
// Opgedeeld in klikbare fragmenten.
// ─────────────────────────────────────────────
const FRAGMENTEN = [
  { id: "f0",  tekst: "Maarn, 11 maart 20…",                                           stijl: "text-right italic text-gray-500 text-sm" },
  { id: "f1",  tekst: "Lieve …,",                                                      stijl: "font-semibold" },
  { id: "f2",  tekst: "Wat leuk dat ik een brief van je kreeg.",                       stijl: "" },
  { id: "f3",  tekst: "Wat een verrassing.",                                           stijl: "" },
  { id: "f4",  tekst: "Je vroeg of wij ook rekenen hadden op school.",                 stijl: "" },
  { id: "f5",  tekst: "Ja, natuurlijk hadden we dat!",                                 stijl: "font-semibold" },
  { id: "f6",  tekst: "Hoe denk je anders dat ik zo goed kan sparen voor jullie cadeautjes?", stijl: "" },
  { id: "f7",  tekst: "Kom eens een weekendje logeren.",                               stijl: "" },
  { id: "f8",  tekst: "Gaan we iets leuks doen.",                                     stijl: "" },
  { id: "f9",  tekst: "Doe de groeten aan papa, mama en Petra.",                       stijl: "" },
  { id: "f10", tekst: "Veel liefs,",                                                   stijl: "italic" },
  { id: "f11", tekst: "Oma",                                                           stijl: "font-bold" },
];

export default function Les6Page() {
  const router = useRouter();
  const [naam, setNaam] = useState("");
  const [gemarkeerd, setGemarkeerd] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    const n = sessionStorage.getItem("leerling_naam");
    if (!n) router.replace("/");
    else setNaam(n);
  }, [router]);

  function toggleMarkeer(id: string) {
    setGemarkeerd((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function opslaan() {
    setStatus("saving");
    const kleurenObj: Record<string, string> = {};
    gemarkeerd.forEach((id) => { kleurenObj[id] = "markeer"; });

    const { error } = await supabase.from("antwoorden").insert({
      leerling_naam: naam,
      opdracht_id: "les6-op1a",
      kleuren: kleurenObj,
      extra: {},
    });
    setStatus(error ? "error" : "saved");
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-orange-50 to-white px-4 py-10">
      <div className="max-w-2xl mx-auto">
        {/* Terug */}
        <button
          onClick={() => router.push("/")}
          className="text-gray-400 hover:text-gray-600 mb-6 flex items-center gap-1 text-sm"
        >
          ← Terug
        </button>

        {/* Lesheader */}
        <div className="bg-purple-500 rounded-2xl px-6 py-4 mb-2 flex items-center gap-3 shadow">
          <span className="text-white font-extrabold text-2xl">Les 6</span>
          <span className="text-purple-100 font-semibold text-lg">Maken</span>
        </div>
        <div className="bg-purple-50 border-l-4 border-purple-400 rounded-xl px-5 py-3 mb-6 text-purple-900">
          <p className="font-bold text-sm uppercase tracking-wide mb-1">Lesdoel</p>
          <p className="text-sm">Ik kan een brief beantwoorden van iemand die ik ken.</p>
        </div>

        {/* Uitleg opdracht */}
        <div className="bg-white rounded-2xl shadow p-6 mb-6">
          <p className="font-bold text-gray-800 mb-2">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-pink-500 text-white text-sm font-extrabold mr-2">1</span>
            In de brief hieronder geeft oma antwoord op een vraag.
          </p>
          <p className="text-gray-700 text-sm">
            <strong>a</strong> Klik op de zinnen die het <strong>antwoord</strong> van oma zijn om ze te markeren.
            <br />
            Klik nog een keer om de markering te verwijderen.
          </p>
        </div>

        {/* Legenda */}
        <div className="flex items-center gap-3 mb-4 px-1">
          <span className="bg-yellow-200 border-2 border-yellow-400 rounded px-3 py-1 text-xs font-bold text-yellow-900">
            📌 gemarkeerd
          </span>
          <span className="text-gray-400 text-xs">← zo ziet een gemarkeerde zin eruit</span>
        </div>

        {/* De brief */}
        <div className="bg-white rounded-2xl shadow-md p-6 mb-6 border border-gray-100">
          {/* Brief-decoratie */}
          <div className="text-xs text-gray-400 italic text-center mb-4">
            Klik op een zin om hem te markeren
          </div>

          <div className="space-y-2 font-serif leading-relaxed">
            {FRAGMENTEN.map((frag) => (
              <button
                key={frag.id}
                onClick={() => toggleMarkeer(frag.id)}
                className={`w-full text-left px-3 py-2 rounded-lg border-2 transition-all duration-100 focus:outline-none focus:ring-2 focus:ring-yellow-400
                  ${gemarkeerd.has(frag.id)
                    ? "bg-yellow-200 border-yellow-400 shadow-inner"
                    : "bg-white border-transparent hover:bg-gray-50 hover:border-gray-200"
                  }
                  ${frag.stijl}`}
              >
                {gemarkeerd.has(frag.id) && (
                  <span className="mr-1 text-yellow-600 text-xs">📌</span>
                )}
                {frag.tekst}
              </button>
            ))}
          </div>

          <p className="mt-4 text-xs text-gray-400 text-right italic">
            Uit: Inez van Dijk en Marijn Backer, <em>Lieve engerd, de groetjes</em>
          </p>
        </div>

        {/* Samenvatting markering */}
        {gemarkeerd.size > 0 && (
          <div className="bg-yellow-50 border-2 border-yellow-300 rounded-2xl p-4 mb-6">
            <p className="font-semibold text-yellow-900 text-sm mb-2">
              📌 Jij hebt {gemarkeerd.size} zin{gemarkeerd.size !== 1 ? "nen" : ""} gemarkeerd:
            </p>
            <ul className="list-disc list-inside text-sm text-yellow-800 space-y-1">
              {FRAGMENTEN.filter((f) => gemarkeerd.has(f.id)).map((f) => (
                <li key={f.id}>{f.tekst}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Opslaan */}
        <button
          onClick={opslaan}
          disabled={status === "saving" || status === "saved" || gemarkeerd.size === 0}
          className={`w-full py-4 rounded-2xl font-extrabold text-lg transition-all shadow
            ${status === "saved"
              ? "bg-green-500 text-white cursor-default"
              : status === "error"
              ? "bg-red-500 text-white"
              : gemarkeerd.size === 0
              ? "bg-gray-200 text-gray-400 cursor-not-allowed"
              : "bg-pink-500 hover:bg-pink-600 text-white"
            }`}
        >
          {status === "saving" && "Opslaan..."}
          {status === "saved"  && "✅ Opgeslagen!"}
          {status === "error"  && "❌ Fout – probeer opnieuw"}
          {status === "idle" && gemarkeerd.size === 0 && "Markeer eerst een antwoord"}
          {status === "idle" && gemarkeerd.size > 0  && "Opslaan →"}
        </button>

        {status === "saved" && (
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
          Les 6 · Maken · Taal Jacht Groep 5 Blok 7
        </p>
      </div>
    </main>
  );
}
