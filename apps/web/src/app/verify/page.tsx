"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthHeading, AuthShell } from "@/components/brand";
import { VerifyEmailForm } from "@/components/verify-email-form";
import { useAuth } from "@/components/auth-provider";

function VerifyContent() {
  const router = useRouter();
  const { setUser } = useAuth();
  const searchParams = useSearchParams();
  const email = (searchParams.get("email") ?? "").trim();
  const next = searchParams.get("next");

  return (
    <AuthShell>
      {email ? (
        <>
          <AuthHeading title="Check your email">
            We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>. It
            expires in 10 minutes.
          </AuthHeading>
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
        <AuthHeading title="Check your email">
          This link is missing the address to verify. Start again by{" "}
          <Link href="/register" className="font-medium text-primary hover:underline">
            creating an account
          </Link>{" "}
          or{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            signing in
          </Link>
          .
        </AuthHeading>
      )}
    </AuthShell>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyContent />
    </Suspense>
  );
}
