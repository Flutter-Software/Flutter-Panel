"use client";

import { useEffect } from "react";
import { MantineProvider } from "@mantine/core";
import { ErrorPage } from "@/components/error-page";
import { flutterMantineTheme } from "@/lib/mantine-theme";
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" className="dark" data-mantine-color-scheme="dark">
      <body className="bg-background font-sans text-foreground">
        <MantineProvider theme={flutterMantineTheme} forceColorScheme="dark">
          <ErrorPage kind="server-error" onRetry={reset} />
        </MantineProvider>
      </body>
    </html>
  );
}
