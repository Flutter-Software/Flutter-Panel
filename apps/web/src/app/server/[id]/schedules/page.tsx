"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ChevronDown,
  ChevronUp,
  Clock,
  Play,
  Plus,
  Power,
  Terminal,
  Trash2,
} from "lucide-react";
import { describeCron, nextCronDate, type CronFields } from "@flutter-software/shared";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { useServerRecord } from "@/components/server-frame";
import { api } from "@/lib/api";
import { can } from "@/lib/access";
import { cn } from "@/lib/cn";

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

function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "no-press relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 block size-5 rounded-full bg-card transition-transform",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}

function StatusPill({ schedule }: { schedule: Schedule }) {
  if (schedule.running) {
    return <Badge className="bg-primary/15 text-primary">Running</Badge>;
  }
  if (!schedule.enabled) {
    return <Badge className="bg-muted text-muted-foreground">Disabled</Badge>;
  }
  if (schedule.lastStatus === "failed") {
    return <Badge className="bg-status-error/15 text-status-error">Failed</Badge>;
  }
  if (schedule.lastStatus === "skipped") {
    return <Badge className="bg-muted text-muted-foreground">Skipped</Badge>;
  }
  if (schedule.lastStatus === "success") {
    return <Badge className="bg-status-running/15 text-status-running">Last run ok</Badge>;
  }
  return <Badge>Enabled</Badge>;
}

export default function SchedulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const server = useServerRecord();
  const allowRead = can(server, "schedule.read");
  const [schedules, setSchedules] = useState<Schedule[]>([]);
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
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [load, running]);

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

  async function toggleEnabled(row: Schedule, enabled: boolean) {
    setError(null);
    setPending(true);
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
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update schedule");
    } finally {
      setPending(false);
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

  async function remove(row: Schedule) {
    if (!window.confirm(`Delete schedule “${row.name}”?`)) return;
    setError(null);
    setPending(true);
    try {
      await api(`/api/v1/client/servers/${id}/schedules/${row.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete schedule");
    } finally {
      setPending(false);
    }
  }

  if (server && !allowRead) {
    return <p className="text-sm text-destructive">You do not have permission to view schedules.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Schedules</h2>
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
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
              <span>
                <span className="block text-sm font-medium">Enabled</span>
                <span className="text-xs text-muted-foreground">Run automatically when due</span>
              </span>
              <Switch
                checked={draft.enabled}
                onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
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
                <div key={task.key} className="space-y-3 rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={task.action}
                      className="max-w-40"
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

      {schedules.length === 0 ? (
        <EmptyState
          title="No schedules yet"
          description="Create a schedule to start, stop, send commands, or back up this server on a timer."
        />
      ) : (
        <div className="space-y-3">
          {schedules.map((row) => (
            <Card key={row.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Clock className="size-4 text-primary" />
                    <p className="font-medium">{row.name}</p>
                    <StatusPill schedule={row} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{row.cronLabel}</p>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">{row.cronExpression}</p>
                  <div className="mt-3 space-y-1">
                    {row.tasks.map((task) => (
                      <p key={task.id} className="flex items-center gap-2 text-sm">
                        <TaskIcon action={task.action} />
                        {taskSummary(task)}
                        {task.timeOffset > 0 ? (
                          <span className="text-xs text-muted-foreground">+{task.timeOffset}s</span>
                        ) : null}
                      </p>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Last run {formatWhen(row.lastRunAt)}
                    {row.lastError ? ` · ${row.lastError}` : ""}
                    {" · "}
                    Next {row.enabled ? formatWhen(row.nextRunAt) : "—"}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-3">
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
                  <div className="flex flex-wrap justify-end gap-2">
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
                        Edit
                      </Button>
                    ) : null}
                    {canDelete ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        disabled={pending}
                        onClick={() => void remove(row)}
                      >
                        <Trash2 className="size-3.5" />
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
