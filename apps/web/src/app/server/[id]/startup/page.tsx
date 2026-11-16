"use client";

import { use, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Card, EmptyState, Field, Input, Rack } from "@/components/ui";
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

  const canEdit = can(server, "startup.update");

  return (
    <form onSubmit={onSave} className="space-y-6">
      <div>
        <h2 className="text-[20px] font-semibold">Startup</h2>
        <p className="text-sm text-muted-foreground">
          The Docker image and startup command come from the egg. Variable changes apply the next time the server
          starts.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card className="max-w-[72ch] space-y-3 p-4">
        <h3 className="text-[16px] font-semibold">Process</h3>
        <Field label="Docker image">
          <Input value={server?.dockerImage || "None"} disabled className="font-mono" />
        </Field>
        <div className="space-y-1.5">
          <p className="text-sm">Startup command</p>
          {startupTemplate ? (
            <>
              <p className="break-all rounded-md border border-border bg-well px-3 py-2 font-mono text-[12.5px] text-muted-foreground">
                {startupTemplate}
              </p>
              <p className="pt-1 text-[13px] text-muted-foreground">With this server&apos;s values</p>
              <p className="whitespace-pre-wrap break-all rounded-md border border-border bg-well px-3 py-2 font-mono text-[13px]">
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
      </Card>

      <section className="space-y-3">
        <div>
          <h3 className="text-[16px] font-semibold">Variables</h3>
          <p className="text-sm text-muted-foreground">Environment variables the egg passes to the server.</p>
        </div>
        {variables.length === 0 ? (
          <EmptyState title="No variables" description="This egg doesn't define any startup variables." />
        ) : (
          <Rack label="Variables">
            {variables.map((variable) => {
              const value = values[variable.key] ?? "";
              const inStartup = startupUsesVariable(startupTemplate, variable.key);
              const networkReady = !canReadNetwork || networkData !== undefined || Boolean(networkError);
              const portWarn =
                networkReady &&
                isPortVariable(variable.key, variable.description) &&
                unallocatedPorts(value, allocatedPorts).length > 0;
              const inputId = `startup-var-${variable.key}`;
              return (
                <div
                  key={variable.key}
                  role="listitem"
                  className="grid gap-2 px-4 py-3.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-6"
                >
                  <div className="min-w-0">
                    <label htmlFor={inputId} className="flex flex-wrap items-baseline gap-x-3">
                      <span className="break-all font-mono text-[13px] font-medium">{variable.key}</span>
                      {inStartup ? <span className="text-[12px] text-muted-foreground">Used in startup</span> : null}
                    </label>
                    {variable.description ? (
                      <p className="mt-0.5 text-[13px] text-muted-foreground">{variable.description}</p>
                    ) : null}
                  </div>
                  <div className="min-w-0 space-y-1 md:self-center">
                    <Input
                      id={inputId}
                      value={value}
                      onChange={(event) => {
                        setSaved(false);
                        setValues((current) => ({ ...current, [variable.key]: event.target.value }));
                      }}
                      className="font-mono"
                      disabled={!canEdit}
                      placeholder={variable.default || undefined}
                    />
                    {portWarn ? (
                      <p className="text-[13px] font-medium text-status-warn">
                        This port isn&apos;t allocated to the server.
                        {canReadNetwork ? (
                          <>
                            {" "}
                            <Link href={`/server/${id}/network`} className="underline underline-offset-2">
                              Check Network
                            </Link>
                          </>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </Rack>
        )}
      </section>

      <div className="flex items-center gap-3">
        <SaveButton pending={pending} saved={saved} disabled={variables.length === 0 || !canEdit}>
          Save variables
        </SaveButton>
      </div>
    </form>
  );
}
