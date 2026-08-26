import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Calistoga } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const calistoga = Calistoga({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "FreeAIXYZ — Observable AI Gateway",
  description:
    "Free, observable, dynamically-discovering AI gateway. OpenAI-compatible API with 80+ models across 17 providers. Real end-to-end SSE streaming. No API key required.",
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
    "model discovery",
  ],
  authors: [{ name: "FreeAIXYZ" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "FreeAIXYZ — Observable AI Gateway",
    description:
      "Free AI inference with 80+ models. OpenAI-compatible, real SSE streaming, dynamic discovery, no key required.",
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
        className={`${inter.variable} ${jetbrainsMono.variable} ${calistoga.variable} antialiased bg-background text-foreground`}
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
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
