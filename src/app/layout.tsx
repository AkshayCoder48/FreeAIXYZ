import type { Metadata } from "next";
import { Nunito, DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const nunito = Nunito({
  variable: "--font-brand",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800", "900"],
});

const dmSans = DM_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-code",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "FreeAI4All — Free AI Inference Platform",
  description:
    "Free, unlimited AI inference platform. OpenAI-compatible API with 90+ models across 15+ providers. No API key required.",
  keywords: [
    "free AI",
    "OpenAI compatible API",
    "free inference",
    "free GPT",
    "free AI API",
    "chat completions API",
    "no auth AI",
    "AI playground",
  ],
  authors: [{ name: "FreeAI4All" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "FreeAI4All — Free AI Inference Platform",
    description:
      "Free AI inference with 90+ models. OpenAI-compatible, no key required.",
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
        className={`${nunito.variable} ${dmSans.variable} ${jetbrains.variable} antialiased bg-background text-foreground`}
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
              toast: "border-border bg-popover text-popover-foreground rounded-[20px]",
            },
          }}
        />
      </body>
    </html>
  );
}
