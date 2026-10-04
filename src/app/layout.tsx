import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "مِعيار",
  description: "مساعد معرفي للمعاملات المالية المعاصرة — ليس جهة فتوى.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
