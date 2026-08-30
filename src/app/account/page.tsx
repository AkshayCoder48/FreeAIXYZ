import type { Metadata } from "next";
import { Nav } from "@/components/nav";
import { SiteFooter } from "@/components/site";
import { Dashboard } from "@/components/account/dashboard";

export const metadata: Metadata = {
  title: "Account — FreeAIXYZ",
  description:
    "Your XYZ balance, daily grant, usage records, and ledger transactions.",
};

export default function Page() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-8 sm:py-12">
        <Dashboard />
      </main>
      <SiteFooter />
    </div>
  );
}
