"use client";

import { useCallback, useEffect, useState } from "react";
import { api, HttpError } from "@/lib/api";
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
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  useEffect(() => {
    if (!path) return;
    setData(peekQuery<T>(path));
    const unsubscribe = subscribeQuery(path, () => {
      setData((current) => peekQuery<T>(path) ?? current);
    });
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
