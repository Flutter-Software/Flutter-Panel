"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ChevronDown,
  ChevronUp,
  Pencil,
  Play,
  Plus,
  Power,
  Terminal,
  Trash2,
} from "lucide-react";
import { describeCron, nextCronDate, type CronFields } from "@flutter-software/shared";
import { confirm } from "@/components/confirm-dialog";
import { Switch } from "@/components/admin-create";
import { Button, EmptyState, Field, Input, Modal, Rack, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useServerRecord } from "@/components/server-frame";
import { useLiveReload, usePanelEvent } from "@/components/panel-socket";
import { api } from "@/lib/api";
import { can } from "@/lib/access";
import { undoable } from "@/lib/undoable";

type TaskAction = "power" | "command" | "backup";
type PowerPayload = "start" | "stop" | "restart" | "kill";

type ScheduleTask = {
  id: string;
  action: TaskAction;
  payload: string;
  timeOffset: number;
  continueOnFailure: boolean;
};

type Schedule = {
  id: string;
  name: string;
  enabled: boolean;
  onlyWhenOnline: boolean;
  cron: CronFields;
  cronExpression: string;
  cronLabel: string;
  tasks: ScheduleTask[];
  lastRunAt: string | null;
  lastStatus: "success" | "failed" | "skipped" | null;
  lastError: string | null;
  nextRunAt: string | null;
  running: boolean;
  createdAt: string;
};

type DraftTask = {
  key: string;
  action: TaskAction;
  payload: string;
  timeOffset: string;
  continueOnFailure: boolean;
};

type Draft = {
  name: string;
  enabled: boolean;
  onlyWhenOnline: boolean;
  cron: CronFields;
  tasks: DraftTask[];
};

const EMPTY_CRON: CronFields = {
  minute: "0",
  hour: "*",
  dayOfMonth: "*",
  month: "*",
  dayOfWeek: "*",
};

const PRESETS: { label: string; cron: CronFields }[] = [
  { label: "Every minute", cron: { minute: "*", hour: "*", dayOfMonth: "*", month: "*", dayOfWeek: "*" } },
  { label: "Every 5 minutes", cron: { minute: "*/5", hour: "*", dayOfMonth: "*", month: "*", dayOfWeek: "*" } },
  { label: "Every 15 minutes", cron: { minute: "*/15", hour: "*", dayOfMonth: "*", month: "*", dayOfWeek: "*" } },
  { label: "Every hour", cron: { minute: "0", hour: "*", dayOfMonth: "*", month: "*", dayOfWeek: "*" } },
  { label: "Every day at 00:00 UTC", cron: { minute: "0", hour: "0", dayOfMonth: "*", month: "*", dayOfWeek: "*" } },
  { label: "Every day at 04:00 UTC", cron: { minute: "0", hour: "4", dayOfMonth: "*", month: "*", dayOfWeek: "*" } },
  { label: "Every Sunday at 00:00 UTC", cron: { minute: "0", hour: "0", dayOfMonth: "*", month: "*", dayOfWeek: "0" } },
  { label: "Custom", cron: EMPTY_CRON },
];

function newTask(action: TaskAction = "power"): DraftTask {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action,
    payload: action === "power" ? "start" : "",
    timeOffset: "0",
    continueOnFailure: false,
  };
}

function emptyDraft(): Draft {
  return {
    name: "",
    enabled: true,
    onlyWhenOnline: false,
    cron: { ...EMPTY_CRON },
    tasks: [newTask("power")],
  };
}

function fromSchedule(row: Schedule): Draft {
  return {
    name: row.name,
    enabled: row.enabled,
    onlyWhenOnline: row.onlyWhenOnline,
    cron: { ...row.cron },
    tasks: row.tasks.map((task) => ({
      key: task.id,
      action: task.action,
      payload: task.payload,
      timeOffset: String(task.timeOffset),
      continueOnFailure: task.continueOnFailure,
    })),
  };
}

function presetValue(cron: CronFields) {
  const match = PRESETS.find(
    (preset) =>
      preset.label !== "Custom" &&
      preset.cron.minute === cron.minute &&
      preset.cron.hour === cron.hour &&
      preset.cron.dayOfMonth === cron.dayOfMonth &&
      preset.cron.month === cron.month &&
      preset.cron.dayOfWeek === cron.dayOfWeek,
  );
  return match?.label ?? "Custom";
}

function formatWhen(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function taskSummary(task: ScheduleTask) {
  if (task.action === "power") return `Power: ${task.payload || "start"}`;
  if (task.action === "command") return `Command: ${task.payload || "—"}`;
  return "Create backup";
}

function TaskIcon({ action }: { action: TaskAction }) {
  const Icon = action === "command" ? Terminal : action === "backup" ? Archive : Power;
  return <Icon className="size-3.5 text-muted-foreground" />;
}

/** A schedule's state as a word plus the colour of its LED and left rail (DESIGN.md → LED rail). */
function scheduleState(schedule: Schedule): { label: string; text: string; bar: string; pulse?: boolean } {
  if (schedule.running) return { label: "Running", text: "text-status-warn", bar: "bg-status-warn", pulse: true };
  if (!schedule.enabled) return { label: "Disabled", text: "text-status-offline", bar: "bg-status-offline/50" };
  if (schedule.lastStatus === "failed") return { label: "Last run failed", text: "text-status-error", bar: "bg-status-error" };
  if (schedule.lastStatus === "skipped") return { label: "Last run skipped", text: "text-status-warn", bar: "bg-status-warn" };
  if (schedule.lastStatus === "success") return { label: "Last run ok", text: "text-status-running", bar: "bg-status-running" };
  return { label: "Enabled", text: "text-status-running", bar: "bg-status-running" };
}

function ScheduleStatus({ schedule }: { schedule: Schedule }) {
  const state = scheduleState(schedule);
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-2 text-[13px] font-medium", state.text)}>
      <span aria-hidden className={cn("inline-block size-2 rounded-full", state.bar, state.pulse && "led-pulse")} />
      {state.label}
    </span>
  );
}

export default function SchedulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const server = useServerRecord();
  const allowRead = can(server, "schedule.read");
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  // Schedules deleted optimistically and still inside their Undo window.
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());
  const visibleSchedules = useMemo(
    () => (hiddenIds.size ? schedules.filter((row) => !hiddenIds.has(row.id)) : schedules),
    [hiddenIds, schedules],
  );
  const [canCreate, setCanCreate] = useState(false);
  const [canUpdate, setCanUpdate] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  const load = useCallback(async () => {
    const result = await api<{
      data: { schedules: Schedule[]; canCreate: boolean; canUpdate: boolean; canDelete: boolean };
    }>(`/api/v1/client/servers/${id}/schedules`);
    setSchedules(result.data.schedules);
    setCanCreate(result.data.canCreate);
    setCanUpdate(result.data.canUpdate);
    setCanDelete(result.data.canDelete);
  }, [id]);

  useEffect(() => {
    if (!allowRead && server && !server.permissions?.includes("*") && !server.owner) return;
    load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load schedules"));
  }, [allowRead, load, server]);

  const running = schedules.some((row) => row.running);
  useLiveReload(load, 2000, running);
  usePanelEvent("schedule", (payload) => {
    if (!payload || typeof payload !== "object") return;
    const data = payload as { serverId?: string; schedule?: Schedule; removed?: string };
    if (data.serverId !== id) return;
    if (data.removed) {
      setSchedules((rows) => rows.filter((row) => row.id !== data.removed));
      return;
    }
    if (!data.schedule) return;
    const next = data.schedule;
    setSchedules((rows) => {
      const index = rows.findIndex((row) => row.id === next.id);
      if (index < 0) return [...rows, next];
      return rows.map((row) => (row.id === next.id ? next : row));
    });
  });

  const nextPreview = useMemo(() => {
    try {
      const next = nextCronDate(draft.cron);
      return next ? next.toLocaleString() : "Never";
    } catch {
      return "Invalid cron";
    }
  }, [draft.cron]);

  function openCreate() {
    setError(null);
    setEditingId(null);
    setDraft(emptyDraft());
    setOpen(true);
  }

  function openEdit(row: Schedule) {
    setError(null);
    setEditingId(row.id);
    setDraft(fromSchedule(row));
    setOpen(true);
  }

  function updateTask(key: string, patch: Partial<DraftTask>) {
    setDraft((current) => ({
      ...current,
      tasks: current.tasks.map((task) => (task.key === key ? { ...task, ...patch } : task)),
    }));
  }

  function moveTask(index: number, direction: -1 | 1) {
    setDraft((current) => {
      const next = [...current.tasks];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return { ...current, tasks: next };
    });
  }

  async function save() {
    setError(null);
    setPending(true);
    try {
      const body = {
        name: draft.name.trim(),
        enabled: draft.enabled,
        onlyWhenOnline: draft.onlyWhenOnline,
        cron: draft.cron,
        tasks: draft.tasks.map((task) => ({
          action: task.action,
          payload: task.payload,
          timeOffset: Number(task.timeOffset) || 0,
          continueOnFailure: task.continueOnFailure,
        })),
      };
      if (editingId) {
        await api(`/api/v1/client/servers/${id}/schedules/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await api(`/api/v1/client/servers/${id}/schedules`, {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      setOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save schedule");
    } finally {
      setPending(false);
    }
  }

  /**
   * Optimistic: the switch flips immediately and the row is patched locally;
   * if the API refuses, it flips back and the error shows. No page-wide
   * `pending` lock, so other rows stay usable while this saves.
   */
  async function toggleEnabled(row: Schedule, enabled: boolean) {
    setError(null);
    const patch = (value: boolean) =>
      setSchedules((rows) => rows.map((item) => (item.id === row.id ? { ...item, enabled: value } : item)));
    patch(enabled);
    try {
      await api(`/api/v1/client/servers/${id}/schedules/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: row.name,
          enabled,
          onlyWhenOnline: row.onlyWhenOnline,
          cron: row.cron,
          tasks: row.tasks,
        }),
      });
      // Picks up server-computed fields like nextRunAt.
      await load();
    } catch (err) {
      patch(row.enabled);
      setError(err instanceof Error ? err.message : "Could not update schedule");
    }
  }

  async function runNow(row: Schedule) {
    setError(null);
    setPending(true);
    try {
      await api(`/api/v1/client/servers/${id}/schedules/${row.id}/run`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run schedule");
    } finally {
      setPending(false);
    }
  }

  /**
   * Confirm first, then delete with an Undo toast as a second safety net; the
   * request is sent when the toast runs out.
   */
  async function remove(row: Schedule) {
    if (
      !(await confirm({
        title: "Delete schedule",
        description: `Delete “${row.name}”?`,
        confirmLabel: "Delete",
      }))
    ) {
      return;
    }
    setError(null);
    undoable({
      message: `Deleted “${row.name}”`,
      apply: () => setHiddenIds((current) => new Set(current).add(row.id)),
      revert: () =>
        setHiddenIds((current) => {
          const next = new Set(current);
          next.delete(row.id);
          return next;
        }),
      commit: (init) => api(`/api/v1/client/servers/${id}/schedules/${row.id}`, { method: "DELETE", ...init }),
      errorMessage: `Could not delete “${row.name}”`,
      onCommitted: () => {
        setSchedules((rows) => rows.filter((item) => item.id !== row.id));
        void load().catch(() => undefined);
      },
    });
  }

  if (server && !allowRead) {
    return <p className="text-sm text-destructive">You do not have permission to view schedules.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold">Schedules</h2>
          <p className="text-sm text-muted-foreground">
            Run power actions, console commands, or backups on a UTC cron.
          </p>
        </div>
        {canCreate ? (
          <Button type="button" onClick={openCreate}>
            <Plus className="size-4" />
            Create schedule
          </Button>
        ) : null}
      </div>
      {error && !open ? <p className="text-sm text-destructive">{error}</p> : null}

      <Modal
        title={editingId ? "Edit schedule" : "Create schedule"}
        description="Times are evaluated in UTC. Tasks run in order, with optional delays between them."
        open={open}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={pending || !draft.name.trim() || draft.tasks.length === 0} onClick={() => void save()}>
              {pending ? "Saving…" : editingId ? "Save schedule" : "Create schedule"}
            </Button>
          </>
        }
      >
        {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
        <div className="space-y-5">
          <Field label="Name" required>
            <Input
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="Restart overnight"
              maxLength={64}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
              <span>
                <span className="block text-sm font-medium">Enabled</span>
                <span className="text-xs text-muted-foreground">Run automatically when due</span>
              </span>
              <Switch
                checked={draft.enabled}
                onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5">
              <span>
                <span className="block text-sm font-medium">Only when online</span>
                <span className="text-xs text-muted-foreground">Skip if the server is offline</span>
              </span>
              <Switch
                checked={draft.onlyWhenOnline}
                onChange={(onlyWhenOnline) => setDraft((current) => ({ ...current, onlyWhenOnline }))}
              />
            </label>
          </div>
          <Field label="Frequency" hint={`Next run: ${nextPreview}`}>
            <Select
              value={presetValue(draft.cron)}
              onChange={(event) => {
                const preset = PRESETS.find((item) => item.label === event.target.value);
                if (!preset || preset.label === "Custom") return;
                setDraft((current) => ({ ...current, cron: { ...preset.cron } }));
              }}
            >
              {PRESETS.map((preset) => (
                <option key={preset.label} value={preset.label}>
                  {preset.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {(
              [
                ["minute", "Minute"],
                ["hour", "Hour"],
                ["dayOfMonth", "Day"],
                ["month", "Month"],
                ["dayOfWeek", "Weekday"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <Input
                  value={draft.cron[key]}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      cron: { ...current.cron, [key]: event.target.value },
                    }))
                  }
                  className="font-mono text-xs"
                />
              </Field>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{describeCron(draft.cron)}</p>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Tasks</p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={draft.tasks.length >= 10}
                onClick={() => setDraft((current) => ({ ...current, tasks: [...current.tasks, newTask()] }))}
              >
                <Plus className="size-3.5" />
                Add task
              </Button>
            </div>
            <div className="space-y-2">
              {draft.tasks.map((task, index) => (
                <div key={task.key} className="space-y-3 rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={task.action}
                      compact
                      className="max-w-44"
                      onChange={(event) => {
                        const action = event.target.value as TaskAction;
                        updateTask(task.key, {
                          action,
                          payload: action === "power" ? "start" : "",
                        });
                      }}
                    >
                      <option value="power">Power action</option>
                      <option value="command">Send command</option>
                      <option value="backup">Create backup</option>
                    </Select>
                    {task.action === "power" ? (
                      <Select
                        value={task.payload || "start"}
                        compact
                        className="max-w-36"
                        onChange={(event) => updateTask(task.key, { payload: event.target.value })}
                      >
                        <option value="start">Start</option>
                        <option value="stop">Stop</option>
                        <option value="restart">Restart</option>
                        <option value="kill">Kill</option>
                      </Select>
                    ) : null}
                    <div className="ml-auto flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="size-8 px-0"
                        disabled={index === 0}
                        onClick={() => moveTask(index, -1)}
                        aria-label="Move up"
                      >
                        <ChevronUp className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="size-8 px-0"
                        disabled={index === draft.tasks.length - 1}
                        onClick={() => moveTask(index, 1)}
                        aria-label="Move down"
                      >
                        <ChevronDown className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="size-8 px-0 text-destructive"
                        disabled={draft.tasks.length === 1}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            tasks: current.tasks.filter((item) => item.key !== task.key),
                          }))
                        }
                        aria-label="Remove task"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                  {task.action === "command" ? (
                    <Textarea
                      value={task.payload}
                      onChange={(event) => updateTask(task.key, { payload: event.target.value })}
                      placeholder="say Restarting in 5 minutes"
                      className="min-h-[72px] font-mono text-xs"
                    />
                  ) : null}
                  {task.action === "backup" ? (
                    <p className="text-xs text-muted-foreground">Creates a new backup on the node.</p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Wait</span>
                      <Input
                        type="number"
                        min={0}
                        max={900}
                        value={task.timeOffset}
                        onChange={(event) => updateTask(task.key, { timeOffset: event.target.value })}
                        className="h-8 w-20"
                      />
                      <span className="text-muted-foreground">seconds first</span>
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={task.continueOnFailure}
                        onChange={(event) => updateTask(task.key, { continueOnFailure: event.target.checked })}
                      />
                      Continue if this task fails
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      {visibleSchedules.length === 0 ? (
        <EmptyState
          title="No schedules yet"
          description="Create a schedule to start, stop, send commands, or back up this server on a timer."
        />
      ) : (
        <Rack label="Schedules">
          {visibleSchedules.map((row) => {
            const state = scheduleState(row);
            return (
              <div
                key={row.id}
                role="listitem"
                className="relative grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto] lg:gap-6"
              >
                <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", state.bar, state.pulse && "led-pulse")} />
                <div className="min-w-0 pl-1">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                    <p className="truncate font-display text-[18px] font-semibold leading-tight">{row.name}</p>
                    <ScheduleStatus schedule={row} />
                  </div>
                  {row.cronLabel !== row.cronExpression ? (
                    <>
                      <p className="mt-1 text-sm">{row.cronLabel}</p>
                      <p className="mt-0.5 font-mono text-[12px] text-muted-foreground">{row.cronExpression}</p>
                    </>
                  ) : (
                    // No plain-words description for this cron: show the expression itself as machine text.
                    <p className="mt-1 font-mono text-[13px]">{row.cronExpression}</p>
                  )}
                </div>
                <div className="min-w-0 pl-1 lg:pl-0">
                  <p className="text-[12px] text-muted-foreground">
                    {row.tasks.length === 1 ? "Task" : "Tasks, in order"}
                  </p>
                  <ol className="mt-0.5 space-y-1">
                    {row.tasks.map((task) => (
                      <li key={task.id} className="flex min-w-0 items-center gap-2 text-sm">
                        <TaskIcon action={task.action} />
                        <span className="min-w-0 truncate">{taskSummary(task)}</span>
                        {task.timeOffset > 0 ? (
                          <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
                            after {task.timeOffset}s
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </div>
                <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 pl-1 text-sm lg:grid-cols-1 lg:pl-0">
                  <div className="min-w-0">
                    <dt className="text-[12px] text-muted-foreground">Last run</dt>
                    <dd className="tabular-nums">{formatWhen(row.lastRunAt)}</dd>
                    {row.lastError ? <dd className="text-[13px] text-status-error">{row.lastError}</dd> : null}
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[12px] text-muted-foreground">Next run</dt>
                    <dd className="tabular-nums">{row.enabled ? formatWhen(row.nextRunAt) : "Not scheduled"}</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap items-center gap-2 pl-1 lg:flex-col lg:items-end lg:pl-0">
                  {canUpdate ? (
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Enabled</span>
                      <Switch
                        checked={row.enabled}
                        disabled={pending || row.running}
                        onChange={(enabled) => void toggleEnabled(row, enabled)}
                      />
                    </label>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
                    {canUpdate ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={pending || row.running}
                        onClick={() => void runNow(row)}
                      >
                        <Play className="size-3.5" />
                        {row.running ? "Running…" : "Run now"}
                      </Button>
                    ) : null}
                    {canUpdate ? (
                      <Button type="button" size="sm" variant="secondary" onClick={() => openEdit(row)}>
                        <Pencil className="size-3.5" />
                        Edit
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        className="size-8 px-0 text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${row.name}`}
                        onClick={() => void remove(row)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </Rack>
      )}
    </div>
  );
}
