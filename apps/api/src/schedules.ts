import {
  FlutterError,
  cronExpression,
  describeCron,
  hasServerPermission,
  nextCronDate,
  parseCron,
  powerActionSchema,
  scheduleUpsertSchema,
  type CronFields,
  type ServerPermission,
} from "@flutter-software/shared";
import { Schedule, Server } from "./db/models";
import { log } from "./log";
import { applyPowerDirect, createBackupDirect, requireAccess, sendCommandDirect } from "./servers";

type TaskDoc = {
  _id: { toString(): string };
  action: "power" | "command" | "backup";
  payload: string;
  timeOffset: number;
  continueOnFailure: boolean;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asCron(value: unknown): CronFields {
  const rec = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    minute: String(rec.minute ?? "*"),
    hour: String(rec.hour ?? "*"),
    dayOfMonth: String(rec.dayOfMonth ?? "*"),
    month: String(rec.month ?? "*"),
    dayOfWeek: String(rec.dayOfWeek ?? "*"),
  };
}

function validateCron(cron: CronFields) {
  try {
    parseCron(cron);
  } catch (error) {
    throw FlutterError.validation(error instanceof Error ? error.message : "Invalid cron expression");
  }
  if (!nextCronDate(cron)) {
    throw FlutterError.validation("That schedule never matches a date");
  }
}

function publicSchedule(row: {
  _id: { toString(): string };
  name: string;
  enabled: boolean;
  onlyWhenOnline: boolean;
  cron: unknown;
  tasks: TaskDoc[];
  lastRunAt?: Date | null;
  lastStatus?: string | null;
  lastError?: string | null;
  nextRunAt?: Date | null;
  runningAt?: Date | null;
  createdAt?: Date;
}) {
  const cron = asCron(row.cron);
  return {
    id: row._id.toString(),
    name: row.name,
    enabled: Boolean(row.enabled),
    onlyWhenOnline: Boolean(row.onlyWhenOnline),
    cron,
    cronExpression: cronExpression(cron),
    cronLabel: describeCron(cron),
    tasks: (row.tasks ?? []).map((task) => ({
      id: task._id.toString(),
      action: task.action,
      payload: task.payload ?? "",
      timeOffset: task.timeOffset ?? 0,
      continueOnFailure: Boolean(task.continueOnFailure),
    })),
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    lastStatus: row.lastStatus ?? null,
    lastError: row.lastError ?? null,
    nextRunAt: row.nextRunAt ? row.nextRunAt.toISOString() : null,
    running: Boolean(row.runningAt),
    createdAt: row.createdAt ? row.createdAt.toISOString() : new Date().toISOString(),
  };
}

function caps(access: { admin: boolean; owner: boolean; permissions: string[] }) {
  const allow = (permission: ServerPermission) =>
    access.admin || access.owner || hasServerPermission(access.permissions, permission);
  return {
    canCreate: allow("schedule.create"),
    canUpdate: allow("schedule.update"),
    canDelete: allow("schedule.delete"),
  };
}

export async function listSchedules(serverId: string, viewerId: string, admin: boolean) {
  const access = await requireAccess(serverId, viewerId, admin, "schedule.read");
  const rows = await Schedule.find({ serverId: access.server._id }).sort({ createdAt: 1 });
  return { schedules: rows.map(publicSchedule), ...caps(access) };
}

export async function createSchedule(serverId: string, viewerId: string, admin: boolean, body: unknown) {
  const access = await requireAccess(serverId, viewerId, admin, "schedule.create");
  const parsed = scheduleUpsertSchema.safeParse(body);
  if (!parsed.success) throw FlutterError.validation("Invalid schedule", parsed.error.flatten());
  validateCron(parsed.data.cron);
  const row = await Schedule.create({
    serverId: access.server._id,
    name: parsed.data.name,
    enabled: parsed.data.enabled,
    onlyWhenOnline: parsed.data.onlyWhenOnline,
    cron: parsed.data.cron,
    tasks: parsed.data.tasks.map((task) => ({
      action: task.action,
      payload: task.payload,
      timeOffset: task.timeOffset,
      continueOnFailure: task.continueOnFailure,
    })),
    nextRunAt: parsed.data.enabled ? nextCronDate(parsed.data.cron) : null,
  });
  return { schedule: publicSchedule(row) };
}

export async function updateSchedule(
  serverId: string,
  scheduleId: string,
  viewerId: string,
  admin: boolean,
  body: unknown,
) {
  const access = await requireAccess(serverId, viewerId, admin, "schedule.update");
  const parsed = scheduleUpsertSchema.safeParse(body);
  if (!parsed.success) throw FlutterError.validation("Invalid schedule", parsed.error.flatten());
  validateCron(parsed.data.cron);
  const row = await Schedule.findOne({ _id: scheduleId, serverId: access.server._id });
  if (!row) throw FlutterError.notFound("Schedule not found");
  row.name = parsed.data.name;
  row.enabled = parsed.data.enabled;
  row.onlyWhenOnline = parsed.data.onlyWhenOnline;
  row.set("cron", parsed.data.cron);
  row.set(
    "tasks",
    parsed.data.tasks.map((task) => ({
      action: task.action,
      payload: task.payload,
      timeOffset: task.timeOffset,
      continueOnFailure: task.continueOnFailure,
    })),
  );
  row.nextRunAt = parsed.data.enabled ? nextCronDate(parsed.data.cron) : null;
  await row.save();
  return { schedule: publicSchedule(row) };
}

export async function deleteSchedule(serverId: string, scheduleId: string, viewerId: string, admin: boolean) {
  const access = await requireAccess(serverId, viewerId, admin, "schedule.delete");
  const result = await Schedule.deleteOne({ _id: scheduleId, serverId: access.server._id });
  if (!result.deletedCount) throw FlutterError.notFound("Schedule not found");
  return { ok: true };
}

export async function runScheduleNow(serverId: string, scheduleId: string, viewerId: string, admin: boolean) {
  const access = await requireAccess(serverId, viewerId, admin, "schedule.update");
  const row = await Schedule.findOne({ _id: scheduleId, serverId: access.server._id });
  if (!row) throw FlutterError.notFound("Schedule not found");
  const claimed = await claimSchedule(row._id.toString());
  if (!claimed) throw FlutterError.conflict("This schedule is already running");
  void finishSchedule(claimed, { ignoreOnline: true }).catch((error) => {
    log("error", "schedule run failed", {
      scheduleId: row._id.toString(),
      error: error instanceof Error ? error.message : String(error),
    });
  });
  return { ok: true };
}

async function executeTasks(serverId: string, tasks: TaskDoc[]) {
  for (const task of tasks) {
    if (task.timeOffset > 0) await sleep(task.timeOffset * 1000);
    try {
      if (task.action === "power") {
        const action = powerActionSchema.safeParse(task.payload);
        if (!action.success) throw FlutterError.validation("Choose start, stop, restart, or kill");
        await applyPowerDirect(serverId, action.data);
      } else if (task.action === "command") {
        await sendCommandDirect(serverId, task.payload);
      } else {
        await createBackupDirect(serverId);
      }
    } catch (error) {
      if (!task.continueOnFailure) throw error;
      log("warn", "schedule task failed", {
        serverId,
        action: task.action,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function claimSchedule(scheduleId: string) {
  const stale = new Date(Date.now() - 15 * 60 * 1000);
  return Schedule.findOneAndUpdate(
    {
      _id: scheduleId,
      $or: [{ runningAt: null }, { runningAt: { $lt: stale } }],
    },
    { $set: { runningAt: new Date() } },
    { new: true },
  );
}

async function finishSchedule(
  claimed: NonNullable<Awaited<ReturnType<typeof claimSchedule>>>,
  options: { ignoreOnline?: boolean } = {},
) {
  const scheduleId = claimed._id.toString();
  const cron = asCron(claimed.cron);
  let status: "success" | "failed" | "skipped" = "success";
  let errorMessage: string | null = null;
  try {
    const server = await Server.findById(claimed.serverId);
    if (!server) throw FlutterError.notFound("Server not found");
    if (!options.ignoreOnline && claimed.onlyWhenOnline && server.status !== "running") {
      status = "skipped";
    } else {
      await executeTasks(server._id.toString(), claimed.tasks as TaskDoc[]);
    }
  } catch (error) {
    status = "failed";
    errorMessage = error instanceof Error ? error.message : "Schedule failed";
    log("error", "schedule failed", {
      scheduleId,
      error: errorMessage,
    });
  }

  const row = await Schedule.findById(scheduleId);
  if (!row) return;
  row.runningAt = null;
  row.lastRunAt = new Date();
  row.lastStatus = status;
  row.lastError = errorMessage;
  row.nextRunAt = row.enabled ? nextCronDate(cron) : null;
  await row.save();
}

async function executeSchedule(scheduleId: string, options: { ignoreOnline?: boolean } = {}) {
  const claimed = await claimSchedule(scheduleId);
  if (!claimed) return;
  await finishSchedule(claimed, options);
}

export async function runDueSchedules() {
  const now = new Date();
  const stale = new Date(now.getTime() - 15 * 60 * 1000);
  const due = await Schedule.find({
    enabled: true,
    nextRunAt: { $lte: now },
    $or: [{ runningAt: null }, { runningAt: { $lt: stale } }],
  }).limit(25);

  for (const row of due) {
    void executeSchedule(row._id.toString()).catch((error) => {
      log("error", "schedule run failed", {
        scheduleId: row._id.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

let ticking = false;

export function startScheduleRunner() {
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await runDueSchedules();
    } catch (error) {
      log("error", "schedule runner failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      ticking = false;
    }
  };
  void tick();
  setInterval(() => void tick(), 20_000);
}
