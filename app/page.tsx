"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { supabase, type Opdracht } from "@/lib/supabase";

export default function Home() {
  const [naam, setNaam] = useState("");
  const [opgeslagen, setOpgeslagen] = useState(false);
  const [opdrachten, setOpdrachten] = useState<Opdracht[]>([]);
  const [ladenOpdrachten, setLadenOpdrachten] = useState(true);

  // Naam herstellen uit sessie
  useEffect(() => {
    const n = sessionStorage.getItem("leerling_naam");
    if (n) { setNaam(n); setOpgeslagen(true); }
  }, []);

  // Opdrachten laden
  useEffect(() => {
    supabase
      .from("opdrachten")
      .select("*")
      .order("aangemaakt_op", { ascending: true })
      .then(({ data }) => {
        if (data) setOpdrachten(data as Opdracht[]);
        setLadenOpdrachten(false);
      });
  }, []);

  function slaOpEnGaVerder() {
    if (naam.trim()) {
      sessionStorage.setItem("leerling_naam", naam.trim());
      setOpgeslagen(true);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-green-100 to-blue-50 flex flex-col items-center justify-center px-4 py-12">
      {/* Logo / Header */}
      <div className="text-center mb-10">
        <div className="inline-block bg-pink-500 text-white font-extrabold text-4xl md:text-5xl px-6 py-3 rounded-2xl shadow-lg mb-2 tracking-tight">
          TAAL JACHT
        </div>
        <p className="text-gray-600 text-lg font-semibold mt-2">
          Groep 5 · Blok 7 ·{" "}
          <span className="text-pink-500">Markeren &amp; Kleuren</span>
        </p>
      </div>

      {/* Naam-invoer */}
      {!opgeslagen ? (
        <div className="bg-white rounded-2xl shadow-md p-8 w-full max-w-md mb-10">
          <h2 className="text-xl font-bold text-gray-800 mb-4">👋 Hoe heet jij?</h2>
          <input
            type="text"
            placeholder="Schrijf hier je naam..."
            value={naam}
            onChange={(e) => setNaam(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && slaOpEnGaVerder()}
            className="w-full border-2 border-blue-300 rounded-xl px-4 py-3 text-lg focus:outline-none focus:border-blue-500 mb-4"
          />
          <button
            onClick={slaOpEnGaVerder}
            disabled={!naam.trim()}
            className="w-full bg-pink-500 hover:bg-pink-600 disabled:bg-gray-300 text-white font-bold py-3 rounded-xl text-lg transition-colors"
          >
            Start! →
          </button>
        </div>
      ) : (
        <div className="bg-green-100 border-2 border-green-400 rounded-2xl px-6 py-4 mb-6 text-green-800 font-semibold text-lg flex items-center gap-3">
          ✅ Hoi <span className="font-extrabold">{naam}</span>! Kies een opdracht:
          <button
            onClick={() => { sessionStorage.removeItem("leerling_naam"); setOpgeslagen(false); setNaam(""); }}
            className="ml-auto text-green-600 text-xs underline hover:text-green-800"
          >
            Wisselen
          </button>
        </div>
      )}

      {/* Opdrachten grid */}
      {ladenOpdrachten ? (
        <div className="flex items-center gap-3 text-gray-400">
          <div className="animate-spin w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full" />
          Opdrachten laden...
        </div>
      ) : opdrachten.length === 0 ? (
        <div className="bg-white rounded-2xl shadow p-8 text-center max-w-md">
          <p className="text-4xl mb-3">📭</p>
          <p className="text-gray-600 font-semibold">Nog geen opdrachten beschikbaar.</p>
          <p className="text-gray-400 text-sm mt-2">
            De juf of meester moet eerst een PDF uploaden.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 w-full max-w-2xl">
          {opdrachten.map((op, i) => {
            const kleuren = op.extra?.kleuren ?? [];
            const isKleur = op.type === "kleur";
            const href = opgeslagen ? `/opdracht/${op.id}` : "#";

            return (
              <Link
                key={op.id}
                href={href}
                onClick={(e) => !opgeslagen && e.preventDefault()}
                className={`group rounded-2xl shadow-md p-6 flex flex-col gap-3 transition-all border-2 ${
                  opgeslagen
                    ? "bg-white border-gray-200 hover:border-pink-400 hover:shadow-lg cursor-pointer"
                    : "bg-gray-100 border-gray-200 cursor-not-allowed opacity-60"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-xl text-gray-800">{op.les}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                      isKleur
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-orange-100 text-orange-800"
                    }`}
                  >
                    {isKleur ? "🎨 Kleuren" : "📌 Markeren"}
                  </span>
                  <span className="ml-auto bg-pink-100 text-pink-700 text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
                    {i + 1}
                  </span>
                </div>

                <p className="text-gray-600 text-sm leading-snug line-clamp-3">
                  {op.instructie}
                </p>

                {kleuren.length > 0 && (
                  <div className="flex gap-1.5 mt-auto">
                    {kleuren.map((k: string) => (
                      <span
                        key={k}
                        className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                          k === "geel"  ? "bg-yellow-200 text-yellow-900" :
                          k === "blauw" ? "bg-blue-200 text-blue-900"     :
                          k === "groen" ? "bg-green-200 text-green-900"   :
                          "bg-gray-200 text-gray-700"
                        }`}
                      >
                        {k}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {!opgeslagen && opdrachten.length > 0 && (
        <p className="mt-6 text-gray-400 text-sm">
          Vul eerst je naam in om een opdracht te starten.
        </p>
      )}

      {/* Link naar beheer */}
      <div className="mt-12 text-center">
        <Link
          href="/beheer"
          className="text-gray-400 hover:text-gray-600 text-xs underline"
        >
          🎓 Beheer (juf/meester)
        </Link>
      </div>

      <p className="mt-4 text-gray-400 text-xs">
        Taal Jacht · Groep 5 · Blok 7 – Wie schrijft die blijft
      </p>
    </main>
  );
}
