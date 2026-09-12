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
    <div className="flex min-h-full flex-col items-center justify-center bg-background px-4">
      <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
      <p className="mt-4 text-sm text-muted-foreground" role="status" aria-live="polite">
        We&apos;re trying to sign you in...
      </p>
    </div>
  );
}
