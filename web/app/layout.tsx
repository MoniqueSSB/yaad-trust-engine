import type { Metadata } from "next";
import Script from "next/script";
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

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
    /* suppressHydrationWarning because the boot script below writes
       data-theme onto <html> before React arrives, and React must not treat
       that attribute as a mismatch to repair. */
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#F7F6FC" />
        {/* Light or dark before first paint, from the saved choice. See
            lib/theme.ts. Inline on purpose: a script loaded by URL arrives
            after the page has already painted dark. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className={`${fraunces.variable} ${ibmPlexSans.variable} ${ibmPlexMono.variable}`}>
        {children}
        {/* Company details and the legal pages, on every app screen. The
            marketing site has carried these in its footer since launch; the
            app had none of them until 16 Oct 2026 (the twenty point check).
            Kept small so it never competes with a job screen. */}
        <footer className="mx-auto mt-10 max-w-[1080px] px-5 pb-8 text-[12px] leading-relaxed text-dim">
          <p>
            Yaadly is a trading name of Yaadly Ltd, registered in England and Wales,
            company no. 17358077. Registered office: 55 Remington Road, London N15 6SS.{" "}
            <a className="underline" href="https://yaadly.co.uk/privacy.html">Privacy</a>{" · "}
            <a className="underline" href="https://yaadly.co.uk/terms.html">Terms</a>{" · "}
            <a className="underline" href="https://yaadly.co.uk/cancellation.html">Cancellation and refunds</a>{" · "}
            <a className="underline" href="https://yaadly.co.uk/contact.html">Contact</a>
          </p>
        </footer>
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
