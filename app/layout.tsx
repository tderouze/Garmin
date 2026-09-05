import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Garmin Analysis",
  description: "Analyse tes performances Garmin — traces, comparaisons, PBs",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased">
        {children}
      </body>
    </html>
  );
}
