"use client";

import { Suspense, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FileJson, Upload } from "lucide-react";
import { AdminError, AdminFormPage, ListSkeleton } from "@/components/admin-table";
import { AdminCreateFooter, AdminCreateHeader, AdminSection } from "@/components/admin-create";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";

type NestOption = { id: string; name: string };

function previewFromJson(raw: unknown): { name: string; image: string; variables: number } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const egg =
    record.egg && typeof record.egg === "object" && !Array.isArray(record.egg)
      ? (record.egg as Record<string, unknown>)
      : record;
  const name = typeof egg.name === "string" ? egg.name : "";
  let image = "";
  if (typeof egg.docker_image === "string") image = egg.docker_image;
  else if (typeof egg.image === "string") image = egg.image;
  else if (egg.docker_images && typeof egg.docker_images === "object" && !Array.isArray(egg.docker_images)) {
    const first = Object.values(egg.docker_images as Record<string, unknown>).find(
      (value) => typeof value === "string" && value,
    );
    if (typeof first === "string") image = first;
  }
  const variables = Array.isArray(egg.variables) ? egg.variables.length : 0;
  if (!name && !image) return null;
  return { name: name || "Imported egg", image, variables };
}

function ImportEggInner() {
  const router = useRouter();
  const search = useSearchParams();
  const { data, error: loadError } = useQuery<{ data: { nests: NestOption[] } }>("/api/v1/admin/nests");
  const nests = data?.data.nests ?? [];
  const [nestId, setNestId] = useState(search.get("nestId") ?? "");
  const [jsonText, setJsonText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const resolvedNestId = nestId || nests[0]?.id || "";

  const parsed = useMemo(() => {
    const trimmed = jsonText.trim();
    if (!trimmed) return { egg: null as unknown, preview: null as ReturnType<typeof previewFromJson>, parseError: null as string | null };
    try {
      const value = JSON.parse(trimmed) as unknown;
      if (Array.isArray(value)) {
        return { egg: null, preview: null, parseError: "Paste a single egg JSON object, not an array." };
      }
      if (!value || typeof value !== "object") {
        return { egg: null, preview: null, parseError: "Egg JSON must be an object." };
      }
      return { egg: value, preview: previewFromJson(value), parseError: null };
    } catch {
      return { egg: null, preview: null, parseError: "JSON is not valid yet." };
    }
  }, [jsonText]);

  const selectedNest = nests.find((nest) => nest.id === resolvedNestId);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setJsonText(await file.text());
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (parsed.parseError || !parsed.egg) {
      setError(parsed.parseError || "Paste or upload a Pterodactyl / Pelican egg JSON file.");
      return;
    }
    setPending(true);
    try {
      await api("/api/v1/admin/eggs/import", {
        method: "POST",
        body: JSON.stringify({ nestId: resolvedNestId, egg: parsed.egg }),
      });
      router.push("/admin/nests");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-6">
      <AdminCreateHeader
        backHref="/admin/nests"
        backLabel="Back to nests"
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/nests", label: "Nests" },
          { label: "Import egg" },
        ]}
        icon={<Upload className="size-4" />}
        title="Import egg"
        description="Paste or upload a Pterodactyl (PTDL) or Pelican egg JSON. Docker image, startup, install script, and variables are mapped automatically."
      />
      <AdminError message={error ?? loadError} />

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <AdminSection
          icon={<Upload className="size-4" />}
          title="Destination"
          description="Imported eggs are added to a nest. You can edit them afterwards."
        >
          <Field label="Nest" required>
            <Select value={resolvedNestId} onChange={(event) => setNestId(event.target.value)} required>
              <option value="">Select nest</option>
              {nests.map((nest) => (
                <option key={nest.id} value={nest.id}>
                  {nest.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Egg JSON file"
            hint="Optional. Choose a .json export, or paste the contents on the right."
          >
            <Input
              type="file"
              accept="application/json,.json"
              onChange={(event) => onFile(event.target.files?.[0])}
            />
          </Field>
          {fileName ? <p className="text-xs text-muted-foreground">Loaded {fileName}</p> : null}
          {parsed.preview ? (
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-sm">
              <p className="font-medium">{parsed.preview.name}</p>
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                {parsed.preview.image || "No docker image detected"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {parsed.preview.variables} variable{parsed.preview.variables === 1 ? "" : "s"}
              </p>
            </div>
          ) : parsed.parseError && jsonText.trim() ? (
            <p className="text-sm text-destructive">{parsed.parseError}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Supports PTDL_v1, PTDL_v2, and Pelican egg exports.
            </p>
          )}
        </AdminSection>

        <AdminSection
          icon={<FileJson className="size-4" />}
          title="Egg JSON"
          description="The exported egg object from Pterodactyl or Pelican."
        >
          <Field label="JSON" required>
            <Textarea
              value={jsonText}
              onChange={(event) => setJsonText(event.target.value)}
              placeholder='{ "meta": { "version": "PTDL_v2" }, "name": "Vanilla Minecraft", ... }'
              className="min-h-[320px] font-mono text-xs"
            />
          </Field>
        </AdminSection>
      </div>

      <AdminCreateFooter
        cancelHref="/admin/nests"
        submitLabel="Import egg"
        pendingLabel="Importing…"
        pending={pending}
        disabled={!resolvedNestId || !parsed.egg || Boolean(parsed.parseError)}
        summary={
          <span className="inline-flex items-center gap-2">
            <Upload className="size-4 text-primary" />
            Importing {parsed.preview?.name ?? "egg"}
            {selectedNest ? (
              <>
                {" "}
                into <span className="font-medium text-foreground">{selectedNest.name}</span>
              </>
            ) : null}
          </span>
        }
      />
    </form>
  );
}

export default function ImportEggPage() {
  return (
    <Suspense
      fallback={
        <AdminFormPage
          title="Import egg"
          description="Paste a Pterodactyl or Pelican egg JSON file."
          backHref="/admin/nests"
          backLabel="Nests"
        >
          <ListSkeleton rows={2} />
        </AdminFormPage>
      }
    >
      <ImportEggInner />
    </Suspense>
  );
}
