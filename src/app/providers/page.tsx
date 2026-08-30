import type { Metadata } from "next";
import { Nav } from "@/components/nav";
import { SiteFooter } from "@/components/site";
import { ByokProviders } from "@/components/providers/byok-providers";

export const metadata: Metadata = {
  title: "Providers — FreeAIXYZ",
  description:
    "Connect your own Gratisfy and G4F BYOK keys, validate them, and refresh the unified provider catalog.",
};

export default function Page() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-8 sm:py-12">
        <ByokProviders />
      </main>
      <SiteFooter />
    </div>
  );
}
