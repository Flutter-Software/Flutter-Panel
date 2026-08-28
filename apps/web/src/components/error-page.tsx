"use client";

import { Button, Container, Group, Text, Title } from "@mantine/core";
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
  tone: "plain" | "banner";
  illustration?: boolean;
};

const COPY: Record<ErrorKind, Copy> = {
  "not-found": {
    code: "404",
    title: "You have found a secret place.",
    description:
      "Unfortunately, this is only a 404 page. You may have mistyped the address, or the page has been moved to another URL.",
    home: "Take me back to home page",
    tone: "plain",
  },
  forbidden: {
    code: "403",
    title: "You don't have access to this.",
    description:
      "Your account is signed in, but it doesn't have permission to open this page. If you think this is an error, ask an administrator.",
    home: "Take me back to home page",
    tone: "plain",
  },
  unauthorized: {
    code: "401",
    title: "You need to sign in.",
    description: "This page requires a session. Sign in and we'll send you back to where you were.",
    home: "Sign in",
    tone: "plain",
  },
  "rate-limited": {
    code: "429",
    title: "Slow down a little.",
    description:
      "Too many requests hit the panel just now. Wait a few seconds, then refresh the page.",
    home: "Take me back to home page",
    retry: "Refresh the page",
    tone: "plain",
  },
  "server-error": {
    code: "500",
    title: "Something bad just happened...",
    description:
      "Our servers could not handle your request. Don't worry, our development team was already notified. Try refreshing the page.",
    home: "Take me back to home page",
    retry: "Refresh the page",
    tone: "banner",
  },
  "bad-gateway": {
    code: "502",
    title: "We lost the connection...",
    description:
      "The gateway is up, but the service behind it did not answer. It may be restarting. Wait a couple of seconds and refresh the page.",
    home: "Take me back to home page",
    retry: "Refresh the page",
    tone: "banner",
  },
  unavailable: {
    title: "All of our servers are busy",
    description:
      "We cannot handle your request right now, please wait for a couple of minutes and refresh the page. Our team is already working on this issue.",
    home: "Take me back to home page",
    retry: "Refresh the page",
    tone: "banner",
    illustration: true,
  },
  maintenance: {
    title: "This node is in maintenance",
    description:
      "The machine that runs this server is temporarily unavailable. Your server is still listed on the dashboard — check back after maintenance is complete.",
    home: "Back to server list",
    retry: "Refresh the page",
    tone: "banner",
    illustration: true,
  },
};

export function kindFromFailure(error?: string | null, status?: number | null): ErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
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

function OverloadIllustration({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 800 420"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="400" cy="210" r="186" stroke="currentColor" strokeWidth="2" opacity="0.35" />
      <circle cx="400" cy="210" r="132" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <rect x="268" y="92" width="108" height="196" rx="14" fill="currentColor" opacity="0.35" />
      <rect x="284" y="112" width="76" height="10" rx="5" fill="currentColor" opacity="0.7" />
      <rect x="284" y="136" width="76" height="10" rx="5" fill="currentColor" opacity="0.7" />
      <rect x="284" y="160" width="76" height="10" rx="5" fill="currentColor" opacity="0.7" />
      <rect x="284" y="184" width="44" height="10" rx="5" fill="currentColor" opacity="0.45" />
      <circle cx="348" cy="250" r="6" fill="currentColor" opacity="0.85" />
      <circle cx="328" cy="250" r="6" fill="currentColor" opacity="0.5" />
      <rect x="424" y="118" width="108" height="170" rx="14" fill="currentColor" opacity="0.28" />
      <rect x="440" y="138" width="76" height="10" rx="5" fill="currentColor" opacity="0.7" />
      <rect x="440" y="162" width="76" height="10" rx="5" fill="currentColor" opacity="0.7" />
      <rect x="440" y="186" width="52" height="10" rx="5" fill="currentColor" opacity="0.45" />
      <circle cx="504" cy="248" r="6" fill="currentColor" opacity="0.85" />
      <path
        d="M214 318c28-46 70-74 120-74 58 0 90 38 132 38 44 0 72-28 120-28 46 0 86 24 120 62"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        opacity="0.35"
      />
      <ellipse cx="400" cy="338" rx="92" ry="14" fill="currentColor" opacity="0.18" />
      <path
        d="M358 286c0-22 16-40 42-40s42 18 42 40v22c0 10-8 18-18 18h-48c-10 0-18-8-18-18v-22Z"
        fill="currentColor"
        opacity="0.55"
      />
      <circle cx="400" cy="214" r="22" fill="currentColor" opacity="0.7" />
      <rect x="372" y="300" width="56" height="36" rx="8" fill="currentColor" opacity="0.45" />
      <rect x="454" y="292" width="62" height="40" rx="8" fill="currentColor" opacity="0.4" />
      <rect x="464" y="302" width="42" height="6" rx="3" fill="currentColor" opacity="0.75" />
    </svg>
  );
}

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
  const buttonVariant = copy.tone === "banner" ? "white" : "filled";
  const refresh = () => {
    if (onRetry) onRetry();
    else if (typeof window !== "undefined") window.location.reload();
  };
  const href =
    kind === "unauthorized" ? "/login" : homeHref && homeHref.startsWith("/") ? homeHref : "/";

  return (
    <div className={classes.root} data-kind={kind} data-tone={copy.tone}>
      <Container size={640}>
        <div className={classes.inner}>
          {copy.illustration ? <OverloadIllustration className={classes.image} /> : null}
          <div className={classes.content}>
            {copy.code ? <div className={classes.label}>{copy.code}</div> : null}
            <Title className={classes.title}>{copy.title}</Title>
            <Text size="lg" ta="center" className={classes.description}>
              {copy.description}
            </Text>
            <Group justify="center">
              {copy.retry ? (
                <Button variant={buttonVariant} size="md" onClick={refresh}>
                  {retryLabel ?? copy.retry}
                </Button>
              ) : (
                <Button component="a" href={href} variant={buttonVariant} size="md">
                  {homeLabel ?? copy.home}
                </Button>
              )}
            </Group>
          </div>
        </div>
      </Container>
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
