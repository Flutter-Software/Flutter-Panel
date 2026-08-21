import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { AdminRow } from "@/lib/types";

export function AdminPage({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function AdminFormPage({
  title,
  description,
  backHref,
  backLabel,
  children,
}: {
  title: string;
  description: string;
  backHref: string;
  backLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div>
        <Link
          href={backHref}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {backLabel}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

export function AdminError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  );
}

export function ListSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-4", className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="h-24 animate-pulse rounded-xl border border-border bg-card"
        />
      ))}
    </div>
  );
}

export function AdminTable({
  rows,
  statusLabel = "Status",
  empty = "Nothing here yet.",
  selectedId,
  onRowClick,
}: {
  rows: AdminRow[];
  statusLabel?: string;
  empty?: string;
  selectedId?: string;
  onRowClick?: (id: string) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Details</th>
              <th className="px-4 py-2.5 font-medium">{statusLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  "border-t border-border",
                  onRowClick && "cursor-pointer hover:bg-muted/40",
                  selectedId === row.id && "bg-primary/10",
                )}
                onClick={onRowClick ? () => onRowClick(row.id) : undefined}
              >
                <td className="px-4 py-3 font-medium">{row.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{row.meta}</td>
                <td className="px-4 py-3">{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? (
        <p className="border-t border-border px-4 py-10 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : null}
    </Card>
  );
}
