import {
  CSRF_COOKIE,
  CSRF_HEADER,
  type PublicUser,
} from "@flutter-software/shared";
import { invalidateQuery, writeQuery } from "@/lib/query-cache";

export type ApiError = {
  error: { code: string; message: string };
  requestId?: string;
};

function csrfToken() {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function seedListCache(path: string, json: unknown) {
  if (!json || typeof json !== "object" || !("data" in json)) return;
  const data = (json as { data: Record<string, unknown> }).data;
  if (!data || typeof data !== "object") return;

  const lists: Array<[string, string, string]> = [
    ["/api/v1/client/servers", "servers", "server"],
    ["/api/v1/admin/servers", "servers", "server"],
    ["/api/v1/admin/locations", "locations", "location"],
    ["/api/v1/admin/nests", "nests", "nest"],
    ["/api/v1/admin/users", "users", "user"],
  ];
  for (const [listPath, key, singular] of lists) {
    if (path !== listPath) continue;
    const rows = data[key];
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (!row || typeof row !== "object" || !("id" in row) || typeof row.id !== "string") continue;
      writeQuery(`${listPath}/${row.id}`, { data: { [singular]: row } });
    }
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const csrf = csrfToken();
  if (csrf) headers.set(CSRF_HEADER, csrf);
  const method = (init.method ?? "GET").toUpperCase();

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });

  const json = (await response.json().catch(() => null)) as T | ApiError | null;
  if (!response.ok) {
    const message =
      json && typeof json === "object" && "error" in json
        ? json.error.message
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  if (typeof window !== "undefined" && method === "GET" && json) {
    writeQuery(path, json);
    seedListCache(path, json);
  } else if (typeof window !== "undefined" && method !== "GET") {
    const clean = path.split("?")[0];
    invalidateQuery(clean);
    const parent = clean.replace(/\/[^/]+$/, "");
    if (parent.startsWith("/api/")) invalidateQuery(parent);
  }

  return json as T;
}

export type MeResponse = { data: { user: PublicUser | null } };
export type SetupResponse = { data: { initialized: boolean; userCount: number } };
