import type { Metadata } from "next";
import { Nav } from "@/components/nav";
import { SiteFooter } from "@/components/site";
import { PricingBoard } from "@/components/pricing/pricing-board";

export const metadata: Metadata = {
  title: "Pricing — FreeAIXYZ",
  description:
    "Unified per-model pricing board with status badges (documented / supplied / free / not documented) and source filters (Native / Gratisfy / G4F).",
};

export default function Page() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-8 sm:py-12">
        <PricingBoard />
      </main>
      <SiteFooter />
    </div>
  );
}
