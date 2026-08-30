"use client";

/**
 * SignInDialog — direct email login (NO verification code).
 *
 * Single-step dialog:
 *   Email input → POST /api/v1/auth/login
 *     - 200: toast success + close + onSignedIn()
 *     - 400/429: show server message, stay open
 *
 * Backed by OnyxBase (no Prisma). The user just enters an email and is
 * signed in immediately — the session is stored server-side, so BYOK
 * keys saved against this account persist across refresh / tab changes.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SignInDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignedIn?: () => void;
}

export function SignInDialog({
  open,
  onOpenChange,
  onSignedIn,
}: SignInDialogProps) {
  const [email, setEmail] = useState("");
  const [signing, setSigning] = useState(false);

  function reset() {
    setEmail("");
    setSigning(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error("Email is required");
      return;
    }
    setSigning(true);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string };
      if (res.ok && data.ok) {
        toast.success("Signed in");
        onOpenChange(false);
        reset();
        onSignedIn?.();
      } else {
        toast.error(data.message ?? "Could not sign in");
      }
    } catch {
      toast.error("Network error — try again");
    } finally {
      setSigning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> Continue with email
          </DialogTitle>
          <DialogDescription>
            Sign in with just your email — no password, no verification code.
            Your API keys are saved to your account and persist across
            devices.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSignIn} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signin-email">Email</Label>
            <Input
              id="signin-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={signing}
              required
            />
          </div>
          <Button type="submit" disabled={signing}>
            {signing ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
