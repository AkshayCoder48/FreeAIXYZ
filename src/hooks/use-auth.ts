"use client";

/**
 * useAuth — shared client-side auth state (PRD §90, §94).
 *
 * CRITICAL FIX (2026-08-30): previously every component that called
 * `useAuth()` got its OWN useState instance — so signing in via the
 * nav-bar dialog only updated NavAuthButton's local state. The Dashboard
 * on /account and ByokProviders on /providers kept their own
 * unauthenticated state, so the user kept seeing the "Sign in required"
 * card even AFTER a successful login. Same on reload — the cookie was
 * valid, but each useAuth() instance still had to fetch /api/v1/auth/me
 * independently and any component that mounted before the fetch returned
 * would briefly show "Sign in required".
 *
 * Solution: back the hook with a Zustand store. Zustand stores live at
 * module scope — every component calling `useAuth()` subscribes to the
 * SAME single source of truth. A login in one place fires `refresh()`
 * which updates the store, and every subscribed component re-renders
 * in lockstep. After a reload, the singleton's `init()` runs once (first
 * component to mount triggers it) and the result is shared by all
 * subscribers.
 *
 * No localStorage — the HttpOnly `fxz_session` cookie is the single
 * source of truth on the wire (the browser sends it automatically with
 * `credentials: "include"`). The Zustand store is just the in-memory
 * mirror of the cookie's view, shared across components.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { create } from "zustand";
import type { AuthUser } from "./auth-user";

interface MeResponse {
  user: AuthUser | null;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  /** Set to true once the initial /me fetch has resolved (success or fail). */
  initialized: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Internal: set user + loading. Used by refresh()/signOut(). */
  _set: (patch: Partial<Omit<AuthState, "refresh" | "signOut" | "_set">>) => void;
}

const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  initialized: false,
  refresh: async () => {
    set({ loading: true });
    try {
      const res = await fetch("/api/v1/auth/me", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        set({ user: null, loading: false, initialized: true });
        return;
      }
      const data: MeResponse = await res.json();
      set({ user: data.user ?? null, loading: false, initialized: true });
    } catch {
      set({ user: null, loading: false, initialized: true });
    }
  },
  signOut: async () => {
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      set({ user: null, loading: false, initialized: true });
    }
  },
  _set: (patch) => set(patch),
}));

// ─── One-shot initializer ───────────────────────────────────────────────────
//
// On the client, the FIRST component to mount triggers the initial /me
// fetch. Subsequent mounts reuse the same promise (no duplicate fetch).
// After a reload, this runs once and every subscribed component sees the
// result simultaneously.

let initPromise: Promise<void> | null = null;
function ensureInitialized(): Promise<void> {
  if (initPromise) return initPromise;
  const { refresh, initialized } = useAuthStore.getState();
  if (initialized) return Promise.resolve();
  initPromise = refresh().finally(() => {
    // Allow re-init later (e.g. after signOut → next mount can re-fetch).
    initPromise = null;
  });
  return initPromise;
}

const emptySubscribe = () => () => {};
function useMounted() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

export function useAuth() {
  const mounted = useMounted();
  // Subscribe to the singleton store unconditionally — calling React hooks
  // in a different order on different renders violates rules-of-hooks.
  const user = useAuthStore((s) => s.user);
  const storeLoading = useAuthStore((s) => s.loading);
  const refresh = useAuthStore((s) => s.refresh);
  const signOut = useAuthStore((s) => s.signOut);
  // On SSR/first paint, the cookie's session isn't known yet — show
  // `loading` so the UI renders a skeleton instead of the "Sign in"
  // button until the singleton's /me fetch resolves.
  const loading = mounted ? storeLoading : true;

  useEffect(() => {
    // Only run on the client. The first mount triggers the singleton fetch.
    if (mounted) void ensureInitialized();
  }, [mounted]);

  // If the user signs out in another tab, the storage event fires; we
  // don't use localStorage for auth, but we DO listen for our own custom
  // "fxz:signout" event so a signOut() in one tab is reflected in others.
  useEffect(() => {
    if (!mounted) return;
    const onSignOut = () => {
      useAuthStore.getState()._set({ user: null, loading: false, initialized: true });
    };
    const onSignIn = () => {
      void useAuthStore.getState().refresh();
    };
    window.addEventListener("fxz:signout", onSignOut as EventListener);
    window.addEventListener("fxz:signin", onSignIn as EventListener);
    return () => {
      window.removeEventListener("fxz:signout", onSignOut as EventListener);
      window.removeEventListener("fxz:signin", onSignIn as EventListener);
    };
  }, [mounted]);

  return { user, loading, refresh, signOut };
}

/** Convenience helper for non-React contexts (rare). Triggers a refresh
 *  on the singleton and broadcasts a "fxz:signin" event so other tabs
 *  re-fetch their auth state too. */
export const authActions = {
  refresh: () => useAuthStore.getState().refresh(),
  broadcastSignIn: () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("fxz:signin"));
    }
  },
  broadcastSignOut: () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("fxz:signout"));
    }
  },
};

// Re-export the AuthUser type so existing imports from "@/hooks/use-auth"
// still work without changing every import site.
export type { AuthUser } from "./auth-user";
