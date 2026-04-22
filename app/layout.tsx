import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Taal Jacht – Markeren & Kleuren",
  description:
    "Interactieve opdrachten: markeer en kleur zinnen in de brief. Groep 5 – Blok 7.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl">
      <body className="min-h-screen bg-gray-50">{children}</body>
    </html>
  );
}
