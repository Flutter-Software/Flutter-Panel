"use client";

import { useMemo, useState } from "react";
import { ServerCard, ServerRackHeader, serverAttention } from "@/components/server-card";
import { QueryErrorPage } from "@/components/error-page";
import { HomeServersSkeleton } from "@/components/skeletons";
import { EmptyState, Input, Rack } from "@/components/ui";
import { useQuery } from "@/lib/query";
import { useLiveReload } from "@/components/panel-socket";
import type { ServerRecord } from "@/lib/types";
import { cn } from "@/lib/cn";

export default function HomePage({ skeletonCount }: { skeletonCount?: number }) {
  const [tab, setTab] = useState<"my" | "other">("my");
  const [query, setQuery] = useState("");
  const { data, error, errorStatus, reload } = useQuery<{ data: { servers: ServerRecord[] } }>(
    "/api/v1/client/servers",
  );
  const servers = data?.data.servers ?? [];
  useLiveReload(reload, 3000);

  const mine = servers.filter((server) => server.owner);
  const other = servers.filter((server) => !server.owner);
  const source = tab === "my" ? mine : other;
  const filtered = useMemo(() => {
    const needle = query.toLowerCase();
    return source
      .filter((server) =>
        `${server.name} ${server.egg} ${server.allocation}`.toLowerCase().includes(needle),
      )
      .sort((a, b) => serverAttention(b) - serverAttention(a) || a.name.localeCompare(b.name));
  }, [query, source]);

  if (error && !data) {
    return (
      <QueryErrorPage
        error={error}
        status={errorStatus}
        onRetry={() => void reload()}
      />
    );
  }

  if (!data) {
    return <HomeServersSkeleton count={skeletonCount} />;
  }

  const running = source.filter((server) => server.status === "running").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h1 className="text-[31px] font-semibold">Servers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {source.length === 0
              ? "Nothing here yet."
              : `${running} of ${source.length} running. Servers that need attention are listed first.`}
          </p>
        </div>
        <div className="w-full sm:w-64">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by name, game or address"
            aria-label="Filter servers"
          />
        </div>
      </div>

      {/* Tabs sit on the rack's top seam, like labels on a drawer. */}
      <div role="tablist" aria-label="Which servers" className="flex gap-6 border-b border-border">
        {(
          [
            ["my", "My servers", mine.length],
            ["other", "Shared with me", other.length],
          ] as const
        ).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={cn(
              "no-press -mb-px inline-flex items-center gap-2 border-b-2 pb-2 text-sm",
              tab === value
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setTab(value)}
          >
            {label}
            <span className="tabular-nums text-muted-foreground">{count}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        query ? (
          <EmptyState title={`No servers match “${query}”`} description="Check the spelling, or clear the filter to see every server." />
        ) : tab === "my" ? (
          <EmptyState
            title="You don't have any servers yet"
            description="An admin creates servers in Admin → Servers. Once one is assigned to you, it appears here."
          />
        ) : (
          <EmptyState
            title="Nobody has shared a server with you"
            description="When a server owner adds you as a user, their server appears here."
          />
        )
      ) : (
        <div>
          <ServerRackHeader />
          <Rack label="Servers">
            {filtered.map((server) => (
              <ServerCard key={server.id} server={server} />
            ))}
          </Rack>
        </div>
      )}
    </div>
  );
}
