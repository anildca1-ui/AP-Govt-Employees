import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AP ఉద్యోగుల పోర్టల్ — ap-emp-ai",
  description:
    "ఆంధ్రప్రదేశ్ ప్రభుత్వ ఉద్యోగుల కోసం GO లైబ్రరీ, AI చాట్ మరియు కాలిక్యులేటర్లు / GO library, AI chat and calculators for AP government employees.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// Telugu is the default UI language (CLAUDE.md hard rule 5). The English toggle
// and the full nav/PWA shell land in Phase 0 task 4.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="te">
      <body className="min-h-dvh bg-white text-slate-900 antialiased">{children}</body>
    </html>
  );
}
