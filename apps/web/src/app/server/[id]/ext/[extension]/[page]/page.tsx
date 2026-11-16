"use client";

/**
 * /server/:id/ext/:extension/:page
 *
 * Hosts one extension server page (declared in the manifest under
 * `contributes.serverPages`) inside the regular server frame.
 */

import { use } from "react";
import { ExtensionFrame } from "@/components/extension-frame";
import { useServerRecord } from "@/components/server-frame";
import { EmptyState } from "@/components/ui";
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
    return <div className="h-full min-h-[28rem] animate-pulse rounded-lg border border-border bg-well" />;
  }

  if (!extension || !page) {
    return (
      <EmptyState
        title="Extension unavailable"
        description={
          error ??
          "This extension page doesn't exist, an admin turned it off, or it isn't available for this server."
        }
      />
    );
  }

  return <ExtensionFrame server={server} extension={extension} page={page} />;
}
