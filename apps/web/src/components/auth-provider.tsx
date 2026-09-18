"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PublicUser } from "@flutter-software/shared";
import { ErrorPage } from "@/components/error-page";
import { api, HttpError, type MeResponse } from "@/lib/api";

type AuthState = {
  user: PublicUser | null;
  ready: boolean;
  refresh: () => Promise<void>;
  setUser: (user: PublicUser | null) => void;
};

const AuthContext = createContext<AuthState | null>(null);

function isPanelDown(error: unknown) {
  if (!(error instanceof HttpError)) return true;
  return error.status >= 500 || error.code === "UNAVAILABLE" || error.code === "INTERNAL";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await api<MeResponse>("/api/v1/auth/me");
      setUser(result.data.user);
      setUnavailable(false);
    } catch (error) {
      // Cookie still lets middleware through, but Mongo/API is down. Don't
      // treat that as signed-out or the shell renders ?? / — placeholders.
      if (isPanelDown(error)) {
        setUnavailable(true);
        return;
      }
      setUser(null);
      setUnavailable(false);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ user, ready, refresh, setUser }),
    [user, ready, refresh],
  );

  let body: ReactNode = null;
  if (ready && unavailable) {
    body = <ErrorPage kind="server-error" onRetry={() => void refresh()} />;
  } else if (ready) {
    body = children;
  }

  return <AuthContext.Provider value={value}>{body}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
