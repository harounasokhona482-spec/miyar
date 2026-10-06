import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Noto_Naskh_Arabic, Readex_Pro } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// Design system typography: Readex Pro for headings and buttons, IBM Plex Sans
// Arabic for Mi'yar's own text, Noto Naskh Arabic for source text only.
const display = Readex_Pro({ subsets: ["arabic", "latin"], weight: ["600", "700"], variable: "--nf-display", display: "swap" });
const body = IBM_Plex_Sans_Arabic({ subsets: ["arabic", "latin"], weight: ["400", "500", "600"], variable: "--nf-body", display: "swap" });
const quote = Noto_Naskh_Arabic({ subsets: ["arabic"], weight: ["400"], variable: "--nf-quote", display: "swap" });

export const metadata: Metadata = {
  title: "مِعيار",
  description: "مساعد معرفي لفهم المعاملات المالية المعاصرة — ليس جهة فتوى.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#faf9f6",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${display.variable} ${body.variable} ${quote.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
