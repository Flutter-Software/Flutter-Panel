"use client";

import { MantineProvider } from "@mantine/core";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import type { ReactNode } from "react";
import { flutterMantineTheme } from "@/lib/mantine-theme";
import { useMotion } from "@/components/motion-provider";

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
  const { enabled: motionEnabled } = useMotion();
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      // Mixed "system" looks wrong against our dark-first chrome. Users pick
      // light/dark explicitly (top bar or Account → Appearance).
      enableSystem={false}
      storageKey="flutter-theme"
      disableTransitionOnChange={!motionEnabled}
    >
      <MantineBridge>{children}</MantineBridge>
    </NextThemesProvider>
  );
}
