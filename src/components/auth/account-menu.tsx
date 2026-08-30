"use client";

/**
 * AccountMenu — signed-in user menu (PRD §94, §93).
 *
 * Dropdown trigger = Avatar + email. Items: XYZ balance (disabled), Account,
 * Providers, Usage, Log Out. Links use next/link.
 */

import Link from "next/link";
import { LogOut, User, Wallet, Boxes, BarChart3 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AuthUser } from "@/hooks/use-auth";
import { authActions } from "@/hooks/use-auth";

interface AccountMenuProps {
  user: AuthUser;
  balance?: number;
}

function initials(email: string) {
  const handle = email.split("@")[0] ?? email;
  if (!handle) return "U";
  const parts = handle.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return handle.slice(0, 2).toUpperCase();
}

export function AccountMenu({ user, balance }: AccountMenuProps) {
  async function handleLogout() {
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      // Update the shared auth store immediately AND broadcast to other
      // tabs so every mounted useAuth() subscriber re-renders as
      // unauthenticated. Then reload to flush any per-page cached state.
      authActions.broadcastSignOut();
      window.location.reload();
    }
  }

  const balanceLabel =
    typeof balance === "number" ? `${balance.toFixed(2)} XYZ` : "—";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 px-2 gap-2 rounded-full"
          aria-label="Account menu"
        >
          <Avatar className="h-7 w-7">
            <AvatarFallback className="text-[10px] font-semibold bg-muted">
              {initials(user.email)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden sm:block text-xs font-medium max-w-[140px] truncate">
            {user.email}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-violet-500" />
          <span className="text-sm font-semibold">{balanceLabel}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account" className="flex items-center gap-2 cursor-pointer">
            <User className="h-4 w-4" /> Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link
            href="/providers"
            className="flex items-center gap-2 cursor-pointer"
          >
            <Boxes className="h-4 w-4" /> Providers
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link
            href="/account?tab=usage"
            className="flex items-center gap-2 cursor-pointer"
          >
            <BarChart3 className="h-4 w-4" /> Usage
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          className="cursor-pointer"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4" /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
