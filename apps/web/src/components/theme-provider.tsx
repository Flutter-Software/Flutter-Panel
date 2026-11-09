"use client";

import { MantineProvider } from "@mantine/core";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { useCallback, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { flutterMantineTheme } from "@/lib/mantine-theme";
import { useMotion } from "@/components/motion-provider";

/**
 * Switches theme with one GPU-composited crossfade of the whole page, instead of
 * every element animating its own colors on the main thread. Falls back to an
 * instant change when motion is off or the browser lacks View Transitions.
 */
export function useSmoothTheme() {
  const { setTheme } = useTheme();
  const { enabled: motionEnabled } = useMotion();

  return useCallback(
    (next: "light" | "dark") => {
      const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!motionEnabled || prefersReduced || typeof document.startViewTransition !== "function") {
        setTheme(next);
        return;
      }
      // flushSync makes React apply the theme inside the callback, so the
      // browser's "after" snapshot is taken with the new colors in place.
      document.startViewTransition(() => {
        flushSync(() => setTheme(next));
      });
    },
    [motionEnabled, setTheme],
  );
}

function MantineBridge({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const scheme = resolvedTheme === "light" ? "light" : "dark";

  return (
    <MantineProvider theme={flutterMantineTheme} defaultColorScheme="dark" forceColorScheme={scheme}>
      {children}
    </MantineProvider>
  );
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      // Mixed "system" looks wrong against our dark-first chrome. Users pick
      // light/dark explicitly (top bar or Account → Appearance).
      enableSystem={false}
      storageKey="flutter-theme"
      // Per-element color transitions look choppy on a theme change. The fade
      // comes from useSmoothTheme's view transition instead.
      disableTransitionOnChange
    >
      <MantineBridge>{children}</MantineBridge>
    </NextThemesProvider>
  );
}
