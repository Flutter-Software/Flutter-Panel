"use client";

import { useCallback, useEffect, useState } from "react";
import { api, HttpError } from "@/lib/api";
import { peekQuery, subscribeQuery } from "@/lib/query-cache";

export { peekQuery, writeQuery, invalidateQuery } from "@/lib/query-cache";

const inflight = new Map<string, Promise<unknown>>();

/**
 * Stale-while-revalidate.
 *
 * Every mount already shows cached data first and refetches behind it. On top
 * of that, when the tab becomes visible again or the network comes back, every
 * query that a mounted component is using is refetched if its data is older
 * than STALE_AFTER_MS. Cached data stays on screen the whole time; the fresh
 * response just replaces it through the cache's listeners.
 */
const STALE_AFTER_MS = 15_000;
/** path -> number of mounted useQuery hooks reading it. */
const active = new Map<string, number>();
/** path -> time the last successful fetch finished. */
const fetchedAt = new Map<string, number>();
let revalidateHooked = false;

function revalidateActive() {
  const now = Date.now();
  for (const path of active.keys()) {
    if (now - (fetchedAt.get(path) ?? 0) < STALE_AFTER_MS) continue;
    void loadQuery(path).catch(() => undefined);
  }
}

function hookRevalidation() {
  if (revalidateHooked || typeof window === "undefined") return;
  revalidateHooked = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") revalidateActive();
  });
  window.addEventListener("online", revalidateActive);
}

function retain(path: string) {
  hookRevalidation();
  active.set(path, (active.get(path) ?? 0) + 1);
  return () => {
    const next = (active.get(path) ?? 1) - 1;
    if (next <= 0) active.delete(path);
    else active.set(path, next);
  };
}

export function loadQuery<T>(path: string, force = false): Promise<T> {
  if (!force) {
    const pending = inflight.get(path);
    if (pending) return pending as Promise<T>;
  }
  const request = api<T>(path)
    .then((result) => {
      fetchedAt.set(path, Date.now());
      return result;
    })
    .finally(() => {
      if (inflight.get(path) === request) inflight.delete(path);
    });
  inflight.set(path, request);
  return request;
}

export function prefetchQuery(path: string) {
  if (typeof window === "undefined") return;
  void loadQuery(path).catch(() => undefined);
}

export function useQuery<T>(path: string | null) {
  const [data, setData] = useState<T | undefined>(() => (path ? peekQuery<T>(path) : undefined));
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  useEffect(() => {
    if (!path) return;
    setData(peekQuery<T>(path));
    const release = retain(path);
    const unsubscribeCache = subscribeQuery(path, () => {
      setData((current) => peekQuery<T>(path) ?? current);
    });
    const unsubscribe = () => {
      unsubscribeCache();
      release();
    };
    loadQuery<T>(path)
      .then(() => {
        setError(null);
        setErrorStatus(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load");
        setErrorStatus(err instanceof HttpError ? err.status : 503);
      });
    return unsubscribe;
  }, [path]);

  const reload = useCallback(() => {
    if (!path) return Promise.resolve(undefined);
    return loadQuery<T>(path, true)
      .then((result) => {
        setError(null);
        setErrorStatus(null);
        return result;
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load");
        setErrorStatus(err instanceof HttpError ? err.status : 503);
        throw err;
      });
  }, [path]);

  return {
    data,
    error,
    errorStatus,
    loading: Boolean(path) && data === undefined && !error,
    reload,
  };
}
