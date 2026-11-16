"use client";

import { useState, type ComponentType } from "react";
import { Laptop, Monitor, Smartphone, Tablet } from "lucide-react";
import { Button, EmptyState, Rack, RackRow } from "@/components/ui";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import { SettingsSection } from "../settings-nav";
import type { DeviceKind, DeviceSummary } from "@flutter-software/shared";

type SessionRow = {
  id: string;
  current: boolean;
  ip: string | null;
  userAgent: string | null;
  device?: DeviceSummary;
  createdAt: string;
  expiresAt: string;
};

const KIND_ICON: Record<DeviceKind, ComponentType<{ className?: string }>> = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
  unknown: Laptop,
};

/** Session rack columns on wide screens: device, IP, signed in, action. */
const SESSION_COLUMNS =
  "md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1.1fr)_6.5rem] md:items-center md:gap-4";

function sessionTitle(row: SessionRow) {
  return row.device?.label || "Unknown device";
}

function sessionIp(ip: string | null) {
  if (!ip) return "IP unknown";
  if (ip === "127.0.0.1") return "Local network";
  return ip;
}

export default function AccountSessionsPage() {
  const { data, error, reload } = useQuery<{ data: { sessions: SessionRow[] } }>(
    "/api/v1/auth/sessions",
  );
  const sessions = data?.data.sessions ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function revoke(id: string) {
    setActionError(null);
    setBusyId(id);
    try {
      await api(`/api/v1/auth/sessions/${id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That session couldn't be signed out. Reload the page and try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SettingsSection
      title="Sessions"
      description="Browsers and devices signed in to your account. Sign one out if you don't recognise it."
    >
      <div className="space-y-3">
        {error || actionError ? (
          <p role="alert" className="text-sm text-status-error">
            {actionError ?? error}
          </p>
        ) : null}
        {!data && !error ? (
          <p className="text-sm text-muted-foreground">Loading sessions…</p>
        ) : sessions.length ? (
          <div>
            <div
              aria-hidden
              className={cn("hidden px-4 pb-2 text-[12px] text-muted-foreground", SESSION_COLUMNS)}
            >
              <span className="pl-7">Device</span>
              <span>IP address</span>
              <span>Signed in</span>
              <span />
            </div>
            <Rack label="Sessions">
              {sessions.map((row) => {
                const Icon = KIND_ICON[row.device?.kind ?? "unknown"];
                const extraOs =
                  row.device?.os && !sessionTitle(row).includes(row.device.os) ? row.device.os : null;
                return (
                  <RackRow key={row.id} className={cn("flex-wrap gap-y-1", !row.current && "max-md:pr-28", SESSION_COLUMNS)}>
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                          <span className="truncate">{sessionTitle(row)}</span>
                          {row.current ? (
                            <span className="text-[12px] font-medium text-primary">This device</span>
                          ) : null}
                        </p>
                        {extraOs ? <p className="text-[13px] text-muted-foreground">{extraOs}</p> : null}
                      </div>
                    </div>
                    <p className="w-full pl-7 text-[13px] text-muted-foreground md:w-auto md:pl-0">
                      <span className="md:hidden">IP address </span>
                      <span className={row.ip && row.ip !== "127.0.0.1" ? "font-mono text-[12.5px]" : undefined}>
                        {sessionIp(row.ip)}
                      </span>
                    </p>
                    <p className="w-full pl-7 text-[13px] text-muted-foreground md:w-auto md:pl-0">
                      <span className="md:hidden">Signed in </span>
                      <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>
                    </p>
                    <div className="flex justify-end max-md:absolute max-md:right-3 max-md:top-2.5">
                      {row.current ? null : (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={busyId === row.id}
                          onClick={() => void revoke(row.id)}
                        >
                          {busyId === row.id ? "Signing out…" : "Sign out"}
                        </Button>
                      )}
                    </div>
                  </RackRow>
                );
              })}
            </Rack>
          </div>
        ) : (
          <EmptyState
            title="No active sessions"
            description="Each browser or device you sign in from is listed here until it signs out or expires."
          />
        )}
      </div>
    </SettingsSection>
  );
}
