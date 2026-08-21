"use client";

import Link from "next/link";
import { Card } from "@/components/ui";
import { useQuery } from "@/lib/query";
import type { ServerRecord } from "@/lib/types";
import type { PublicUser } from "@flutter-software/shared";

type Health = {
  ok: boolean;
  checks: Record<string, { ok: boolean }>;
};

export default function AdminDashboardPage() {
  const users = useQuery<{ data: { users: PublicUser[] } }>("/api/v1/admin/users");
  const locations = useQuery<{ data: { locations: unknown[] } }>("/api/v1/admin/locations");
  const nodes = useQuery<{ data: { nodes: unknown[] } }>("/api/v1/admin/nodes");
  const servers = useQuery<{ data: { servers: ServerRecord[] } }>("/api/v1/admin/servers");
  const health = useQuery<Health>("/api/v1/health");

  const stats = [
    { label: "Servers", value: servers.data?.data.servers.length ?? 0, href: "/admin/servers" },
    { label: "Nodes", value: nodes.data?.data.nodes.length ?? 0, href: "/admin/nodes" },
    { label: "Locations", value: locations.data?.data.locations.length ?? 0, href: "/admin/locations" },
    { label: "Users", value: users.data?.data.users.length ?? 0, href: "/admin/users" },
  ];
  const serverRows = servers.data?.data.servers ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Control plane overview. Locations, nodes, eggs, and servers persist in MongoDB.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="p-4 transition-colors hover:border-primary/40">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {stat.label}
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{stat.value}</p>
            </Card>
          </Link>
        ))}
      </div>
      <Card className="p-4">
        <p className="text-sm font-semibold">API health</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {health.data
            ? health.data.ok
              ? "MongoDB is up."
              : `Degraded: ${Object.entries(health.data.checks)
                  .filter(([, check]) => !check.ok)
                  .map(([name]) => name)
                  .join(", ") || "unreachable"}`
            : health.error
              ? "Unreachable"
              : "\u00a0"}
        </p>
      </Card>
      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-3 text-sm font-semibold">Servers</div>
        {!servers.data && !servers.error ? (
          <div className="h-24 animate-pulse bg-muted/40" />
        ) : serverRows.length === 0 ? (
          <p className="px-4 py-8 text-sm text-muted-foreground">No servers yet. Create one under Admin → Servers.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {serverRows.map((server) => (
                <tr key={server.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{server.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{server.node}</td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{server.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
