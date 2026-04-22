"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// ─────────────────────────────────────────────
// Zinnen uit de brief op pagina 14 van Taal Jacht
// Elke zin krijgt een uniek id.
// ─────────────────────────────────────────────
const ZINNEN = [
  { id: "z0",  tekst: "Lieve oma," },
  { id: "z1",  tekst: "Ik heb zin om u een brief te schrijven." },
  { id: "z2",  tekst: "En hier komt hij." },
  { id: "z3",  tekst: "Vanochtend op school hadden we rekenen." },
  { id: "z4",  tekst: "Moest u vroeger, toen u op school zat, ook elke dag rekenen?" },
  { id: "z5",  tekst: "Tja." },
  { id: "z6",  tekst: "En nu verder." },
  { id: "z7",  tekst: "Wat heb je voor leuks gedaan, of spannends?" },
  { id: "z8",  tekst: "Of wat ga je doen?" },
  { id: "z9",  tekst: "Heb je ergens aan gedacht?" },
  { id: "z10", tekst: "Iets geks gezien?" },
  { id: "z11", tekst: "Heb je een idee?" },
  { id: "z12", tekst: "Wil je weten hoe zij altijd haar beroemde kaas-ananas-boterhammen maakt?" },
];

type Kleur = "geel" | "blauw" | "groen" | null;
type KleurenMap = Record<string, Kleur>;

const KLEUREN: { id: Kleur; label: string; bg: string; border: string; text: string }[] = [
  { id: "geel",  label: "Geel – Start",   bg: "bg-yellow-300", border: "border-yellow-500", text: "text-yellow-900" },
  { id: "blauw", label: "Blauw – Midden", bg: "bg-blue-300",   border: "border-blue-500",   text: "text-blue-900"   },
  { id: "groen", label: "Groen – Slot",   bg: "bg-green-300",  border: "border-green-500",  text: "text-green-900"  },
];

function zinBg(kleur: Kleur): string {
  if (kleur === "geel")  return "bg-yellow-200 border-yellow-400";
  if (kleur === "blauw") return "bg-blue-200   border-blue-400";
  if (kleur === "groen") return "bg-green-200  border-green-400";
  return "bg-white border-gray-200 hover:bg-gray-50";
}

export default function Les5Page() {
  const router = useRouter();
  const [naam, setNaam] = useState("");
  const [actieveKleur, setActieveKleur] = useState<Kleur>("geel");
  const [kleuren, setKleuren] = useState<KleurenMap>({});
  const [welkeNiet, setWelkeNiet] = useState<Kleur | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [popId, setPopId] = useState<string | null>(null);

  useEffect(() => {
    const n = sessionStorage.getItem("leerling_naam");
    if (!n) router.replace("/");
    else setNaam(n);
  }, [router]);

  const kleurZin = useCallback((id: string) => {
    setKleuren((prev) => {
      // Tweede klik op dezelfde zin → verwijder kleur
      if (prev[id] === actieveKleur) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: actieveKleur };
    });
    setPopId(id);
    setTimeout(() => setPopId(null), 160);
  }, [actieveKleur]);

  async function opslaan() {
    setStatus("saving");
    const { error } = await supabase.from("antwoorden").insert({
      leerling_naam: naam,
      opdracht_id: "les5-op1",
      kleuren,
      extra: { welke_kleur_niet: welkeNiet ?? "" },
    });
    setStatus(error ? "error" : "saved");
  }

  const aantalGekleurd = Object.keys(kleuren).length;

  return (
    <main className="min-h-screen bg-gradient-to-b from-yellow-50 to-white px-4 py-10">
      <div className="max-w-2xl mx-auto">
        {/* Terug */}
        <button
          onClick={() => router.push("/")}
          className="text-gray-400 hover:text-gray-600 mb-6 flex items-center gap-1 text-sm"
        >
          ← Terug
        </button>

        {/* Lesheader */}
        <div className="bg-yellow-400 rounded-2xl px-6 py-4 mb-2 flex items-center gap-3 shadow">
          <span className="text-white font-extrabold text-2xl">Les 5</span>
          <span className="text-yellow-900 font-semibold text-lg">Verkennen</span>
        </div>
        <div className="bg-yellow-100 border-l-4 border-yellow-400 rounded-xl px-5 py-3 mb-6 text-yellow-900">
          <p className="font-bold text-sm uppercase tracking-wide mb-1">Lesdoel</p>
          <p className="text-sm">Ik verken kenmerken van een brief.</p>
        </div>

        {/* Opdracht uitleg */}
        <div className="bg-white rounded-2xl shadow p-6 mb-6">
          <p className="font-bold text-gray-800 mb-3">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-pink-500 text-white text-sm font-extrabold mr-2">1</span>
            Bekijk de brief hieronder. <span className="text-pink-600 font-extrabold">Let op: je gebruikt niet alle kleuren!</span>
          </p>
          <div className="space-y-1 text-sm text-gray-700 mb-1">
            <p>🟡 <strong>a</strong> Kleur de zinnen die bij de <strong>start</strong> van de brief horen <strong>geel</strong>.</p>
            <p>🔵 <strong>b</strong> Kleur de zinnen die bij het <strong>midden</strong> horen <strong>blauw</strong>.</p>
            <p>🟢 <strong>c</strong> Kleur de zinnen die bij het <strong>slot</strong> horen <strong>groen</strong>.</p>
          </div>
        </div>

        {/* Kleur-knoppen (palet) */}
        <div className="flex gap-3 mb-6 flex-wrap">
          {KLEUREN.map((k) => (
            <button
              key={k.id}
              onClick={() => setActieveKleur(k.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold border-2 transition-all text-sm
                ${actieveKleur === k.id
                  ? `${k.bg} ${k.border} ${k.text} shadow-md scale-105`
                  : "bg-white border-gray-300 text-gray-600 hover:border-gray-400"
                }`}
            >
              <span className={`w-4 h-4 rounded-full ${k.bg} border ${k.border}`} />
              {k.label}
            </button>
          ))}
          <button
            onClick={() => setActieveKleur(null)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold border-2 transition-all text-sm
              ${actieveKleur === null
                ? "bg-gray-200 border-gray-500 text-gray-700 shadow-md scale-105"
                : "bg-white border-gray-300 text-gray-600 hover:border-gray-400"
              }`}
          >
            🧹 Gum
          </button>
        </div>

        {/* De brief */}
        <div className="bg-white rounded-2xl shadow-md p-6 mb-6 border border-gray-100">
          <div className="text-center text-xs text-gray-400 mb-4 italic">
            Klik op een zin om hem te kleuren met de gekozen kleur · nogmaals klikken = verwijderen
          </div>
          <div className="space-y-2">
            {ZINNEN.map((zin) => (
              <button
                key={zin.id}
                onClick={() => kleurZin(zin.id)}
                className={`w-full text-left px-4 py-2 rounded-xl border-2 transition-all duration-100 text-gray-800
                  ${zinBg(kleuren[zin.id] ?? null)}
                  ${popId === zin.id ? "zin-pop" : ""}
                  focus:outline-none focus:ring-2 focus:ring-pink-400`}
              >
                {zin.tekst}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-400 text-right">
            {aantalGekleurd} van {ZINNEN.length} zinnen gekleurd
          </p>
        </div>

        {/* Vraag d */}
        <div className="bg-white rounded-2xl shadow p-6 mb-6">
          <p className="font-bold text-gray-800 mb-3">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-pink-500 text-white text-sm font-extrabold mr-2">d</span>
            Welke kleur heb je <strong>niet</strong> gebruikt? Kruis aan.
          </p>
          <div className="flex gap-4 flex-wrap">
            {KLEUREN.map((k) => (
              <label key={k.id} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="welkeNiet"
                  value={k.id!}
                  checked={welkeNiet === k.id}
                  onChange={() => setWelkeNiet(k.id)}
                  className="w-4 h-4 accent-pink-500"
                />
                <span className={`px-3 py-1 rounded-full text-sm font-bold ${k.bg} ${k.text}`}>
                  {k.label.split(" – ")[0]}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Opslaan */}
        <button
          onClick={opslaan}
          disabled={status === "saving" || status === "saved"}
          className={`w-full py-4 rounded-2xl font-extrabold text-lg transition-all shadow
            ${status === "saved"
              ? "bg-green-500 text-white cursor-default"
              : status === "error"
              ? "bg-red-500 text-white"
              : "bg-pink-500 hover:bg-pink-600 text-white"
            }`}
        >
          {status === "saving" && "Opslaan..."}
          {status === "saved"  && "✅ Opgeslagen!"}
          {status === "error"  && "❌ Fout – probeer opnieuw"}
          {status === "idle"   && "Opslaan →"}
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
          Les 5 · Verkennen · Taal Jacht Groep 5 Blok 7
        </p>
      </div>
    </main>
  );
}
