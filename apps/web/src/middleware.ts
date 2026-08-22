import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@flutter-software/shared";

const PUBLIC = new Set(["/login"]);
const PUBLIC_FILE = /\.(?:ico|png|jpe?g|gif|webp|svg|woff2?)$/i;

function isLoopbackHost(host: string) {
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function publicOrigin(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? "";
  const host = forwardedHost || request.headers.get("host")?.split(",")[0]?.trim() || "";
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const appUrl = process.env.APP_URL?.replace(/\/+$/, "");

  if (host && !isLoopbackHost(host)) {
    const proto =
      forwardedProto ||
      (appUrl?.startsWith("https:") ? "https" : request.nextUrl.protocol.replace(":", "")) ||
      "http";
    return `${proto}://${host}`;
  }
  if (appUrl) {
    try {
      if (!isLoopbackHost(new URL(appUrl).host)) return appUrl;
    } catch {
      /* ignore */
    }
  }
  return request.nextUrl.origin;
}

function redirectTo(request: NextRequest, path: string, nextPath?: string) {
  const target = new URL(path, "http://flutter.invalid");
  if (nextPath) target.searchParams.set("next", nextPath);
  const location = `${target.pathname}${target.search}`;
  const origin = publicOrigin(request);
  if (origin && !isLoopbackHost(new URL(origin).host)) {
    return NextResponse.redirect(new URL(location, `${origin}/`));
  }
  return new NextResponse(null, {
    status: 307,
    headers: { Location: location },
  });
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
  if (session && pathname === "/login") {
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
