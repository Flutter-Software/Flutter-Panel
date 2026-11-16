"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";

export default function SsoPage() {
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token")?.trim() ?? "";
    const next = token
      ? `/api/v1/auth/sso?token=${encodeURIComponent(token)}`
      : "/login?error=sso";
    const timer = window.setTimeout(() => {
      window.location.replace(next);
    }, 150);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="flex min-h-full items-center justify-center bg-background px-4">
      <p className="flex items-center gap-2.5 text-sm text-muted-foreground" role="status" aria-live="polite">
        <Loader2 className="size-4 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
        Signing you in…
      </p>
    </div>
  );
}
