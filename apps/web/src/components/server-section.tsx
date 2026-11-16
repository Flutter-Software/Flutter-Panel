import { EmptyState, Rack } from "@/components/ui";

/**
 * A simple server page section: a heading, a line of context, and either a
 * rack of name/detail rows or an empty state.
 */
export function ServerSection({
  title,
  description,
  rows,
  emptyTitle,
  emptyDescription,
}: {
  title: string;
  description: string;
  rows?: { name: string; meta: string }[];
  /** Defaults to "No {title} yet". */
  emptyTitle?: string;
  /** What to do next; defaults to the section description. */
  emptyDescription?: string;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[20px] font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {rows?.length ? (
        <Rack label={title}>
          {rows.map((row) => (
            <div key={row.name} role="listitem" className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-3 text-sm">
              <span className="font-medium">{row.name}</span>
              <span className="text-muted-foreground">{row.meta}</span>
            </div>
          ))}
        </Rack>
      ) : (
        <EmptyState
          title={emptyTitle ?? `No ${title.toLowerCase()} yet`}
          description={emptyDescription ?? description}
        />
      )}
    </div>
  );
}
