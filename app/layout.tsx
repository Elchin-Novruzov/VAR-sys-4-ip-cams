import type { Metadata, Viewport } from "next";
import { AutoReload } from "@/components/auto-reload";
import "./globals.css";

export const metadata: Metadata = {
  title: "Padel VAR",
  description: "Court replay: rewind, slow motion, zoom, save the moment.",
  manifest: "/manifest.webmanifest",
  // "Add to Home Screen" on an iPad or iPhone opens the site full screen,
  // without the browser chrome, which is what a courtside tablet wants.
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Padel VAR" },
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0f14",
  // No maximumScale: pinch zoom on the page itself must stay possible.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <AutoReload />
        {children}
      </body>
    </html>
  );
}
