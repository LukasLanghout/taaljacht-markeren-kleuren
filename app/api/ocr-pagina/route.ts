import { NextResponse } from "next/server";

// OCR wordt nu client-side gedaan via Tesseract.js in app/beheer/page.tsx
// Dit endpoint is niet meer in gebruik.
export async function POST() {
  return NextResponse.json(
    { error: "OCR wordt nu client-side gedaan via Tesseract.js. Dit endpoint is deprecated." },
    { status: 410 }
  );
}
