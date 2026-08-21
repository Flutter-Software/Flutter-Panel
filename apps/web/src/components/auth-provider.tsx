"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PublicUser } from "@flutter-software/shared";
import { api, type MeResponse } from "@/lib/api";

type AuthState = {
  user: PublicUser | null;
  ready: boolean;
  refresh: () => Promise<void>;
  setUser: (user: PublicUser | null) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = async () => {
    try {
      const result = await api<MeResponse>("/api/v1/auth/me");
      setUser(result.data.user);
    } catch {
      setUser(null);
    } finally {
      setReady(true);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const value = useMemo(
    () => ({ user, ready, refresh, setUser }),
    [user, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
