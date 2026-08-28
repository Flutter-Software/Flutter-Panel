"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { MOTION_STORAGE_KEY, REDUCE_MOTION_ATTR } from "@/lib/motion";

type MotionContextValue = {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
};

const MotionContext = createContext<MotionContextValue>({
  enabled: true,
  setEnabled: () => {},
});

export function MotionProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(true);

  useEffect(() => {
    setEnabledState(document.documentElement.getAttribute(REDUCE_MOTION_ATTR) !== "off");
  }, []);

  const value = useMemo<MotionContextValue>(
    () => ({
      enabled,
      setEnabled(next: boolean) {
        setEnabledState(next);
        document.documentElement.setAttribute(REDUCE_MOTION_ATTR, next ? "on" : "off");
        window.localStorage.setItem(MOTION_STORAGE_KEY, next ? "on" : "off");
      },
    }),
    [enabled],
  );

  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>;
}

export function useMotion() {
  return useContext(MotionContext);
}
