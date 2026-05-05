import type { Metadata } from "next";
import { Noto_Sans } from "next/font/google";
import "./globals.css";

const notoSans = Noto_Sans({
  subsets: ["latin"],
  variable: "--font-noto-sans",
  weight: ["400", "500", "700"],
  display: "swap",
});

// TODO: Cuando el cliente provea `public/fonts/FWC2026-CondensedBlack.woff2`
// (proprietario de FIFA), reemplazar este bloque por:
//
//   import localFont from "next/font/local";
//   const fwc = localFont({
//     src: "../public/fonts/FWC2026-CondensedBlack.woff2",
//     variable: "--font-fwc",
//     weight: "900",
//     display: "swap",
//   });
//
// Y agregar `${fwc.variable}` a la className del <html>.
//
// Mientras tanto definimos la CSS variable con un fallback de sistema
// (Arial Narrow Black), para que `--font-display` siga funcionando.
const fwcFallbackVariable = {
  variable: "--font-fwc",
  className: "fwc-fallback",
};

export const metadata: Metadata = {
  title: "Prode Mundial 2026 — Tiro Federal",
  description:
    "Pronósticos del Mundial de Fútbol 2026 — Club Tiro Federal de Bahía Blanca",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es-AR"
      className={`${notoSans.variable} ${fwcFallbackVariable.className} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
