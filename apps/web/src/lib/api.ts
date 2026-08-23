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
    invalidateMutating(path);
  }

  return json as T;
}

function invalidateMutating(path: string) {
  const clean = path.split("?")[0];
  invalidateQuery(clean);
  const parent = clean.replace(/\/[^/]+$/, "");
  if (parent.startsWith("/api/")) invalidateQuery(parent);
  if (clean.includes("/admin/eggs")) invalidateQuery("/api/v1/admin/nests");
}

export function apiUpload<T>(
  path: string,
  body: unknown,
  onProgress?: (ratio: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.withCredentials = true;
    xhr.setRequestHeader("content-type", "application/json");
    const csrf = csrfToken();
    if (csrf) xhr.setRequestHeader(CSRF_HEADER, csrf);
    xhr.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable || event.total <= 0) return;
      onProgress(Math.min(1, event.loaded / event.total));
    };
    xhr.onload = () => {
      let json: T | ApiError | null = null;
      try {
        json = JSON.parse(xhr.responseText) as T | ApiError;
      } catch {
        json = null;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const message =
          json && typeof json === "object" && "error" in json
            ? json.error.message
            : `Request failed (${xhr.status})`;
        reject(new Error(message));
        return;
      }
      invalidateMutating(path);
      resolve(json as T);
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(JSON.stringify(body));
  });
}

export type MeResponse = { data: { user: PublicUser | null } };
export type SetupResponse = { data: { initialized: boolean; userCount: number } };
export type AuthResponse = {
  data: {
    user: PublicUser | null;
    needsVerification: boolean;
    needsTotp?: boolean;
    totpToken?: string;
    email?: string;
  };
};
