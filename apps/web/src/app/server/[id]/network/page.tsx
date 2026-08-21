"use client";

import { use } from "react";
import { Card } from "@/components/ui";
import { useQuery } from "@/lib/query";

type Allocation = {
  id: string;
  ip: string;
  alias: string;
  port: number;
  notes: string;
  primary: boolean;
  display: string;
};

export default function NetworkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error } = useQuery<{ data: { allocations: Allocation[] } }>(
    `/api/v1/client/servers/${id}/network`,
  );
  const rows = data?.data.allocations ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Network</h2>
        <p className="text-sm text-muted-foreground">
          Allocations assigned to this server. The primary address is what the process binds to.
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">Address</th>
              <th className="px-4 py-2.5 font-medium">Notes</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-muted-foreground" colSpan={3}>
                  {!data && !error ? " " : "No allocations assigned."}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-4 py-3 font-mono text-xs">{row.display}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.notes || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.primary ? "Primary" : "Additional"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
