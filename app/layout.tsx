import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Inter } from "next/font/google";
import { AutoReload } from "@/components/auto-reload";
import "./globals.css";

// The club's own faces (padelcenter.az): Bebas Neue for headings, Inter for
// text. next/font downloads them at build time and serves them from this
// site, so a courtside tablet never waits on Google.
const display = Bebas_Neue({ weight: "400", subsets: ["latin", "latin-ext"], variable: "--font-bebas", display: "swap" });
const sans = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "VAR Replay · Padel Center Baku", template: "%s · Padel Center Baku VAR" },
  description: "Padel Center Baku court replay: rewind, slow motion, zoom, save the moment.",
  manifest: "/manifest.webmanifest",
  // "Add to Home Screen" on an iPad or iPhone opens the site full screen,
  // without the browser chrome, which is what a courtside tablet wants.
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "PCB VAR" },
  icons: { icon: "/icon-192.png", apple: "/apple-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#080908",
  colorScheme: "dark",
  // No maximumScale: pinch zoom on the page itself must stay possible.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body className="min-h-dvh">
        <AutoReload />
        {children}
      </body>
    </html>
  );
}
