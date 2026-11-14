"use client";

/**
 * Admin → Extensions.
 *
 * Lists every folder in the panel's extensions directory with its manifest,
 * status and requested permissions, and lets an admin enable (approve),
 * disable, update or uninstall. Install by uploading a .zip or by dropping a
 * folder into the extensions directory and pressing Rescan; see
 * extensions/README.md for the authoring guide.
 *
 * Backend: GET /api/v1/admin/extensions, POST /rescan, POST /upload,
 * POST /:id/enable, POST /:id/disable, DELETE /:id, GET /:id/download.
 * All need a signed-in admin session.
 */

import { useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CircleCheck,
  CircleOff,
  Download,
  FolderOpen,
  Power,
  Puzzle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import {
  EXTENSION_PERMISSIONS,
  EXTENSION_ZIP_LIMITS,
  type AdminExtension,
  type ExtensionManifest,
  type ExtensionPermission,
} from "@flutter-software/shared";
import { AdminError, AdminPage } from "@/components/admin-table";
import { confirm } from "@/components/confirm-dialog";
import { QueryErrorPage } from "@/components/error-page";
import { AdminExtensionsPageSkeleton } from "@/components/skeletons";
import { toast } from "@/components/toast";
import { Button, Card, Modal } from "@/components/ui";
import { api, apiDownload, apiUpload, HttpError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { extensionIcon } from "@/lib/extension-icons";
import { AnalysisReport, AnalysisSummary, RiskBadge } from "./analysis";
import { useQuery } from "@/lib/query";
import { writeQuery } from "@/lib/query-cache";

const PATH = "/api/v1/admin/extensions";

type Payload = { data: { directory: string; extensions: AdminExtension[] } };
type UploadPayload = {
  data: Payload["data"] & {
    result: { id: string; version: string; replaced: boolean; previousVersion: string | null };
  };
};

/** Reads a File as base64 (without the data: URL prefix). */
function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.readAsDataURL(file);
  });
}

const STATUS: Record<AdminExtension["status"], { label: string; className: string; icon: typeof CircleCheck }> = {
  enabled: { label: "Enabled", className: "bg-status-running/15 text-status-running", icon: CircleCheck },
  disabled: { label: "Disabled", className: "bg-muted text-muted-foreground", icon: CircleOff },
  "needs-approval": { label: "Needs approval", className: "bg-status-warn/15 text-status-warn", icon: ShieldAlert },
  invalid: { label: "Invalid", className: "bg-status-error/15 text-status-error", icon: AlertTriangle },
};

const EXAMPLE_MANIFEST = `{
  "id": "hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "permissions": ["server.read"],
  "contributes": {
    "serverPages": [
      { "id": "hello", "label": "Hello", "icon": "star", "entry": "src/main.tsx" }
    ]
  }
}`;

const EXAMPLE_TSX = `import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";

function App() {
  const [name, setName] = useState("…");
  useEffect(() => {
    Flutter.ready().then(({ server }) => setName(server.name));
  }, []);
  return <h1>Hello from {name}</h1>;
}

createRoot(document.getElementById("root")!).render(<App />);`;

function describeTargets(manifest: ExtensionManifest) {
  const eggs = manifest.targets?.eggs ?? [];
  const images = manifest.targets?.dockerImages ?? [];
  if (!eggs.length && !images.length) return "All servers";
  return [...eggs.map((egg) => `egg ${egg}`), ...images.map((image) => `image ${image}`)].join(", ");
}

export default function AdminExtensionsPage() {
  const { data, error, errorStatus, reload } = useQuery<Payload>(PATH);
  const [reviewing, setReviewing] = useState<AdminExtension | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** Extension whose full code-scan report is open. */
  const [report, setReport] = useState<AdminExtension | null>(null);
  /**
   * High-risk scans need an explicit "I've reviewed this" before enabling.
   * Stored per extension id (with its scan fingerprint) so it resets for a
   * different extension or after the code changes.
   */
  const [acknowledgedKey, setAcknowledgedKey] = useState<string | null>(null);

  const extensions = data?.data.extensions ?? [];
  const highRisk = reviewing?.analysis?.risk === "high";
  const reviewKey = reviewing ? `${reviewing.id}:${reviewing.analysis?.fingerprint ?? ""}` : null;
  const acknowledged = Boolean(reviewKey) && acknowledgedKey === reviewKey;
  const setAcknowledged = (value: boolean) => setAcknowledgedKey(value ? reviewKey : null);
  const reviewAcknowledged = !highRisk || acknowledged;

  /** Every mutation returns the fresh list; write it straight into the cache. */
  async function mutate(path: string, key: string) {
    setBusy(key);
    setActionError(null);
    try {
      const result = await api<Payload>(path, { method: "POST" });
      writeQuery(PATH, result);
      return result;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Request failed");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function rescan() {
    const result = await mutate(`${PATH}/rescan`, "rescan");
    if (result) toast(`Found ${result.data.extensions.length} extension${result.data.extensions.length === 1 ? "" : "s"}.`, "success");
  }

  async function enable(row: AdminExtension) {
    const result = await mutate(`${PATH}/${row.id}/enable`, row.id);
    if (!result) return;
    setReviewing(null);
    toast(`${row.manifest?.name ?? row.id} enabled.`, "success");
  }

  /**
   * Installs a .zip. If the extension already exists the API answers 409; we
   * ask, then retry with replace. New installs open the review dialog so the
   * admin can enable it straight away.
   */
  async function upload(file: File) {
    setActionError(null);
    if (!/\.zip$/i.test(file.name)) {
      setActionError("Choose a .zip file.");
      return;
    }
    if (file.size > EXTENSION_ZIP_LIMITS.maxArchiveBytes) {
      setActionError(`That zip is larger than ${Math.round(EXTENSION_ZIP_LIMITS.maxArchiveBytes / 1024 / 1024)} MB.`);
      return;
    }
    setUploadProgress(0);
    try {
      const contentBase64 = await fileToBase64(file);
      const send = (replace: boolean) =>
        apiUpload<UploadPayload>(`${PATH}/upload`, { contentBase64, replace }, (ratio) => setUploadProgress(ratio));
      let result: UploadPayload;
      try {
        result = await send(false);
      } catch (err) {
        if (!(err instanceof HttpError) || err.status !== 409) throw err;
        const ok = await confirm({ title: "Update extension?", description: err.message, confirmLabel: "Replace" });
        if (!ok) return;
        setUploadProgress(0);
        result = await send(true);
      }
      const { result: installed, ...list } = result.data;
      writeQuery(PATH, { data: list });
      const row = list.extensions.find((item) => item.id === installed.id);
      const name = row?.manifest?.name ?? installed.id;
      if (installed.replaced) {
        toast(
          row?.status === "needs-approval"
            ? `${name} updated to v${installed.version}. It asks for new permissions; review to re-enable.`
            : `${name} updated to v${installed.version}.`,
          row?.status === "needs-approval" ? "warning" : "success",
        );
      } else {
        toast(`${name} installed.`, "success");
        if (row?.status === "disabled") setReviewing(row);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadProgress(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function download(row: AdminExtension) {
    setActionError(null);
    try {
      const { blob, filename } = await apiDownload(`${PATH}/${row.id}/download`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename || `${row.id}.zip`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Download failed");
    }
  }

  async function uninstall(row: AdminExtension) {
    const ok = await confirm({
      title: `Uninstall ${row.manifest?.name ?? row.id}?`,
      description: "Deletes its folder from the panel and removes it from every server. Download it first if you want a copy.",
      confirmLabel: "Uninstall",
      danger: true,
    });
    if (!ok) return;
    setBusy(row.id);
    setActionError(null);
    try {
      const result = await api<Payload>(`${PATH}/${row.id}`, { method: "DELETE" });
      writeQuery(PATH, result);
      toast(`${row.manifest?.name ?? row.id} uninstalled.`, "success");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Uninstall failed");
    } finally {
      setBusy(null);
    }
  }

  async function disable(row: AdminExtension) {
    const ok = await confirm({
      title: `Disable ${row.manifest?.name ?? row.id}?`,
      description: "Its pages disappear from every server right away. You can enable it again later.",
      confirmLabel: "Disable",
      danger: true,
    });
    if (!ok) return;
    const result = await mutate(`${PATH}/${row.id}/disable`, row.id);
    if (result) toast(`${row.manifest?.name ?? row.id} disabled.`, "success");
  }

  if (error && !data) {
    return (
      <QueryErrorPage
        error={error}
        status={errorStatus}
        onRetry={() => void reload()}
        homeHref="/admin"
        homeLabel="Back to admin"
      />
    );
  }

  if (!data) return <AdminExtensionsPageSkeleton />;

  return (
    <AdminPage
      title="Extensions"
      description="Add pages and tools to servers. Extensions run sandboxed and only get the permissions you approve."
      actions={
        <>
          <Button type="button" variant="secondary" onClick={() => setGuideOpen(true)}>
            <BookOpen className="size-4" />
            Build one
          </Button>
          <Button type="button" variant="secondary" disabled={busy === "rescan"} onClick={() => void rescan()}>
            <RefreshCw className={cn("size-4", busy === "rescan" && "animate-spin")} />
            Rescan
          </Button>
          <Button type="button" disabled={uploadProgress !== null} onClick={() => fileInput.current?.click()}>
            <Upload className="size-4" />
            {uploadProgress !== null ? `Uploading ${Math.round(uploadProgress * 100)}%` : "Upload .zip"}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </>
      }
    >
      <AdminError message={actionError} />

      <Card className="flex flex-col gap-1 p-4 text-sm sm:flex-row sm:items-center sm:gap-3">
        <span className="flex shrink-0 items-center gap-1.5 font-medium">
          <FolderOpen className="size-4 text-muted-foreground" />
          Install
        </span>
        <span className="min-w-0 text-muted-foreground">
          Upload a .zip, or copy an extension folder into{" "}
          <code className="break-all font-mono text-foreground">{data.data.directory}</code> and press Rescan. Uploading
          a newer version of an installed extension updates it.
        </span>
      </Card>

      {extensions.length === 0 ? (
        <Card className="px-6 py-16 text-center">
          <Puzzle className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-base font-semibold">No extensions installed</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Extensions add pages to servers, like a player list for Minecraft or a map viewer. Build your own with
            plain HTML and JavaScript.
          </p>
          <Button type="button" className="mt-5" variant="secondary" onClick={() => setGuideOpen(true)}>
            <BookOpen className="size-4" />
            How to build one
          </Button>
        </Card>
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {extensions.map((row) => (
            <ExtensionRow
              key={row.id}
              row={row}
              busy={busy === row.id}
              onEnable={() => setReviewing(row)}
              onDisable={() => void disable(row)}
              onDownload={() => void download(row)}
              onUninstall={() => void uninstall(row)}
              onReport={() => setReport(row)}
            />
          ))}
        </Card>
      )}

      <Modal
        open={Boolean(reviewing)}
        onClose={() => {
          if (!busy) setReviewing(null);
        }}
        title={reviewing?.status === "needs-approval" ? "Approve new permissions" : "Enable extension"}
        description="Review what this extension can do. Users still need the matching server permission themselves."
        footer={
          reviewing ? (
            <>
              <Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => setReviewing(null)}>
                Cancel
              </Button>
              <Button type="button" disabled={Boolean(busy) || !reviewAcknowledged} onClick={() => void enable(reviewing)}>
                <Power className="size-4" />
                {busy ? "Enabling…" : reviewing.status === "needs-approval" ? "Approve" : "Enable"}
              </Button>
            </>
          ) : null
        }
      >
        {reviewing?.manifest ? (
          <div className="space-y-4">
            <ReviewBody row={reviewing} manifest={reviewing.manifest} />
            <AnalysisSummary analysis={reviewing.analysis} onOpenReport={() => setReport(reviewing)} />
            {highRisk ? (
              <label className="flex items-start gap-2 rounded-lg border border-status-error/30 bg-status-error/10 px-3 py-2 text-xs text-status-error">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                <span>I&apos;ve reviewed the high-risk findings and trust this extension&apos;s code.</span>
              </label>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(report)}
        onClose={() => setReport(null)}
        title={`Code scan: ${report?.manifest?.name ?? report?.id ?? ""}`}
        description="What the automated scan found in this extension's files."
        className="max-w-2xl"
        footer={
          <Button type="button" onClick={() => setReport(null)}>
            Done
          </Button>
        }
      >
        {report?.analysis ? <AnalysisReport analysis={report.analysis} /> : null}
      </Modal>

      <Modal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="Build an extension"
        description="An extension is a folder with a manifest and some HTML. No build step needed."
        className="max-w-2xl"
        footer={
          <Button type="button" onClick={() => setGuideOpen(false)}>
            Done
          </Button>
        }
      >
        <ol className="list-decimal space-y-3 pl-5 text-sm">
          <li>
            Create <code className="font-mono">{data.data.directory}/hello-world/extension.json</code>:
            <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-[11px]">
              {EXAMPLE_MANIFEST}
            </pre>
          </li>
          <li>
            Add <code className="font-mono">src/main.tsx</code>. TypeScript, JSX, imports, CSS and React work with no
            build step; the panel compiles it and loads the SDK for you:
            <pre className="mt-2 overflow-x-auto rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-[11px]">
              {EXAMPLE_TSX}
            </pre>
            Prefer plain HTML? Point <code className="font-mono">entry</code> at an <code className="font-mono">.html</code>{" "}
            file and include <code className="font-mono">/api/v1/extensions/sdk.js</code> yourself.
          </li>
          <li>
            Zip the folder and press Upload .zip (or copy it into the extensions folder and press Rescan), review the
            permissions and enable it. It shows up in the server sidebar.
          </li>
        </ol>
        <p className="mt-4 text-xs text-muted-foreground">
          The full guide (manifest fields, every SDK method, permissions and theming) is in{" "}
          <code className="font-mono">extensions/README.md</code>, with editor types in{" "}
          <code className="font-mono">extensions/flutter-sdk.d.ts</code>. Starter templates (HTML, TypeScript, React
          and Rust/WebAssembly) aren&apos;t bundled with the panel; download them from{" "}
          <a
            href="https://docs.flutter.software/extensions/templates"
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline underline-offset-2 hover:text-primary"
          >
            docs.flutter.software/extensions/templates
          </a>
          .
        </p>
      </Modal>
    </AdminPage>
  );
}

function ExtensionRow({
  row,
  busy,
  onEnable,
  onDisable,
  onDownload,
  onUninstall,
  onReport,
}: {
  row: AdminExtension;
  busy: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onDownload: () => void;
  onUninstall: () => void;
  onReport: () => void;
}) {
  const manifest = row.manifest;
  const Icon = extensionIcon(manifest?.icon);
  const status = STATUS[row.status];
  const StatusIcon = status.icon;

  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
          <Icon className="size-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{manifest?.name ?? row.id}</span>
            {manifest ? (
              <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                v{manifest.version}
              </code>
            ) : null}
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", status.className)}>
              <StatusIcon className="size-3" />
              {status.label}
            </span>
            <RiskBadge analysis={row.analysis} onClick={onReport} />
          </div>

          {manifest?.description ? <p className="text-sm text-muted-foreground">{manifest.description}</p> : null}

          {manifest ? (
            <>
              <p className="text-xs text-muted-foreground">
                {manifest.author ? `By ${manifest.author} · ` : ""}
                <span className="font-mono">{row.id}</span>
                {" · "}
                {manifest.contributes.serverPages.length
                  ? `Adds ${manifest.contributes.serverPages.map((page) => page.label).join(", ")}`
                  : "No pages"}
                {" · "}
                {describeTargets(manifest)}
              </p>
              <PermissionChips
                permissions={manifest.permissions}
                pending={row.pendingPermissions}
              />
            </>
          ) : (
            <ul className="space-y-0.5 text-xs text-status-error">
              <li className="font-mono text-muted-foreground">{row.id}/</li>
              {row.errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2 self-start">
        {manifest ? (
          <>
            {row.status === "needs-approval" ? (
              <Button type="button" size="sm" disabled={busy} onClick={onEnable}>
                <ShieldCheck className="size-3.5" />
                Review
              </Button>
            ) : null}
            {row.status === "disabled" ? (
              <Button type="button" size="sm" disabled={busy} onClick={onEnable}>
                <Power className="size-3.5" />
                Enable
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                className="text-muted-foreground hover:text-destructive"
                onClick={onDisable}
              >
                <CircleOff className="size-3.5" />
                Disable
              </Button>
            )}
          </>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          className="text-muted-foreground"
          onClick={onDownload}
          title="Download as .zip"
          aria-label={`Download ${manifest?.name ?? row.id}`}
        >
          <Download className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          className="text-muted-foreground hover:text-destructive"
          onClick={onUninstall}
          title="Uninstall"
          aria-label={`Uninstall ${manifest?.name ?? row.id}`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function PermissionChips({
  permissions,
  pending,
}: {
  permissions: ExtensionPermission[];
  pending: ExtensionPermission[];
}) {
  if (!permissions.length) {
    return <span className="text-[11px] text-muted-foreground">No permissions</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {permissions.map((perm) => {
        const info = EXTENSION_PERMISSIONS[perm];
        const isPending = pending.includes(perm);
        return (
          <span
            key={perm}
            title={info.description}
            className={cn(
              "rounded-md border px-1.5 py-0.5 text-[11px]",
              isPending
                ? "border-status-warn/40 bg-status-warn/10 text-status-warn"
                : info.sensitive
                  ? "border-border text-foreground"
                  : "border-border text-muted-foreground",
            )}
          >
            {info.label}
            {isPending ? " (new)" : ""}
          </span>
        );
      })}
    </div>
  );
}

function ReviewBody({ row, manifest }: { row: AdminExtension; manifest: ExtensionManifest }) {
  const sensitive = manifest.permissions.some((perm) => EXTENSION_PERMISSIONS[perm].sensitive);
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="font-medium">
          {manifest.name} <span className="font-mono text-xs text-muted-foreground">v{manifest.version}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {manifest.author ? `By ${manifest.author} · ` : ""}
          {describeTargets(manifest)}
        </p>
      </div>

      {manifest.permissions.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {manifest.permissions.map((perm) => {
            const info = EXTENSION_PERMISSIONS[perm];
            const isNew = row.pendingPermissions.includes(perm);
            return (
              <li key={perm} className="flex items-start gap-2.5 px-3 py-2.5">
                {info.sensitive ? (
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-status-warn" />
                ) : (
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  <p className="font-medium">
                    {info.label}
                    {isNew ? <span className="ml-1.5 text-xs font-normal text-status-warn">new</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">{info.description}</p>
                  {info.requires.length ? (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Viewer also needs: <span className="font-mono">{info.requires.join(", ")}</span>
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground">This extension asks for no permissions. It can only show its own content.</p>
      )}

      {sensitive ? (
        <p className="rounded-lg border border-status-warn/30 bg-status-warn/10 px-3 py-2 text-xs text-status-warn">
          Some of these let the extension change servers. Only enable extensions whose code you trust.
        </p>
      ) : null}
    </div>
  );
}
