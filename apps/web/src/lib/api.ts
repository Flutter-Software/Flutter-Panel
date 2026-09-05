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

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "INTERNAL") {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

function httpErrorFrom(json: unknown, status: number) {
  const body = json && typeof json === "object" && "error" in json ? (json as ApiError).error : null;
  const message = body?.message || `Request failed (${status})`;
  const code = body?.code || (status === 503 ? "UNAVAILABLE" : "INTERNAL");
  return new HttpError(message, status, code);
}

function csrfToken() {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function seedListCache(path: string, json: unknown) {
  // List endpoints carry enough of each row to hydrate /:id. Stops the edit
  // page from flashing empty while the detail request is in flight.
  if (!json || typeof json !== "object" || !("data" in json)) return;
  const data = (json as { data: Record<string, unknown> }).data;
  if (!data || typeof data !== "object") return;

  const lists: Array<[string, string, string]> = [
    ["/api/v1/client/servers", "servers", "server"],
    ["/api/v1/admin/servers", "servers", "server"],
    ["/api/v1/admin/locations", "locations", "location"],
    ["/api/v1/admin/database-hosts", "hosts", "host"],
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

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: "include",
    });
  } catch {
    throw new HttpError("We cannot reach the panel API right now.", 503, "UNAVAILABLE");
  }

  const json = (await response.json().catch(() => null)) as T | ApiError | null;
  if (!response.ok) throw httpErrorFrom(json, response.status);

  if (typeof window !== "undefined" && method === "GET" && json) {
    writeQuery(path, json);
    seedListCache(path, json);
  } else if (typeof window !== "undefined" && method !== "GET") {
    invalidateMutating(path);
  }

  return json as T;
}

function filenameFromDisposition(value: string | null) {
  if (!value) return "download";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* keep going */
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(value);
  if (quoted?.[1]) return quoted[1];
  const plain = /filename=([^;]+)/i.exec(value);
  return (plain?.[1] || "download").trim();
}

export async function apiDownload(path: string): Promise<{ blob: Blob; filename: string }> {
  const headers = new Headers();
  const csrf = csrfToken();
  if (csrf) headers.set(CSRF_HEADER, csrf);
  let response: Response;
  try {
    response = await fetch(path, { credentials: "include", headers });
  } catch {
    throw new HttpError("We cannot reach the panel API right now.", 503, "UNAVAILABLE");
  }
  if (!response.ok) {
    const json = (await response.json().catch(() => null)) as ApiError | null;
    throw httpErrorFrom(json, response.status);
  }
  return {
    blob: await response.blob(),
    filename: filenameFromDisposition(response.headers.get("content-disposition")),
  };
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
        reject(httpErrorFrom(json, xhr.status));
        return;
      }
      invalidateMutating(path);
      resolve(json as T);
    };
    xhr.onerror = () => reject(new HttpError("Upload failed", 503, "UNAVAILABLE"));
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
