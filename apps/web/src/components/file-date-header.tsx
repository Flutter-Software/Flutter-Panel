"use client";

import { useState, type SyntheticEvent } from "react";
import { Popover } from "@mantine/core";
import { ArrowDown, ArrowUp, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  DATE_BUCKETS,
  EMPTY_DATE_FILTER,
  isDateFilterActive,
  type DateBucket,
  type DateField,
  type DateFilter,
  type DateSort,
} from "@/lib/file-date-filter";

// The dropdown renders in a portal, but React still bubbles its events to the
// file table, whose Ctrl+A, Backspace, and right-click handlers must not fire.
function stopBubbling(event: SyntheticEvent) {
  event.stopPropagation();
}

/**
 * A date column header like Windows Explorer's: click the label to sort, or
 * open the chevron to filter by date group or a custom range.
 */
export function FileDateHeader({
  field,
  label,
  className,
  sort,
  onSort,
  filter,
  onFilter,
  counts,
}: {
  field: DateField;
  label: string;
  className?: string;
  sort: DateSort | null;
  onSort: () => void;
  filter: DateFilter;
  onFilter: (next: DateFilter) => void;
  counts: ReadonlyMap<DateBucket, number>;
}) {
  const [open, setOpen] = useState(false);
  const direction = sort?.field === field ? sort.direction : null;
  const active = isDateFilterActive(filter);
  // Keep a ticked group listed even after a reload leaves it with no entries.
  const groups = DATE_BUCKETS.filter(({ id }) => counts.has(id) || filter.buckets.has(id));
  const SortIcon = direction === "asc" ? ArrowUp : ArrowDown;

  function toggleBucket(id: DateBucket, on: boolean) {
    const buckets = new Set(filter.buckets);
    if (on) buckets.add(id);
    else buckets.delete(id);
    onFilter({ ...filter, buckets });
  }

  return (
    <th
      className={cn("whitespace-nowrap px-4 py-2.5 font-medium", className)}
      aria-sort={direction === "desc" ? "descending" : direction === "asc" ? "ascending" : "none"}
    >
      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          className="no-press inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground"
          onClick={onSort}
        >
          {label}
          {/* Always rendered so the filter chevron doesn't jump when sorting starts. */}
          <SortIcon className={cn("size-3", !direction && "invisible")} aria-hidden />
        </button>
        <Popover opened={open} onChange={setOpen} position="bottom-start" width={248} shadow="md" trapFocus>
          <Popover.Target>
            <button
              type="button"
              className={cn(
                "no-press inline-flex size-5 items-center justify-center rounded hover:bg-muted hover:text-foreground",
                active && "text-primary",
              )}
              aria-label={`Filter by ${label}${active ? " (filter on)" : ""}`}
              aria-expanded={open}
              onClick={() => setOpen((current) => !current)}
            >
              <ChevronDown className="size-3.5" aria-hidden />
            </button>
          </Popover.Target>
          <Popover.Dropdown
            className="space-y-3 border-border bg-popover p-3 text-sm text-popover-foreground"
            onKeyDown={stopBubbling}
            onContextMenu={stopBubbling}
          >
            {groups.length ? (
              <div className="space-y-0.5">
                {groups.map(({ id, label: groupLabel }) => (
                  <label
                    key={id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-muted/60"
                  >
                    <input
                      type="checkbox"
                      className="size-3.5 accent-[var(--primary)]"
                      checked={filter.buckets.has(id)}
                      onChange={(event) => toggleBucket(id, event.target.checked)}
                    />
                    <span className="flex-1">{groupLabel}</span>
                    <span className="text-xs text-muted-foreground">{counts.get(id) ?? 0}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="px-1.5 text-muted-foreground">Nothing in this folder yet.</p>
            )}

            <div className="space-y-2 border-t border-border pt-3">
              <label className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">From</span>
                <Input
                  type="date"
                  className="h-8 w-40"
                  value={filter.from}
                  onChange={(event) => onFilter({ ...filter, from: event.target.value })}
                />
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">To</span>
                <Input
                  type="date"
                  className="h-8 w-40"
                  value={filter.to}
                  onChange={(event) => onFilter({ ...filter, to: event.target.value })}
                />
              </label>
            </div>

            <button
              type="button"
              className="w-full text-center text-xs font-medium text-primary disabled:text-muted-foreground"
              disabled={!active}
              onClick={() => onFilter(EMPTY_DATE_FILTER)}
            >
              Clear filter
            </button>
          </Popover.Dropdown>
        </Popover>
      </div>
    </th>
  );
}
