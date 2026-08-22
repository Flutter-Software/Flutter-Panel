"use client";

import { ServerSection } from "@/components/server-section";
import { useServerRecord } from "@/components/server-frame";

export default function DatabasesPage() {
  const server = useServerRecord();
  const limit = server?.databaseLimit ?? 0;
  if (limit <= 0) {
    return (
      <ServerSection
        title="Databases"
        description="This server has no database slots. An administrator can raise the database limit on the server."
      />
    );
  }
  return (
    <ServerSection
      title="Databases"
      description={`Up to ${limit} database${limit === 1 ? "" : "s"} can be assigned to this server. Database hosts are not configured on this panel yet.`}
    />
  );
}
