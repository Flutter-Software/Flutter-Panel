"use client";

import { useState, type ComponentType } from "react";
import { Laptop, Monitor, Smartphone, Tablet } from "lucide-react";
import { Button, Card } from "@/components/ui";
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
      setActionError(err instanceof Error ? err.message : "Could not revoke session");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SettingsSection title="Sessions" description="Devices that are signed in to this account.">
      {error || actionError ? (
        <p className="text-sm text-destructive">{actionError ?? error}</p>
      ) : null}
      <Card className="divide-y divide-border overflow-hidden">
        {sessions.length ? (
          sessions.map((row) => {
            const Icon = KIND_ICON[row.device?.kind ?? "unknown"];
            const extraOs =
              row.device?.os && !sessionTitle(row).includes(row.device.os) ? row.device.os : null;
            const detail = [extraOs, sessionIp(row.ip)].filter(Boolean).join(" · ");
            return (
              <div key={row.id} className="flex items-start justify-between gap-4 px-5 py-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {sessionTitle(row)}
                      {row.current ? (
                        <span className="ml-2 rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                          this device
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {detail} · signed in {new Date(row.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                {row.current ? null : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busyId === row.id}
                    onClick={() => void revoke(row.id)}
                  >
                    {busyId === row.id ? "Revoking…" : "Revoke"}
                  </Button>
                )}
              </div>
            );
          })
        ) : (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">No active sessions.</p>
        )}
      </Card>
    </SettingsSection>
  );
}
