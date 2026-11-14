"use client";

import type { ClientExtension } from "@flutter-software/shared";
import { useQuery } from "@/lib/query";

export function serverExtensionsPath(serverId: string) {
  return `/api/v1/client/servers/${serverId}/extensions`;
}

/**
 * Enabled extensions that apply to this server, with the pages the viewer may
 * open. Shared by the server sidebar and the extension page so both read the
 * same cached response.
 */
export function useServerExtensions(serverId: string) {
  const query = useQuery<{ data: { extensions: ClientExtension[] } }>(serverExtensionsPath(serverId));
  return { ...query, extensions: query.data?.data.extensions ?? [] };
}
