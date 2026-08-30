"use client";

/**
 * useAuth — minimal client-side auth state (PRD §90, §94).
 *
 * Reads /api/v1/auth/me on mount and exposes { user, loading, refresh, signOut }.
 * No localStorage — the HttpOnly `fxz_session` cookie is the single source of
 * truth (the browser sends it automatically with `credentials: "include"`).
 */

import { useCallback, useEffect, useState } from "react";

export interface AuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt?: string;
  status?: "active" | "disabled";
}

interface MeResponse {
  user: AuthUser | null;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/me", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        setUser(null);
        return;
      }
      const data: MeResponse = await res.json();
      setUser(data.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { user, loading, refresh, signOut };
}
