"use client";

import { useEffect, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useTheme } from "next-themes";
import { Save } from "lucide-react";
import { AdminError } from "@/components/admin-table";
import { useAdminNode } from "@/components/node-frame";
import { Button, Card } from "@/components/ui";
import { api } from "@/lib/api";

export default function NodeConfigurationPage() {
  const { resolvedTheme } = useTheme();
  const { node } = useAdminNode();
  const [path, setPath] = useState("data/config.json");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const dark = resolvedTheme !== "light";

  useEffect(() => {
    if (!node) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<{ data: { path: string; content: string } }>(`/api/v1/admin/nodes/${node.id}/config`)
      .then((result) => {
        if (cancelled) return;
        setPath(result.data.path);
        setContent(result.data.content);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load daemon config");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [node?.id, node?.online]);

  async function onSave() {
    if (!node) return;
    setError(null);
    setPending(true);
    try {
      JSON.parse(content);
      await api(`/api/v1/admin/nodes/${node.id}/config`, {
        method: "PUT",
        body: JSON.stringify({ content }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save daemon config");
    } finally {
      setPending(false);
    }
  }

  const onMount: OnMount = (_editor, monaco) => {
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: false,
    });
  };

  if (!node) return null;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Daemon config</h2>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">{path}</p>
        </div>
        <Button type="button" size="sm" disabled={pending || loading || !node.online} onClick={() => void onSave()}>
          <Save className="size-3.5" />
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <div className="px-4 py-3">
        <AdminError message={error} />
        <p className="mb-3 text-xs text-muted-foreground">
          Edits write the daemon&apos;s config.json on this machine. Restart the daemon after changing listen
          port, host, or token.
        </p>
      </div>
      <div className="h-[min(70vh,40rem)] border-t border-border bg-background">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading config…
          </div>
        ) : (
          <Editor
            height="100%"
            language="json"
            value={content}
            theme={dark ? "vs-dark" : "light"}
            onChange={(value) => setContent(value ?? "")}
            onMount={onMount}
            options={{
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              lineHeight: 20,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              padding: { top: 12, bottom: 12 },
              wordWrap: "on",
              readOnly: !node.online,
            }}
          />
        )}
      </div>
    </Card>
  );
}
