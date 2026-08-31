"use client";

import {
  Suspense,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArchiveRestore,
  ArrowUp,
  Copy,
  FilePlus,
  FileText,
  FolderOpen,
  FolderPlus,
  MoreVertical,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { confirm } from "@/components/confirm-dialog";
import { FileIdeModal } from "@/components/file-ide";
import { Button, Card } from "@/components/ui";
import { api, apiUpload } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useServerRecord } from "@/components/server-frame";
import { can } from "@/lib/access";
import { FILE_UPLOAD_LIMIT_BYTES, formatUploadLimit } from "@flutter-software/shared";

type Entry = { name: string; kind: "file" | "dir"; size: number; modifiedAt: string };

type Menu =
  | { x: number; y: number; kind: "entry"; entry: Entry }
  | { x: number; y: number; kind: "blank" };

function joinPath(dir: string, name: string) {
  if (!dir || dir === "/") return name.startsWith("/") ? name : `/${name}`;
  return `${dir.replace(/\/+$/, "")}/${name.replace(/^\/+/, "")}`;
}

function normalizeDir(value: string | null | undefined) {
  if (!value) return "/";
  const parts = value.replace(/\\/g, "/").split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) return "/";
  return parts.length ? `/${parts.join("/")}` : "/";
}

function parentPath(dir: string) {
  const cleaned = normalizeDir(dir);
  if (cleaned === "/") return "/";
  const idx = cleaned.lastIndexOf("/");
  return idx <= 0 ? "/" : cleaned.slice(0, idx);
}

function filesHref(pathname: string, dir: string) {
  const next = normalizeDir(dir);
  if (next === "/") return pathname;
  return `${pathname}?path=${encodeURIComponent(next)}`;
}

const CONTAINER_ROOT = ["home", "container"] as const;

function PathCrumbs({
  path,
  onBrowse,
}: {
  path: string;
  onBrowse: (next: string) => void;
}) {
  const nested = path === "/" ? [] : path.split("/").filter(Boolean);
  const crumbs = [
    ...CONTAINER_ROOT.map((name) => ({ name, dir: "/" as string })),
    ...nested.map((name, index) => ({
      name,
      dir: `/${nested.slice(0, index + 1).join("/")}`,
    })),
  ];

  return (
    <nav className="flex flex-wrap items-center font-mono text-sm text-muted-foreground" aria-label="Current path">
      {crumbs.map((crumb, index) => {
        const current = index === crumbs.length - 1;
        return (
          <span key={`${crumb.dir}:${crumb.name}:${index}`} className="inline-flex items-center">
            <span aria-hidden>/</span>
            {current ? (
              <span className="text-foreground">{crumb.name}</span>
            ) : (
              <button
                type="button"
                className="hover:text-foreground hover:underline"
                onClick={() => onBrowse(crumb.dir)}
              >
                {crumb.name}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isArchive(name: string) {
  return /\.(zip|tar|tgz|gz|rar)$/i.test(name);
}

function fileToBase64(file: File, onProgress?: (ratio: number) => void) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable || event.total <= 0) return;
      onProgress(Math.min(1, event.loaded / event.total));
    };
    reader.onload = () => {
      onProgress?.(1);
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function FileProgressBar({ label, percent }: { label: string; percent: number }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="space-y-1.5" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={label}>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{label}…</span>
        <span className="tabular-nums">{value}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
          style={{ width: `${Math.max(4, value)}%` }}
        />
      </div>
    </div>
  );
}

type FsEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file: (ok: (file: File) => void, err?: (error: DOMException) => void) => void;
  createReader: () => {
    readEntries: (
      ok: (entries: FsEntry[]) => void,
      err?: (error: DOMException) => void,
    ) => void;
  };
};

async function walkEntry(entry: FsEntry, prefix: string, out: { relative: string; file: File }[]) {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
    out.push({ relative: prefix ? `${prefix}/${entry.name}` : entry.name, file });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = entry.createReader();
  const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
  const children: FsEntry[] = [];
  for (;;) {
    const batch = await new Promise<FsEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    children.push(...batch);
  }
  for (const child of children) await walkEntry(child, nextPrefix, out);
}

async function droppedFiles(event: DragEvent): Promise<{ relative: string; file: File }[]> {
  const items = event.dataTransfer?.items;
  const out: { relative: string; file: File }[] = [];
  if (items?.length) {
    const entries = [...items]
      .map((item) => (item.webkitGetAsEntry?.() as FsEntry | null) ?? null)
      .filter((entry): entry is FsEntry => Boolean(entry));
    if (entries.length) {
      for (const entry of entries) await walkEntry(entry, "", out);
      return out;
    }
  }
  const files = [...(event.dataTransfer?.files ?? [])];
  return files.map((file) => ({ relative: file.name, file }));
}

function MenuItem({
  icon,
  label,
  disabled,
  danger,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm disabled:pointer-events-none disabled:opacity-50",
        danger ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-muted",
      )}
      onClick={onClick}
    >
      <span className="size-3.5 shrink-0">{icon}</span>
      {label}
    </button>
  );
}

export default function FilesPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Files</h2>
          <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
        </div>
      }
    >
      <FilesBrowser params={params} />
    </Suspense>
  );
}

function FilesBrowser({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const path = normalizeDir(search.get("path"));
  const server = useServerRecord();
  const uploadLimit = server?.uploadLimitBytes || FILE_UPLOAD_LIMIT_BYTES;
  const canWrite = can(server, "file.write");
  const canDelete = can(server, "file.delete");
  const canArchive = can(server, "file.archive");
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ path: string; content: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastIndex = useRef<number | null>(null);

  async function files(body: Record<string, unknown>) {
    return api<{ data: unknown }>(`/api/v1/client/servers/${id}/files`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async function load(nextPath = path) {
    setError(null);
    const result = await files({ action: "list", path: nextPath });
    const data = result.data as { path: string; entries: Entry[] };
    setEntries(data.entries ?? []);
  }

  function browse(nextPath: string) {
    const dir = normalizeDir(nextPath);
    const href = filesHref(pathname, dir);
    setEditing(null);
    setMenu(null);
    setSelected(new Set());
    lastIndex.current = null;
    if (href === filesHref(pathname, path)) {
      void load(dir).catch((err) => setError(err instanceof Error ? err.message : "Failed to list files"));
      return;
    }
    router.push(href, { scroll: false });
  }

  useEffect(() => {
    let cancelled = false;
    setMenu(null);
    setEditing(null);
    setSelected(new Set());
    lastIndex.current = null;
    setError(null);
    files({ action: "list", path })
      .then((result) => {
        if (cancelled) return;
        const data = result.data as { path: string; entries: Entry[] };
        setEntries(data.entries ?? []);
        const listed = normalizeDir(data.path);
        if (listed !== path) {
          router.replace(filesHref(pathname, listed), { scroll: false });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to list files");
        setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [id, path]);

  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const el = menuRef.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = menu.x;
    let y = menu.y;
    if (x + rect.width > window.innerWidth - pad) x = window.innerWidth - rect.width - pad;
    if (y + rect.height > window.innerHeight - pad) y = window.innerHeight - rect.height - pad;
    if (x < pad) x = pad;
    if (y < pad) y = pad;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [menu]);

  function openMenu(event: MouseEvent, next: Menu) {
    event.preventDefault();
    event.stopPropagation();
    setMenu(next);
  }

  async function openEntry(entry: Entry) {
    const next = joinPath(path, entry.name);
    setError(null);
    if (entry.kind === "dir") {
      browse(next);
      return;
    }
    try {
      const result = await files({ action: "read", path: next });
      const data = result.data as { path: string; content: string };
      setEditing({ path: data.path, content: data.content });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cannot open file");
    }
  }

  async function saveFile() {
    if (!editing) return false;
    setPending(true);
    setError(null);
    try {
      await files({ action: "write", path: editing.path, content: editing.content });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      return false;
    } finally {
      setPending(false);
    }
  }

  function isEditing(entry: Entry) {
    const full = joinPath(path, entry.name);
    return editing?.path === full || editing?.path === entry.name;
  }

  function startFakeProgress(label: string) {
    setPending(true);
    setProgressLabel(label);
    setPercent(4);
    return window.setInterval(() => {
      setPercent((current) => Math.min(90, (current ?? 4) + 3));
    }, 250);
  }

  function finishProgress(ok: boolean) {
    if (ok) setPercent(100);
    setPending(false);
    window.setTimeout(() => {
      setPercent(null);
      setProgressLabel(null);
    }, ok ? 400 : 0);
  }

  function toggleSelect(name: string, index: number, range: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (range && lastIndex.current !== null) {
        const from = Math.min(lastIndex.current, index);
        const to = Math.max(lastIndex.current, index);
        for (let i = from; i <= to; i += 1) next.add(entries[i].name);
      } else if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
    lastIndex.current = index;
  }

  function selectAll(on: boolean) {
    setSelected(on ? new Set(entries.map((entry) => entry.name)) : new Set());
    lastIndex.current = null;
  }

  function onSelectAll(event: ChangeEvent<HTMLInputElement>) {
    selectAll(event.target.checked);
  }

  async function remove(entry: Entry) {
    if (
      !(await confirm({
        title: "Delete file",
        description: `Delete ${entry.name}? This cannot be undone.`,
        confirmLabel: "Delete",
      }))
    ) {
      return;
    }
    setError(null);
    const timer = startFakeProgress(`Deleting ${entry.name}`);
    try {
      await files({ action: "delete", path: joinPath(path, entry.name) });
      window.clearInterval(timer);
      if (isEditing(entry)) setEditing(null);
      setSelected((current) => {
        const next = new Set(current);
        next.delete(entry.name);
        return next;
      });
      await load(path);
      finishProgress(true);
    } catch (err) {
      window.clearInterval(timer);
      setError(err instanceof Error ? err.message : "Delete failed");
      finishProgress(false);
    }
  }

  async function removeSelected() {
    const names = [...selected];
    if (!names.length) return;
    const label = names.length === 1 ? names[0] : `${names.length} items`;
    if (
      !(await confirm({
        title: "Delete files",
        description: `Delete ${label}? This cannot be undone.`,
        confirmLabel: "Delete",
      }))
    ) {
      return;
    }
    setError(null);
    setPending(true);
    setProgressLabel(names.length === 1 ? `Deleting ${names[0]}` : `Deleting ${names.length} items`);
    setPercent(4);
    try {
      for (let index = 0; index < names.length; index++) {
        const name = names[index];
        if (!name) continue;
        setProgressLabel(names.length === 1 ? `Deleting ${name}` : `Deleting ${index + 1} of ${names.length}`);
        setPercent(Math.max(4, (index / names.length) * 100));
        await files({ action: "delete", path: joinPath(path, name) });
        if (editing && (editing.path === joinPath(path, name) || editing.path.endsWith(`/${name}`))) {
          setEditing(null);
        }
        setPercent(((index + 1) / names.length) * 100);
      }
      setSelected(new Set());
      await load(path);
      finishProgress(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      finishProgress(false);
    }
  }

  async function extract(entry: Entry) {
    if (
      !(await confirm({
        title: "Extract archive",
        description: `Extract ${entry.name} into this folder?`,
        confirmLabel: "Extract",
        danger: false,
      }))
    ) {
      return;
    }
    setError(null);
    const timer = startFakeProgress(`Extracting ${entry.name}`);
    try {
      await files({ action: "extract", path: joinPath(path, entry.name) });
      window.clearInterval(timer);
      setPercent(100);
      await load(path);
      finishProgress(true);
    } catch (err) {
      window.clearInterval(timer);
      setError(err instanceof Error ? err.message : "Extract failed");
      finishProgress(false);
    }
  }

  async function renameEntry(entry: Entry) {
    const name = window.prompt("Rename", entry.name);
    if (!name?.trim() || name.trim() === entry.name) return;
    const from = joinPath(path, entry.name);
    const to = joinPath(path, name.trim());
    setError(null);
    try {
      await files({ action: "rename", path: from, to });
      if (isEditing(entry) && editing) setEditing({ ...editing, path: to });
      await load(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed");
    }
  }

  async function copyPath(entry: Entry) {
    const full = joinPath(path, entry.name);
    try {
      await navigator.clipboard.writeText(full);
    } catch {
      setError("Could not copy path");
    }
  }

  async function create(kind: "file" | "dir") {
    const name = window.prompt(kind === "dir" ? "Folder name" : "File name");
    if (!name?.trim()) return;
    setError(null);
    try {
      const next = joinPath(path, name.trim());
      if (kind === "dir") await files({ action: "mkdir", path: next });
      else await files({ action: "write", path: next, content: "" });
      await load(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  }

  async function uploadList(list: { relative: string; file: File }[]) {
    if (!list.length) return;
    setError(null);
    setPending(true);
    setProgressLabel(list.length === 1 ? `Uploading ${list[0]?.relative ?? "file"}` : `Uploading ${list.length} files`);
    const total = list.reduce((sum, item) => sum + Math.max(item.file.size, 1), 0);
    let finished = 0;
    const report = (loaded: number) => {
      setPercent(Math.min(100, ((finished + loaded) / total) * 100));
    };
    try {
      setPercent(0);
      for (const item of list) {
        if (item.file.size > uploadLimit) {
          throw new Error(`${item.relative} is larger than ${formatUploadLimit(uploadLimit)}`);
        }
        const contentBase64 = await fileToBase64(item.file, (ratio) => {
          report(item.file.size * ratio * 0.25);
        });
        await apiUpload(
          `/api/v1/client/servers/${id}/files`,
          {
            action: "upload",
            path,
            name: item.relative,
            contentBase64,
          },
          (ratio) => {
            report(item.file.size * (0.25 + ratio * 0.75));
          },
        );
        finished += Math.max(item.file.size, 1);
        report(0);
      }
      setPercent(100);
      await load(path);
      finishProgress(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      finishProgress(false);
    }
  }

  async function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!canWrite) return;
    const list = await droppedFiles(event);
    await uploadList(list);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Files</h2>
          <PathCrumbs path={path} onBrowse={browse} />
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              const list = [...(event.target.files ?? [])].map((file) => ({
                relative: file.name,
                file,
              }));
              event.target.value = "";
              void uploadList(list);
            }}
          />
          {canWrite ? (
            <>
          <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => inputRef.current?.click()}>
            <Upload className="size-3.5" />
            Upload
          </Button>
          <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => create("dir")}>
            <FolderPlus className="size-3.5" />
            Folder
          </Button>
          <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => create("file")}>
            <FilePlus className="size-3.5" />
            File
          </Button>
            </>
          ) : null}
        </div>
      </div>
      {percent !== null ? (
        <FileProgressBar label={progressLabel ?? "Working"} percent={percent} />
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <p className="text-sm">
            <span className="font-medium">{selected.size}</span> selected
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => selectAll(false)}>
              Clear
            </Button>
            {canDelete ? (
            <Button type="button" variant="danger" size="sm" disabled={pending} onClick={() => void removeSelected()}>
              <Trash2 className="size-3.5" />
              Delete
            </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        className={cn("relative", dragging && "ring-2 ring-primary rounded-xl")}
        onDragEnter={(event) => {
          event.preventDefault();
          if (canWrite) setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node)) return;
          setDragging(false);
        }}
        onDrop={(event) => void onDrop(event)}
        onContextMenu={(event) => openMenu(event, { x: event.clientX, y: event.clientY, kind: "blank" })}
      >
        <Card className="overflow-hidden">
          {dragging ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/80 text-sm font-medium">
              Drop files to upload
            </div>
          ) : null}
        <table
          className="w-full select-none text-sm"
          tabIndex={0}
          onKeyDown={(event: KeyboardEvent<HTMLTableElement>) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
              event.preventDefault();
              selectAll(true);
            }
          }}
        >
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={entries.length > 0 && selected.size === entries.length}
                  ref={(el) => {
                    if (el) el.indeterminate = selected.size > 0 && selected.size < entries.length;
                  }}
                  onChange={onSelectAll}
                  aria-label="Select all"
                  disabled={!entries.length}
                />
              </th>
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Type</th>
              <th className="px-4 py-2.5 font-medium">Size</th>
              <th className="px-4 py-2.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {path !== "/" ? (
              <tr className="border-t border-border">
                <td className="px-4 py-2.5" colSpan={5}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                    onClick={() => browse(parentPath(path))}
                  >
                    <ArrowUp className="size-3.5" />
                    Parent directory
                  </button>
                </td>
              </tr>
            ) : null}
            {entries.map((entry, index) => {
              const active = menu?.kind === "entry" && menu.entry.name === entry.name;
              const checked = selected.has(entry.name);
              return (
                <tr
                  key={entry.name}
                  className={cn(
                    "border-t border-border hover:bg-muted/40",
                    (active || checked) && "bg-muted/60",
                  )}
                  onContextMenu={(event) =>
                    openMenu(event, { x: event.clientX, y: event.clientY, kind: "entry", entry })
                  }
                  onDoubleClick={() => void openEntry(entry)}
                >
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={checked}
                      aria-label={`Select ${entry.name}`}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        const shift = "shiftKey" in event.nativeEvent && Boolean(event.nativeEvent.shiftKey);
                        toggleSelect(entry.name, index, shift);
                      }}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      type="button"
                      className="font-medium hover:text-primary"
                      onClick={() => void openEntry(entry)}
                    >
                      {entry.name}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 capitalize text-muted-foreground">{entry.kind}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {entry.kind === "dir" ? "—" : formatSize(entry.size)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="size-8 px-0 text-muted-foreground hover:text-foreground"
                        aria-label={`Actions for ${entry.name}`}
                        disabled={pending}
                        onClick={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          openMenu(event, {
                            x: rect.right,
                            y: rect.bottom + 4,
                            kind: "entry",
                            entry,
                          });
                        }}
                      >
                        <MoreVertical className="size-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {entries.length === 0 ? (
              <tr className="border-t border-border">
                <td className="px-4 py-10 text-center text-sm text-muted-foreground" colSpan={5}>
                  This folder is empty. Drag files here, use Upload, or right-click.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        </Card>
      </div>

      {menu ? (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 min-w-44 overflow-hidden rounded-lg border border-border bg-popover py-1 text-popover-foreground shadow-lg"
          style={{ left: menu.x, top: menu.y }}
        >
          {menu.kind === "entry" ? (
            <>
              <MenuItem
                icon={menu.entry.kind === "dir" ? <FolderOpen className="size-3.5" /> : <FileText className="size-3.5" />}
                label={menu.entry.kind === "dir" ? "Open" : "Edit"}
                disabled={pending}
                onClick={() => {
                  const entry = menu.entry;
                  setMenu(null);
                  void openEntry(entry);
                }}
              />
              <MenuItem
                icon={<Pencil className="size-3.5" />}
                label="Rename"
                disabled={pending || !canWrite}
                onClick={() => {
                  const entry = menu.entry;
                  setMenu(null);
                  void renameEntry(entry);
                }}
              />
              <MenuItem
                icon={<Copy className="size-3.5" />}
                label="Copy path"
                onClick={() => {
                  const entry = menu.entry;
                  setMenu(null);
                  void copyPath(entry);
                }}
              />
              {menu.entry.kind === "file" && isArchive(menu.entry.name) && canArchive ? (
                <MenuItem
                  icon={<ArchiveRestore className="size-3.5" />}
                  label="Extract"
                  disabled={pending}
                  onClick={() => {
                    const entry = menu.entry;
                    setMenu(null);
                    void extract(entry);
                  }}
                />
              ) : null}
              {canDelete ? (
              <>
              <div className="my-1 h-px bg-border" />
              <MenuItem
                icon={<Trash2 className="size-3.5" />}
                label={selected.size > 1 && selected.has(menu.entry.name) ? `Delete ${selected.size} items` : "Delete"}
                disabled={pending}
                danger
                onClick={() => {
                  const entry = menu.entry;
                  const bulk = selected.size > 1 && selected.has(entry.name);
                  setMenu(null);
                  if (bulk) void removeSelected();
                  else void remove(entry);
                }}
              />
              </>
              ) : null}
            </>
          ) : (
            <>
              {canWrite ? (
              <>
              <MenuItem
                icon={<FilePlus className="size-3.5" />}
                label="New file"
                disabled={pending}
                onClick={() => {
                  setMenu(null);
                  void create("file");
                }}
              />
              <MenuItem
                icon={<FolderPlus className="size-3.5" />}
                label="New folder"
                disabled={pending}
                onClick={() => {
                  setMenu(null);
                  void create("dir");
                }}
              />
              <MenuItem
                icon={<Upload className="size-3.5" />}
                label="Upload"
                disabled={pending}
                onClick={() => {
                  setMenu(null);
                  inputRef.current?.click();
                }}
              />
              <div className="my-1 h-px bg-border" />
              </>
              ) : null}
              <MenuItem
                icon={<RefreshCw className="size-3.5" />}
                label="Refresh"
                disabled={pending}
                onClick={() => {
                  setMenu(null);
                  void load(path);
                }}
              />
            </>
          )}
        </div>
      ) : null}

      {editing ? (
        <FileIdeModal
          path={editing.path}
          content={editing.content}
          pending={pending}
          readOnly={!canWrite}
          onChange={(content) => setEditing({ ...editing, content })}
          onSave={saveFile}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
