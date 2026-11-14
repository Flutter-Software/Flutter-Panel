"use client";

/**
 * Command menu (Ctrl/Cmd+K).
 *
 * One searchable list of everywhere you can go and a few things you can do:
 * the current server's sections, your servers, account pages, admin pages
 * (admins only) and actions like switching theme or signing out.
 *
 * Mounted once by the Topbar, so it exists on every signed-in page. Open it
 * with Ctrl/Cmd+K from anywhere (even inside a text field, like most apps), or
 * with the search button in the Topbar.
 *
 * Keyboard: ↑/↓ (or Ctrl+N/P) moves, Enter runs, Esc closes. The highlighted
 * route is prefetched, so Enter usually lands on an already-loaded page.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  CornerDownLeft,
  Fingerprint,
  KeyRound,
  LogOut,
  MonitorSmartphone,
  Moon,
  Palette,
  Search,
  Server,
  Sun,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/components/auth-provider";
import { Kbd, isModKey, useModKeyLabel } from "@/components/kbd";
import { ADMIN_NAV, serverNavItems } from "@/components/sidebar";
import { useSmoothTheme } from "@/components/theme-provider";
import { serverHomeHref } from "@/lib/access";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useQuery } from "@/lib/query";
import type { ServerRecord } from "@/lib/types";

type Command = {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  /** Extra words that should match (e.g. "logout" for "Sign out"). */
  keywords?: string;
  /** Secondary text on the right (e.g. a server's node). */
  hint?: string;
  href?: string;
  run?: () => void | Promise<void>;
};

const ACCOUNT_PAGES: Array<Pick<Command, "label" | "href" | "icon" | "keywords">> = [
  { label: "Account", href: "/account", icon: UserRound, keywords: "profile email username" },
  { label: "Security", href: "/account/security", icon: Fingerprint, keywords: "password 2fa totp two factor" },
  { label: "Sessions", href: "/account/sessions", icon: MonitorSmartphone, keywords: "devices sign out" },
  { label: "Appearance", href: "/account/appearance", icon: Palette, keywords: "theme motion layout" },
  { label: "API keys", href: "/account/api-keys", icon: KeyRound, keywords: "token" },
];

/**
 * Scores `query` against `text` as an in-order subsequence. Higher is better;
 * -1 means no match. Rewards matches at word starts and consecutive runs, so
 * "ns" ranks "Nests" above "Locations".
 */
function score(text: string, query: string) {
  if (!query) return 0;
  const hay = text.toLowerCase();
  const needle = query.toLowerCase();
  if (hay.startsWith(needle)) return 1000 - hay.length;
  const contiguous = hay.indexOf(needle);
  if (contiguous >= 0) return 500 - contiguous;

  let total = 0;
  let from = 0;
  let previous = -2;
  for (const char of needle) {
    if (char === " ") continue;
    const index = hay.indexOf(char, from);
    if (index < 0) return -1;
    const wordStart = index === 0 || /[\s/_-]/.test(hay[index - 1] ?? "");
    total += (wordStart ? 8 : 1) + (index === previous + 1 ? 4 : 0);
    previous = index;
    from = index + 1;
  }
  return total;
}

export function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  // Global shortcut lives here so it works even while the menu is closed.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || event.shiftKey || event.altKey) return;
      if (!isModKey(event)) return;
      event.preventDefault();
      onOpenChange(!open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;
  return <CommandDialog onClose={() => onOpenChange(false)} />;
}

function CommandDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, setUser } = useAuth();
  const { resolvedTheme } = useTheme();
  const switchTheme = useSmoothTheme();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const serversQuery = useQuery<{ data: { servers: ServerRecord[] } }>("/api/v1/client/servers");
  const servers = useMemo(() => serversQuery.data?.data.servers ?? [], [serversQuery.data]);
  const currentServerId = /^\/server\/([^/]+)/.exec(pathname)?.[1] ?? null;
  const currentServer = servers.find((server) => server.id === currentServerId) ?? null;

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];

    if (currentServerId) {
      const group = currentServer ? currentServer.name : "This server";
      for (const item of serverNavItems(currentServerId, currentServer)) {
        list.push({ id: `here:${item.href}`, label: item.label, group, icon: item.icon, href: item.href });
      }
    }

    for (const server of servers) {
      list.push({
        id: `server:${server.id}`,
        label: server.name,
        group: "Servers",
        icon: Server,
        hint: server.node,
        keywords: `${server.egg} ${server.allocation} ${server.description}`,
        href: serverHomeHref(server),
      });
    }

    for (const page of ACCOUNT_PAGES) {
      list.push({ id: `account:${page.href}`, group: "Account", ...page });
    }

    if (user?.role === "admin") {
      for (const group of ADMIN_NAV) {
        for (const item of group.items) {
          list.push({
            id: `admin:${item.href}`,
            label: item.label,
            group: "Admin",
            icon: item.icon,
            keywords: `admin ${group.group}`,
            href: item.href,
          });
        }
      }
    }

    const dark = resolvedTheme === "dark";
    list.push({
      id: "action:theme",
      label: dark ? "Switch to light theme" : "Switch to dark theme",
      group: "Actions",
      icon: dark ? Sun : Moon,
      keywords: "theme appearance mode",
      run: () => switchTheme(dark ? "light" : "dark"),
    });
    list.push({
      id: "action:sign-out",
      label: "Sign out",
      group: "Actions",
      icon: LogOut,
      keywords: "logout log out",
      async run() {
        await api("/api/v1/auth/logout", { method: "POST" }).catch(() => undefined);
        setUser(null);
        router.push("/login");
        router.refresh();
      },
    });

    return list;
  }, [currentServer, currentServerId, resolvedTheme, router, servers, setUser, switchTheme, user?.role]);

  // Filter + rank. With no query, keep the natural order (grouped).
  const results = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return commands;
    return commands
      .map((command) => ({
        command,
        rank: Math.max(
          score(command.label, trimmed) * 2,
          score(`${command.group} ${command.label} ${command.keywords ?? ""}`, trimmed),
        ),
      }))
      .filter((entry) => entry.rank >= 0)
      .sort((a, b) => b.rank - a.rank)
      .map((entry) => entry.command);
  }, [commands, query]);

  const clamped = Math.min(active, Math.max(0, results.length - 1));
  const current = results[clamped];

  // Remember what had focus, focus the input, lock page scroll; undo on close.
  useEffect(() => {
    restoreFocus.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      restoreFocus.current?.focus?.();
    };
  }, []);

  // Keep the highlighted row visible, and warm up its route.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${clamped}"]`)
      ?.scrollIntoView({ block: "nearest" });
    if (current?.href) router.prefetch(current.href);
  }, [clamped, current?.href, router]);

  const runCommand = useCallback(
    (command: Command | undefined) => {
      if (!command) return;
      onClose();
      if (command.href) router.push(command.href);
      else void command.run?.();
    },
    [onClose, router],
  );

  function onKeyDown(event: ReactKeyboardEvent) {
    const down = event.key === "ArrowDown" || (event.ctrlKey && event.key === "n");
    const up = event.key === "ArrowUp" || (event.ctrlKey && event.key === "p");
    if (down || up) {
      event.preventDefault();
      if (!results.length) return;
      const step = down ? 1 : -1;
      setActive((clamped + step + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      runCommand(current);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Tab") {
      // Focus stays in the input; Tab would otherwise leave the dialog.
      event.preventDefault();
    }
  }

  // Group headers only make sense when the list is in its natural order.
  const grouped = !query.trim();

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-3 pt-[calc(12vh+env(safe-area-inset-top))]">
      <button
        type="button"
        aria-label="Close command menu"
        tabIndex={-1}
        className="no-press flutter-modal-backdrop-in absolute inset-0 bg-background/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
        className="flutter-modal-in relative flex max-h-[min(70vh,32rem)] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-black/40"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-3.5">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={current ? `${listId}-${clamped}` : undefined}
            aria-autocomplete="list"
            placeholder="Search servers, pages and actions…"
            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            spellCheck={false}
            autoComplete="off"
          />
          <Kbd>Esc</Kbd>
        </div>

        <div ref={listRef} id={listId} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {serversQuery.loading ? "Loading…" : `Nothing matches “${query.trim()}”.`}
            </p>
          ) : (
            results.map((command, index) => (
              <CommandRow
                key={command.id}
                id={`${listId}-${index}`}
                index={index}
                command={command}
                active={index === clamped}
                header={grouped && command.group !== results[index - 1]?.group ? command.group : null}
                onHover={() => setActive(index)}
                onRun={() => runCommand(command)}
              />
            ))
          )}
        </div>

        <Footer />
      </div>
    </div>
  );
}

function CommandRow({
  id,
  index,
  command,
  active,
  header,
  onHover,
  onRun,
}: {
  id: string;
  index: number;
  command: Command;
  active: boolean;
  header: string | null;
  onHover: () => void;
  onRun: () => void;
}) {
  const Icon = command.icon;
  return (
    <>
      {header ? (
        <p
          role="presentation"
          className="px-2.5 pt-2.5 pb-1 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase first:pt-1"
        >
          {header}
        </p>
      ) : null}
      <div
        id={id}
        role="option"
        aria-selected={active}
        data-index={index}
        className={cn(
          "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm",
          active ? "bg-accent text-accent-foreground" : "text-foreground/90",
        )}
        // onMouseMove (not enter) so a list scrolling under a still pointer
        // doesn't steal the keyboard highlight.
        onMouseMove={active ? undefined : onHover}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onRun}
      >
        <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{command.label}</span>
        {command.hint ? (
          <span className="max-w-[40%] truncate text-xs text-muted-foreground">{command.hint}</span>
        ) : null}
        {active ? <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
      </div>
    </>
  );
}

function Footer() {
  const mod = useModKeyLabel();
  const hint = (keys: ReactNode, label: string) => (
    <span className="flex items-center gap-1.5">
      {keys}
      {label}
    </span>
  );
  return (
    <div className="kbd-hint-row flex items-center gap-4 border-t border-border px-3.5 py-2 text-[11px] text-muted-foreground">
      {hint(
        <>
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
        </>,
        "Navigate",
      )}
      {hint(<Kbd>↵</Kbd>, "Open")}
      <span className="ml-auto">{hint(<Kbd>{mod}K</Kbd>, "Toggle")}</span>
    </div>
  );
}
