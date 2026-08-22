import { cn } from "@/lib/cn";
import type { ServerStatus } from "@/lib/types";

const STATUS: Record<
  ServerStatus,
  { label: string; className: string; bar: string }
> = {
  running: {
    label: "Running",
    className: "text-status-running",
    bar: "bg-status-running",
  },
  starting: {
    label: "Starting",
    className: "text-status-warn",
    bar: "bg-status-warn",
  },
  stopping: {
    label: "Stopping",
    className: "text-status-warn",
    bar: "bg-status-warn",
  },
  installing: {
    label: "Installing",
    className: "text-status-info",
    bar: "bg-status-info",
  },
  install_failed: {
    label: "Install failed",
    className: "text-status-error",
    bar: "bg-status-error",
  },
  offline: {
    label: "Offline",
    className: "text-status-offline",
    bar: "bg-status-offline",
  },
};

export function statusMeta(status: ServerStatus) {
  return STATUS[status];
}

export function StatusDot({ status }: { status: ServerStatus }) {
  const meta = STATUS[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span className={cn("size-2 rounded-full", meta.bar)} />
      <span className={meta.className}>{meta.label}</span>
    </span>
  );
}

export function ResourceBar({
  label,
  value,
  max,
  display,
}: {
  label: string;
  value: number;
  max: number;
  display: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const tone =
    pct >= 90 ? "bg-status-error" : pct >= 70 ? "bg-status-warn" : "bg-status-running";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-foreground/80">{display}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function sparkPath(values: number[], max: number, width: number, height: number, windowSize = 60) {
  const ceiling = Math.max(max, 0.0001);
  if (!values.length) {
    return { line: `M0 ${height} L${width} ${height}`, area: `M0 ${height} L${width} ${height} Z` };
  }
  const start = Math.max(0, windowSize - values.length);
  const points = values.map((value, index) => {
    const x = ((start + index) / Math.max(windowSize - 1, 1)) * width;
    const y = height - (Math.min(Math.max(value, 0), ceiling) / ceiling) * height;
    return [x, y] as const;
  });
  const line = points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  const area = [
    `M${first[0].toFixed(2)} ${height}`,
    ...points.map(([x, y]) => `L${x.toFixed(2)} ${y.toFixed(2)}`),
    `L${last[0].toFixed(2)} ${height}`,
    "Z",
  ].join(" ");
  return { line, area };
}

export function StatGraph({
  label,
  value,
  max,
  display,
  series,
  className,
  tall = false,
  warn = true,
}: {
  label: string;
  value: number;
  max: number;
  display: string;
  series: number[];
  className?: string;
  tall?: boolean;
  warn?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const tone =
    warn && pct >= 90
      ? "text-status-error"
      : warn && pct >= 70
        ? "text-status-warn"
        : className || "text-primary";
  const height = tall ? 72 : 56;
  const { line, area } = sparkPath(series, max, 120, height);

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-sm font-medium tabular-nums">{display}</p>
        </div>
        <p className="text-[11px] text-muted-foreground">1m</p>
      </div>
      <svg
        viewBox={`0 0 120 ${height}`}
        className={cn(tall ? "h-24" : "h-20", "w-full overflow-hidden", tone)}
        preserveAspectRatio="none"
      >
        <path d={area} fill="currentColor" className="opacity-20" />
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
