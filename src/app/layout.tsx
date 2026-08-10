import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Anime AI Studio - Free AI Anime Image Generator",
  description:
    "Generate stunning anime artwork for free with AI. Powered by Pollinations.ai & AIAnime.io — unlimited, no login required.",
  keywords: [
    "anime",
    "AI",
    "image generator",
    "anime art",
    "AI art",
    "free",
    "Pollinations",
    "AIAnime",
  ],
  authors: [{ name: "Anime AI Studio" }],
  openGraph: {
    title: "Anime AI Studio - Free AI Anime Image Generator",
    description:
      "Generate stunning anime artwork for free with AI. Unlimited, no login required.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Anime AI Studio - Free AI Anime Image Generator",
    description:
      "Generate stunning anime artwork for free with AI. Unlimited, no login required.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
