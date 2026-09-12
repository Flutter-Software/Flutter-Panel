import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, isLoopbackHost } from "@flutter-software/shared";

const PUBLIC = new Set(["/login", "/register", "/verify", "/sso"]);
const PUBLIC_FILE = /\.(?:ico|png|jpe?g|gif|webp|svg|woff2?)$/i;

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

function clientIp(request: NextRequest) {
  const forwarded =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "";
  if (forwarded) return forwarded;
  const ip = (request as NextRequest & { ip?: string | null }).ip;
  return typeof ip === "string" ? ip.trim() : "";
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    PUBLIC_FILE.test(pathname)
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api")) {
    const ip = clientIp(request);
    if (!ip) return NextResponse.next();
    const headers = new Headers(request.headers);
    if (!headers.get("x-forwarded-for")) headers.set("x-forwarded-for", ip);
    if (!headers.get("x-real-ip")) headers.set("x-real-ip", ip);
    return NextResponse.next({ request: { headers } });
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
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:ico|png|jpe?g|gif|webp|svg)$).*)",
  ],
};
