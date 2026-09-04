import type { Metadata } from "next";
import Script from "next/script";
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-fraunces",
});

const ibmPlexSans = IBM_Plex_Sans({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-ibm-plex-sans",
});

const ibmPlexMono = IBM_Plex_Mono({
  weight: ["400", "600"],
  subsets: ["latin"],
  variable: "--font-ibm-plex-mono",
});

export const metadata: Metadata = {
  title: "Yaadly",
  description:
    "Trust-first property work in Jamaica. You buy the job from Yaadly, nothing is signed off until you have seen the evidence, and Yaadly pays the tradesperson on completion.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${fraunces.variable} ${ibmPlexSans.variable} ${ibmPlexMono.variable}`}>
        {children}
        {/* The Ask Yaadly chat, the same file the marketing site serves, so
            there is one widget and one place to change it. It talks to
            yaad-inbound on the "web" channel; app.yaadly.co.uk is on that
            door's origin allowlist (supabase/functions/yaad-inbound/web-chat.ts).
            The file itself steps aside on the worker's portal. Founder,
            2 Sep 2026: "add this chat on the side of every page". */}
        <Script src="https://yaadly.co.uk/chat.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
