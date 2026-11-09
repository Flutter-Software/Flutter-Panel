/**
 * Sorting and filtering for the file explorer's date columns, modelled on
 * Windows Explorer's "Date created" and "Date modified" column headers.
 * Kept free of React and browser globals so it can be tested on its own.
 */

export type DateField = "createdAt" | "modifiedAt";

export type DateBucket =
  | "future"
  | "today"
  | "yesterday"
  | "earlierThisWeek"
  | "lastWeek"
  | "earlierThisMonth"
  | "lastMonth"
  | "earlierThisYear"
  | "longAgo"
  | "unknown";

/** Dropdown order, newest first. `unknown` covers nodes that report no date. */
export const DATE_BUCKETS: ReadonlyArray<{ id: DateBucket; label: string }> = [
  { id: "future", label: "In the future" },
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "earlierThisWeek", label: "Earlier this week" },
  { id: "lastWeek", label: "Last week" },
  { id: "earlierThisMonth", label: "Earlier this month" },
  { id: "lastMonth", label: "Last month" },
  { id: "earlierThisYear", label: "Earlier this year" },
  { id: "longAgo", label: "A long time ago" },
  { id: "unknown", label: "Unknown" },
];

export type DateFilter = {
  buckets: ReadonlySet<DateBucket>;
  /** Inclusive local days as `YYYY-MM-DD`, or "" when that end is open. */
  from: string;
  to: string;
};

export type DateFilters = Record<DateField, DateFilter>;

export type DateSort = { field: DateField; direction: "desc" | "asc" };

/** The fields these helpers need; entries may carry anything else. */
export type DatedEntry = {
  kind: "file" | "dir";
  name: string;
  modifiedAt: string;
  /** Null when the filesystem has no creation time, absent on older daemons. */
  createdAt?: string | null;
};

export const EMPTY_DATE_FILTER: DateFilter = { buckets: new Set(), from: "", to: "" };

export const EMPTY_DATE_FILTERS: DateFilters = {
  createdAt: EMPTY_DATE_FILTER,
  modifiedAt: EMPTY_DATE_FILTER,
};

export function isDateFilterActive(filter: DateFilter) {
  return filter.buckets.size > 0 || Boolean(filter.from) || Boolean(filter.to);
}

export function hasActiveDateFilters(filters: DateFilters) {
  return isDateFilterActive(filters.createdAt) || isDateFilterActive(filters.modifiedAt);
}

/**
 * First day of the week for a locale as a JS weekday (0 = Sunday), so "this
 * week" matches the user's calendar. Falls back to Sunday where unsupported.
 */
export function localeWeekStart(locale: string) {
  try {
    const parsed = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const firstDay = parsed.getWeekInfo?.().firstDay ?? parsed.weekInfo?.firstDay;
    return firstDay === undefined ? 0 : firstDay % 7;
  } catch {
    return 0;
  }
}

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Bucket boundaries in local time. Built from calendar parts rather than by
 * subtracting milliseconds, so days stay correct across daylight-saving changes.
 */
function bucketBoundaries(now: number, weekStart: number) {
  const today = new Date(now);
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();
  const daysIntoWeek = (today.getDay() - weekStart + 7) % 7;
  const at = (y: number, m: number, d: number) => new Date(y, m, d).getTime();
  return {
    tomorrow: at(year, month, day + 1),
    today: at(year, month, day),
    yesterday: at(year, month, day - 1),
    thisWeek: at(year, month, day - daysIntoWeek),
    lastWeek: at(year, month, day - daysIntoWeek - 7),
    thisMonth: at(year, month, 1),
    lastMonth: at(year, month - 1, 1),
    thisYear: at(year, 0, 1),
  };
}

/** Checked newest first, so overlaps resolve to the most recent label. */
function bucketFor(ms: number | null, b: ReturnType<typeof bucketBoundaries>): DateBucket {
  if (ms === null) return "unknown";
  if (ms >= b.tomorrow) return "future";
  if (ms >= b.today) return "today";
  if (ms >= b.yesterday) return "yesterday";
  if (ms >= b.thisWeek) return "earlierThisWeek";
  if (ms >= b.lastWeek) return "lastWeek";
  if (ms >= b.thisMonth) return "earlierThisMonth";
  if (ms >= b.lastMonth) return "lastMonth";
  if (ms >= b.thisYear) return "earlierThisYear";
  return "longAgo";
}

/** Start of a `YYYY-MM-DD` day in local time, offset by whole days. */
function dayStart(value: string, offsetDays = 0) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day + offsetDays).getTime();
}

function inRange(ms: number | null, from: string, to: string) {
  if (ms === null || (!from && !to)) return false;
  // Accept a range entered backwards rather than silently matching nothing.
  const [start, end] = from && to && from > to ? [to, from] : [from, to];
  if (start && ms < dayStart(start)) return false;
  if (end && ms >= dayStart(end, 1)) return false;
  return true;
}

/** Choices within one column widen the results, as ticking more boxes does in Windows. */
function matchesFilter(ms: number | null, filter: DateFilter, b: ReturnType<typeof bucketBoundaries>) {
  if (!isDateFilterActive(filter)) return true;
  return filter.buckets.has(bucketFor(ms, b)) || inRange(ms, filter.from, filter.to);
}

/** How many entries fall in each bucket, used to list only the groups present. */
export function countDateBuckets(
  entries: readonly DatedEntry[],
  field: DateField,
  now: number,
  weekStart: number,
) {
  const boundaries = bucketBoundaries(now, weekStart);
  const counts = new Map<DateBucket, number>();
  for (const entry of entries) {
    const bucket = bucketFor(timestamp(entry[field]), boundaries);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return counts;
}

/**
 * Applies both column filters (an entry must pass each one) and the optional
 * sort. Folders stay above files, undated entries sort last in either
 * direction, and ties keep the incoming name order.
 */
export function applyDateView<T extends DatedEntry>(
  entries: readonly T[],
  filters: DateFilters,
  sort: DateSort | null,
  now: number,
  weekStart: number,
): T[] {
  const boundaries = bucketBoundaries(now, weekStart);
  const visible = entries.filter(
    (entry) =>
      matchesFilter(timestamp(entry.createdAt), filters.createdAt, boundaries) &&
      matchesFilter(timestamp(entry.modifiedAt), filters.modifiedAt, boundaries),
  );
  if (!sort) return visible;

  const direction = sort.direction === "desc" ? -1 : 1;
  return visible.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    const left = timestamp(a[sort.field]);
    const right = timestamp(b[sort.field]);
    if (left === null || right === null) {
      if (left === right) return 0;
      return left === null ? 1 : -1;
    }
    return (left - right) * direction;
  });
}

/** Newest first, then oldest first, then back to the default folder order. */
export function nextDateSort(current: DateSort | null, field: DateField): DateSort | null {
  if (current?.field !== field) return { field, direction: "desc" };
  return current.direction === "desc" ? { field, direction: "asc" } : null;
}
