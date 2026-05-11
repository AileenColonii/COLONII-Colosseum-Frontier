import type { Metadata, Viewport } from "next";
import { Alata, Special_Elite } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

// Per Sam's COLOSSEUM spec (May 2026):
//   Header / Interface: Alata
//   Body:               Special Elite (typewriter — matches Colony's
//                       handwritten / human-first tone of voice)
const alata = Alata({
  weight: ["400"],
  subsets: ["latin"],
  variable: "--font-display",
});

const specialElite = Special_Elite({
  weight: ["400"],
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "COLONII — Talk to Anja",
  description: "Real-time voice conversation with Anja, your AI avatar companion",
  icons: {
    icon: "/colonii-icon-white.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${alata.variable} ${specialElite.variable}`}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
