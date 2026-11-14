"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Box,
  CircleHelp,
  Code,
  Cpu,
  Database,
  KeyRound,
  LifeBuoy,
  Mail,
  MapPin,
  Puzzle,
  ScrollText,
  Server,
  Settings,
  SquareArrowOutUpRight,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Popover } from "@mantine/core";
import { AdminError, AdminPage } from "@/components/admin-table";
import { DashboardSkeleton, OVERVIEW_DESCRIPTION } from "@/components/skeletons";
import { QueryErrorPage } from "@/components/error-page";
import { Badge, Card, buttonClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { prefetchQuery, useQuery } from "@/lib/query";
import { useLiveReload, usePanelEvent } from "@/components/panel-socket";
import type { ServerRecord } from "@/lib/types";
import type { PublicUser } from "@flutter-software/shared";
import type { LocationRecord } from "../locations/location-form";
import type { NestRecord } from "../nests/nest-form";
import { VersionBanner } from "./version-banner";

type HealthCheck = { ok: boolean; latencyMs?: number };
type Health = {
  ok: boolean;
  version?: string;
  checks: Record<string, HealthCheck>;
};

type NodeRow = {
  id: string;
  name: string;
  fqdn: string;
  location: string;
  online: boolean;
  maintenanceMode?: boolean;
  serverCount?: number;
};

type ServiceKind = "ORM" | "Service";

const HEALTH_META: Record<
  string,
  { label: string; kind: ServiceKind; description: string; href: string }
> = {
  mongo: {
    label: "MongoDB",
    kind: "Service",
    description:
      "Document database that stores panel state — accounts, servers, nodes, and sessions.",
    href: "https://www.mongodb.com/",
  },
  prisma: {
    label: "Prisma",
    kind: "ORM",
    description:
      "Typed MongoDB client generated from schema.prisma. Health-checks that the schema still matches the database.",
    href: "https://www.prisma.io/",
  },
  redis: {
    label: "Redis",
    kind: "Service",
    description:
      "In-memory data store bundled with the panel. Pinged for health and available for cache and background jobs.",
    href: "https://redis.io/",
  },
};

/** External project links shown as the button row under the version banner. */
const PROJECT_REPO = "https://github.com/Flutter-Software/Flutter-Panel";
const PROJECT_LINKS: { label: string; href: string; icon: LucideIcon }[] = [
  { label: "Documentation", href: "https://docs.flutter.software", icon: BookOpen },
  { label: "GitHub", href: PROJECT_REPO, icon: Code },
  { label: "Report an issue", href: `${PROJECT_REPO}/issues/new`, icon: LifeBuoy },
  { label: "Changelog", href: `${PROJECT_REPO}/blob/main/CHANGELOG.md`, icon: ScrollText },
];

/** One tile in the Overview grid: an admin section plus an optional live figure. */
type SectionTile = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  /** Live count shown top-right; omitted for settings tiles. */
  count?: number;
  /** One-line live summary pinned to the bottom of the tile (e.g. "3 running"). */
  hint?: string;
  /** API path to warm on hover so the destination page opens instantly. */
  prefetch?: string;
};

type Alert = { href: string; label: string; tone: string; dot: string };

export default function AdminDashboardPage() {
  const users = useQuery<{ data: { users: PublicUser[] } }>("/api/v1/admin/users");
  const locations = useQuery<{ data: { locations: LocationRecord[] } }>("/api/v1/admin/locations");
  const nodes = useQuery<{ data: { nodes: NodeRow[] } }>("/api/v1/admin/nodes");
  const servers = useQuery<{ data: { servers: ServerRecord[] } }>("/api/v1/admin/servers");
  const nests = useQuery<{ data: { nests: NestRecord[] } }>("/api/v1/admin/nests");
  // Database hosts only feed one tile's count, so they never hold up the page.
  const dbHosts = useQuery<{ data: { hosts: unknown[] } }>("/api/v1/admin/database-hosts");
  const apiKeys = useQuery<{ data: { keys: unknown[] } }>("/api/v1/admin/api-keys");
  const extensions = useQuery<{ data: { extensions: { status: string }[] } }>("/api/v1/admin/extensions");
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const serverRows = servers.data?.data.servers ?? [];
  const nodeRows = nodes.data?.data.nodes ?? [];
  const nestRows = nests.data?.data.nests ?? [];
  const locationRows = locations.data?.data.locations ?? [];
  const userRows = users.data?.data.users ?? [];
  const hostRows = dbHosts.data?.data.hosts;
  const apiKeyRows = apiKeys.data?.data.keys;
  const extensionRows = extensions.data?.data.extensions;
  const enabledExtensions = extensionRows?.filter((row) => row.status === "enabled").length ?? 0;
  const extensionsNeedingReview = extensionRows?.filter((row) => row.status === "needs-approval").length ?? 0;

  useLiveReload(servers.reload, 8000);
  useLiveReload(nodes.reload, 8000);
  usePanelEvent("health", (payload) => {
    setHealth(payload as Health);
    setHealthError(null);
  });

  const loadHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/health", { credentials: "include" });
      const json = (await response.json()) as Health;
      setHealth(json);
      setHealthError(null);
    } catch {
      setHealthError("Unreachable");
    }
  }, []);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);
  useLiveReload(loadHealth, 15_000);

  const running = serverRows.filter((row) => row.status === "running").length;
  const installFailed = serverRows.filter((row) => row.status === "install_failed");
  const onlineNodes = nodeRows.filter((row) => row.online).length;
  const maintenanceNodes = nodeRows.filter((row) => row.maintenanceMode);
  const offlineNodes = nodeRows.filter((row) => !row.online);
  const eggCount = nestRows.reduce((sum, nest) => sum + (nest.eggCount ?? nest.eggs?.length ?? 0), 0);
  const adminCount = userRows.filter((row) => row.role === "admin").length;
  const assignedNodes = locationRows.reduce((sum, row) => sum + (row.nodeCount ?? 0), 0);
  const loadError = servers.error ?? nodes.error ?? locations.error ?? users.error ?? nests.error;
  const loading =
    (!servers.data && !servers.error) ||
    (!nodes.data && !nodes.error) ||
    (!locations.data && !locations.error) ||
    (!users.data && !users.error) ||
    (!nests.data && !nests.error);

  const alerts: Alert[] = [
    ...offlineNodes.map((node) => ({
      href: `/admin/nodes/${node.id}`,
      label: `${node.name} is offline`,
      tone: "text-status-offline",
      dot: "bg-status-offline",
    })),
    ...maintenanceNodes.map((node) => ({
      href: `/admin/nodes/${node.id}/settings`,
      label: `${node.name} is in maintenance`,
      tone: "text-status-warn",
      dot: "bg-status-warn",
    })),
    ...installFailed.map((server) => ({
      href: `/admin/servers/${server.id}`,
      label: `${server.name} failed to install`,
      tone: "text-status-error",
      dot: "bg-status-error",
    })),
    ...serverRows
      .filter((row) => row.status === "installing")
      .map((server) => ({
        href: `/admin/servers/${server.id}`,
        label: `${server.name} is installing`,
        tone: "text-status-info",
        dot: "bg-status-info",
      })),
  ];

  // Grid order follows the setup flow: accounts → where machines live →
  // machines → workloads → templates, then the most-used settings panes.
  const tiles: SectionTile[] = [
    {
      title: "Users",
      description: "Create, edit, and remove user accounts.",
      href: "/admin/users",
      icon: Users,
      count: userRows.length,
      hint: userRows.length ? `${adminCount} admin${adminCount === 1 ? "" : "s"}` : "Invite an account",
      prefetch: "/api/v1/admin/users",
    },
    {
      title: "Locations",
      description: "Group nodes into physical locations.",
      href: "/admin/locations",
      icon: MapPin,
      count: locationRows.length,
      hint: locationRows.length
        ? `${assignedNodes} node${assignedNodes === 1 ? "" : "s"} assigned`
        : "Group your nodes",
      prefetch: "/api/v1/admin/locations",
    },
    {
      title: "Nodes",
      description: "Manage daemon machines and their allocations.",
      href: "/admin/nodes",
      icon: Cpu,
      count: nodeRows.length,
      hint: nodeRows.length ? `${onlineNodes} of ${nodeRows.length} online` : "Add a machine",
      prefetch: "/api/v1/admin/nodes",
    },
    {
      title: "Servers",
      description: "Provision and manage game servers.",
      href: "/admin/servers",
      icon: Server,
      count: serverRows.length,
      hint: serverRows.length ? `${running} running` : "Create a server",
      prefetch: "/api/v1/admin/servers",
    },
    {
      title: "Database Hosts",
      description: "Configure MySQL hosts for server databases.",
      href: "/admin/database-hosts",
      icon: Database,
      count: hostRows?.length,
      hint: hostRows && hostRows.length === 0 ? "Add a host" : undefined,
      prefetch: "/api/v1/admin/database-hosts",
    },
    {
      title: "Nests & Eggs",
      description: "Manage server templates and their variables.",
      href: "/admin/nests",
      icon: Box,
      count: nestRows.length,
      hint: nestRows.length ? `${eggCount} egg${eggCount === 1 ? "" : "s"}` : "Import or create eggs",
      prefetch: "/api/v1/admin/nests",
    },
    {
      title: "Extensions",
      description: "Install add-ons that add pages and tools to servers.",
      href: "/admin/extensions",
      icon: Puzzle,
      count: extensionRows?.length,
      hint: !extensionRows
        ? undefined
        : extensionsNeedingReview
          ? `${extensionsNeedingReview} need${extensionsNeedingReview === 1 ? "s" : ""} approval`
          : extensionRows.length
            ? `${enabledExtensions} enabled`
            : "Add your first extension",
      prefetch: "/api/v1/admin/extensions",
    },
    {
      title: "API Keys",
      description: "Issue application keys for billing systems, bots, and scripts.",
      href: "/admin/api-keys",
      icon: KeyRound,
      count: apiKeyRows?.length,
      hint: apiKeyRows && apiKeyRows.length === 0 ? "Create a key" : undefined,
      prefetch: "/api/v1/admin/api-keys",
    },
    {
      title: "Settings",
      description: "Branding, updates, and telemetry.",
      href: "/admin/settings",
      icon: Settings,
    },
    {
      title: "Mail & Sign-in",
      description: "SMTP delivery and single sign-on providers.",
      href: "/admin/settings#mail",
      icon: Mail,
    },
  ];

  if (
    loadError &&
    !loading &&
    !servers.data &&
    !nodes.data &&
    !locations.data &&
    !users.data &&
    !nests.data
  ) {
    return (
      <QueryErrorPage
        error={loadError}
        status={
          servers.errorStatus ??
          nodes.errorStatus ??
          locations.errorStatus ??
          users.errorStatus ??
          nests.errorStatus
        }
        onRetry={() => {
          void servers.reload();
          void nodes.reload();
          void locations.reload();
          void users.reload();
          void nests.reload();
        }}
      />
    );
  }

  if (loading) {
    return <DashboardSkeleton />;
  }

  return (
    <AdminPage title="Overview" description={OVERVIEW_DESCRIPTION}>
      <AdminError message={loadError} />
      <VersionBanner />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {PROJECT_LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className={buttonClass({ variant: "secondary", className: "w-full justify-center" })}
            >
              <Icon className="size-4" />
              {link.label}
            </a>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <SectionCard key={tile.title} tile={tile} />
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Needs attention
          </p>
          {alerts.length ? (
            <ul className="mt-3 space-y-2">
              {alerts.slice(0, 8).map((alert) => (
                <li key={`${alert.href}-${alert.label}`} className="flex min-w-0 items-center gap-2">
                  <span className={cn("size-1.5 shrink-0 rounded-full", alert.dot)} />
                  <Link href={alert.href} className={cn("truncate text-sm hover:underline", alert.tone)}>
                    {alert.label}
                  </Link>
                </li>
              ))}
              {alerts.length > 8 ? (
                <li className="text-xs text-muted-foreground">and {alerts.length - 8} more</li>
              ) : null}
            </ul>
          ) : (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <span className="size-1.5 shrink-0 rounded-full bg-status-running" />
              All nodes are online and no servers need action.
            </p>
          )}
        </Card>

        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Services
          </p>
          {healthError ? (
            <p className="mt-3 text-sm text-destructive">{healthError}</p>
          ) : !health ? (
            <p className="mt-3 text-sm text-muted-foreground">Checking…</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {Object.entries(health.checks).map(([name, check]) => {
                const meta = HEALTH_META[name];
                const label = meta?.label ?? name;
                return (
                  <li key={name} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          check.ok ? "bg-status-running" : "bg-status-error",
                        )}
                      />
                      <span className="truncate">{label}</span>
                      {meta ? <ServiceHint meta={meta} /> : null}
                    </span>
                    <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                      {check.ok
                        ? check.latencyMs != null
                          ? `${check.latencyMs} ms`
                          : "Up"
                        : "Down"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </AdminPage>
  );
}

/** Section tile: icon, title and count on top, description, live hint pinned to the bottom. */
function SectionCard({ tile }: { tile: SectionTile }) {
  const Icon = tile.icon;
  const prefetch = tile.prefetch;
  return (
    <Link
      href={tile.href}
      onMouseEnter={prefetch ? () => prefetchQuery(prefetch) : undefined}
      className="group block h-full"
    >
      <Card className="flex h-full flex-col p-5 transition-colors group-hover:border-primary/40 group-hover:bg-muted/30">
        <div className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2 font-semibold">
            <Icon className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
            <span className="truncate">{tile.title}</span>
          </p>
          {tile.count != null ? (
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
              {tile.count}
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 text-sm text-muted-foreground">{tile.description}</p>
        {tile.hint ? <p className="mt-auto pt-3 text-xs text-muted-foreground/80">{tile.hint}</p> : null}
      </Card>
    </Link>
  );
}

function ServiceHint({
  meta,
}: {
  meta: { label: string; kind: ServiceKind; description: string; href: string };
}) {
  const [opened, setOpened] = useState(false);
  const pinned = useRef(false);
  const leaveTimer = useRef<number>(0);

  const open = () => {
    window.clearTimeout(leaveTimer.current);
    setOpened(true);
  };
  const close = () => {
    pinned.current = false;
    window.clearTimeout(leaveTimer.current);
    setOpened(false);
  };
  const scheduleClose = () => {
    if (pinned.current) return;
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setOpened(false), 160);
  };

  return (
    <Popover
      width={280}
      shadow="none"
      withArrow
      arrowSize={6}
      offset={6}
      position="left"
      opened={opened}
      onChange={(next) => {
        if (!next) close();
        else setOpened(true);
      }}
      classNames={{ dropdown: "flutter-tooltip", arrow: "flutter-tooltip-arrow" }}
    >
      <Popover.Target>
        <button
          type="button"
          className="no-press inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={`About ${meta.label}`}
          aria-expanded={opened}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            window.clearTimeout(leaveTimer.current);
            if (opened && pinned.current) {
              close();
              return;
            }
            pinned.current = true;
            setOpened(true);
          }}
          onMouseEnter={open}
          onMouseLeave={scheduleClose}
        >
          <CircleHelp className="size-3.5" />
        </button>
      </Popover.Target>
      <Popover.Dropdown
        className="!w-[280px] !p-3 !font-normal"
        onMouseEnter={open}
        onMouseLeave={scheduleClose}
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">{meta.label}</p>
            <Badge
              className={
                meta.kind === "ORM"
                  ? "rounded-md"
                  : "rounded-md bg-muted text-muted-foreground"
              }
            >
              {meta.kind}
            </Badge>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{meta.description}</p>
          <a
            href={meta.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Open {new URL(meta.href).hostname.replace(/^www\./, "")}
            <SquareArrowOutUpRight className="size-3" />
          </a>
        </div>
      </Popover.Dropdown>
    </Popover>
  );
}
