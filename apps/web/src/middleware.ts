import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@flutter-software/shared";

const PUBLIC = new Set(["/login", "/register", "/verify"]);
const PUBLIC_FILE = /\.(?:ico|png|jpe?g|gif|webp|svg|woff2?)$/i;

function isLoopbackHost(host: string) {
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname === ""
  );
}

function asUrl(value: string, base?: string) {
  try {
    return base ? new URL(value, base) : new URL(value);
  } catch {
    return null;
  }
}

function publicOrigin(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? "";
  const host = forwardedHost || request.headers.get("host")?.split(",")[0]?.trim() || "";
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const appUrl = process.env.APP_URL?.replace(/\/+$/, "");

  // Prefer the hostname the browser actually used. APP_URL is a fallback for
  // when Next only sees 127.0.0.1 behind nginx.
  if (host && !isLoopbackHost(host)) {
    const proto =
      forwardedProto ||
      (appUrl?.startsWith("https:") ? "https" : request.nextUrl.protocol.replace(":", "")) ||
      "http";
    return `${proto}://${host}`;
  }
  if (appUrl) {
    const parsed = asUrl(appUrl);
    if (parsed && !isLoopbackHost(parsed.host)) return appUrl;
  }
  return request.nextUrl.origin;
}

function redirectTo(request: NextRequest, path: string, nextPath?: string) {
  const target = asUrl(path.startsWith("/") ? path : "/", "http://flutter.invalid");
  if (target && nextPath?.startsWith("/")) target.searchParams.set("next", nextPath);
  const location = target ? `${target.pathname}${target.search}` : "/";
  // Next 15's middleware adapter runs `new URL(Location)` with no base.
  // A relative `/login` throws TypeError: Invalid URL and every route 404s.
  const publicUrl = asUrl(publicOrigin(request));
  const requestOrigin = asUrl(request.nextUrl.origin);
  const origin =
    publicUrl && !isLoopbackHost(publicUrl.host) ? publicUrl.origin : requestOrigin?.origin;
  const abs = origin ? asUrl(location, `${origin}/`) : null;
  if (abs) return NextResponse.redirect(abs);
  return NextResponse.next();
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    PUBLIC_FILE.test(pathname)
  ) {
    return NextResponse.next();
  }

  const session = request.cookies.get(SESSION_COOKIE)?.value;
  const invite = pathname.startsWith("/invite/");
  if (!session && !PUBLIC.has(pathname) && !invite) {
    return redirectTo(request, "/login", pathname);
  }
  if (session && (pathname === "/login" || pathname === "/register" || pathname === "/verify")) {
    const next = request.nextUrl.searchParams.get("next");
    return redirectTo(request, next?.startsWith("/") ? next : "/");
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:ico|png|jpe?g|gif|webp|svg)$).*)",
  ],
};
