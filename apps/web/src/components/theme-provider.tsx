"use client";

import { MantineProvider } from "@mantine/core";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import type { ReactNode } from "react";
import { flutterMantineTheme } from "@/lib/mantine-theme";

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
      enableSystem={false}
      storageKey="flutter-theme"
      disableTransitionOnChange
    >
      <MantineBridge>{children}</MantineBridge>
    </NextThemesProvider>
  );
}
