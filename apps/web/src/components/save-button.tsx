"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

function SaveCheckMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-7" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" className="stroke-current opacity-25" strokeWidth="2" />
      <circle cx="12" cy="12" r="9" className="flutter-save-circle stroke-current" strokeWidth="2" />
      <path
        d="M7.5 12.2l3.2 3.2 5.8-6.4"
        className="flutter-save-check stroke-current"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SaveButton({
  pending,
  saved,
  children,
  className,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  pending: boolean;
  saved: boolean;
  children: ReactNode;
}) {
  const label = typeof children === "string" ? children : "Save";
  return (
    <Button
      type="submit"
      disabled={pending || saved || disabled}
      aria-label={saved ? "Saved" : pending ? "Saving" : label}
      className={cn("relative", saved && "no-press disabled:opacity-100 disabled:shadow-sm", className)}
      {...props}
    >
      <span className={cn("whitespace-nowrap", (pending || saved) && "invisible")}>{children}</span>
      {pending && !saved ? (
        <span className="absolute inset-0 flex items-center justify-center">Saving…</span>
      ) : null}
      {saved ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <SaveCheckMark />
        </span>
      ) : null}
    </Button>
  );
}
