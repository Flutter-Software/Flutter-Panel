"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  ChevronRight,
  Clock,
  Database,
  FilePlus,
  FileUp,
  FileX,
  Folder,
  FolderPlus,
  HardDrive,
  History,
  Network,
  Play,
  Search,
  Settings,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  ACTIVITY_CATEGORY_META,
  ACTIVITY_FILE_STACK_MS,
  isActivityCategory,
  type ActivityActorKind,
  type ActivityCategory,
} from "@flutter-software/shared";
import { Card, EmptyState, Input, Modal, Select } from "@/components/ui";
import { FileTypeIcon } from "@/components/file-type-icon";
import { useServerRecord } from "@/components/server-frame";
import { api, HttpError } from "@/lib/api";
import { can } from "@/lib/access";
import { cn } from "@/lib/cn";

type ActivityEvent = {
  id: string;
  event: string;
  category: ActivityCategory;
  title: string;
  actor: { id: string | null; name: string; kind: ActivityActorKind };
  ip: string | null;
  properties: Record<string, unknown>;
  createdAt: string;
};

type FileSnapshot = {
  at: string;
  added: number;
  removed: number;
  created: boolean;
  truncated: boolean;
  preview: string;
  known: boolean;
};

type OpenPreview = {
  event: ActivityEvent;
  snapshot: FileSnapshot;
};

const CATEGORY_ICON: Record<ActivityCategory, LucideIcon> = {
  power: Play,
  files: Folder,
  backups: Archive,
  users: Users,
  settings: Settings,
  startup: SlidersHorizontal,
  databases: Database,
  schedules: Clock,
  sftp: HardDrive,
  network: Network,
};

function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function dayKey(iso: string) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function namesOf(event: ActivityEvent) {
  return Array.isArray(event.properties.names) ? event.properties.names.map((item) => String(item)).filter(Boolean) : [];
}

function fileNameOf(event: ActivityEvent) {
  return text(event.properties.path) || text(event.properties.name) || text(event.properties.to) || namesOf(event)[0] || "";
}

function baseName(path: string) {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function actorKey(event: ActivityEvent) {
  return event.actor.id || event.actor.name;
}

function actorLabel(event: ActivityEvent) {
  return event.actor.kind === "schedule" ? event.actor.name : event.actor.name;
}

function asSnapshot(value: unknown): FileSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return {
    at: text(row.at),
    added: num(row.added),
    removed: num(row.removed),
    created: Boolean(row.created),
    truncated: Boolean(row.truncated),
    preview: text(row.preview),
    known: true,
  };
}

function snapshotsOf(event: ActivityEvent): FileSnapshot[] {
  const raw = event.properties.snapshots;
  if (Array.isArray(raw) && raw.length) {
    return raw.map(asSnapshot).filter((item): item is FileSnapshot => Boolean(item));
  }
  return [
    {
      at: event.createdAt,
      added: num(event.properties.added),
      removed: num(event.properties.removed),
      created: Boolean(event.properties.created),
      truncated: Boolean(event.properties.truncated),
      preview: text(event.properties.preview),
      known: typeof event.properties.preview === "string" || Array.isArray(event.properties.snapshots),
    },
  ];
}

function snapshotHasEdits(snapshot: FileSnapshot) {
  return snapshot.added > 0 || snapshot.removed > 0 || snapshot.created;
}

function orderedSnapshots(event: ActivityEvent) {
  const edits: FileSnapshot[] = [];
  const rest: FileSnapshot[] = [];
  for (const snapshot of snapshotsOf(event)) {
    (snapshotHasEdits(snapshot) ? edits : rest).push(snapshot);
  }
  const byNewest = (a: FileSnapshot, b: FileSnapshot) => Date.parse(b.at || "0") - Date.parse(a.at || "0");
  edits.sort(byNewest);
  rest.sort(byNewest);
  return [...edits, ...rest];
}

function stackCount(event: ActivityEvent) {
  return Math.max(num(event.properties.saves), snapshotsOf(event).length, 1);
}

function isWriteStack(event: ActivityEvent) {
  return event.event === "file.write" && stackCount(event) > 1;
}

function stackFileWrites(events: ActivityEvent[]) {
  const out: (ActivityEvent & { stackOldest: number })[] = [];
  for (const event of events) {
    const last = out[out.length - 1];
    const stamp = new Date(event.createdAt).getTime();
    if (
      last &&
      event.event === "file.write" &&
      last.event === "file.write" &&
      text(event.properties.path) &&
      text(event.properties.path) === text(last.properties.path) &&
      actorKey(event) === actorKey(last) &&
      last.stackOldest - stamp <= ACTIVITY_FILE_STACK_MS
    ) {
      const extra = Math.max(num(event.properties.saves), 1);
      last.properties = {
        ...last.properties,
        saves: Math.max(num(last.properties.saves), 1) + extra,
        snapshots: [...snapshotsOf(event), ...snapshotsOf(last)],
      };
      last.stackOldest = stamp;
      continue;
    }
    out.push({ ...event, properties: { ...event.properties }, stackOldest: stamp });
  }
  return out.map(({ stackOldest: _stackOldest, ...event }) => event);
}

function DiffCounts({ added, removed }: { added: number; removed: number }) {
  if (!added && !removed) return null;
  return (
    <span className="font-mono">
      {added ? <span className="text-status-running">+{added}</span> : null}
      {added && removed ? " " : null}
      {removed ? <span className="text-destructive">−{removed}</span> : null}
    </span>
  );
}

function FileActionGlyph({ event, snapshot }: { event: ActivityEvent; snapshot?: FileSnapshot }) {
  const name = fileNameOf(event);
  const created = Boolean(snapshot?.created || event.properties.created);

  if (event.event === "file.mkdir") {
    return <FolderPlus className="size-4 text-status-running" />;
  }
  if (event.event === "file.delete") {
    return name ? <FileTypeIcon name={name} size={16} className="text-destructive" /> : <FileX className="size-4 text-destructive" />;
  }
  if (event.event === "file.upload") {
    return name ? <FileTypeIcon name={name} size={16} className="text-muted-foreground" /> : <FileUp className="size-4 text-muted-foreground" />;
  }
  if (event.event === "file.rename") {
    return <FileTypeIcon name={text(event.properties.to) || name} size={16} className="text-muted-foreground" />;
  }
  if (event.event === "file.compress" || event.event === "file.extract") {
    return <FileTypeIcon name={name || "archive.zip"} size={16} className="text-muted-foreground" />;
  }
  if (created) {
    return name ? (
      <FileTypeIcon name={name} size={16} className="text-status-running" />
    ) : (
      <FilePlus className="size-4 text-status-running" />
    );
  }
  if (name) return <FileTypeIcon name={name} size={16} className="text-muted-foreground" />;
  const Fallback = isActivityCategory(event.category) ? CATEGORY_ICON[event.category] : History;
  return <Fallback className="size-4 text-muted-foreground" />;
}

function Glyph({ event, snapshot }: { event: ActivityEvent; snapshot?: FileSnapshot }) {
  const fileEvent = event.event.startsWith("file.");
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground">
      {fileEvent ? (
        <FileActionGlyph event={event} snapshot={snapshot} />
      ) : (
        (() => {
          const Icon = isActivityCategory(event.category) ? CATEGORY_ICON[event.category] : History;
          return <Icon className="size-3.5" />;
        })()
      )}
    </span>
  );
}

function snapshotLabel(snapshot: FileSnapshot) {
  if (snapshot.created) return "Created";
  if (snapshotHasEdits(snapshot)) return "Edited";
  return "No changes";
}

function parsePreview(preview: string) {
  return preview.split("\n").map((line, index) => {
    if (line === "@@") return { key: index, kind: "hunk" as const, text: "" };
    const mark = line[0];
    if (mark === "+" || mark === "-" || mark === " ") {
      return { key: index, kind: mark, text: line.slice(1) };
    }
    return { key: index, kind: " " as const, text: line };
  });
}

function DiffPreview({ snapshot }: { snapshot: FileSnapshot }) {
  const rows = snapshot.preview ? parsePreview(snapshot.preview) : [];
  if (!rows.length) {
    if (snapshotHasEdits(snapshot) || !snapshot.known) {
      return (
        <p className="text-sm text-muted-foreground">
          No preview was saved for this edit. New file saves will include the added and removed lines.
        </p>
      );
    }
    return <p className="text-sm text-muted-foreground">Saved with no changes.</p>;
  }
  return (
    <pre className="overflow-x-auto rounded-lg border border-border bg-background font-mono text-[12px] leading-5">
      {rows.map((row) =>
        row.kind === "hunk" ? (
          <div key={row.key} className="border-y border-border/70 bg-muted/40 px-3 py-1 text-[10px] text-muted-foreground">
            ···
          </div>
        ) : (
          <div
            key={row.key}
            className={cn(
              "grid grid-cols-[1.25rem_minmax(0,1fr)] px-3",
              row.kind === "+" && "bg-status-running/10 text-status-running",
              row.kind === "-" && "bg-destructive/10 text-destructive",
            )}
          >
            <span className="select-none opacity-70">{row.kind === " " ? " " : row.kind}</span>
            <span className="whitespace-pre-wrap break-all text-inherit">{row.text || " "}</span>
          </div>
        ),
      )}
    </pre>
  );
}

function Meta({ event, extra }: { event: ActivityEvent; extra?: ReactNode }) {
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      <span>{actorLabel(event)}</span>
      <span aria-hidden="true">·</span>
      <time dateTime={event.createdAt} title={new Date(event.createdAt).toLocaleString()}>
        {timeLabel(event.createdAt)}
      </time>
      {extra}
    </span>
  );
}

function FileStack({
  event,
  onOpen,
}: {
  event: ActivityEvent;
  onOpen: (item: OpenPreview) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const touch = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const enterTimer = useRef(0);
  const leaveTimer = useRef(0);
  const items = orderedSnapshots(event);
  const depth = Math.min(stackCount(event) - 1, 2);
  const path = fileNameOf(event);
  const top = items[0];

  function clearTimers() {
    window.clearTimeout(enterTimer.current);
    window.clearTimeout(leaveTimer.current);
  }

  useEffect(() => () => clearTimers(), []);

  function expand() {
    clearTimers();
    setExpanded(true);
  }

  function collapse() {
    clearTimers();
    setExpanded(false);
  }

  useEffect(() => {
    if (!expanded) return;
    function onDoc(pointer: PointerEvent) {
      if (!(pointer.target instanceof Node)) return;
      if (root.current?.contains(pointer.target)) return;
      collapse();
    }
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [expanded]);

  return (
    <div
      ref={root}
      className={cn("relative isolate", expanded && "z-10")}
      onPointerEnter={(pointer) => {
        if (pointer.pointerType !== "mouse") return;
        window.clearTimeout(leaveTimer.current);
        enterTimer.current = window.setTimeout(expand, 500);
      }}
      onPointerLeave={(pointer) => {
        if (pointer.pointerType !== "mouse") return;
        window.clearTimeout(enterTimer.current);
        leaveTimer.current = window.setTimeout(() => {
          if (root.current?.matches(":hover")) return;
          collapse();
        }, 160);
      }}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-haspopup="listbox"
        onPointerDown={(pointer) => {
          touch.current = pointer.pointerType !== "mouse";
        }}
        onClick={() => {
          if (touch.current && !expanded) {
            expand();
            return;
          }
          if (top) onOpen({ event, snapshot: top });
        }}
        className="no-press relative z-[1] flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left hover:bg-muted"
      >
        <span className="relative">
          <Glyph event={event} snapshot={top} />
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-semibold leading-none text-background">
            {stackCount(event)}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{event.title}</span>
          <Meta
            event={event}
            extra={
              <>
                <span aria-hidden="true">·</span>
                <span>{stackCount(event)} saves</span>
                <DiffCounts added={num(event.properties.added)} removed={num(event.properties.removed)} />
              </>
            }
          />
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {depth > 0 && !expanded ? (
        <div aria-hidden className="pointer-events-none relative z-0 -mt-px px-2.5">
          <div className="h-1.5 rounded-b-xl border border-t-0 border-border bg-card" />
          {depth > 1 ? (
            <div className="mx-2.5 -mt-px h-1.5 rounded-b-xl border border-t-0 border-border/70 bg-muted" />
          ) : null}
        </div>
      ) : null}

      <div
        className={cn(
          "relative z-[1] grid transition-[grid-template-rows] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
          !expanded && "pointer-events-none",
        )}
        style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            role="list"
            inert={!expanded}
            aria-label={`${stackCount(event)} saves`}
            className="mt-1 overflow-hidden rounded-xl border border-border bg-card"
          >
            {items.map((snapshot, index) => (
              <button
                key={`${snapshot.at}-${index}`}
                type="button"
                role="listitem"
                onClick={() => onOpen({ event, snapshot })}
                className="no-press flex w-full items-center gap-3 border-b border-border px-4 py-2.5 text-left last:border-b-0 hover:bg-muted"
              >
                <Glyph event={event} snapshot={snapshot} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {snapshotLabel(snapshot)} {path ? baseName(path) : "file"}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>{actorLabel(event)}</span>
                    {snapshot.at ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <time dateTime={snapshot.at}>{timeLabel(snapshot.at)}</time>
                      </>
                    ) : null}
                    <DiffCounts added={snapshot.added} removed={snapshot.removed} />
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivityRow({
  event,
  onOpen,
}: {
  event: ActivityEvent;
  onOpen: (item: OpenPreview) => void;
}) {
  const clickable = event.event === "file.write";
  const snapshot = clickable ? orderedSnapshots(event)[0] : undefined;
  const row = (
    <>
      <Glyph event={event} snapshot={snapshot} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{event.title}</span>
        <Meta
          event={event}
          extra={<DiffCounts added={num(event.properties.added)} removed={num(event.properties.removed)} />}
        />
      </span>
      {clickable ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" /> : null}
    </>
  );

  if (clickable && snapshot) {
    return (
      <button
        type="button"
        onClick={() => onOpen({ event, snapshot })}
        className="no-press flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left hover:bg-muted"
      >
        {row}
      </button>
    );
  }

  return <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">{row}</div>;
}

export default function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const server = useServerRecord();
  const canRead = can(server, "activity.read");
  const [category, setCategory] = useState<"" | ActivityCategory>("");
  const [actor, setActor] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [actors, setActors] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<OpenPreview | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => setSearch(query.trim()), 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  const load = useCallback(
    async (reset: boolean, nextCursor?: string | null) => {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (actor) params.set("actor", actor);
      if (search) params.set("q", search);
      if (!reset && nextCursor) params.set("cursor", nextCursor);
      const qs = params.toString();
      const result = await api<{ data: { events: ActivityEvent[]; nextCursor: string | null; actors: string[] } }>(
        `/api/v1/client/servers/${id}/activity${qs ? `?${qs}` : ""}`,
      );
      setActors(result.data.actors ?? []);
      setCursor(result.data.nextCursor);
      setEvents((current) => (reset ? result.data.events : [...current, ...result.data.events]));
      setError(null);
    },
    [actor, category, id, search],
  );

  useEffect(() => {
    if (!server?.id) return;
    if (!canRead) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    load(true)
      .catch((err) => {
        if (cancelled) return;
        setEvents([]);
        setError(err instanceof Error ? err.message : "Failed to load activity");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canRead, load, server?.id]);

  const groups = useMemo(() => {
    const out: { label: string; key: string; events: ActivityEvent[] }[] = [];
    for (const event of stackFileWrites(events)) {
      const key = dayKey(event.createdAt);
      const last = out[out.length - 1];
      if (last && last.key === key) last.events.push(event);
      else out.push({ key, label: dayLabel(event.createdAt), events: [event] });
    }
    return out;
  }, [events]);

  if (server && !canRead) {
    return (
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Activity</h2>
        <p className="text-sm text-muted-foreground">You do not have permission to view activity on this server.</p>
      </div>
    );
  }

  const snapshot = open?.snapshot;
  const path = open ? fileNameOf(open.event) : "";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Activity</h2>
          <p className="text-sm text-muted-foreground">A log of who changed this server.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[12rem] flex-1 sm:w-56 sm:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              className="h-9 pl-9"
            />
          </div>
          <Select
            compact
            className="w-[9.5rem]"
            value={category}
            onChange={(event) => setCategory((event.target as HTMLSelectElement).value as "" | ActivityCategory)}
          >
            <option value="">All types</option>
            {ACTIVITY_CATEGORY_META.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </Select>
          <Select compact className="w-[9.5rem]" value={actor} onChange={(event) => setActor((event.target as HTMLSelectElement).value)}>
            <option value="">Anyone</option>
            {actors.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {loading && events.length === 0 ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} className="flex items-center gap-3 px-4 py-3">
              <div className="size-8 shrink-0 rounded-lg bg-muted" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3.5 w-1/2 rounded bg-muted" />
                <div className="h-3 w-1/4 rounded bg-muted" />
              </div>
            </Card>
          ))}
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          title={category || actor || search ? "No matching activity" : "Nothing yet"}
          description={
            category || actor || search
              ? "Try a different filter or search."
              : "Power actions, file edits, backups, and subuser changes will show up here."
          }
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key} className="space-y-2">
              <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h3>
              <div className="space-y-2">
                {group.events.map((event) =>
                  isWriteStack(event) ? (
                    <FileStack key={event.id} event={event} onOpen={setOpen} />
                  ) : (
                    <ActivityRow key={event.id} event={event} onOpen={setOpen} />
                  ),
                )}
              </div>
            </section>
          ))}
          {cursor ? (
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => {
                setLoadingMore(true);
                load(false, cursor)
                  .catch((err) => {
                    if (err instanceof HttpError) setError(err.message);
                    else setError(err instanceof Error ? err.message : "Failed to load more");
                  })
                  .finally(() => setLoadingMore(false));
              }}
              className="w-full rounded-xl border border-border py-2.5 text-sm text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Older activity"}
            </button>
          ) : null}
        </div>
      )}

      <Modal
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        title={path ? baseName(path) : open?.event.title || "File change"}
        description={
          open && snapshot
            ? `${actorLabel(open.event)} · ${snapshotLabel(snapshot)} · ${new Date(snapshot.at || open.event.createdAt).toLocaleString()}${
                snapshot.added || snapshot.removed
                  ? ` · ${snapshot.added ? `+${snapshot.added}` : ""}${snapshot.added && snapshot.removed ? " " : ""}${snapshot.removed ? `−${snapshot.removed}` : ""}`
                  : ""
              }`
            : undefined
        }
        className="max-w-4xl"
      >
        {snapshot?.created ? <p className="mb-3 text-xs font-medium text-muted-foreground">New file</p> : null}
        {snapshot ? <DiffPreview snapshot={snapshot} /> : null}
        {snapshot?.truncated ? (
          <p className="mt-3 text-xs text-muted-foreground">Showing a shortened preview of a larger change.</p>
        ) : null}
      </Modal>
    </div>
  );
}
