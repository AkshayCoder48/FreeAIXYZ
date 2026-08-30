"use client";

/**
 * Dashboard — signed-in account surface (PRD §43, §44, §59, §68).
 *
 * If unauthenticated: shows a "Continue with email" card that opens the same
 * SignInDialog used in the nav.
 *
 * If authenticated: fetches /xyz/balance + /xyz/usage + /xyz/transactions.
 *   - Big balance Card: "{balance} XYZ" + subtext "+1.00 daily · -X used today"
 *     (computed from transactions where type=GENERATION and createdAt is today).
 *   - Tabs: Usage | Transactions | Models.
 *     - Usage tab: table of UsageRecord (model, in/out tokens, xyzCost, ts).
 *     - Transactions tab: table of XYZTransaction (type badge, amount
 *       (+green/-red), balanceAfter, note, ts).
 *     - Models tab: aggregate usage by model (sum xyzCost).
 *
 * Polls /xyz/balance every 60s.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Mail, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { SignInDialog } from "@/components/auth/sign-in-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface BalanceResponse {
  balance?: {
    userId: string;
    xyzBalance: number;
    lifetimeEarned: number;
    lifetimeSpent: number;
    lastDailyGrantAt?: string;
    updatedAt: string;
  };
  granted?: boolean;
}

interface UsageRecord {
  requestId: string;
  source?: "native" | "gratisfy" | "g4f";
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  usdCost: number;
  xyzCost: number;
  pricingVersion: number;
  timestamp: string;
}

interface UsageResponse {
  usage: UsageRecord[];
}

type XYZTransactionType =
  | "DAILY_GRANT"
  | "GENERATION"
  | "REFUND"
  | "ADMIN_ADJUSTMENT";

interface XYZTransaction {
  id: string;
  type: XYZTransactionType;
  amount: number;
  balanceAfter: number;
  requestId?: string;
  source?: "native" | "gratisfy" | "g4f";
  provider?: string;
  model?: string;
  note?: string;
  createdAt: string;
}

interface TransactionsResponse {
  transactions: XYZTransaction[];
}

function isToday(iso: string): boolean {
  try {
    const d = new Date(iso);
    const now = new Date();
    return (
      d.getUTCFullYear() === now.getUTCFullYear() &&
      d.getUTCMonth() === now.getUTCMonth() &&
      d.getUTCDate() === now.getUTCDate()
    );
  } catch {
    return false;
  }
}

function UnauthCard() {
  const [open, setOpen] = useState(false);
  return (
    <Card className="max-w-md mx-auto w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" /> Continue with email
        </CardTitle>
        <CardDescription>
          Sign in to track your XYZ balance, usage, and BYOK keys. No password
          required — we&apos;ll email you a one-time code.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={() => setOpen(true)} className="w-full">
          Sign in
        </Button>
        <SignInDialog open={open} onOpenChange={setOpen} />
      </CardContent>
    </Card>
  );
}

function TransactionTypeBadge({ type }: { type: XYZTransactionType }) {
  const map: Record<XYZTransactionType, string> = {
    DAILY_GRANT:
      "border-transparent bg-violet-500/15 text-violet-700 dark:text-violet-300",
    GENERATION:
      "border-transparent bg-slate-500/15 text-slate-700 dark:text-slate-300",
    REFUND:
      "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    ADMIN_ADJUSTMENT:
      "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300",
  };
  return <Badge className={map[type]}>{type}</Badge>;
}

export function Dashboard() {
  const { user, loading, refresh } = useAuth();
  const [balance, setBalance] = useState<number | null>(null);
  const [granted, setGranted] = useState(false);
  const [usage, setUsage] = useState<UsageRecord[] | null>(null);
  const [transactions, setTransactions] = useState<XYZTransaction[] | null>(
    null,
  );

  const refreshBalance = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/xyz/balance", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const data: BalanceResponse = await res.json();
      if (data.balance) setBalance(data.balance.xyzBalance);
      setGranted(Boolean(data.granted));
    } catch {
      // ignore
    }
  }, []);

  const refreshUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/xyz/usage?limit=50", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const data: UsageResponse = await res.json();
      setUsage(data.usage ?? []);
    } catch {
      // ignore
    }
  }, []);

  const refreshTransactions = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/xyz/transactions?limit=50", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) return;
      const data: TransactionsResponse = await res.json();
      setTransactions(data.transactions ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const doBalance = async () => {
      try {
        const res = await fetch("/api/v1/xyz/balance", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) return;
        const data: BalanceResponse = await res.json();
        if (cancelled) return;
        if (data.balance) setBalance(data.balance.xyzBalance);
        setGranted(Boolean(data.granted));
      } catch {
        // ignore
      }
    };

    const doUsage = async () => {
      try {
        const res = await fetch("/api/v1/xyz/usage?limit=50", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) return;
        const data: UsageResponse = await res.json();
        if (cancelled) return;
        setUsage(data.usage ?? []);
      } catch {
        // ignore
      }
    };

    const doTransactions = async () => {
      try {
        const res = await fetch("/api/v1/xyz/transactions?limit=50", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) return;
        const data: TransactionsResponse = await res.json();
        if (cancelled) return;
        setTransactions(data.transactions ?? []);
      } catch {
        // ignore
      }
    };

    doBalance();
    doUsage();
    doTransactions();
    intervalId = setInterval(doBalance, 60_000);
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [user]);

  const spentToday = useMemo(() => {
    if (!transactions) return 0;
    return transactions
      .filter(
        (t) => t.type === "GENERATION" && isToday(t.createdAt),
      )
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }, [transactions]);

  const usageByModel = useMemo(() => {
    if (!usage) return [] as { model: string; totalXyz: number; count: number }[];
    const map = new Map<string, { totalXyz: number; count: number }>();
    for (const u of usage) {
      const key = u.model || "unknown";
      const entry = map.get(key) ?? { totalXyz: 0, count: 0 };
      entry.totalXyz += u.xyzCost;
      entry.count += 1;
      map.set(key, entry);
    }
    return Array.from(map.entries()).map(([model, e]) => ({
      model,
      totalXyz: e.totalXyz,
      count: e.count,
    }));
  }, [usage]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!user) {
    return <UnauthCard />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Account</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Signed in as <span className="font-mono">{user.email}</span>
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await Promise.all([refreshBalance(), refreshUsage(), refreshTransactions()]);
            toast.success("Refreshed");
          }}
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardDescription>XYZ balance</CardDescription>
          <CardTitle className="text-4xl font-bold tracking-tight">
            {balance === null ? "—" : `${balance.toFixed(2)} XYZ`}
          </CardTitle>
          <CardDescription>
            +1.00 daily{spentToday > 0 ? ` · -${spentToday.toFixed(2)} used today` : ""}
            {granted ? " · daily grant applied" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Manage your BYOK keys on the{" "}
            <Link
              href="/providers"
              className="underline hover:text-foreground"
            >
              Providers
            </Link>{" "}
            page.
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue="usage">
        <TabsList>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="models">Models</TabsTrigger>
        </TabsList>

        <TabsContent value="usage">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="text-right">Out</TableHead>
                  <TableHead className="text-right">XYZ</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage?.slice(0, 50).map((u) => (
                  <TableRow key={u.requestId}>
                    <TableCell className="font-mono text-xs">
                      {u.model}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {u.provider}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {u.inputTokens}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {u.outputTokens}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {u.xyzCost.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(u.timestamp).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
                {usage && usage.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-sm text-muted-foreground py-6"
                    >
                      No usage yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="transactions">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance after</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions?.slice(0, 50).map((t) => {
                  const positive = t.amount >= 0;
                  return (
                    <TableRow key={t.id}>
                      <TableCell>
                        <TransactionTypeBadge type={t.type} />
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono ${
                          positive
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-rose-600 dark:text-rose-400"
                        }`}
                      >
                        {positive ? "+" : ""}
                        {t.amount.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {t.balanceAfter.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {t.note ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(t.createdAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {transactions && transactions.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-sm text-muted-foreground py-6"
                    >
                      No transactions yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="models">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                  <TableHead className="text-right">XYZ spent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usageByModel.map((row) => (
                  <TableRow key={row.model}>
                    <TableCell className="font-mono text-xs">
                      {row.model}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {row.count}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {row.totalXyz.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
                {usageByModel.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="text-center text-sm text-muted-foreground py-6"
                    >
                      No model usage yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
