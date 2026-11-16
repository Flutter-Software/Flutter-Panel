"use client";

import { Button, buttonClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { HttpError } from "@/lib/api";
import classes from "./error-page.module.css";

export type ErrorKind =
  | "not-found"
  | "forbidden"
  | "unauthorized"
  | "rate-limited"
  | "server-error"
  | "bad-gateway"
  | "unavailable"
  | "maintenance";

type Copy = {
  code?: string;
  title: string;
  description: string;
  home: string;
  retry?: string;
  /** Colour of the status rail: error for failures, warn for "wait", offline for "not here". */
  tone: "error" | "warn" | "offline";
};

const COPY: Record<ErrorKind, Copy> = {
  "not-found": {
    code: "404",
    title: "This page doesn't exist",
    description:
      "The address may be mistyped, or the page was moved or deleted. Check the URL, or go back to your servers.",
    home: "Go to servers",
    tone: "offline",
  },
  forbidden: {
    code: "403",
    title: "You don't have access to this page",
    description:
      "You're signed in, but your account doesn't have permission to open it. Ask a panel administrator or the server owner for access.",
    home: "Go to servers",
    tone: "offline",
  },
  unauthorized: {
    code: "401",
    title: "Sign in to continue",
    description: "Your session ended, or you haven't signed in yet. Sign in and you'll come back to this page.",
    home: "Sign in",
    tone: "offline",
  },
  "rate-limited": {
    code: "429",
    title: "Too many requests",
    description: "The panel received a lot of requests from you in a short time. Wait a few seconds, then try again.",
    home: "Go to servers",
    retry: "Try again",
    tone: "warn",
  },
  "server-error": {
    code: "500",
    title: "The panel hit an error",
    description:
      "Something failed while loading this page. Try again. If it keeps happening, check the panel logs or report the issue.",
    home: "Go to servers",
    retry: "Try again",
    tone: "error",
  },
  "bad-gateway": {
    code: "502",
    title: "The panel API isn't answering",
    description:
      "The web panel is up, but the API behind it didn't respond. It may be restarting. Wait a few seconds and try again.",
    home: "Go to servers",
    retry: "Try again",
    tone: "error",
  },
  unavailable: {
    code: "503",
    title: "The panel can't be reached right now",
    description:
      "The service didn't respond in time. It may be busy or restarting. Wait a minute, then try again.",
    home: "Go to servers",
    retry: "Try again",
    tone: "error",
  },
  maintenance: {
    title: "This node is in maintenance",
    description:
      "The machine that runs this server is temporarily unavailable. The server is still in your list. Check back once maintenance is finished.",
    home: "Back to servers",
    retry: "Try again",
    tone: "warn",
  },
};

const RAIL: Record<Copy["tone"], string> = {
  error: "bg-status-error",
  warn: "bg-status-warn",
  offline: "bg-status-offline",
};

const CODE_TEXT: Record<Copy["tone"], string> = {
  error: "text-status-error",
  warn: "text-status-warn",
  offline: "text-muted-foreground",
};

export function kindFromFailure(error?: string | null, status?: number | null): ErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  if (status === 500) return "server-error";
  if (status === 502) return "bad-gateway";
  if (status === 503 || status === 504) return "unavailable";
  const text = error ?? "";
  if (/maintenance/i.test(text)) return "maintenance";
  if (/not found/i.test(text)) return "not-found";
  if (/forbidden|permission|not allowed|access denied/i.test(text)) return "forbidden";
  if (/unauthorized|unauthenticated|sign in required/i.test(text)) return "unauthorized";
  if (/rate limit|too many/i.test(text)) return "rate-limited";
  if (/bad gateway|\b502\b/i.test(text)) return "bad-gateway";
  if (
    /offline|unavailable|daemon|failed to fetch|network|econnrefused|reach the panel|busy/i.test(
      text,
    )
  ) {
    return "unavailable";
  }
  return "server-error";
}

export function kindFromUnknown(error: unknown): ErrorKind {
  if (error instanceof HttpError) return kindFromFailure(error.message, error.status);
  if (error instanceof Error) return kindFromFailure(error.message);
  return "server-error";
}

/**
 * Full-page error. Laid out like a rack unit that has gone down: a status rail
 * on the left edge in the failure's colour, then the code, a plain title, what
 * happened and what to do, and one action. Left-aligned like the rest of the panel.
 */
export function ErrorPage({
  kind,
  homeHref = "/",
  homeLabel,
  onRetry,
  retryLabel,
}: {
  kind: ErrorKind;
  homeHref?: string;
  homeLabel?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const copy = COPY[kind];
  const refresh = () => {
    if (onRetry) onRetry();
    else if (typeof window !== "undefined") window.location.reload();
  };
  const href =
    kind === "unauthorized" ? "/login" : homeHref && homeHref.startsWith("/") ? homeHref : "/";

  return (
    <div className={classes.root} data-kind={kind}>
      <div className="relative w-full max-w-[60ch] py-1 pl-6">
        <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", RAIL[copy.tone])} />
        <p className={cn("text-[13px] font-medium", CODE_TEXT[copy.tone])} data-numeric>
          {copy.code ? `Error ${copy.code}` : "Unavailable"}
        </p>
        <h1 className="mt-1 text-[31px] font-semibold">{copy.title}</h1>
        <p className="mt-3 text-[15px] text-muted-foreground">{copy.description}</p>
        <div className="mt-6">
          {copy.retry ? (
            <Button type="button" onClick={refresh}>
              {retryLabel ?? copy.retry}
            </Button>
          ) : (
            <a href={href} className={buttonClass()}>
              {homeLabel ?? copy.home}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export function QueryErrorPage({
  error,
  status,
  onRetry,
  homeHref,
  homeLabel,
}: {
  error: string;
  status?: number | null;
  onRetry?: () => void;
  homeHref?: string;
  homeLabel?: string;
}) {
  const kind = kindFromFailure(error, status);
  const copy = COPY[kind];
  return (
    <ErrorPage
      kind={kind}
      onRetry={copy.retry ? onRetry : undefined}
      homeHref={homeHref}
      homeLabel={homeLabel}
    />
  );
}
