"use client";

import { use, useEffect, useState, type FormEvent } from "react";
import { Field, Input } from "@/components/ui";
import { SaveButton } from "@/components/save-button";
import { useServerRecord } from "@/components/server-frame";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import type { ServerRecord } from "@/lib/types";
import { can } from "@/lib/access";

export default function StartupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const framed = useServerRecord();
  const { data, error: loadError, reload } = useQuery<{ data: { server: ServerRecord } }>(
    `/api/v1/client/servers/${id}`,
  );
  const server = data?.data.server ?? framed;
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
        <Field label="Startup command">
          <Input value={server?.startup || "(image entrypoint)"} disabled className="font-mono" />
        </Field>
        <Field label="Stop command">
          <Input value={server?.stopCommand || "stop"} disabled className="font-mono" />
        </Field>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Environment
        </p>
        {variables.length === 0 ? (
          <p className="text-sm text-muted-foreground">This egg has no variables.</p>
        ) : (
          variables.map((variable) => (
            <Field key={variable.key} label={variable.key} hint={variable.description || undefined}>
              <Input
                value={values[variable.key] ?? ""}
                onChange={(event) => {
                  setSaved(false);
                  setValues((current) => ({ ...current, [variable.key]: event.target.value }));
                }}
                className="font-mono"
                disabled={!can(server, "startup.update")}
              />
            </Field>
          ))
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
