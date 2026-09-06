"use client";

import { use, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Field, Input } from "@/components/ui";
import { SaveButton } from "@/components/save-button";
import { useServerRecord } from "@/components/server-frame";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import type { ServerRecord } from "@/lib/types";
import { can } from "@/lib/access";
import { cn } from "@/lib/cn";
import {
  ipFromAddress,
  isPortVariable,
  portFromAddress,
  startupPreviewParts,
  startupUsesVariable,
  unallocatedPorts,
} from "@/lib/startup-preview";

type NetworkAllocation = {
  ip: string;
  port: number;
  primary: boolean;
};

export default function StartupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const framed = useServerRecord();
  const { data, error: loadError, reload } = useQuery<{ data: { server: ServerRecord } }>(
    `/api/v1/client/servers/${id}`,
  );
  const server = data?.data.server ?? framed;
  const canReadNetwork = can(server, "allocation.read");
  const { data: networkData, error: networkError } = useQuery<{ data: { allocations: NetworkAllocation[] } }>(
    canReadNetwork ? `/api/v1/client/servers/${id}/network` : null,
  );
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...(server?.environment ?? {}),
  }));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!server) return;
    setValues({ ...(server.environment ?? {}) });
  }, [id, server?.uuid]);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 2200);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const variables = server?.eggVariables ?? [];
  const allocations = networkData?.data.allocations ?? [];
  const allocatedPorts = useMemo(() => {
    const ports = new Set<number>();
    for (const row of allocations) ports.add(row.port);
    const fromAddress = portFromAddress(server?.allocation);
    if (fromAddress) ports.add(fromAddress);
    return [...ports];
  }, [allocations, server?.allocation]);

  const previewEnv = useMemo(() => {
    const env: Record<string, string> = {};
    for (const variable of variables) {
      env[variable.key] = values[variable.key] ?? variable.default ?? "";
    }
    Object.assign(env, server?.environment ?? {}, values);
    const primary = allocations.find((row) => row.primary) ?? allocations[0];
    const memory = server?.memory.limitMb ?? 0;
    env.SERVER_MEMORY = memory > 0 ? String(memory) : env.SERVER_MEMORY ?? "";
    env.SERVER_IP = primary?.ip || ipFromAddress(server?.allocation) || env.SERVER_IP || "";
    env.SERVER_PORT =
      primary?.port != null
        ? String(primary.port)
        : String(portFromAddress(server?.allocation) ?? env.SERVER_PORT ?? "");
    const extras = allocations.filter((row) => !row.primary);
    extras.forEach((row, index) => {
      env[`SERVER_PORT_${index + 1}`] = String(row.port);
    });
    return env;
  }, [allocations, server?.allocation, server?.environment, server?.memory.limitMb, values, variables]);

  const startupTemplate = server?.startup ?? "";
  const previewParts = useMemo(
    () => startupPreviewParts(startupTemplate, previewEnv),
    [previewEnv, startupTemplate],
  );

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setPending(true);
    const environment = Object.fromEntries(
      variables.map((variable) => [variable.key, values[variable.key] ?? variable.default ?? ""]),
    );
    try {
      const result = await api<{ data: { server: ServerRecord } }>(`/api/v1/client/servers/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ environment }),
      });
      await reload();
      setValues({ ...(result.data.server.environment ?? {}) });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  if (loadError && !server) {
    return <p className="text-sm text-destructive">{loadError}</p>;
  }

  return (
    <form onSubmit={onSave} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Startup</h2>
        <p className="text-sm text-muted-foreground">
          Docker image and startup come from the egg. Environment changes apply the next time the server starts.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Process</p>
        <Field label="Docker image">
          <Input value={server?.dockerImage || "—"} disabled className="font-mono" />
        </Field>
        <div className="space-y-1.5">
          <p className="text-sm">Startup command</p>
          {startupTemplate ? (
            <>
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
                {startupTemplate}
              </p>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Preview
              </p>
              <p className="whitespace-pre-wrap break-all rounded-md border border-border bg-background px-3 py-2 font-mono text-sm">
                {previewParts.map((part, index) =>
                  part.kind === "text" ? (
                    <span key={index}>{part.text}</span>
                  ) : (
                    <span
                      key={index}
                      title={part.key}
                      className={cn(part.missing ? "text-status-warn" : "text-primary")}
                    >
                      {part.value}
                    </span>
                  ),
                )}
              </p>
            </>
          ) : (
            <Input value="(image entrypoint)" disabled className="font-mono" />
          )}
        </div>
        <Field label="Stop command">
          <Input value={server?.stopCommand || "stop"} disabled className="font-mono" />
        </Field>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Environment
        </p>
        {variables.length === 0 ? (
          <p className="text-sm text-muted-foreground">This egg has no variables.</p>
        ) : (
          variables.map((variable) => {
            const value = values[variable.key] ?? "";
            const inStartup = startupUsesVariable(startupTemplate, variable.key);
            const networkReady = !canReadNetwork || networkData !== undefined || Boolean(networkError);
            const portWarn =
              networkReady &&
              isPortVariable(variable.key, variable.description) &&
              unallocatedPorts(value, allocatedPorts).length > 0;
            return (
              <label key={variable.key} className="block space-y-1.5">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-sm font-medium">{variable.key}</span>
                  {inStartup ? (
                    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      In startup
                    </span>
                  ) : null}
                </span>
                {variable.description ? (
                  <span className="block text-sm text-muted-foreground">{variable.description}</span>
                ) : null}
                <Input
                  value={value}
                  onChange={(event) => {
                    setSaved(false);
                    setValues((current) => ({ ...current, [variable.key]: event.target.value }));
                  }}
                  className="font-mono"
                  disabled={!can(server, "startup.update")}
                  placeholder={variable.default || undefined}
                />
                {portWarn ? (
                  <span className="block text-xs font-medium text-status-warn">
                    This port isn’t allocated.
                    {canReadNetwork ? (
                      <>
                        {" "}
                        <Link href={`/server/${id}/network`} className="underline underline-offset-2">
                          Network
                        </Link>
                      </>
                    ) : null}
                  </span>
                ) : null}
              </label>
            );
          })
        )}
      </div>

      <div className="flex items-center gap-3">
        <SaveButton pending={pending} saved={saved} disabled={variables.length === 0 || !can(server, "startup.update")}>
          Save environment
        </SaveButton>
      </div>
    </form>
  );
}