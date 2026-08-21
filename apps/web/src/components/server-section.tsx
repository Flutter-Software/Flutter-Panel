import { Card, EmptyState } from "@/components/ui";

export function ServerSection({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows?: { name: string; meta: string }[];
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {rows?.length ? (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {rows.map((row) => (
                <tr key={row.name} className="border-t border-border first:border-0">
                  <td className="px-4 py-3 font-medium">{row.name}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{row.meta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <EmptyState title={`No ${title.toLowerCase()} yet`} description={description} />
      )}
    </div>
  );
}
