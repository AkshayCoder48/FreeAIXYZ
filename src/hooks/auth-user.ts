/**
 * AuthUser — the public user record returned by /api/v1/auth/me.
 *
 * Kept in its own module so the client-side auth store
 * (src/hooks/use-auth.ts) and the server-side auth helpers
 * (src/lib/xyz/auth.ts) can both import the SAME type without creating
 * a circular dependency.
 */
export interface AuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt?: string;
  status?: "active" | "disabled";
}
