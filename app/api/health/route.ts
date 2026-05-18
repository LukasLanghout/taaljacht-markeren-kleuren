import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 20;

const MODEL = "mistralai/Mistral-7B-Instruct-v0.2";
const HF_URL = "https://api-inference.huggingface.co/v1/chat/completions";

export async function GET() {
  const apiKey = process.env.HUGGINGFACE_API_KEY;

  if (!apiKey) {
    return NextResponse.json({
      status: "error",
      ai: "error",
      reden: "HUGGINGFACE_API_KEY ontbreekt in Vercel env-vars",
    });
  }

  try {
    const res = await fetch(HF_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: "Zeg alleen: ok" }],
        max_tokens: 5,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) {
      return NextResponse.json({ status: "ok", ai: "ok", model: MODEL });
    }

    if (res.status === 503) {
      const body = await res.text().catch(() => "");
      let wacht = 0;
      try { wacht = JSON.parse(body).estimated_time ?? 0; } catch { /* ok */ }
      return NextResponse.json({
        status: "laden",
        ai: "laden",
        reden: `Model laadt nog (~${Math.round(wacht)}s)`,
        model: MODEL,
      });
    }

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({
        status: "error",
        ai: "error",
        reden: `HuggingFace API-key ongeldig of geen toegang (${res.status})`,
      });
    }

    return NextResponse.json({
      status: "error",
      ai: "error",
      reden: `HTTP ${res.status}`,
    });
  } catch (e) {
    return NextResponse.json({
      status: "error",
      ai: "error",
      reden: "Verbinding mislukt: " + String(e).substring(0, 100),
    });
  }
}
