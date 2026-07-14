import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: "FreeGPT Gateway — Unlimited Free AI, OpenAI-Compatible API",
  description:
    "A serverless, drop-in OpenAI-compatible API gateway providing unlimited free AI access with automatic per-request token rotation. No API key required.",
  keywords: [
    "free AI",
    "OpenAI compatible API",
    "serverless AI",
    "free GPT",
    "token rotation",
    "toolbaz",
    "chat completions API",
  ],
  authors: [{ name: "FreeGPT Gateway" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "FreeGPT Gateway — Unlimited Free AI",
    description:
      "Serverless OpenAI-compatible API with automatic token rotation. Free, unlimited, no key.",
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <SonnerToaster
          position="bottom-right"
          theme="dark"
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
