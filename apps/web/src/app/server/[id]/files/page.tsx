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
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  ArrowUp,
  Copy,
  Download,
  FilePlus,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Loader2,
  MoreVertical,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { confirm } from "@/components/confirm-dialog";
import { FileIdeModal } from "@/components/file-ide";
import { FileTypeIcon } from "@/components/file-type-icon";
import { toast } from "@/components/toast";
import { Button, Card, Field, Input, Modal } from "@/components/ui";
import { api, apiDownload, apiUpload } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useServerRecord } from "@/components/server-frame";
import { can } from "@/lib/access";
import { FILE_UPLOAD_LIMIT_BYTES, formatUploadLimit } from "@flutter-software/shared";

type Entry = { name: string; kind: "file" | "dir"; size: number; modifiedAt: string };
type SearchHit = { path: string; name: string; kind: "file" | "dir"; size: number };

type Menu =
  | { x: number; y: number; kind: "entry"; entry: Entry }
  | { x: number; y: number; kind: "blank" };

type NameModalState =
  | { mode: "create-file" }
  | { mode: "create-dir" }
  | { mode: "rename"; entry: Entry };

type MoveModalState = {
  from: string;
  entries: Entry[];
};

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

function displayContainerPath(dir: string) {
  const cleaned = normalizeDir(dir);
  return cleaned === "/" ? "/home/container" : `/home/container${cleaned}`;
}

function looksLikePath(raw: string) {
  const value = raw.trim();
  if (!value) return false;
  if (/^sftp:\/\//i.test(value)) return true;
  if (value.includes("/") || value.includes("\\")) return true;
  return /^home\/container(\/|$)/i.test(value);
}

function parseContainerPath(raw: string, currentDir = "/") {
  let value = raw.trim();
  if (!value) return "/";
  if (/^sftp:\/\//i.test(value)) {
    try {
      value = decodeURIComponent(new URL(value).pathname || "/");
    } catch {
      value = value.replace(/^sftp:\/\/[^/]*/i, "") || "/";
    }
  }
  value = value.replace(/\\/g, "/");
  const lower = value.toLowerCase();
  const marker = "/home/container";
  const index = lower.indexOf(marker);
  if (index >= 0) {
    value = value.slice(index + marker.length) || "/";
  } else if (/^home\/container(\/|$)/i.test(value)) {
    value = value.slice("home/container".length) || "/";
  }
  if (!value.startsWith("/")) value = joinPath(currentDir, value);
  return normalizeDir(value);
}

function parseEntryName(value: string): { name: string } | { error: string } {
  const name = value.trim();
  if (!name) return { error: "Enter a name" };
  if (name === "." || name === "..") return { error: "Enter a valid name" };
  if (/[\\/]/.test(name)) return { error: "Name cannot contain slashes" };
  return { name };
}

function isInsidePath(dir: string, ancestor: string) {
  const target = normalizeDir(dir);
  const root = normalizeDir(ancestor);
  return target === root || target.startsWith(`${root}/`);
}

function cannotMoveTo(from: string, entries: Entry[], dest: string) {
  const destDir = normalizeDir(dest);
  if (destDir === normalizeDir(from)) return true;
  return entries.some((entry) => {
    if (entry.kind !== "dir") return false;
    return isInsidePath(destDir, joinPath(from, entry.name));
  });
}

function moveCollisions(from: string, items: Entry[], dest: string, destEntries: Entry[]) {
  if (normalizeDir(from) === normalizeDir(dest)) return [];
  const names = new Set(items.map((entry) => entry.name));
  return destEntries.filter((entry) => names.has(entry.name)).map((entry) => entry.name);
}

function filesHref(pathname: string, dir: string) {
  const next = normalizeDir(dir);
  if (next === "/") return pathname;
  return `${pathname}?path=${encodeURIComponent(next)}`;
}

type ClickPoint = { detail: number; clientX: number; clientY: number };
type ClickGuard = { until: number; x: number; y: number };

function isRepeatedClick(event: ClickPoint, guard: ClickGuard | null) {
  if (event.detail > 1) return true;
  if (!guard || Date.now() > guard.until) return false;
  return Math.abs(event.clientX - guard.x) < 12 && Math.abs(event.clientY - guard.y) < 12;
}

function nextClickGuard(event: ClickPoint): ClickGuard {
  return { until: Date.now() + 500, x: event.clientX, y: event.clientY };
}

const CONTAINER_ROOT = ["home", "container"] as const;

function PathCrumbs({
  path,
  onBrowse,
}: {
  path: string;
  onBrowse: (next: string, event: MouseEvent<HTMLButtonElement>) => void;
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
                className="no-press hover:text-foreground hover:underline"
                onClick={(event) => onBrowse(crumb.dir, event)}
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

function TopLoadingBar({ label, percent }: { label: string; percent: number }) {
  const value = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      aria-label={label}
      title={`${label}… ${Math.round(value)}%`}
    >
      <div
        className="h-full bg-primary shadow-[0_0_8px_2px] shadow-primary/80 transition-[width] duration-150 ease-out"
        style={{ width: `${Math.max(2, value)}%` }}
      />
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

function SelectHit({
  checked,
  disabled,
  label,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  indeterminate?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label
      className={cn(
        "flex h-11 w-12 cursor-pointer items-center justify-center",
        disabled && "pointer-events-none cursor-default opacity-50",
      )}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        type="checkbox"
        className="size-5 shrink-0 cursor-pointer accent-primary"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        ref={(el) => {
          if (el && indeterminate !== undefined) el.indeterminate = indeterminate;
        }}
        onChange={onChange}
      />
    </label>
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
  const urlPath = normalizeDir(search.get("path"));
  const [path, setPath] = useState(urlPath);
  const server = useServerRecord();
  const uploadLimit = server?.uploadLimitBytes || FILE_UPLOAD_LIMIT_BYTES;
  const canWrite = can(server, "file.write");
  const canDelete = can(server, "file.delete");
  const canArchive = can(server, "file.archive");
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listSeq = useRef(0);
  const moveSeq = useRef(0);
  const clickGuard = useRef<ClickGuard | null>(null);
  const localNav = useRef<string | null>(null);
  const pendingOpen = useRef<string | null>(null);
  const openedUrlFile = useRef<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [listing, setListing] = useState(true);
  const [editing, setEditing] = useState<{ path: string; content: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastIndex = useRef<number | null>(null);
  const [nameModal, setNameModal] = useState<NameModalState | null>(null);
  const [nameValue, setNameValue] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [namePending, setNamePending] = useState(false);
  const [moveModal, setMoveModal] = useState<MoveModalState | null>(null);
  const [moveDest, setMoveDest] = useState("/");
  const [moveList, setMoveList] = useState<Entry[]>([]);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveLoading, setMoveLoading] = useState(false);
  const [movePending, setMovePending] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchHits, setSearchHits] = useState<{ matches: SearchHit[]; truncated: boolean } | null>(null);

  async function files(body: Record<string, unknown>) {
    return api<{ data: unknown }>(`/api/v1/client/servers/${id}/files`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  function armClickGuard(event: ClickPoint) {
    clickGuard.current = nextClickGuard(event);
  }

  function shouldIgnoreClick(event: ClickPoint) {
    return isRepeatedClick(event, clickGuard.current);
  }

  function showError(err: unknown, fallback: string) {
    toast(err instanceof Error ? err.message : fallback);
  }

  async function load(nextPath = path, opts: { keepEntries?: boolean; syncUrl?: boolean } = {}) {
    const seq = ++listSeq.current;
    setListing(true);
    try {
      const result = await files({ action: "list", path: nextPath });
      if (seq !== listSeq.current) return;
      const data = result.data as { path: string; entries: Entry[] };
      setEntries(data.entries ?? []);
      const listed = normalizeDir(data.path);
      if (opts.syncUrl && listed !== nextPath) {
        localNav.current = listed;
        setPath(listed);
        router.replace(filesHref(pathname, listed), { scroll: false });
      }
      const openPath = pendingOpen.current;
      if (openPath) {
        pendingOpen.current = null;
        void openFileAt(openPath);
      }
    } catch (err) {
      if (seq !== listSeq.current) return;
      showError(err, "Failed to list files");
      setEntries([]);
    } finally {
      if (seq === listSeq.current) setListing(false);
    }
  }

  function browse(nextPath: string) {
    const dir = normalizeDir(nextPath);
    setEditing(null);
    setMenu(null);
    setSelected(new Set());
    setSearchHits(null);
    lastIndex.current = null;
    if (dir === path) {
      void load(dir, { keepEntries: true });
      return;
    }
    setPath(dir);
    localNav.current = dir;
    router.push(filesHref(pathname, dir), { scroll: false });
  }

  useEffect(() => {
    if (localNav.current !== null) {
      if (urlPath === localNav.current) localNav.current = null;
      else return;
    }
    setPath((current) => (current === urlPath ? current : urlPath));
  }, [urlPath]);

  useEffect(() => {
    setMenu(null);
    setEditing(null);
    setSelected(new Set());
    lastIndex.current = null;
    void load(path, { syncUrl: true });
  }, [id, path]);

  const urlFile = search.get("file");
  useEffect(() => {
    if (!urlFile || openedUrlFile.current === urlFile) return;
    openedUrlFile.current = urlFile;
    void openByPath(urlFile);
  }, [urlFile]);

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

  async function openEntry(entry: Entry, event?: ClickPoint) {
    if (event && shouldIgnoreClick(event)) return;
    const next = joinPath(path, entry.name);
    if (entry.kind === "dir") {
      if (event) armClickGuard(event);
      browse(next);
      return;
    }
    if (listing) return;
    void openFileAt(next);
  }

  async function openFileAt(full: string) {
    try {
      const result = await files({ action: "read", path: full });
      const data = result.data as { path: string; content: string };
      setEditing({ path: data.path, content: data.content });
    } catch (err) {
      showError(err, "Cannot open file");
    }
  }

  async function saveFile() {
    if (!editing) return false;
    setPending(true);
    try {
      await files({ action: "write", path: editing.path, content: editing.content });
      return true;
    } catch (err) {
      showError(err, "Save failed");
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
      await load(path, { keepEntries: true });
      finishProgress(true);
    } catch (err) {
      window.clearInterval(timer);
      showError(err, "Delete failed");
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
      await load(path, { keepEntries: true });
      finishProgress(true);
    } catch (err) {
      showError(err, "Delete failed");
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
    const timer = startFakeProgress(`Extracting ${entry.name}`);
    try {
      await files({ action: "extract", path: joinPath(path, entry.name) });
      window.clearInterval(timer);
      setPercent(100);
      await load(path, { keepEntries: true });
      finishProgress(true);
    } catch (err) {
      window.clearInterval(timer);
      showError(err, "Extract failed");
      finishProgress(false);
    }
  }

  async function compress(items: Entry[]) {
    if (!items.length) return;
    const names = items.map((entry) => entry.name);
    const label = names.length === 1 ? names[0] : `${names.length} items`;
    const timer = startFakeProgress(`Archiving ${label}`);
    try {
      await files({ action: "compress", path, names });
      window.clearInterval(timer);
      setPercent(100);
      setSelected(new Set());
      await load(path, { keepEntries: true });
      finishProgress(true);
    } catch (err) {
      window.clearInterval(timer);
      showError(err, "Archive failed");
      finishProgress(false);
    }
  }

  function closeNameModal() {
    if (namePending) return;
    setNameModal(null);
    setNameValue("");
    setNameError(null);
  }

  function openCreate(kind: "file" | "dir") {
    setNameModal({ mode: kind === "file" ? "create-file" : "create-dir" });
    setNameValue("");
    setNameError(null);
  }

  function openRename(entry: Entry) {
    setNameModal({ mode: "rename", entry });
    setNameValue(entry.name);
    setNameError(null);
  }

  function focusNameInput(event: FocusEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    if (nameModal?.mode === "rename" && nameModal.entry.kind === "file") {
      const current = nameModal.entry.name;
      const dot = current.lastIndexOf(".");
      if (dot > 0) {
        input.setSelectionRange(0, dot);
        return;
      }
    }
    input.select();
  }

  async function submitNameModal() {
    if (!nameModal || namePending) return;
    const parsed = parseEntryName(nameValue);
    if ("error" in parsed) {
      setNameError(parsed.error);
      return;
    }
    const name = parsed.name;
    if (nameModal.mode === "rename" && name === nameModal.entry.name) {
      closeNameModal();
      return;
    }
    if (nameModal.mode !== "rename" && entries.some((entry) => entry.name === name)) {
      setNameError("A file or folder with that name already exists");
      return;
    }
    if (nameModal.mode === "rename" && entries.some((entry) => entry.name === name && entry.name !== nameModal.entry.name)) {
      setNameError("A file or folder with that name already exists");
      return;
    }
    setNameError(null);
    setNamePending(true);
    try {
      if (nameModal.mode === "create-dir") {
        await files({ action: "mkdir", path: joinPath(path, name) });
      } else if (nameModal.mode === "create-file") {
        await files({ action: "write", path: joinPath(path, name), content: "" });
      } else {
        const from = joinPath(path, nameModal.entry.name);
        const to = joinPath(path, name);
        await files({ action: "rename", path: from, to });
        if (isEditing(nameModal.entry) && editing) setEditing({ ...editing, path: to });
      }
      setNameModal(null);
      setNameValue("");
      await load(path, { keepEntries: true });
    } catch (err) {
      setNameError(err instanceof Error ? err.message : nameModal.mode === "rename" ? "Rename failed" : "Create failed");
    } finally {
      setNamePending(false);
    }
  }

  async function copyPath(entry: Entry) {
    const full = displayContainerPath(joinPath(path, entry.name));
    try {
      await navigator.clipboard.writeText(full);
    } catch {
      toast("Could not copy path");
    }
  }

  async function openByPath(raw: string) {
    const parsed = parseContainerPath(raw, path);
    try {
      const result = await files({ action: "stat", path: parsed });
      const data = result.data as { path: string; kind: "file" | "dir" };
      if (data.kind === "dir") {
        if (normalizeDir(data.path) === path) {
          router.replace(filesHref(pathname, path), { scroll: false });
          return;
        }
        browse(data.path);
        return;
      }
      const dir = parentPath(data.path);
      pendingOpen.current = data.path;
      if (dir !== path) {
        browse(dir);
        return;
      }
      pendingOpen.current = null;
      await openFileAt(data.path);
      router.replace(filesHref(pathname, path), { scroll: false });
    } catch (err) {
      pendingOpen.current = null;
      showError(err, "Path not found");
      router.replace(filesHref(pathname, path), { scroll: false });
    }
  }

  async function runSearch() {
    const value = query.trim();
    if (!value) {
      setSearchHits(null);
      return;
    }
    if (looksLikePath(value)) {
      setSearchHits(null);
      await openByPath(value);
      return;
    }
    setSearching(true);
    try {
      const result = await files({ action: "search", path, query: value });
      const data = result.data as { matches?: SearchHit[]; truncated?: boolean };
      setSearchHits({ matches: data.matches ?? [], truncated: Boolean(data.truncated) });
    } catch (err) {
      showError(err, "Search failed");
      setSearchHits(null);
    } finally {
      setSearching(false);
    }
  }

  function openSearchHit(hit: SearchHit) {
    setSearchHits(null);
    if (hit.kind === "dir") {
      browse(hit.path);
      return;
    }
    const dir = parentPath(hit.path);
    pendingOpen.current = hit.path;
    if (dir !== path) {
      browse(dir);
      return;
    }
    pendingOpen.current = null;
    void openFileAt(hit.path);
  }

  async function downloadItems(items: Entry[]) {
    if (!items.length) return;
    const names = items.map((entry) => entry.name);
    const label = names.length === 1 ? names[0] : `${names.length} items`;
    const timer = startFakeProgress(`Downloading ${label}`);
    try {
      const params = new URLSearchParams();
      params.set("path", path);
      for (const name of names) params.append("names", name);
      const { blob, filename } = await apiDownload(`/api/v1/client/servers/${id}/files/download?${params}`);
      window.clearInterval(timer);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      finishProgress(true);
    } catch (err) {
      window.clearInterval(timer);
      showError(err, "Download failed");
      finishProgress(false);
    }
  }

  function openMove(items: Entry[]) {
    if (!items.length) return;
    setMoveModal({ from: path, entries: items });
    setMoveDest(path);
    setMoveList(entries);
    setMoveError(null);
    setMovePending(false);
  }

  function closeMoveModal() {
    if (movePending) return;
    setMoveModal(null);
    setMoveError(null);
    setMoveList([]);
  }

  async function browseMove(dir: string) {
    const next = normalizeDir(dir);
    const seq = ++moveSeq.current;
    setMoveError(null);
    setMoveLoading(true);
    setMoveDest(next);
    setMoveList([]);
    try {
      const result = await files({ action: "list", path: next });
      if (seq !== moveSeq.current) return;
      const data = result.data as { path: string; entries: Entry[] };
      setMoveDest(normalizeDir(data.path));
      setMoveList(data.entries ?? []);
    } catch (err) {
      if (seq !== moveSeq.current) return;
      setMoveError(err instanceof Error ? err.message : "Failed to list folders");
    } finally {
      if (seq === moveSeq.current) setMoveLoading(false);
    }
  }

  async function submitMove() {
    if (!moveModal || movePending) return;
    if (cannotMoveTo(moveModal.from, moveModal.entries, moveDest)) {
      setMoveError(normalizeDir(moveDest) === normalizeDir(moveModal.from) ? "Already in this folder" : "Cannot move a folder into itself");
      return;
    }
    const collisions = moveCollisions(moveModal.from, moveModal.entries, moveDest, moveList);
    if (collisions.length) {
      setMoveError(
        collisions.length === 1
          ? `${collisions[0]} already exists in this folder`
          : `${collisions.length} items already exist in this folder`,
      );
      return;
    }
    setMoveError(null);
    setMovePending(true);
    try {
      for (const entry of moveModal.entries) {
        const from = joinPath(moveModal.from, entry.name);
        const to = joinPath(moveDest, entry.name);
        await files({ action: "rename", path: from, to });
        if (editing && (editing.path === from || editing.path === entry.name)) {
          setEditing({ ...editing, path: to });
        }
      }
      setMoveModal(null);
      setSelected(new Set());
      await load(path, { keepEntries: true });
    } catch (err) {
      setMoveError(err instanceof Error ? err.message : "Move failed");
    } finally {
      setMovePending(false);
    }
  }

  async function uploadList(list: { relative: string; file: File }[]) {
    if (!list.length) return;
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
      await load(path, { keepEntries: true });
      finishProgress(true);
    } catch (err) {
      showError(err, "Upload failed");
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

  const moveFolders = moveList.filter((entry) => entry.kind === "dir");
  const moveConflicts = moveModal
    ? moveCollisions(moveModal.from, moveModal.entries, moveDest, moveList)
    : [];
  const moveBlocked = Boolean(
    moveModal && cannotMoveTo(moveModal.from, moveModal.entries, moveDest),
  );
  const moveHereDisabled = !moveModal || movePending || moveLoading || moveBlocked || moveConflicts.length > 0;

  return (
    <div className="space-y-4">
      {percent !== null ? <TopLoadingBar label={progressLabel ?? "Working"} percent={percent} /> : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Files</h2>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="no-press inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              disabled={path === "/"}
              aria-label="Parent directory"
              title="Parent directory"
              onClick={(event) => {
                if (shouldIgnoreClick(event)) return;
                armClickGuard(event);
                browse(parentPath(path));
              }}
            >
              <ArrowUp className="size-3.5" />
            </button>
            <PathCrumbs
              path={path}
              onBrowse={(dir, event) => {
                if (shouldIgnoreClick(event)) return;
                armClickGuard(event);
                browse(dir);
              }}
            />
            <span className="inline-flex size-3.5 shrink-0 items-center justify-center" aria-hidden={!listing}>
              {listing ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Loading folder" /> : null}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="relative min-w-[12rem] flex-1 sm:max-w-xs"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search or paste a path"
              className="h-9 pl-8 pr-8"
              aria-label="Search files or open a path"
            />
            {searching ? (
              <Loader2 className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : null}
          </form>
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
          {selected.size > 0 ? (
            <>
              <p className="hidden text-sm text-muted-foreground sm:block">
                <span className="font-medium text-foreground">{selected.size}</span> selected
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={() => selectAll(false)}>
                Clear
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() => void downloadItems(entries.filter((entry) => selected.has(entry.name)))}
              >
                <Download className="size-3.5" />
                Download
              </Button>
              {canWrite ? (
                <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => openMove(entries.filter((entry) => selected.has(entry.name)))}>
                  <FolderInput className="size-3.5" />
                  Move
                </Button>
              ) : null}
              {canArchive ? (
                <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => void compress(entries.filter((entry) => selected.has(entry.name)))}>
                  <Archive className="size-3.5" />
                  Archive
                </Button>
              ) : null}
              {canDelete ? (
                <Button type="button" variant="danger" size="sm" disabled={pending} onClick={() => void removeSelected()}>
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
              ) : null}
            </>
          ) : canWrite ? (
            <>
              <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => inputRef.current?.click()}>
                <Upload className="size-3.5" />
                Upload
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => openCreate("dir")}>
                <FolderPlus className="size-3.5" />
                Folder
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => openCreate("file")}>
                <FilePlus className="size-3.5" />
                File
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {searchHits ? (
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
            <p className="text-sm text-muted-foreground">
              {searchHits.matches.length === 0
                ? `No matches in ${displayContainerPath(path)}`
                : `${searchHits.matches.length} match${searchHits.matches.length === 1 ? "" : "es"} in ${displayContainerPath(path)}`}
              {searchHits.truncated ? " · results are capped" : ""}
            </p>
            <Button type="button" variant="ghost" size="sm" onClick={() => setSearchHits(null)}>
              Close
            </Button>
          </div>
          {searchHits.matches.length ? (
            <ul className="max-h-56 overflow-auto py-1">
              {searchHits.matches.map((hit) => (
                <li key={hit.path}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm hover:bg-muted/50"
                    onClick={() => openSearchHit(hit)}
                  >
                    {hit.kind === "dir" ? (
                      <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <FileTypeIcon name={hit.name} className="size-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 truncate font-medium">{hit.name}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                      {displayContainerPath(hit.path)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      <div
        className="relative"
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
          className="w-full select-none text-sm outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none"
          tabIndex={0}
          aria-busy={listing}
          onKeyDown={(event: KeyboardEvent<HTMLTableElement>) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
              event.preventDefault();
              selectAll(true);
            }
            if (event.key === "Backspace" && path !== "/" && !(event.target instanceof HTMLInputElement)) {
              event.preventDefault();
              browse(parentPath(path));
            }
          }}
        >
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-12 p-0">
                <SelectHit
                  checked={entries.length > 0 && selected.size === entries.length}
                  indeterminate={selected.size > 0 && selected.size < entries.length}
                  disabled={!entries.length}
                  label="Select all"
                  onChange={onSelectAll}
                />
              </th>
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Type</th>
              <th className="px-4 py-2.5 font-medium">Size</th>
              <th className="px-4 py-2.5 font-medium" />
            </tr>
          </thead>
          <tbody className={cn(listing && "pointer-events-none")}>
            {entries.map((entry, index) => {
              const active = menu?.kind === "entry" && menu.entry.name === entry.name;
              const checked = selected.has(entry.name);
              return (
                <tr
                  key={entry.name}
                  className={cn(
                    "cursor-pointer border-t border-border hover:bg-muted/40",
                    (active || checked) && "bg-muted/60",
                  )}
                  onContextMenu={(event) =>
                    openMenu(event, { x: event.clientX, y: event.clientY, kind: "entry", entry })
                  }
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("input, button, label")) return;
                    void openEntry(entry, event);
                  }}
                >
                  <td className="p-0">
                    <SelectHit
                      checked={checked}
                      label={`Select ${entry.name}`}
                      onChange={(event) => {
                        const shift = "shiftKey" in event.nativeEvent && Boolean(event.nativeEvent.shiftKey);
                        toggleSelect(entry.name, index, shift);
                      }}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex min-w-0 items-center gap-2">
                      {entry.kind === "dir" ? (
                        <Folder className="size-4 shrink-0 text-primary" />
                      ) : (
                        <FileTypeIcon name={entry.name} className="shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate font-medium" title={entry.name}>
                        {entry.name}
                      </span>
                    </span>
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
                        className="no-press size-8 px-0 text-muted-foreground hover:text-foreground"
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
            {listing && entries.length === 0 ? (
              <tr className="border-t border-border">
                <td className="px-4 py-8 text-center text-sm text-muted-foreground" colSpan={5}>
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    Loading folder…
                  </span>
                </td>
              </tr>
            ) : !listing && entries.length === 0 ? (
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
                icon={
                  menu.entry.kind === "dir" ? (
                    <FolderOpen className="size-3.5" />
                  ) : (
                    <FileTypeIcon name={menu.entry.name} size={14} className="text-muted-foreground" />
                  )
                }
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
                  openRename(entry);
                }}
              />
              <MenuItem
                icon={<FolderInput className="size-3.5" />}
                label={selected.size > 1 && selected.has(menu.entry.name) ? `Move ${selected.size} items` : "Move"}
                disabled={pending || !canWrite}
                onClick={() => {
                  const entry = menu.entry;
                  const bulk = selected.size > 1 && selected.has(entry.name);
                  setMenu(null);
                  openMove(bulk ? entries.filter((item) => selected.has(item.name)) : [entry]);
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
              <MenuItem
                icon={<Download className="size-3.5" />}
                label={selected.size > 1 && selected.has(menu.entry.name) ? `Download ${selected.size} items` : "Download"}
                disabled={pending}
                onClick={() => {
                  const entry = menu.entry;
                  const bulk = selected.size > 1 && selected.has(entry.name);
                  setMenu(null);
                  void downloadItems(bulk ? entries.filter((item) => selected.has(item.name)) : [entry]);
                }}
              />
              {canArchive ? (
                <MenuItem
                  icon={<Archive className="size-3.5" />}
                  label={selected.size > 1 && selected.has(menu.entry.name) ? `Archive ${selected.size} items` : "Archive"}
                  disabled={pending}
                  onClick={() => {
                    const entry = menu.entry;
                    const bulk = selected.size > 1 && selected.has(entry.name);
                    setMenu(null);
                    void compress(bulk ? entries.filter((item) => selected.has(item.name)) : [entry]);
                  }}
                />
              ) : null}
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
                  openCreate("file");
                }}
              />
              <MenuItem
                icon={<FolderPlus className="size-3.5" />}
                label="New folder"
                disabled={pending}
                onClick={() => {
                  setMenu(null);
                  openCreate("dir");
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
              {selected.size > 0 ? (
                <MenuItem
                  icon={<Download className="size-3.5" />}
                  label={selected.size === 1 ? "Download" : `Download ${selected.size} items`}
                  disabled={pending}
                  onClick={() => {
                    const items = entries.filter((entry) => selected.has(entry.name));
                    setMenu(null);
                    void downloadItems(items);
                  }}
                />
              ) : null}
              {canArchive && selected.size > 0 ? (
                <MenuItem
                  icon={<Archive className="size-3.5" />}
                  label={selected.size === 1 ? "Archive" : `Archive ${selected.size} items`}
                  disabled={pending}
                  onClick={() => {
                    const items = entries.filter((entry) => selected.has(entry.name));
                    setMenu(null);
                    void compress(items);
                  }}
                />
              ) : null}
              <MenuItem
                icon={<RefreshCw className="size-3.5" />}
                label="Refresh"
                disabled={pending}
                onClick={() => {
                  setMenu(null);
                  void load(path, { keepEntries: true });
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

      <Modal
        title={
          nameModal?.mode === "create-file"
            ? "New file"
            : nameModal?.mode === "create-dir"
              ? "New folder"
              : "Rename"
        }
        description={
          nameModal?.mode === "rename"
            ? `Renaming ${nameModal.entry.name}`
            : `This will be created in ${displayContainerPath(path)}`
        }
        open={Boolean(nameModal)}
        onClose={closeNameModal}
        className="max-w-md"
        footer={
          <>
            <Button type="button" variant="secondary" size="sm" disabled={namePending} onClick={closeNameModal}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={namePending || !nameValue.trim()}
              onClick={() => void submitNameModal()}
            >
              {namePending
                ? "Saving…"
                : nameModal?.mode === "create-file"
                  ? "Create file"
                  : nameModal?.mode === "create-dir"
                    ? "Create folder"
                    : "Rename"}
            </Button>
          </>
        }
      >
        {nameError ? <p className="mb-3 text-sm text-destructive">{nameError}</p> : null}
        <Field label="Name" required>
          <Input
            autoFocus
            value={nameValue}
            disabled={namePending}
            placeholder={
              nameModal?.mode === "create-dir"
                ? "plugins"
                : nameModal?.mode === "create-file"
                  ? "server.properties"
                  : undefined
            }
            onChange={(event) => {
              setNameValue(event.target.value);
              if (nameError) setNameError(null);
            }}
            onFocus={focusNameInput}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submitNameModal();
              }
            }}
          />
        </Field>
      </Modal>

      <Modal
        title={
          moveModal && moveModal.entries.length === 1
            ? `Move ${moveModal.entries[0]?.name}`
            : `Move ${moveModal?.entries.length ?? 0} items`
        }
        description="Choose a folder, then move the selection here."
        open={Boolean(moveModal)}
        onClose={closeMoveModal}
        className="max-w-md"
        footer={
          <>
            <Button type="button" variant="secondary" size="sm" disabled={movePending} onClick={closeMoveModal}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={moveHereDisabled}
              onClick={() => void submitMove()}
            >
              {movePending ? "Moving…" : "Move here"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {moveError ? <p className="text-sm text-destructive">{moveError}</p> : null}
          <div className="flex items-center gap-2">
            <PathCrumbs
              path={moveDest}
              onBrowse={(dir, event) => {
                if (shouldIgnoreClick(event)) return;
                armClickGuard(event);
                void browseMove(dir);
              }}
            />
            {moveLoading ? <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-label="Loading folder" /> : null}
          </div>
          <p className="font-mono text-xs text-muted-foreground">{displayContainerPath(moveDest)}</p>
          <div className={cn("max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border", moveLoading && "pointer-events-none")}>
            {moveDest !== "/" ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                disabled={movePending}
                onClick={(event) => {
                  if (shouldIgnoreClick(event)) return;
                  armClickGuard(event);
                  void browseMove(parentPath(moveDest));
                }}
              >
                <ArrowUp className="size-3.5" />
                Parent directory
              </button>
            ) : null}
            {moveFolders.map((folder) => {
              const blocked =
                moveModal != null &&
                normalizeDir(moveDest) === normalizeDir(moveModal.from) &&
                moveModal.entries.some((entry) => entry.kind === "dir" && entry.name === folder.name);
              return (
                <button
                  key={folder.name}
                  type="button"
                  disabled={blocked || movePending}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                  onClick={(event) => {
                    if (shouldIgnoreClick(event)) return;
                    armClickGuard(event);
                    void browseMove(joinPath(moveDest, folder.name));
                  }}
                >
                  <Folder className="size-3.5 text-muted-foreground" />
                  <span className="truncate">{folder.name}</span>
                </button>
              );
            })}
            {moveLoading && moveFolders.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  Loading folder…
                </span>
              </p>
            ) : moveFolders.length === 0 ? (
              <p className={cn("text-center text-sm text-muted-foreground", moveDest === "/" ? "px-3 py-8" : "px-3 py-3")}>
                No folders in this directory
              </p>
            ) : null}
          </div>
          {moveModal && moveBlocked ? (
            <p className="text-xs text-muted-foreground">
              {normalizeDir(moveDest) === normalizeDir(moveModal.from)
                ? "Already in this folder. Open a different folder to move."
                : "Cannot move a folder into itself."}
            </p>
          ) : moveConflicts.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {moveConflicts.length === 1
                ? `${moveConflicts[0]} already exists here`
                : `${moveConflicts.length} items already exist here`}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Move to {displayContainerPath(moveDest)}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
