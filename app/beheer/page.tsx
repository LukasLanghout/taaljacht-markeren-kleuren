"use client";

import { useState, useEffect, useRef } from "react";
import { supabase, type Opdracht } from "@/lib/supabase";

type UploadStatus =
  | "idle"
  | "rendering"
  | "ocr"
  | "extracting"
  | "sending"
  | "done"
  | "error";

const STATUS_TEKST: Record<UploadStatus, string> = {
  idle:       "PDF verwerken",
  rendering:  "🖼️ PDF-pagina's renderen...",
  ocr:        "🔍 Tesseract leest de tekst...",
  extracting: "🤖 AI zoekt markeer/kleur-opdrachten...",
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

  const [genereerStatus, setGenereerStatus] = useState<
    "idle" | "bezig" | "klaar" | "error"
  >("idle");
  const [genereerVoortgang, setGenereerVoortgang] = useState("");
  const [genereerBezigId, setGenereerBezigId] = useState<string | null>(null);

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

  // ── Antwoorden automatisch genereren ─────────────────────────────────
  async function genereerAntwoordenVoorOpdracht(id: string): Promise<{
    success: boolean;
    aantal_antwoorden?: number;
    error?: string;
  }> {
    const MAX_POGINGEN = 4;
    for (let poging = 1; poging <= MAX_POGINGEN; poging++) {
      const res = await fetch("/api/genereer-antwoorden", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) return await res.json();

      if ((res.status === 429 || res.status === 503) && poging < MAX_POGINGEN) {
        const wachtSec = 30 * poging;
        for (let s = wachtSec; s > 0; s--) {
          setGenereerVoortgang(
            res.status === 503
              ? `Model laadt nog — wacht ${s}s...`
              : `Rate-limit — wacht nog ${s}s...`
          );
          await new Promise((r) => setTimeout(r, 1000));
        }
        continue;
      }

      const tekst = await res.text();
      let parsed: { error?: string };
      try { parsed = JSON.parse(tekst); } catch { parsed = { error: tekst.substring(0, 200) }; }
      return { success: false, error: parsed.error ?? `HTTP ${res.status}` };
    }
    return { success: false, error: "Blijvend mislukt na alle pogingen." };
  }

  async function genereerVoorEen(id: string) {
    setGenereerBezigId(id);
    const res = await genereerAntwoordenVoorOpdracht(id);
    if (!res.success) {
      alert("Fout bij genereren: " + (res.error ?? "onbekend"));
    }
    setGenereerBezigId(null);
    await laadOpdrachten();
  }

  async function genereerVoorAlle() {
    if (bestaandeOpdrachten.length === 0) return;
    const teVerwerken = bestaandeOpdrachten.filter(
      (o) =>
        Array.isArray(o.zinnen) &&
        o.zinnen.length > 0 &&
        (!o.extra?.antwoorden || Object.keys(o.extra.antwoorden).length === 0)
    );
    if (teVerwerken.length === 0) {
      alert("Alle opdrachten met zinnen hebben al antwoorden.");
      return;
    }
    if (
      !confirm(
        `Antwoorden genereren voor ${teVerwerken.length} opdracht${
          teVerwerken.length !== 1 ? "en" : ""
        }? Dit kan enkele minuten duren.`
      )
    )
      return;

    setGenereerStatus("bezig");
    let geslaagd = 0;
    let mislukt = 0;
    const fouten: string[] = [];

    for (let i = 0; i < teVerwerken.length; i++) {
      const op = teVerwerken[i];
      setGenereerBezigId(op.id);
      setGenereerVoortgang(
        `${i + 1} van ${teVerwerken.length}: ${op.les} — ${op.instructie.substring(0, 60)}...`
      );
      const res = await genereerAntwoordenVoorOpdracht(op.id);
      if (res.success) geslaagd++;
      else {
        mislukt++;
        fouten.push(`${op.les}: ${res.error}`);
      }

      // 6s pauze tussen opdrachten
      if (i < teVerwerken.length - 1) {
        for (let s = 6; s > 0; s--) {
          setGenereerVoortgang(
            `${i + 1}/${teVerwerken.length} klaar (${geslaagd} ✓, ${mislukt} ✗) — wacht ${s}s...`
          );
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    setGenereerBezigId(null);
    setGenereerStatus(mislukt === 0 ? "klaar" : "error");
    setGenereerVoortgang(
      `Klaar: ${geslaagd} geslaagd, ${mislukt} mislukt${
        fouten.length > 0 ? "\n\nFouten:\n- " + fouten.slice(0, 5).join("\n- ") : ""
      }`
    );
    await laadOpdrachten();
  }

  async function verwijderAlleOpdrachten() {
    if (bestaandeOpdrachten.length === 0) return;
    const aantal = bestaandeOpdrachten.length;
    if (!confirm(`Weet je zeker dat je ALLE ${aantal} opdrachten wilt verwijderen?`)) return;
    if (!confirm(`Echt zeker? Alle ${aantal} opdrachten worden permanent verwijderd.`)) return;
    const { error } = await supabase
      .from("opdrachten")
      .delete()
      .not("id", "is", null);
    if (error) {
      alert("Fout bij verwijderen: " + error.message);
      return;
    }
    setBestaandeOpdrachten([]);
  }

  // ── PDF pagina renderen naar JPEG (base64 data URL) ──────────────────
  async function renderPaginaAlsImage(
    pagina: import("pdfjs-dist").PDFPageProxy
  ): Promise<string> {
    const viewport = pagina.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D-context niet beschikbaar");
    await pagina.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL("image/jpeg", 0.85);
  }

  // ── OCR van alle PDF-pagina's via Tesseract.js (client-side) ─────────
  async function extractPdfTekst(file: File): Promise<string> {
    // PDF laden
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

    const buffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;

    // Tesseract worker aanmaken (eenmalig, hergebruik voor alle pagina's)
    setStatus("ocr");
    setVoortgang("Tesseract initialiseren (taaldata downloaden ~4MB, eenmalig)...");
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("nld", 1, {
      logger: (m: { status: string; progress: number }) => {
        if (m.status === "loading tesseract core") {
          setVoortgang("Tesseract laden...");
        } else if (m.status === "loading language traineddata") {
          setVoortgang(`Taaldata downloaden: ${Math.round(m.progress * 100)}%`);
        } else if (m.status === "initializing api") {
          setVoortgang("Tesseract gereed!");
        }
      },
    });

    let volledigeTekst = "";

    try {
      for (let i = 1; i <= pdf.numPages; i++) {
        // Pagina renderen
        setStatus("rendering");
        setVoortgang(`Pagina ${i} van ${pdf.numPages} renderen...`);
        const pagina = await pdf.getPage(i);
        const image = await renderPaginaAlsImage(pagina);

        // OCR via Tesseract
        setStatus("ocr");
        setVoortgang(`Pagina ${i} van ${pdf.numPages} lezen via Tesseract...`);
        const { data } = await worker.recognize(image);
        volledigeTekst += `\n\n=== Pagina ${i} ===\n${data.text}`;
      }
    } finally {
      await worker.terminate();
    }

    return volledigeTekst;
  }

  // ── Splits OCR-tekst op pagina-grenzen in chunks van max ~10k tekens ──
  function chunkOcrTekst(tekst: string, maxLen = 10000): string[] {
    const stukken = tekst.split(/(?=\n*=== Pagina \d+ ===)/);
    const chunks: string[] = [];
    let huidig = "";
    for (const stuk of stukken) {
      if ((huidig + stuk).length > maxLen && huidig.length > 0) {
        chunks.push(huidig);
        huidig = stuk;
      } else {
        huidig += stuk;
      }
    }
    if (huidig.trim().length > 0) chunks.push(huidig);
    return chunks.length === 0 ? [tekst] : chunks;
  }

  // ── Eén chunk extraheren via /api/verwerk-pdf ─────────────────────────
  async function verwerkChunk(
    chunkTekst: string,
    bestandsnaam: string,
    deelInfo: string
  ): Promise<{ gevonden: number; opgeslagen: number; opdrachten: Opdracht[] }> {
    const MAX_POGINGEN = 4;
    for (let poging = 1; poging <= MAX_POGINGEN; poging++) {
      const res = await fetch("/api/verwerk-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tekst: chunkTekst, bestandsnaam, deelInfo }),
      });

      if (res.ok) return await res.json();

      if ((res.status === 429 || res.status === 503) && poging < MAX_POGINGEN) {
        const wachtSec = res.status === 503 ? 25 : 30 * poging;
        for (let s = wachtSec; s > 0; s--) {
          setVoortgang(
            res.status === 503
              ? `${deelInfo}: AI-model laadt — wacht ${s}s...`
              : `${deelInfo}: rate-limit — wacht ${s}s (poging ${poging}/${MAX_POGINGEN - 1})...`
          );
          await new Promise((r) => setTimeout(r, 1000));
        }
        continue;
      }

      const msg = await res.text();
      let parsed: { error?: string };
      try { parsed = JSON.parse(msg); } catch { parsed = { error: msg.substring(0, 200) }; }
      throw new Error(`${deelInfo} mislukt: ${parsed.error ?? "Onbekende fout."}`);
    }
    throw new Error(`${deelInfo} blijvend gefaald.`);
  }

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!bestand) return;

    setFoutmelding("");
    setResultaat(null);

    try {
      // Stap 1: PDF pagina voor pagina via Tesseract OCR (client-side)
      const tekst = await extractPdfTekst(bestand);
      setVoortgang(`${tekst.length.toLocaleString("nl-NL")} tekens gelezen`);

      // Stap 2: tekst in chunks splitsen en naar server sturen
      setStatus("extracting");
      const chunks = chunkOcrTekst(tekst, 10000);
      const alleOpdrachten: Opdracht[] = [];
      let totaalGevonden = 0;
      let totaalOpgeslagen = 0;

      for (let i = 0; i < chunks.length; i++) {
        const deelInfo = `Deel ${i + 1} van ${chunks.length}`;
        setVoortgang(`${deelInfo}: opdrachten extraheren...`);
        const result = await verwerkChunk(chunks[i], bestand.name, deelInfo);
        totaalGevonden += result.gevonden ?? 0;
        totaalOpgeslagen += result.opgeslagen ?? 0;
        alleOpdrachten.push(...(result.opdrachten ?? []));

        // 6s pauze tussen chunks
        if (i < chunks.length - 1) {
          for (let s = 6; s > 0; s--) {
            setVoortgang(`${deelInfo} klaar (${result.gevonden} gevonden) — wacht ${s}s...`);
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }

      setStatus("done");
      setResultaat({
        gevonden: totaalGevonden,
        opgeslagen: totaalOpgeslagen,
        opdrachten: alleOpdrachten,
      });
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

  const bezig =
    status === "rendering" || status === "ocr" || status === "extracting" || status === "sending";

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <a href="/" className="text-gray-400 hover:text-gray-600 text-sm">← Terug</a>
          <div>
            <h1 className="text-3xl font-extrabold text-gray-800">🎓 Beheer – Juf / Meester</h1>
            <p className="text-gray-500 text-sm mt-1">
              Upload de PDF. Tesseract leest de tekst in je browser, daarna haalt de AI de
              markeer/kleur-opdrachten eruit. Geen API-kosten voor OCR!
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
                onChange={(e) => {
                  setBestand(e.target.files?.[0] ?? null);
                  setStatus("idle");
                }}
              />
              <div className="text-4xl mb-2">📑</div>
              <p className="text-gray-600 font-semibold">Klik om een PDF te kiezen</p>
              <p className="text-gray-400 text-sm mt-1">
                {bestand
                  ? `${bestand.name} (${(bestand.size / 1024 / 1024).toFixed(1)} MB)`
                  : "Nog geen bestand gekozen"}
              </p>
            </div>

            <button
              type="submit"
              disabled={!bestand || bezig}
              className={`w-full py-3 rounded-xl font-bold text-white text-lg transition-all
                ${!bestand
                  ? "bg-gray-300 cursor-not-allowed"
                  : bezig
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

          {bezig && (
            <div className="mt-4 flex items-center gap-3 text-blue-600">
              <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full" />
              <div className="flex-1">
                <p className="text-sm font-medium">{STATUS_TEKST[status]}</p>
                {voortgang && <p className="text-xs text-gray-500">{voortgang}</p>}
              </div>
            </div>
          )}

          {/* Info-blok over OCR */}
          {status === "idle" && bestand && (
            <div className="mt-3 bg-blue-50 border border-blue-200 rounded-xl p-3 text-blue-700 text-xs">
              <strong>📝 Let op:</strong> OCR via Tesseract draait in je browser. Bij de eerste keer
              wordt ~4MB taaldata gedownload. Per pagina duurt het ~5-15s. Bij een grote PDF kan dit
              enkele minuten duren.
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
                ✅ {resultaat.gevonden} opdracht{resultaat.gevonden !== 1 ? "en" : ""} gevonden,{" "}
                {resultaat.opgeslagen} opgeslagen!
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
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h2 className="text-xl font-bold text-gray-800">
              📋 Opgeslagen opdrachten ({bestaandeOpdrachten.length})
            </h2>
            {bestaandeOpdrachten.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={genereerVoorAlle}
                  disabled={genereerStatus === "bezig"}
                  className={`text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors
                    ${genereerStatus === "bezig"
                      ? "bg-blue-300 cursor-not-allowed"
                      : "bg-blue-500 hover:bg-blue-600"
                    }`}
                >
                  {genereerStatus === "bezig" ? "🤖 Bezig..." : "🤖 Antwoorden genereren"}
                </button>
                <button
                  onClick={verwijderAlleOpdrachten}
                  className="bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
                >
                  🗑 Alles verwijderen
                </button>
              </div>
            )}
          </div>

          {/* Voortgang bulk-genereren */}
          {genereerStatus !== "idle" && (
            <div
              className={`mb-4 rounded-xl px-4 py-3 text-sm whitespace-pre-line
              ${
                genereerStatus === "bezig"
                  ? "bg-blue-50 border border-blue-200 text-blue-800"
                  : genereerStatus === "klaar"
                  ? "bg-green-50 border border-green-200 text-green-800"
                  : "bg-amber-50 border border-amber-200 text-amber-800"
              }`}
            >
              {genereerStatus === "bezig" && (
                <span className="inline-block animate-spin mr-2">⏳</span>
              )}
              <strong>
                {genereerStatus === "bezig"
                  ? "Antwoorden genereren..."
                  : genereerStatus === "klaar"
                  ? "✅ Antwoorden klaar"
                  : "⚠️ Met fouten klaar"}
              </strong>
              {genereerVoortgang && <div className="mt-1 text-xs">{genereerVoortgang}</div>}
              {(genereerStatus === "klaar" || genereerStatus === "error") && (
                <button
                  onClick={() => setGenereerStatus("idle")}
                  className="mt-2 text-xs underline opacity-70 hover:opacity-100"
                >
                  sluiten
                </button>
              )}
            </div>
          )}

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
                                k === "geel"
                                  ? "bg-yellow-400"
                                  : k === "blauw"
                                  ? "bg-blue-400"
                                  : k === "groen"
                                  ? "bg-green-400"
                                  : "bg-gray-400"
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
                  <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                    {op.extra?.antwoorden && Object.keys(op.extra.antwoorden).length > 0 ? (
                      <span
                        className="bg-green-100 text-green-700 text-xs font-bold px-2 py-1.5 rounded-lg"
                        title="Antwoorden ingevuld"
                      >
                        ✓ Antwoord
                      </span>
                    ) : (
                      <span
                        className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-1.5 rounded-lg"
                        title="Geen antwoorden ingevuld"
                      >
                        ⚠ Geen antwoord
                      </span>
                    )}
                    <button
                      onClick={() => genereerVoorEen(op.id)}
                      disabled={
                        genereerBezigId !== null ||
                        !Array.isArray(op.zinnen) ||
                        op.zinnen.length === 0
                      }
                      className={`text-white text-xs font-bold px-2.5 py-1.5 rounded-lg transition-colors
                        ${
                          genereerBezigId === op.id
                            ? "bg-blue-300 cursor-wait"
                            : genereerBezigId !== null
                            ? "bg-blue-300 cursor-not-allowed opacity-50"
                            : "bg-blue-400 hover:bg-blue-500"
                        }`}
                      title="AI antwoorden bedenken"
                    >
                      {genereerBezigId === op.id ? "⏳" : "🤖"}
                    </button>
                    <a
                      href={`/opdracht/${op.id}?modus=antwoord`}
                      className="bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
                      title="Antwoorden zelf invullen"
                    >
                      ✏️
                    </a>
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
