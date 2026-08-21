"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { peekQuery, subscribeQuery } from "@/lib/query-cache";

export { peekQuery, writeQuery, invalidateQuery } from "@/lib/query-cache";

const inflight = new Map<string, Promise<unknown>>();

export function loadQuery<T>(path: string, force = false): Promise<T> {
  if (!force) {
    const pending = inflight.get(path);
    if (pending) return pending as Promise<T>;
  }
  const request = api<T>(path).finally(() => {
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

  useEffect(() => {
    if (!path) return;
    setData(peekQuery<T>(path));
    const unsubscribe = subscribeQuery(path, () => {
      setData((current) => peekQuery<T>(path) ?? current);
    });
    loadQuery<T>(path)
      .then(() => setError(null))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
    return unsubscribe;
  }, [path]);

  const reload = useCallback(() => {
    if (!path) return Promise.resolve(undefined);
    return loadQuery<T>(path, true);
  }, [path]);

  return {
    data,
    error,
    loading: Boolean(path) && data === undefined && !error,
    reload,
  };
}
