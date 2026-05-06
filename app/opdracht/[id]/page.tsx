"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import {
  supabase,
  type Opdracht,
  type Zin,
  type Antwoorden,
} from "@/lib/supabase";

// ── Kleur-configuratie ────────────────────────────────────────────────────────
const KLEUR_CONFIG: Record<
  string,
  { bg: string; border: string; text: string; label: string }
> = {
  geel:    { bg: "bg-yellow-200", border: "border-yellow-400", text: "text-yellow-900", label: "Geel"   },
  blauw:   { bg: "bg-blue-200",   border: "border-blue-400",   text: "text-blue-900",   label: "Blauw"  },
  groen:   { bg: "bg-green-200",  border: "border-green-400",  text: "text-green-900",  label: "Groen"  },
  rood:    { bg: "bg-red-200",    border: "border-red-400",    text: "text-red-900",    label: "Rood"   },
  paars:   { bg: "bg-purple-200", border: "border-purple-400", text: "text-purple-900", label: "Paars"  },
  oranje:  { bg: "bg-orange-200", border: "border-orange-400", text: "text-orange-900", label: "Oranje" },
  markeer: { bg: "bg-yellow-200", border: "border-yellow-400", text: "text-yellow-900", label: "📌 Markeer" },
};

const KLEUR_LABEL_LES5: Record<string, string> = {
  geel:  "Geel – Start",
  blauw: "Blauw – Midden",
  groen: "Groen – Slot",
};

function zinKlasse(kleur: string | undefined): string {
  if (!kleur) return "bg-white border-gray-200 hover:bg-gray-50";
  const cfg = KLEUR_CONFIG[kleur];
  return cfg ? `${cfg.bg} ${cfg.border}` : "bg-white border-gray-200";
}

/** Groepeer zinnen op context-veld (voor kleur_woord_rij/_plaatje/_zin). */
function groepeerZinnen(zinnen: Zin[]): { context: string; zinnen: Zin[] }[] {
  const heeftContext = zinnen.some((z) => z.context && z.context.length > 0);
  if (!heeftContext) return [{ context: "", zinnen }];
  const map = new Map<string, Zin[]>();
  for (const z of zinnen) {
    const ctx = z.context ?? "";
    if (!map.has(ctx)) map.set(ctx, []);
    map.get(ctx)!.push(z);
  }
  return Array.from(map.entries()).map(([context, zinnen]) => ({ context, zinnen }));
}

export default function OpdrachtPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params?.id as string;
  const isJufModus = searchParams?.get("modus") === "antwoord";

  const [naam, setNaam] = useState("");
  const [opdracht, setOpdracht] = useState<Opdracht | null>(null);
  const [loading, setLoading] = useState(true);
  const [actieveKleur, setActieveKleur] = useState<string>("geel");
  const [gekleurd, setGekleurd] = useState<Antwoorden>({});
  const [welkeNiet, setWelkeNiet] = useState<string>("");
  const [savStatus, setSavStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [foutmelding, setFoutmelding] = useState("");
  const [nagekeken, setNagekeken] = useState(false);

  // Leerling-naam ophalen (alleen in leerling-modus)
  useEffect(() => {
    if (isJufModus) return;
    const n = sessionStorage.getItem("leerling_naam");
    if (!n) router.replace("/");
    else setNaam(n);
  }, [router, isJufModus]);

  // Opdracht ophalen
  useEffect(() => {
    if (!id) return;
    supabase
      .from("opdrachten")
      .select("*")
      .eq("id", id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) { setLoading(false); return; }
        const op = data as Opdracht;
        setOpdracht(op);
        const beschikbaar = op.extra?.kleuren ?? [];
        if (op.type === "markeer") setActieveKleur("markeer");
        else if (beschikbaar.length > 0) setActieveKleur(beschikbaar[0]);

        // In juf-modus: bestaande antwoorden vooraf tonen
        if (isJufModus && op.extra?.antwoorden) {
          setGekleurd(op.extra.antwoorden);
        }
        if (isJufModus && op.extra?.vraag_d_antwoord) {
          setWelkeNiet(op.extra.vraag_d_antwoord);
        }
        setLoading(false);
      });
  }, [id, isJufModus]);

  const klikOpZin = useCallback(
    (zinId: string) => {
      if (nagekeken) return;
      setGekleurd((prev) => {
        const huidig = prev[zinId];
        if (actieveKleur === "gum") {
          const next = { ...prev };
          delete next[zinId];
          return next;
        }
        // Markeer-modus: toggle true/uit
        if (actieveKleur === "markeer") {
          const next = { ...prev };
          if (huidig === true) delete next[zinId];
          else next[zinId] = true;
          return next;
        }
        // Kleur-modus: toggle of switch
        if (huidig === actieveKleur) {
          const next = { ...prev };
          delete next[zinId];
          return next;
        }
        return { ...prev, [zinId]: actieveKleur };
      });
    },
    [actieveKleur, nagekeken]
  );

  // ── Opslaan in juf-modus → antwoorden in opdracht.extra ───────────────
  async function slaAntwoordenOp() {
    if (!opdracht) return;
    setSavStatus("saving");
    setFoutmelding("");
    const nieuweExtra = {
      ...opdracht.extra,
      antwoorden: gekleurd,
      vraag_d_antwoord: welkeNiet || null,
    };
    const { error } = await supabase
      .from("opdrachten")
      .update({ extra: nieuweExtra })
      .eq("id", opdracht.id);
    if (error) {
      setFoutmelding(error.message);
      setSavStatus("error");
    } else {
      setOpdracht({ ...opdracht, extra: nieuweExtra });
      setSavStatus("saved");
    }
  }

  // ── Opslaan in leerling-modus → antwoorden-tabel ──────────────────────
  async function slaLeerlingAntwoordOp() {
    if (!opdracht) return;
    setSavStatus("saving");
    setFoutmelding("");
    // kleuren-record naar string-only voor de antwoorden-tabel
    const kleurenStr: Record<string, string> = {};
    for (const [k, v] of Object.entries(gekleurd)) {
      kleurenStr[k] = typeof v === "boolean" ? "markeer" : v;
    }
    const { error } = await supabase.from("antwoorden").insert({
      leerling_naam: naam,
      opdracht_id: opdracht.id,
      kleuren: kleurenStr,
      extra: welkeNiet ? { welke_kleur_niet: welkeNiet } : {},
    });
    if (error) {
      setFoutmelding(error.message);
      setSavStatus("error");
    } else {
      setSavStatus("saved");
    }
  }

  // ── Nakijken ────────────────────────────────────────────────────────
  const correctAntwoorden = opdracht?.extra?.antwoorden;
  const heeftCorrecteAntwoorden =
    !!correctAntwoorden && Object.keys(correctAntwoorden).length > 0;

  const score = useMemo(() => {
    if (!opdracht || !correctAntwoorden) return null;
    let goed = 0;
    let totaal = 0;
    // Voor markeer/kleur_woord_*: alleen zinnen die een correct antwoord hebben tellen mee
    // Voor kleur_zinnen: alle zinnen tellen mee
    const subtype = opdracht.extra?.subtype ?? "kleur_zinnen";
    if (subtype === "kleur_zinnen") {
      for (const zin of opdracht.zinnen) {
        totaal++;
        const correct = correctAntwoorden[zin.id];
        const gekozen = gekleurd[zin.id];
        if (correct === gekozen) goed++;
      }
    } else {
      // Voor andere subtypes: zinnen met correct=true zijn de juiste keuzes
      const correctIds = new Set(
        Object.entries(correctAntwoorden)
          .filter(([, v]) => v === true || (typeof v === "string" && v !== ""))
          .map(([k]) => k)
      );
      for (const zin of opdracht.zinnen) {
        const moestGekleurd = correctIds.has(zin.id);
        const isGekleurd = !!gekleurd[zin.id];
        if (moestGekleurd) totaal++;
        if (moestGekleurd && isGekleurd) goed++;
        // Foutief gekleurde zin = aftrek? Voor nu: 1 punt per goed-gemarkeerde,
        // maar foutieve markeringen worden visueel als ✗ getoond
      }
    }
    // Vraag d
    if (opdracht.extra?.vraag_d_antwoord) {
      totaal++;
      if (welkeNiet === opdracht.extra.vraag_d_antwoord) goed++;
    }
    return { goed, totaal };
  }, [opdracht, correctAntwoorden, gekleurd, welkeNiet]);

  function feedbackVoorZin(zinId: string): "goed" | "fout-mist" | "fout-extra" | "neutraal" {
    if (!nagekeken || !correctAntwoorden) return "neutraal";
    const subtype = opdracht?.extra?.subtype ?? "kleur_zinnen";
    const correct = correctAntwoorden[zinId];
    const gekozen = gekleurd[zinId];
    if (subtype === "kleur_zinnen") {
      if (correct && correct === gekozen) return "goed";
      if (correct && correct !== gekozen) return "fout-mist";
      return "neutraal";
    }
    // markeer / kleur_woord_*
    const moest = correct === true || (typeof correct === "string" && correct !== "");
    const heeft = !!gekozen;
    if (moest && heeft) return "goed";
    if (moest && !heeft) return "fout-mist";
    if (!moest && heeft) return "fout-extra";
    return "neutraal";
  }

  // ── Loading / not-found ────────────────────────────────────────────────
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
      : opdracht.extra?.kleuren && opdracht.extra.kleuren.length > 0
      ? opdracht.extra.kleuren
      : ["geel"]; // bv. kleur_woord_* zonder kleur-keuze → 1 highlight

  const isKleurOpdracht = opdracht.type === "kleur";
  const subtype = opdracht.extra?.subtype ?? (isKleurOpdracht ? "kleur_zinnen" : "markeer");
  const heeftVraagD =
    isKleurOpdracht && (
      (opdracht.extra?.vraag_d as string | boolean | null | undefined) ||
      beschikbareKleuren.length >= 3
    );
  const aantalGekleurd = Object.keys(gekleurd).length;
  const groepen = groepeerZinnen(opdracht.zinnen);

  const themaKleur = isJufModus
    ? { header: "bg-blue-500", accent: "text-blue-700", light: "bg-blue-50 border-blue-300" }
    : isKleurOpdracht
    ? { header: "bg-yellow-400", accent: "text-yellow-700", light: "bg-yellow-50 border-yellow-300" }
    : { header: "bg-purple-500", accent: "text-purple-700", light: "bg-purple-50 border-purple-300" };

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-50 to-white px-4 py-10">
      <div className="max-w-2xl mx-auto">
        {/* Terug */}
        <button
          onClick={() => router.push(isJufModus ? "/beheer" : "/")}
          className="text-gray-400 hover:text-gray-600 mb-6 flex items-center gap-1 text-sm"
        >
          ← Terug
        </button>

        {/* Header */}
        <div className={`${themaKleur.header} rounded-2xl px-6 py-4 mb-2 flex items-center gap-3 shadow flex-wrap`}>
          <span className="text-white font-extrabold text-2xl">{opdracht.les}</span>
          <span className="text-white/80 font-semibold text-lg">
            {isKleurOpdracht ? "🎨 Kleuren" : "📌 Markeren"}
          </span>
          {isJufModus && (
            <span className="ml-auto bg-white/30 text-white text-xs font-bold px-3 py-1 rounded-full">
              ✏️ Antwoorden invullen
            </span>
          )}
        </div>

        {/* Instructie */}
        <div className={`${themaKleur.light} border-l-4 rounded-xl px-5 py-4 mb-6`}>
          <p className="font-bold text-sm uppercase tracking-wide mb-1 text-gray-600">
            {isJufModus ? "Vul hier de juiste antwoorden in" : "Opdracht"}
          </p>
          <p className="text-gray-800 text-sm leading-relaxed">{opdracht.instructie}</p>
          {isJufModus && (
            <p className="text-xs text-blue-700 mt-2 italic">
              Klik op de zinnen zoals een leerling ze juist zou kleuren/markeren.
              Dit wordt gebruikt om hun antwoorden na te kijken.
            </p>
          )}
        </div>

        {/* Kleur-palet */}
        {isKleurOpdracht && !nagekeken && (
          <div className="flex gap-2 mb-6 flex-wrap">
            {beschikbareKleuren.map((k) => {
              const cfg = KLEUR_CONFIG[k];
              if (!cfg) return null;
              const label = subtype === "kleur_zinnen" && KLEUR_LABEL_LES5[k]
                ? KLEUR_LABEL_LES5[k]
                : cfg.label;
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
                  {label}
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

        {/* De zinnen — eventueel gegroepeerd op context */}
        <div className="bg-white rounded-2xl shadow-md p-6 mb-6 border border-gray-100">
          {!nagekeken && (
            <p className="text-xs text-gray-400 italic text-center mb-4">
              Klik op een zin om hem te {isKleurOpdracht ? "kleuren" : "markeren"} ·
              nogmaals klikken = verwijderen
            </p>
          )}

          <div className="space-y-5">
            {groepen.map((groep, gi) => (
              <div key={gi}>
                {groep.context && (
                  <p className="text-sm font-bold text-gray-500 mb-2 uppercase tracking-wide">
                    {groep.context}
                  </p>
                )}
                <div className="space-y-2">
                  {groep.zinnen.map((zin) => {
                    const huidig = gekleurd[zin.id];
                    const huidigStr = typeof huidig === "string" ? huidig : huidig === true ? "markeer" : undefined;
                    const fb = feedbackVoorZin(zin.id);
                    const correct = correctAntwoorden?.[zin.id];
                    const correctStr = typeof correct === "string" ? correct : correct === true ? "markeer" : undefined;

                    return (
                      <div key={zin.id} className="relative">
                        <button
                          disabled={nagekeken}
                          onClick={() => klikOpZin(zin.id)}
                          className={`w-full text-left px-4 py-2.5 rounded-xl border-2 transition-all duration-100
                            text-gray-800 font-serif leading-relaxed
                            focus:outline-none focus:ring-2 focus:ring-pink-400
                            ${nagekeken ? "cursor-default" : ""}
                            ${zinKlasse(huidigStr)}
                            ${fb === "fout-extra" ? "ring-2 ring-red-400" : ""}
                            ${fb === "fout-mist" ? "ring-2 ring-amber-400" : ""}
                          `}
                        >
                          {!isKleurOpdracht && huidig === true && !nagekeken && (
                            <span className="mr-1 text-yellow-600 text-xs">📌</span>
                          )}
                          {zin.tekst}
                          {nagekeken && fb === "goed" && (
                            <span className="ml-2 text-green-600 font-bold">✓</span>
                          )}
                          {nagekeken && fb === "fout-extra" && (
                            <span className="ml-2 text-red-600 font-bold">✗ niet kleuren</span>
                          )}
                          {nagekeken && fb === "fout-mist" && (
                            <span className="ml-2 text-amber-600 font-bold">
                              ✗ moest {correctStr ?? "gekleurd"}
                            </span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {!nagekeken && (
            <p className="mt-3 text-xs text-gray-400 text-right">
              {aantalGekleurd} van {opdracht.zinnen.length} zinnen{" "}
              {isKleurOpdracht ? "gekleurd" : "gemarkeerd"}
            </p>
          )}
        </div>

        {/* Vraag d */}
        {heeftVraagD && (
          <div className="bg-white rounded-2xl shadow p-6 mb-6">
            <p className="font-bold text-gray-800 mb-3">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-pink-500 text-white text-sm font-extrabold mr-2">
                d
              </span>
              Welke kleur heb je <strong>niet</strong> gebruikt?
            </p>
            <div className="flex gap-4 flex-wrap">
              {beschikbareKleuren.map((k) => {
                const cfg = KLEUR_CONFIG[k];
                if (!cfg) return null;
                const isCorrect = nagekeken && opdracht.extra?.vraag_d_antwoord === k;
                const isFout =
                  nagekeken && welkeNiet === k && opdracht.extra?.vraag_d_antwoord !== k;
                return (
                  <label key={k} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="welkeNiet"
                      value={k}
                      checked={welkeNiet === k}
                      onChange={() => !nagekeken && setWelkeNiet(k)}
                      disabled={nagekeken}
                      className="w-4 h-4 accent-pink-500"
                    />
                    <span
                      className={`px-3 py-1 rounded-full text-sm font-bold ${cfg.bg} ${cfg.text}
                        ${isCorrect ? "ring-2 ring-green-500" : ""}
                        ${isFout ? "ring-2 ring-red-500" : ""}`}
                    >
                      {cfg.label.split(" – ")[0]}
                      {isCorrect && " ✓"}
                      {isFout && " ✗"}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Score na nakijken */}
        {nagekeken && score && (
          <div className="bg-gradient-to-r from-pink-50 to-yellow-50 border-2 border-pink-300 rounded-2xl p-6 mb-6 text-center">
            <p className="text-3xl font-extrabold text-pink-600 mb-1">
              {score.goed} / {score.totaal} goed!
            </p>
            <p className="text-sm text-gray-600">
              {score.goed === score.totaal
                ? "🎉 Perfect! Helemaal goed!"
                : score.goed >= score.totaal * 0.7
                ? "💪 Goed bezig — kijk waar je nog kunt verbeteren."
                : "👀 Bekijk de tips hieronder en probeer het nog eens."}
            </p>
          </div>
        )}

        {/* Knoppen */}
        {isJufModus ? (
          <button
            onClick={slaAntwoordenOp}
            disabled={savStatus === "saving" || aantalGekleurd === 0}
            className={`w-full py-4 rounded-2xl font-extrabold text-lg transition-all shadow
              ${savStatus === "saved"
                ? "bg-green-500 text-white"
                : savStatus === "error"
                ? "bg-red-500 text-white"
                : aantalGekleurd === 0
                ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                : "bg-blue-500 hover:bg-blue-600 text-white"
              }`}
          >
            {savStatus === "saving" && "Opslaan..."}
            {savStatus === "saved"  && "✅ Antwoorden opgeslagen"}
            {savStatus === "error"  && "❌ Fout — probeer opnieuw"}
            {savStatus === "idle" && aantalGekleurd === 0 && "Klik eerst de juiste zinnen aan"}
            {savStatus === "idle" && aantalGekleurd > 0  && "Antwoorden opslaan →"}
          </button>
        ) : !nagekeken ? (
          <div className="space-y-3">
            {heeftCorrecteAntwoorden && (
              <button
                onClick={() => setNagekeken(true)}
                disabled={aantalGekleurd === 0}
                className={`w-full py-4 rounded-2xl font-extrabold text-lg transition-all shadow
                  ${aantalGekleurd === 0
                    ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                    : "bg-pink-500 hover:bg-pink-600 text-white"
                  }`}
              >
                ✓ Nakijken
              </button>
            )}
            <button
              onClick={slaLeerlingAntwoordOp}
              disabled={savStatus === "saving" || savStatus === "saved" || aantalGekleurd === 0}
              className={`w-full py-3 rounded-2xl font-bold text-base transition-all shadow
                ${savStatus === "saved"
                  ? "bg-green-500 text-white cursor-default"
                  : savStatus === "error"
                  ? "bg-red-500 text-white"
                  : aantalGekleurd === 0
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-white border-2 border-pink-300 text-pink-600 hover:border-pink-500"
                }`}
            >
              {savStatus === "saving" && "Opslaan..."}
              {savStatus === "saved"  && "✅ Opgeslagen"}
              {savStatus === "error"  && "❌ Fout — probeer opnieuw"}
              {savStatus === "idle" && (heeftCorrecteAntwoorden ? "Of: alleen opslaan zonder nakijken" : "Opslaan →")}
            </button>
            {!heeftCorrecteAntwoorden && (
              <p className="text-xs text-gray-400 text-center italic">
                ℹ️ Voor deze opdracht zijn nog geen antwoorden beschikbaar.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <button
              onClick={() => {
                setNagekeken(false);
                setGekleurd({});
                setWelkeNiet("");
              }}
              className="w-full py-3 rounded-2xl font-bold text-base bg-white border-2 border-gray-300 text-gray-700 hover:border-gray-500"
            >
              🔄 Opnieuw proberen
            </button>
            <button
              onClick={slaLeerlingAntwoordOp}
              disabled={savStatus === "saving" || savStatus === "saved"}
              className={`w-full py-3 rounded-2xl font-bold text-base transition-all shadow
                ${savStatus === "saved"
                  ? "bg-green-500 text-white cursor-default"
                  : savStatus === "error"
                  ? "bg-red-500 text-white"
                  : "bg-pink-500 hover:bg-pink-600 text-white"
                }`}
            >
              {savStatus === "saving" && "Opslaan..."}
              {savStatus === "saved"  && "✅ Resultaat opgeslagen"}
              {savStatus === "error"  && "❌ Fout — probeer opnieuw"}
              {savStatus === "idle"   && "Resultaat opslaan"}
            </button>
            <button
              onClick={() => router.push("/")}
              className="w-full py-2 text-pink-500 hover:text-pink-700 font-semibold underline text-sm"
            >
              Terug naar opdrachten
            </button>
          </div>
        )}

        {foutmelding && (
          <p className="mt-3 text-xs text-red-500 text-center">{foutmelding}</p>
        )}

        <p className="mt-8 text-center text-xs text-gray-400">
          {opdracht.les} · Taal Jacht Groep 5 Blok 7
        </p>
      </div>
    </main>
  );
}
