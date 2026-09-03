"use client";

import { useEffect, useMemo, useState } from "react";
import { LayoutGrid, Table2 } from "lucide-react";
import { ServerCard, ServerTable } from "@/components/server-card";
import { ListSkeleton } from "@/components/admin-table";
import { QueryErrorPage } from "@/components/error-page";
import { Badge, Button, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import type { ServerRecord } from "@/lib/types";
import { cn } from "@/lib/cn";

export default function DashboardPage() {
  const [tab, setTab] = useState<"my" | "other">("my");
  const [layout, setLayout] = useState<"grid" | "table">("grid");
  const [query, setQuery] = useState("");
  const { data, error, errorStatus, reload } = useQuery<{ data: { servers: ServerRecord[] } }>(
    "/api/v1/client/servers",
  );
  const servers = data?.data.servers ?? [];

  useEffect(() => {
    const timer = window.setInterval(() => {
      void reload();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [reload]);

  async function onPower(id: string, action: "start" | "stop" | "restart" | "kill") {
    try {
      await api(`/api/v1/client/servers/${id}/power`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      await reload();
    } catch {
      await reload();
    }
  }

  const mine = servers.filter((server) => server.owner);
  const other = servers.filter((server) => !server.owner);
  const source = tab === "my" ? mine : other;
  const filtered = useMemo(
    () =>
      source.filter((server) =>
        `${server.name} ${server.egg} ${server.allocation}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [query, source],
  );

  if (error && !data) {
    return (
      <QueryErrorPage
        error={error}
        status={errorStatus}
        onRetry={() => void reload()}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Servers you own and servers shared with you.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          <Button
            size="sm"
            variant={layout === "grid" ? "secondary" : "ghost"}
            className="px-2"
            onClick={() => setLayout("grid")}
            aria-label="Grid layout"
          >
            <LayoutGrid className="size-4" />
          </Button>
          <Button
            size="sm"
            variant={layout === "table" ? "secondary" : "ghost"}
            className="px-2"
            onClick={() => setLayout("table")}
            aria-label="Table layout"
          >
            <Table2 className="size-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm",
            tab === "my" ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60",
          )}
          onClick={() => setTab("my")}
        >
          My servers
          <Badge className="rounded-sm">{mine.length}</Badge>
        </button>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm",
            tab === "other" ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60",
          )}
          onClick={() => setTab("other")}
        >
          Shared with Me
          <Badge className="rounded-sm bg-muted text-muted-foreground">{other.length}</Badge>
        </button>
        <div className="ml-auto w-full sm:w-64">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter servers"
          />
        </div>
      </div>

      {!data ? (
        <ListSkeleton rows={2} />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-6 py-16 text-center">
          <p className="font-semibold">
            {tab === "my"
              ? "You don't own any servers!"
              : "When someone shares a server with you, it shows up here."}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a node, add allocations, then create a server in Admin.
          </p>
        </div>
      ) : layout === "grid" ? (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((server) => (
            <ServerCard key={server.id} server={server} onPower={onPower} />
          ))}
        </div>
      ) : (
        <ServerTable servers={filtered} />
      )}
    </div>
  );
}
