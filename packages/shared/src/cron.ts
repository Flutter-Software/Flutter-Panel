export type CronFields = {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
};

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const WEEKDAYS: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function tokenToNumber(token: string, names: Record<string, number>): number | null {
  const lower = token.trim().toLowerCase();
  if (!lower) return null;
  if (lower in names) return names[lower];
  if (/^\d+$/.test(lower)) return Number(lower);
  return null;
}

function expandField(field: string, min: number, max: number, names: Record<string, number>): Set<number> {
  const values = new Set<number>();
  const parts = field.trim().toLowerCase().split(",");
  if (parts.length === 0 || parts.some((part) => !part)) {
    throw new Error("Invalid cron field");
  }
  for (const part of parts) {
    const [rangeRaw, stepRaw] = part.split("/");
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1) throw new Error("Invalid cron step");
    let start: number;
    let end: number;
    if (rangeRaw === "*") {
      start = min;
      end = max;
    } else if (rangeRaw.includes("-")) {
      const [fromRaw, toRaw] = rangeRaw.split("-");
      const from = tokenToNumber(fromRaw, names);
      const to = tokenToNumber(toRaw, names);
      if (from === null || to === null) throw new Error("Invalid cron range");
      start = from;
      end = to;
    } else {
      const value = tokenToNumber(rangeRaw, names);
      if (value === null) throw new Error("Invalid cron value");
      start = value;
      end = value;
    }
    if (start > end) throw new Error("Invalid cron range");
    for (let value = start; value <= end; value += step) {
      if (value < min || value > max) throw new Error("Cron value out of range");
      values.add(value === 7 && min === 0 && max === 7 ? 0 : value);
    }
  }
  return values;
}

export function parseCron(cron: CronFields): {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  anyDayOfMonth: boolean;
  anyDayOfWeek: boolean;
} {
  return {
    minute: expandField(cron.minute, 0, 59, {}),
    hour: expandField(cron.hour, 0, 23, {}),
    dayOfMonth: expandField(cron.dayOfMonth, 1, 31, {}),
    month: expandField(cron.month, 1, 12, MONTHS),
    dayOfWeek: expandField(cron.dayOfWeek, 0, 7, WEEKDAYS),
    anyDayOfMonth: cron.dayOfMonth.trim() === "*",
    anyDayOfWeek: cron.dayOfWeek.trim() === "*",
  };
}

export function cronExpression(cron: CronFields) {
  return `${cron.minute} ${cron.hour} ${cron.dayOfMonth} ${cron.month} ${cron.dayOfWeek}`;
}

export function matchesCron(cron: CronFields, date: Date) {
  const parsed = parseCron(cron);
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dayOfMonth = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const dayOfWeek = date.getUTCDay();
  if (!parsed.minute.has(minute) || !parsed.hour.has(hour) || !parsed.month.has(month)) return false;
  const dom = parsed.dayOfMonth.has(dayOfMonth);
  const dow = parsed.dayOfWeek.has(dayOfWeek) || parsed.dayOfWeek.has(7) && dayOfWeek === 0;
  if (parsed.anyDayOfMonth && parsed.anyDayOfWeek) return true;
  if (parsed.anyDayOfMonth) return dow;
  if (parsed.anyDayOfWeek) return dom;
  return dom || dow;
}

export function nextCronDate(cron: CronFields, from = new Date(), limitMinutes = 366 * 24 * 60) {
  parseCron(cron);
  const cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  for (let i = 0; i < limitMinutes; i++) {
    if (matchesCron(cron, cursor)) return new Date(cursor);
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return null;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function describeCron(cron: CronFields) {
  const expr = cronExpression(cron);
  const presets: Record<string, string> = {
    "* * * * *": "Every minute",
    "*/5 * * * *": "Every 5 minutes",
    "*/10 * * * *": "Every 10 minutes",
    "*/15 * * * *": "Every 15 minutes",
    "*/30 * * * *": "Every 30 minutes",
    "0 * * * *": "Every hour",
    "0 */6 * * *": "Every 6 hours",
    "0 0 * * *": "Every day at 00:00 UTC",
    "0 4 * * *": "Every day at 04:00 UTC",
    "0 0 * * 0": "Every Sunday at 00:00 UTC",
    "0 0 1 * *": "On the 1st of each month at 00:00 UTC",
  };
  if (presets[expr]) return presets[expr];
  if (cron.minute !== "*" && cron.hour !== "*" && cron.dayOfMonth === "*" && cron.month === "*" && cron.dayOfWeek === "*") {
    const minute = Number(cron.minute);
    const hour = Number(cron.hour);
    if (Number.isInteger(minute) && Number.isInteger(hour)) {
      return `Every day at ${pad(hour)}:${pad(minute)} UTC`;
    }
  }
  return expr;
}
