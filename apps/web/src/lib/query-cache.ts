type Entry = { data: unknown; at: number };

const store = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

export function peekQuery<T>(path: string): T | undefined {
  return store.get(path)?.data as T | undefined;
}

export function writeQuery(path: string, data: unknown) {
  store.set(path, { data, at: Date.now() });
  listeners.get(path)?.forEach((listener) => listener());
}

export function subscribeQuery(path: string, listener: () => void) {
  let subs = listeners.get(path);
  if (!subs) {
    subs = new Set();
    listeners.set(path, subs);
  }
  subs.add(listener);
  return () => {
    subs.delete(listener);
  };
}

export function invalidateQuery(prefix: string) {
  const keys = [...store.keys()].filter(
    (key) => key === prefix || key.startsWith(`${prefix}?`) || key.startsWith(`${prefix}/`),
  );
  for (const key of keys) {
    store.delete(key);
    listeners.get(key)?.forEach((listener) => listener());
  }
  listeners.get(prefix)?.forEach((listener) => listener());
}
