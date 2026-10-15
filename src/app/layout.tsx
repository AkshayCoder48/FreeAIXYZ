import type { Metadata } from "next";
import { Space_Grotesk, Geist, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

/**
 * FreeAIXYZ typography (warm crimson/ember kit):
 *   - Space Grotesk — display / headlines
 *   - Geist          — body
 *   - JetBrains Mono — code, model ids, telemetry labels
 */

const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

const geist = Geist({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "FreeAIXYZ — Free OpenAI-Compatible AI Gateway",
  description:
    "FreeAIXYZ: a free, observable AI gateway. OpenAI-compatible API with the 24-model Onyx AI fleet across 3 lines — uncensored, general and creative. Real end-to-end SSE streaming, tool calling, no API key required.",
  keywords: [
    "free AI",
    "OpenAI compatible API",
    "free inference",
    "free GPT",
    "free AI API",
    "chat completions API",
    "no auth AI",
    "AI playground",
    "SSE streaming",
    "FreeAIXYZ",
    "Onyx AI fleet",
  ],
  authors: [{ name: "FreeAIXYZ" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "FreeAIXYZ — Free OpenAI-Compatible AI Gateway",
    description:
      "Free AI inference with the 24-model Onyx fleet. OpenAI-compatible, real SSE streaming, tool calling, no key required.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${spaceGrotesk.variable} ${geist.variable} ${jetbrainsMono.variable} antialiased bg-background text-foreground`}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
        <SonnerToaster
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast:
                "border border-border bg-popover text-popover-foreground rounded-lg",
            },
          }}
        />
      </body>
    </html>
  );
}
