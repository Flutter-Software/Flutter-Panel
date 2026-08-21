"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown, Moon, Search, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Wordmark } from "@/components/brand";
import { useAuth } from "@/components/auth-provider";
import { api } from "@/lib/api";

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, setUser } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const inAdmin = pathname.startsWith("/admin");
  const initials = (user?.username ?? "??").slice(0, 2).toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-4 border-b border-border bg-card/90 px-4 backdrop-blur">
      <Link href="/" className="shrink-0">
        <Wordmark />
      </Link>
      <div className="hidden min-w-0 flex-1 items-center md:flex">
        <label className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/30"
            placeholder="Search"
          />
        </label>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-muted"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          <Sun className="size-4 dark:hidden" />
          <Moon className="hidden size-4 dark:block" />
        </button>
        <div className="relative">
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {initials}
            </span>
            <span className="hidden text-sm sm:block">{user?.username ?? "Account"}</span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </button>
          {menuOpen ? (
            <div className="absolute right-0 mt-2 w-48 overflow-hidden rounded-xl border border-border bg-card py-1">
              <Link
                href="/account"
                className="block px-3 py-2 text-sm hover:bg-muted"
                onClick={() => setMenuOpen(false)}
              >
                Account
              </Link>
              {user?.role === "admin" && !inAdmin ? (
                <Link
                  href="/admin"
                  className="block px-3 py-2 text-sm hover:bg-muted"
                  onClick={() => setMenuOpen(false)}
                >
                  Admin
                </Link>
              ) : null}
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={async () => {
                  setMenuOpen(false);
                  await api("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
                  setUser(null);
                  router.push("/login");
                  router.refresh();
                }}
              >
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
