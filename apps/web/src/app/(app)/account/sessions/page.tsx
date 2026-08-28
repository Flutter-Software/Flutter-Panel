"use client";

import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import { SettingsSection } from "../settings-nav";

type SessionRow = {
  id: string;
  current: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
};

function deviceLabel(userAgent: string | null) {
  if (!userAgent) return "Unknown device";
  if (/Edg\//i.test(userAgent)) return "Microsoft Edge";
  if (/Chrome\//i.test(userAgent) && !/Chromium/i.test(userAgent)) return "Chrome";
  if (/Firefox\//i.test(userAgent)) return "Firefox";
  if (/Safari\//i.test(userAgent) && !/Chrome/i.test(userAgent)) return "Safari";
  return userAgent.slice(0, 72);
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
          sessions.map((row) => (
            <div key={row.id} className="flex items-start justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {deviceLabel(row.userAgent)}
                  {row.current ? (
                    <span className="ml-2 rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                      this device
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.ip || "IP unknown"} · signed in {new Date(row.createdAt).toLocaleString()}
                </p>
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
          ))
        ) : (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">No active sessions.</p>
        )}
      </Card>
    </SettingsSection>
  );
}
