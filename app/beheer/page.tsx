"use client";

import { useState, useEffect, useRef } from "react";
import { supabase, type Opdracht } from "@/lib/supabase";

type UploadStatus =
  | "idle"
  | "reading"
  | "extracting"
  | "sending"
  | "done"
  | "error";

const STATUS_TEKST: Record<UploadStatus, string> = {
  idle:       "PDF verwerken",
  reading:    "📖 PDF lezen in de browser...",
  extracting: "🤖 Groq AI zoekt markeer/kleur-opdrachten...",
  sending:    "💾 Opslaan in Supabase...",
  done:       "✅ Klaar!",
  error:      "❌ Fout opgetreden",
};

export default function BeheerPage() {
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [foutmelding, setFoutmelding] = useState("");
  const [voortgang, setVoortgang] = useState("");
  const [resultaat, setResultaat] = useState<{
    gevonden: number;
    opgeslagen: number;
    opdrachten: Opdracht[];
  } | null>(null);
  const [bestaandeOpdrachten, setBestaandeOpdrachten] = useState<Opdracht[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [bestand, setBestand] = useState<File | null>(null);

  useEffect(() => {
    laadOpdrachten();
  }, []);

  async function laadOpdrachten() {
    const { data } = await supabase
      .from("opdrachten")
      .select("*")
      .order("aangemaakt_op", { ascending: false });
    if (data) setBestaandeOpdrachten(data as Opdracht[]);
  }

  async function verwijderOpdracht(id: string) {
    if (!confirm("Weet je zeker dat je deze opdracht wilt verwijderen?")) return;
    await supabase.from("opdrachten").delete().eq("id", id);
    setBestaandeOpdrachten((prev) => prev.filter((o) => o.id !== id));
  }

  // ── PDF tekst extraheren in de browser ──────────────────────────────────────
  async function extractPdfTekst(file: File): Promise<string> {
    // Dynamische import zodat pdfjs alleen in de browser laadt
    const pdfjs = await import("pdfjs-dist");
    // Worker via CDN (bespaart bundel-grootte)
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

    const buffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;

    let volledigeTekst = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      setVoortgang(`Pagina ${i} van ${pdf.numPages} lezen...`);
      const pagina = await pdf.getPage(i);
      const content = await pagina.getTextContent();
      const paginaTekst = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      volledigeTekst += `\n\n=== Pagina ${i} ===\n${paginaTekst}`;
    }
    return volledigeTekst;
  }

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!bestand) return;

    setFoutmelding("");
    setResultaat(null);

    try {
      // Stap 1: PDF in browser lezen
      setStatus("reading");
      const tekst = await extractPdfTekst(bestand);
      setVoortgang(`${tekst.length.toLocaleString("nl-NL")} tekens gelezen`);

      // Stap 2: Alleen de tekst naar de server sturen
      setStatus("extracting");
      const res = await fetch("/api/verwerk-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tekst,
          bestandsnaam: bestand.name,
        }),
      });

      if (!res.ok) {
        const msg = await res.text();
        let parsed;
        try { parsed = JSON.parse(msg); } catch { parsed = { error: msg.substring(0, 200) }; }
        throw new Error(parsed.error ?? "Onbekende fout.");
      }

      const json = await res.json();
      setStatus("done");
      setResultaat(json);
      setVoortgang("");
      await laadOpdrachten();
      setBestand(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setStatus("error");
      setFoutmelding(err instanceof Error ? err.message : String(err));
      setVoortgang("");
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <a href="/" className="text-gray-400 hover:text-gray-600 text-sm">← Terug</a>
          <div>
            <h1 className="text-3xl font-extrabold text-gray-800">🎓 Beheer – Juf / Meester</h1>
            <p className="text-gray-500 text-sm mt-1">
              Upload de PDF. De tekst wordt in je browser gelezen, daarna haalt Groq AI de
              markeer/kleur-opdrachten eruit.
            </p>
          </div>
        </div>

        {/* Upload sectie */}
        <div className="bg-white rounded-2xl shadow p-6 mb-8">
          <h2 className="text-xl font-bold text-gray-800 mb-4">📄 PDF uploaden</h2>
          <form onSubmit={handleUpload} className="space-y-4">
            <div
              className="border-2 border-dashed border-blue-300 rounded-xl p-8 text-center cursor-pointer hover:bg-blue-50 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => { setBestand(e.target.files?.[0] ?? null); setStatus("idle"); }}
              />
              <div className="text-4xl mb-2">📑</div>
              <p className="text-gray-600 font-semibold">Klik om een PDF te kiezen</p>
              <p className="text-gray-400 text-sm mt-1">
                {bestand ? `${bestand.name} (${(bestand.size / 1024 / 1024).toFixed(1)} MB)` : "Nog geen bestand gekozen"}
              </p>
            </div>

            <button
              type="submit"
              disabled={!bestand || status === "reading" || status === "extracting" || status === "sending"}
              className={`w-full py-3 rounded-xl font-bold text-white text-lg transition-all
                ${!bestand
                  ? "bg-gray-300 cursor-not-allowed"
                  : status === "reading" || status === "extracting" || status === "sending"
                  ? "bg-blue-300 cursor-not-allowed"
                  : status === "done"
                  ? "bg-green-500 hover:bg-green-600"
                  : status === "error"
                  ? "bg-red-500 hover:bg-red-600"
                  : "bg-blue-500 hover:bg-blue-600"
                }`}
            >
              {STATUS_TEKST[status]}
            </button>
          </form>

          {(status === "reading" || status === "extracting" || status === "sending") && (
            <div className="mt-4 flex items-center gap-3 text-blue-600">
              <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
              <div className="flex-1">
                <p className="text-sm font-medium">{STATUS_TEKST[status]}</p>
                {voortgang && <p className="text-xs text-gray-500">{voortgang}</p>}
              </div>
            </div>
          )}

          {foutmelding && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
              <strong>Fout:</strong> {foutmelding}
            </div>
          )}

          {resultaat && status === "done" && (
            <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4">
              <p className="text-green-800 font-semibold">
                ✅ {resultaat.gevonden} opdracht{resultaat.gevonden !== 1 ? "en" : ""} gevonden, {resultaat.opgeslagen} opgeslagen!
              </p>
              <ul className="mt-2 space-y-1">
                {resultaat.opdrachten.map((op) => (
                  <li key={op.id} className="text-green-700 text-sm">
                    • {op.les} – {op.type === "kleur" ? "🎨 Kleuren" : "📌 Markeren"}: {op.zinnen.length} zinnen
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Bestaande opdrachten */}
        <div className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-xl font-bold text-gray-800 mb-4">
            📋 Opgeslagen opdrachten ({bestaandeOpdrachten.length})
          </h2>

          {bestaandeOpdrachten.length === 0 ? (
            <p className="text-gray-400 text-sm">Nog geen opdrachten. Upload een PDF om te beginnen.</p>
          ) : (
            <div className="space-y-3">
              {bestaandeOpdrachten.map((op) => (
                <div
                  key={op.id}
                  className="border border-gray-200 rounded-xl p-4 flex items-start justify-between gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-bold text-gray-800">{op.les}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                          op.type === "kleur"
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-orange-100 text-orange-800"
                        }`}
                      >
                        {op.type === "kleur" ? "🎨 Kleuren" : "📌 Markeren"}
                      </span>
                      {op.extra?.kleuren && op.extra.kleuren.length > 0 && (
                        <div className="flex gap-1">
                          {op.extra.kleuren.map((k: string) => (
                            <span
                              key={k}
                              className={`w-3 h-3 rounded-full inline-block ${
                                k === "geel"  ? "bg-yellow-400" :
                                k === "blauw" ? "bg-blue-400"   :
                                k === "groen" ? "bg-green-400"  : "bg-gray-400"
                              }`}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="text-gray-600 text-sm line-clamp-2">{op.instructie}</p>
                    <p className="text-gray-400 text-xs mt-1">
                      {op.zinnen.length} zinnen · {op.pdf_naam} ·{" "}
                      {new Date(op.aangemaakt_op).toLocaleDateString("nl-NL")}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <a
                      href={`/opdracht/${op.id}`}
                      className="bg-pink-500 hover:bg-pink-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Bekijk →
                    </a>
                    <button
                      onClick={() => verwijderOpdracht(op.id)}
                      className="bg-gray-100 hover:bg-red-100 text-gray-500 hover:text-red-600 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
