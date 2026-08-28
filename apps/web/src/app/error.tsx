"use client";

import { useEffect } from "react";
import { HttpError } from "@/lib/api";
import { ErrorPage, kindFromUnknown } from "@/components/error-page";

export default function AppError({
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
    <ErrorPage
      kind={error instanceof HttpError ? kindFromUnknown(error) : "server-error"}
      onRetry={reset}
    />
  );
}
