"use client";

/**
 * NavAuthButton — top-right auth state for the nav bar.
 *
 * - loading   → Skeleton (so layout is stable during SSR/CSR hydration).
 * - signed in → <AccountMenu> with live XYZ balance (polled every 60s).
 * - signed out→ "Sign In" button that opens <SignInDialog>.
 *
 * The balance fetch is inlined in the effect so the setState calls happen
 * after `await` (i.e. inside an async callback, not synchronously in the
 * effect body — satisfies `react-hooks/set-state-in-effect`).
 */

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { AccountMenu } from "@/components/auth/account-menu";
import { SignInDialog } from "@/components/auth/sign-in-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface BalanceResponse {
  balance?: {
    xyzBalance: number;
  };
}

export function NavAuthButton() {
  const { user, loading, refresh } = useAuth();
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const doFetch = async () => {
      try {
        const res = await fetch("/api/v1/xyz/balance", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) return;
        const data: BalanceResponse = await res.json();
        if (cancelled) return;
        if (data.balance) setBalance(data.balance.xyzBalance);
      } catch {
        // ignore — polled
      }
    };

    doFetch();
    intervalId = setInterval(doFetch, 60_000);
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [user]);

  if (loading) {
    return <Skeleton className="h-9 w-24 rounded-full" />;
  }

  if (!user) {
    return (
      <>
        <Button
          size="sm"
          className="rounded-full h-9"
          onClick={() => setOpen(true)}
        >
          Sign in
        </Button>
        <SignInDialog open={open} onOpenChange={setOpen} onSignedIn={refresh} />
      </>
    );
  }

  return <AccountMenu user={user} balance={balance} />;
}
