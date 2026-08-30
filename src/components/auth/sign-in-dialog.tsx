"use client";

/**
 * SignInDialog — magic-link (email code) sign-in flow (PRD §80, §81, §82, §99).
 *
 * Two-step dialog:
 *   Step A: email Input → POST /api/v1/auth/email/send
 *     - Generic message shown (no account enumeration — PRD §99).
 *     - In dev (no email provider) the server returns `devCode`; show it in a
 *       dev-only amber alert so the flow is testable without email infra.
 *   Step B: 6-digit code Input → POST /api/v1/auth/email/verify
 *     - 200: toast success + close + onSignedIn()
 *     - 400: show server message, stay on step B.
 *     - "Back" returns to step A to re-send.
 */

import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, KeyRound, Mail } from "lucide-react";
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

type Step = "email" | "code";

export function SignInDialog({
  open,
  onOpenChange,
  onSignedIn,
}: SignInDialogProps) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  function reset() {
    setStep("email");
    setEmail("");
    setCode("");
    setDevCode(null);
    setStatusMessage(null);
    setSending(false);
    setVerifying(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error("Email is required");
      return;
    }
    setSending(true);
    setDevCode(null);
    setStatusMessage(null);
    try {
      const res = await fetch("/api/v1/auth/email/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        message?: string;
        devCode?: string;
      };
      if (data.message) setStatusMessage(data.message);
      if (data.devCode) setDevCode(data.devCode);
      if (data.ok) {
        setStep("code");
      } else {
        toast.error(data.message ?? "Could not send code");
      }
    } catch {
      toast.error("Network error — try again");
    } finally {
      setSending(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      toast.error("Enter the 6-digit code");
      return;
    }
    setVerifying(true);
    try {
      const res = await fetch("/api/v1/auth/email/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, code: trimmedCode }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        message?: string;
        userId?: string;
      };
      if (res.ok && data.ok) {
        toast.success("Signed in");
        onOpenChange(false);
        reset();
        onSignedIn?.();
      } else {
        // stay on step B; show server message
        toast.error(data.message ?? "Invalid code");
      }
    } catch {
      toast.error("Network error — try again");
    } finally {
      setVerifying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === "email" ? (
              <>
                <Mail className="h-4 w-4" /> Continue with email
              </>
            ) : (
              <>
                <KeyRound className="h-4 w-4" /> Verify your code
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {step === "email"
              ? "We'll email you a one-time code. No password required."
              : `Enter the 6-digit code sent to ${email}.`}
          </DialogDescription>
        </DialogHeader>

        {step === "email" ? (
          <form onSubmit={handleSendCode} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="signin-email">Email</Label>
              <Input
                id="signin-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={sending}
                required
              />
            </div>
            {statusMessage && (
              <p className="text-xs text-muted-foreground">{statusMessage}</p>
            )}
            <Button type="submit" disabled={sending}>
              {sending ? "Sending…" : "Continue"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="flex flex-col gap-3">
            {devCode && (
              <div
                role="alert"
                className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200"
              >
                DEV mode — your code is{" "}
                <span className="font-mono font-semibold">{devCode}</span>
              </div>
            )}
            {statusMessage && (
              <p className="text-xs text-muted-foreground">{statusMessage}</p>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="signin-code">Code</Label>
              <Input
                id="signin-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
                disabled={verifying}
                className="font-mono tracking-[0.4em] text-center"
                required
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep("email")}
                disabled={verifying}
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button type="submit" disabled={verifying}>
                {verifying ? "Verifying…" : "Verify"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
