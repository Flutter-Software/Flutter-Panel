"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthBrand } from "@/components/brand";
import { VerifyEmailForm } from "@/components/verify-email-form";
import { useAuth } from "@/components/auth-provider";
import { PANEL_VERSION } from "@flutter-software/shared";

function VerifyContent() {
  const router = useRouter();
  const { setUser } = useAuth();
  const searchParams = useSearchParams();
  const email = (searchParams.get("email") ?? "").trim();
  const next = searchParams.get("next");

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-[400px]">
        <AuthBrand className="mb-8" />
        <div className="rounded-xl border border-border bg-card p-8">
          <h1 className="text-2xl font-semibold tracking-tight">Verify your sign-in</h1>
          {email ? (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter the 6-digit code we sent to{" "}
                <span className="font-medium text-foreground">{email}</span>. It expires in 10
                minutes.
              </p>
              <VerifyEmailForm
                email={email}
                onVerified={(user) => {
                  setUser(user);
                  router.push(next?.startsWith("/") ? next : "/");
                  router.refresh();
                }}
              />
            </>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Start from{" "}
              <Link href="/register" className="font-medium text-primary">
                creating an account
              </Link>{" "}
              or{" "}
              <Link href="/login" className="font-medium text-primary">
                signing in
              </Link>
              .
            </p>
          )}
        </div>
      </div>
      <p className="absolute bottom-6 font-mono text-xs text-muted-foreground">v{PANEL_VERSION}</p>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyContent />
    </Suspense>
  );
}
