"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Box, FileJson, Plus, Terminal, Trash2, Upload, Variable } from "lucide-react";
import { AdminError } from "@/components/admin-table";
import { AdminCreateHeader, AdminSection, SaveIsland, Segmented, isDirty } from "@/components/admin-create";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";
import { parseEggJson } from "./egg-json";

export type EggVariable = {
  key: string;
  default: string;
  description: string;
};

export type EggRecord = {
  id: string;
  nestId: string;
  name: string;
  description: string;
  dockerImage: string;
  startup: string;
  stopCommand: string;
  installScript: string;
  installImage: string;
  variables: EggVariable[];
  serverCount?: number;
};

type NestOption = { id: string; name: string };

const emptyVariable = (): EggVariable => ({ key: "", default: "", description: "" });

export function EggForm({
  mode,
  initial,
  defaultNestId,
}: {
  mode: "create" | "edit";
  initial?: EggRecord;
  defaultNestId?: string;
}) {
  const router = useRouter();
  const creating = mode === "create";
  const { data: nestData, error: nestError } = useQuery<{ data: { nests: NestOption[] } }>(
    "/api/v1/admin/nests",
  );
  const nests = nestData?.data.nests ?? [];
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [nestId, setNestId] = useState(initial?.nestId ?? defaultNestId ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [dockerImage, setDockerImage] = useState(initial?.dockerImage ?? "");
  const [startup, setStartup] = useState(initial?.startup ?? "");
  const [stopCommand, setStopCommand] = useState(initial?.stopCommand || "stop");
  const [installImage, setInstallImage] = useState(initial?.installImage || "alpine:3.20");
  const [installScript, setInstallScript] = useState(initial?.installScript ?? "");
  const [variables, setVariables] = useState<EggVariable[]>(
    initial?.variables?.length ? initial.variables : [],
  );
  const [source, setSource] = useState<"manual" | "import">("manual");
  const [jsonText, setJsonText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const dirty = isDirty(
    {
      nestId,
      name,
      description,
      dockerImage,
      startup,
      stopCommand,
      installImage,
      installScript,
      variables,
      source,
      jsonText,
    },
    {
      nestId: initial?.nestId ?? defaultNestId ?? "",
      name: initial?.name ?? "",
      description: initial?.description ?? "",
      dockerImage: initial?.dockerImage ?? "",
      startup: initial?.startup ?? "",
      stopCommand: initial?.stopCommand || "stop",
      installImage: initial?.installImage || "alpine:3.20",
      installScript: initial?.installScript ?? "",
      variables: initial?.variables?.length ? initial.variables : [],
      source: "manual",
      jsonText: "",
    },
  );

  const selectedNest = nests.find((nest) => nest.id === (nestId || nests[0]?.id));
  const resolvedNestId = nestId || nests[0]?.id || "";
  const importing = creating && source === "import";
  const parsed = useMemo(() => parseEggJson(jsonText), [jsonText]);
  const ready = importing
    ? Boolean(resolvedNestId && parsed.egg && !parsed.parseError)
    : Boolean(resolvedNestId && name.trim() && dockerImage.trim());
  const serverCount = initial?.serverCount ?? 0;

  function onCancel() {
    setNestId(initial?.nestId ?? defaultNestId ?? "");
    setName(initial?.name ?? "");
    setDescription(initial?.description ?? "");
    setDockerImage(initial?.dockerImage ?? "");
    setStartup(initial?.startup ?? "");
    setStopCommand(initial?.stopCommand || "stop");
    setInstallImage(initial?.installImage || "alpine:3.20");
    setInstallScript(initial?.installScript ?? "");
    setVariables((initial?.variables?.length ? initial.variables : []).map((row) => ({ ...row })));
    setSource("manual");
    setJsonText("");
    setFileName(null);
    setError(null);
  }

  function setVariable(index: number, patch: Partial<EggVariable>) {
    setVariables((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function parsedVariables() {
    return variables
      .map((row) => ({
        key: row.key.trim().toUpperCase(),
        default: row.default,
        description: row.description,
      }))
      .filter((row) => row.key);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setJsonText(await file.text());
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (importing) {
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
      return;
    }
    setPending(true);
    const nextVariables = parsedVariables();
    const invalid = nextVariables.find((row) => !/^[A-Z][A-Z0-9_]*$/.test(row.key));
    if (invalid) {
      setError(
        `Invalid variable key "${invalid.key}". Use A–Z, digits, and underscore, starting with a letter.`,
      );
      setPending(false);
      return;
    }
    const body = {
      nestId: resolvedNestId,
      name: name.trim(),
      description,
      dockerImage: dockerImage.trim(),
      startup,
      stopCommand: stopCommand.trim() || "stop",
      installScript,
      installImage: installImage.trim() || "alpine:3.20",
      variables: nextVariables,
    };
    try {
      if (creating) {
        await api("/api/v1/admin/eggs", {
          method: "POST",
          body: JSON.stringify(body),
        });
      } else if (initial) {
        await api(`/api/v1/admin/eggs/${initial.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      router.push("/admin/nests");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : creating ? "Create failed" : "Save failed");
      setPending(false);
    }
  }

  async function onDelete() {
    if (!initial) return;
    if (!window.confirm(`Delete egg ${initial.name}? This cannot be undone.`)) return;
    setError(null);
    setDeleting(true);
    try {
      await api(`/api/v1/admin/eggs/${initial.id}`, { method: "DELETE" });
      router.push("/admin/nests");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
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
          { label: creating ? "New egg" : initial?.name ?? "Edit egg" },
        ]}
        icon={<Box className="size-4" />}
        title={creating ? (importing ? "Import egg" : "New egg") : `Edit ${initial?.name ?? "egg"}`}
        description={
          creating && importing
            ? "Paste or upload a Pterodactyl (PTDL) or Pelican egg JSON. Docker image, startup, install script, and variables are mapped automatically."
            : "An egg defines the Docker image, install script, startup, and environment for a server type."
        }
      />
      {creating ? (
        <Segmented
          value={source}
          onChange={setSource}
          options={[
            { value: "manual", label: "Create", icon: <Box className="size-3.5" /> },
            { value: "import", label: "Import", icon: <Upload className="size-3.5" /> },
          ]}
        />
      ) : null}
      <AdminError message={error ?? nestError} />

      {importing ? (
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
                onChange={(event) => void onFile(event.target.files?.[0])}
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
            <Field label="JSON">
              <Textarea
                value={jsonText}
                onChange={(event) => setJsonText(event.target.value)}
                placeholder='{ "meta": { "version": "PTDL_v2" }, "name": "Vanilla Minecraft", ... }'
                className="min-h-[320px] font-mono text-xs"
              />
            </Field>
          </AdminSection>
        </div>
      ) : (
        <>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <AdminSection
          icon={<Box className="size-4" />}
          title="Egg details"
          description="Which nest this belongs to and the image servers run."
        >
          <Field label="Nest" required hint="Eggs can be moved between nests later.">
            <Select value={resolvedNestId} onChange={(event) => setNestId(event.target.value)} required>
              <option value="">Select nest</option>
              {nests.map((nest) => (
                <option key={nest.id} value={nest.id}>
                  {nest.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Name" required hint="Shown when creating servers.">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Vanilla"
              required
              maxLength={64}
            />
          </Field>
          <Field label="Description" hint="Optional. Keep it short.">
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Minecraft Java Edition vanilla."
              maxLength={240}
              className="min-h-[72px]"
            />
          </Field>
          <Field label="Docker image" required hint="Image pulled on the node for the game process.">
            <Input
              value={dockerImage}
              onChange={(event) => setDockerImage(event.target.value)}
              placeholder="itzg/minecraft-server:java21"
              required
              className="font-mono"
              maxLength={255}
            />
          </Field>
        </AdminSection>

        <AdminSection
          icon={<Terminal className="size-4" />}
          title="Process & install"
          description="How the container starts, stops, and is first installed."
        >
          <Field label="Startup" hint="Optional. Command run as the game process. Leave blank if the image has an entrypoint.">
            <Textarea
              value={startup}
              onChange={(event) => setStartup(event.target.value)}
              placeholder="java -Xms128M -jar server.jar"
              className="min-h-[72px] font-mono"
              maxLength={2000}
            />
          </Field>
          <Field label="Stop command" hint='Sent to stdin. Use "stop" for most game servers.'>
            <Input
              value={stopCommand}
              onChange={(event) => setStopCommand(event.target.value)}
              placeholder="stop"
              className="font-mono"
              maxLength={120}
            />
          </Field>
          <Field label="Install image" hint="Container used for the one-time install script. Defaults to alpine:3.20.">
            <Input
              value={installImage}
              onChange={(event) => setInstallImage(event.target.value)}
              placeholder="alpine:3.20"
              className="font-mono"
              maxLength={255}
            />
          </Field>
          <Field
            label="Install script"
            hint="Optional. Runs once in /mnt/server before the first start."
          >
            <Textarea
              value={installScript}
              onChange={(event) => setInstallScript(event.target.value)}
              placeholder="echo installed > /mnt/server/.flutter-installed"
              className="min-h-[120px] font-mono"
              maxLength={20_000}
            />
          </Field>
        </AdminSection>
      </div>

      <AdminSection
        icon={<Variable className="size-4" />}
        title="Environment variables"
        description="Keys must be uppercase (A–Z, digits, underscore). Defaults are copied onto new servers."
      >
        {variables.length === 0 ? (
          <p className="text-sm text-muted-foreground">No variables yet. Add keys like EULA or VERSION.</p>
        ) : (
          <div className="space-y-3">
            {variables.map((row, index) => (
              <div
                key={index}
                className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
              >
                <Field label="Key" required>
                  <Input
                    value={row.key}
                    onChange={(event) => setVariable(index, { key: event.target.value })}
                    onBlur={() => setVariable(index, { key: row.key.toUpperCase() })}
                    placeholder="EULA"
                    className="font-mono"
                    maxLength={64}
                  />
                </Field>
                <Field label="Default">
                  <Input
                    value={row.default}
                    onChange={(event) => setVariable(index, { default: event.target.value })}
                    placeholder="TRUE"
                    className="font-mono"
                    maxLength={512}
                  />
                </Field>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="size-10 px-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${row.key || "variable"}`}
                    onClick={() => setVariables((current) => current.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="sm:col-span-3">
                  <Field label="Description">
                    <Input
                      value={row.description}
                      onChange={(event) => setVariable(index, { description: event.target.value })}
                      placeholder="Must be TRUE to accept the EULA"
                      maxLength={240}
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={() => setVariables((current) => [...current, emptyVariable()])}>
          <Plus className="size-3.5" />
          Add variable
        </Button>
      </AdminSection>
        </>
      )}

      {creating ? null : (
        <AdminSection
          icon={<Trash2 className="size-4" />}
          title="Danger zone"
          description="Eggs that still have servers cannot be deleted."
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {serverCount
                ? `${serverCount} server${serverCount === 1 ? "" : "s"} still use this egg.`
                : "No servers use this egg."}
            </p>
            <Button type="button" variant="danger" disabled={deleting || serverCount > 0} onClick={onDelete}>
              {deleting ? "Deleting…" : "Delete egg"}
            </Button>
          </div>
        </AdminSection>
      )}

      <SaveIsland
        visible={dirty || pending}
        onCancel={onCancel}
        submitLabel={importing ? "Import egg" : creating ? "Create egg" : "Save changes"}
        pendingLabel={importing ? "Importing…" : creating ? "Creating…" : "Saving…"}
        pending={pending}
        disabled={importing ? pending : !ready}
        summary={
          <span className="inline-flex items-center gap-2">
            {importing ? <Upload className="size-4 text-primary" /> : <Box className="size-4 text-primary" />}
            <span>
              {importing ? "Importing" : creating ? "Creating" : "Saving"}{" "}
              <span className="font-medium text-foreground">
                {importing ? parsed.preview?.name ?? "egg" : name.trim() || "egg"}
              </span>
              {selectedNest ? (
                <>
                  {" "}
                  {importing ? "into" : "in"}{" "}
                  <span className="font-medium text-foreground">{selectedNest.name}</span>
                </>
              ) : null}
            </span>
          </span>
        }
      />
    </form>
  );
}
