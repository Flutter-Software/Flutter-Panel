"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LayoutDashboard, LogOut, Moon, Shield, Sun, UserRound } from "lucide-react";
import { useTheme } from "next-themes";
import { Wordmark } from "@/components/brand";
import { useAuth } from "@/components/auth-provider";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, setUser } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inAdmin = pathname.startsWith("/admin");
  const initials = (user?.username ?? "??").slice(0, 2).toUpperCase();

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const itemClass =
    "pressable flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground/80 hover:bg-accent/70 hover:text-foreground";

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-4 border-b border-border bg-card/90 px-4 backdrop-blur">
      <Link href="/" className="shrink-0">
        <Wordmark />
      </Link>
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          aria-label="Toggle theme"
        >
          <Sun className="size-4 dark:hidden" />
          <Moon className="hidden size-4 dark:block" />
        </button>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted",
              menuOpen && "bg-muted",
            )}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {initials}
            </span>
            <span className="hidden text-sm sm:block">{user?.username ?? "Account"}</span>
            <ChevronDown
              className={cn("size-4 text-muted-foreground transition-transform", menuOpen && "rotate-180")}
            />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-card shadow-lg"
            >
              <div className="flex items-center gap-3 border-b border-border px-3 py-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {initials}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{user?.username ?? "Account"}</p>
                  <p className="truncate text-xs text-muted-foreground">{user?.email ?? ""}</p>
                </div>
              </div>
              {user?.role ? (
                <p className="px-3 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {user.role}
                </p>
              ) : null}
              <div className="flex flex-col gap-0.5 p-1.5 pt-0">
                <Link href="/account" role="menuitem" className={itemClass} onClick={() => setMenuOpen(false)}>
                  <UserRound className="size-4 shrink-0" />
                  Account
                </Link>
                {user?.role === "admin" ? (
                  inAdmin ? (
                    <Link href="/" role="menuitem" className={itemClass} onClick={() => setMenuOpen(false)}>
                      <LayoutDashboard className="size-4 shrink-0" />
                      Servers
                    </Link>
                  ) : (
                    <Link href="/admin" role="menuitem" className={itemClass} onClick={() => setMenuOpen(false)}>
                      <Shield className="size-4 shrink-0" />
                      Admin
                    </Link>
                  )
                ) : null}
              </div>
              <div className="border-t border-border p-1.5">
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
                  onClick={async () => {
                    setMenuOpen(false);
                    await api("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
                    setUser(null);
                    router.push("/login");
                    router.refresh();
                  }}
                >
                  <LogOut className="size-4 shrink-0" />
                  Sign out
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
