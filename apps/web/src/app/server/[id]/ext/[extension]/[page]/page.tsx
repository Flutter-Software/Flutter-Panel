"use client";

/**
 * /server/:id/ext/:extension/:page
 *
 * Hosts one extension server page (declared in the manifest under
 * `contributes.serverPages`) inside the regular server frame.
 */

import { use } from "react";
import { Puzzle } from "lucide-react";
import { ExtensionFrame } from "@/components/extension-frame";
import { useServerRecord } from "@/components/server-frame";
import { Card } from "@/components/ui";
import { useServerExtensions } from "@/lib/use-server-extensions";

export default function ExtensionPage({
  params,
}: {
  params: Promise<{ id: string; extension: string; page: string }>;
}) {
  const { id, extension: extensionId, page: pageId } = use(params);
  const server = useServerRecord();
  const { extensions, data, error } = useServerExtensions(id);

  const extension = extensions.find((row) => row.id === extensionId);
  const page = extension?.pages.find((row) => row.id === pageId);

  if (!server || (!data && !error)) {
    return <div className="h-full min-h-[28rem] animate-pulse rounded-xl border border-border bg-muted/30" />;
  }

  if (!extension || !page) {
    return (
      <Card className="px-6 py-16 text-center">
        <Puzzle className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-3 text-base font-semibold">Extension unavailable</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          {error ??
            "This extension page doesn't exist, was disabled by an admin, or isn't available for this server."}
        </p>
      </Card>
    );
  }

  return <ExtensionFrame server={server} extension={extension} page={page} />;
}
