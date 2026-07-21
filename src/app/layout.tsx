import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display, Inter, JetBrains_Mono, Pacifico } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Branding font — elegant cursive for logo/headings
const playfair = Playfair_Display({
  variable: "--font-brand",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  style: ["normal", "italic"],
});

// Body text font — clean, modern
const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

// Code/mono font — for code blocks
const jetbrains = JetBrains_Mono({
  variable: "--font-code",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Script/cursive font — for special branding accents
const pacifico = Pacifico({
  variable: "--font-script",
  subsets: ["latin"],
  weight: ["400"],
});

export const metadata: Metadata = {
  title: "FreeAIXYZ — Unlimited Free AI, OpenAI-Compatible API",
  description:
    "A serverless, drop-in OpenAI-compatible API gateway providing unlimited free AI access with automatic per-request token rotation. 400+ models, 49 providers, no API key required.",
  keywords: [
    "free AI",
    "OpenAI compatible API",
    "serverless AI",
    "free GPT",
    "token rotation",
    "free AI API",
    "chat completions API",
    "no auth AI",
  ],
  authors: [{ name: "FreeAIXYZ" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "FreeAIXYZ — Unlimited Free AI",
    description:
      "Serverless OpenAI-compatible API with 400+ models. Free, unlimited, no key required.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} ${inter.variable} ${jetbrains.variable} ${pacifico.variable} antialiased bg-background text-foreground`}
        style={{ fontFamily: "var(--font-body), system-ui, sans-serif" }}
      >
        {children}
        <SonnerToaster
          position="bottom-right"
          theme="light"
          toastOptions={{
            classNames: {
              toast: "border-border bg-popover text-popover-foreground",
            },
          }}
        />
      </body>
    </html>
  );
}
