import { createHmac, timingSafeEqual } from "node:crypto";
import { FlutterError, oidcDiscoveryTestSchema } from "@flutter-software/shared";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import * as client from "openid-client";
import { User } from "../db/models";
import { env } from "../env";
import { log } from "../log";
import { oidcRedirectUri, resolveOidc } from "../settings";
import { attachPendingSubusers } from "../subusers";
import { hashPassword, randomToken } from "./crypto";
import { authCookieOptions, createSession } from "./session";

const OIDC_COOKIE = "flutter_oidc";
const OIDC_TTL_MS = 10 * 60 * 1000;
const DISCOVERY_TTL_MS = 5 * 60 * 1000;

type OidcChallenge = {
  v: 1;
  state: string;
  verifier: string;
  next: string;
  expiresAt: number;
};

const discoveryCache = new Map<string, { at: number; config: client.Configuration }>();

function appOrigin() {
  return env().APP_URL.replace(/\/+$/, "");
}

function loginErrorUrl() {
  return `${appOrigin()}/login?error=sso`;
}

function safeNext(value: string | undefined | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}

function sign(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function signChallenge(input: { state: string; verifier: string; next: string }) {
  const payload: OidcChallenge = {
    v: 1,
    state: input.state,
    verifier: input.verifier,
    next: input.next,
    expiresAt: Date.now() + OIDC_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(env().SESSION_SECRET, body)}`;
}

function verifyChallenge(token: string | undefined): OidcChallenge | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(env().SESSION_SECRET, body);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OidcChallenge;
    if (parsed.v !== 1 || parsed.expiresAt < Date.now()) return null;
    if (!parsed.state || !parsed.verifier) return null;
    return parsed;
  } catch {
    return null;
  }
}

function emailAllowed(email: string, domains: string[]) {
  if (!domains.length) return true;
  const host = email.split("@")[1]?.toLowerCase() ?? "";
  return domains.includes(host);
}

function usernameSeed(preferred: string | undefined, email: string) {
  const raw = (preferred?.includes("@") ? preferred.split("@")[0] : preferred) || email.split("@")[0] || "user";
  let base = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (base.length < 3) base = `${base}user`.slice(0, 32);
  if (base.length < 3) base = "user";
  return base.slice(0, 28);
}

async function uniqueUsername(seed: string) {
  const base = usernameSeed(seed, seed);
  for (let index = 0; index < 80; index += 1) {
    const name = (index === 0 ? base : `${base}${index + 1}`).slice(0, 32);
    if (!(await User.exists({ username: name }))) return name;
  }
  return `${base}${Date.now().toString(36)}`.slice(0, 32);
}

async function discover(issuer: string, clientId: string, clientSecret: string) {
  const key = `${issuer}\0${clientId}`;
  const hit = discoveryCache.get(key);
  if (hit && Date.now() - hit.at < DISCOVERY_TTL_MS) return hit.config;
  const server = new URL(issuer);
  const config = await client.discovery(server, clientId, clientSecret, undefined, {
    execute: server.protocol === "http:" ? [client.allowInsecureRequests] : undefined,
  });
  discoveryCache.set(key, { at: Date.now(), config });
  return config;
}

export async function testOidcDiscovery(body: unknown) {
  const parsed = oidcDiscoveryTestSchema.safeParse(body);
  if (!parsed.success) throw FlutterError.validation("Invalid issuer URL", parsed.error.flatten());
  const issuer = parsed.data.issuer.replace(/\/+$/, "");
  const wellKnown = `${issuer}/.well-known/openid-configuration`;
  let response: Response;
  try {
    response = await fetch(wellKnown, { signal: AbortSignal.timeout(8_000) });
  } catch (error) {
    throw FlutterError.unavailable(error instanceof Error ? error.message : "Could not reach the issuer");
  }
  if (!response.ok) {
    throw FlutterError.unavailable(`Discovery failed (HTTP ${response.status})`);
  }
  const json = (await response.json().catch(() => null)) as {
    issuer?: string;
    authorization_endpoint?: string;
    token_endpoint?: string;
    userinfo_endpoint?: string;
  } | null;
  if (!json?.issuer || !json.authorization_endpoint || !json.token_endpoint) {
    throw FlutterError.unavailable("Issuer did not return OpenID Connect metadata");
  }
  return {
    issuer: json.issuer,
    authorizationEndpoint: json.authorization_endpoint,
    tokenEndpoint: json.token_endpoint,
    userinfoEndpoint: json.userinfo_endpoint ?? null,
  };
}

export async function startOidc(c: Context) {
  try {
    const resolved = await resolveOidc();
    if (!resolved) throw new Error("SSO is not configured");
    const config = await discover(resolved.issuer, resolved.clientId, resolved.clientSecret);
    const verifier = client.randomPKCECodeVerifier();
    const challenge = await client.calculatePKCECodeChallenge(verifier);
    const state = client.randomState();
    const next = safeNext(c.req.query("next"));
    setCookie(c, OIDC_COOKIE, signChallenge({ state, verifier, next }), {
      ...authCookieOptions(),
      maxAge: Math.floor(OIDC_TTL_MS / 1000),
    });
    const redirectTo = client.buildAuthorizationUrl(config, {
      redirect_uri: oidcRedirectUri(),
      scope: resolved.scopes,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    });
    return c.redirect(redirectTo.href);
  } catch (error) {
    log("warn", "oidc start failed", { err: error instanceof Error ? error.message : String(error) });
    return c.redirect(loginErrorUrl());
  }
}

export async function finishOidc(c: Context) {
  const clear = () => deleteCookie(c, OIDC_COOKIE, { path: "/" });
  try {
    const challenge = verifyChallenge(getCookie(c, OIDC_COOKIE));
    clear();
    if (!challenge) throw new Error("SSO session expired");
    const resolved = await resolveOidc();
    if (!resolved) throw new Error("SSO is not configured");

    const config = await discover(resolved.issuer, resolved.clientId, resolved.clientSecret);
    const currentUrl = new URL(oidcRedirectUri());
    currentUrl.search = new URL(c.req.url).search;
    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: challenge.verifier,
      expectedState: challenge.state,
    });
    const claims = tokens.claims();
    let sub = typeof claims?.sub === "string" ? claims.sub : "";
    let email = typeof claims?.email === "string" ? claims.email : "";
    let preferred = typeof claims?.preferred_username === "string" ? claims.preferred_username : "";
    if ((!email || !sub) && tokens.access_token) {
      const info = await client.fetchUserInfo(config, tokens.access_token, sub || client.skipSubjectCheck);
      if (!sub && typeof info.sub === "string") sub = info.sub;
      if (!email && typeof info.email === "string") email = info.email;
      if (!preferred && typeof info.preferred_username === "string") preferred = info.preferred_username;
    }
    email = email.trim().toLowerCase();
    if (!email || !sub) throw new Error("IdP did not return an email and subject");
    if (!emailAllowed(email, resolved.allowedDomains)) throw new Error("Email domain is not allowed");

    const user = await linkOrCreateUser({
      email,
      sub,
      issuer: resolved.issuer,
      preferred,
    });
    await createSession(c, user._id.toString(), true);
    await attachPendingSubusers(user);
    return c.redirect(`${appOrigin()}${challenge.next}`);
  } catch (error) {
    clear();
    log("warn", "oidc callback failed", { err: error instanceof Error ? error.message : String(error) });
    return c.redirect(loginErrorUrl());
  }
}

async function linkOrCreateUser(input: { email: string; sub: string; issuer: string; preferred: string }) {
  const linked = await User.findOne({ oidcIssuer: input.issuer, oidcSub: input.sub });
  if (linked) {
    if (linked.email !== input.email) {
      const taken = await User.findOne({ email: input.email, _id: { $ne: linked._id } });
      if (!taken) {
        linked.email = input.email;
        linked.emailVerified = true;
        await linked.save();
      }
    }
    return linked;
  }

  const existing = await User.findOne({ email: input.email });
  if (existing) {
    existing.oidcIssuer = input.issuer;
    existing.oidcSub = input.sub;
    existing.emailVerified = true;
    await existing.save();
    return existing;
  }

  const userCount = await User.countDocuments();
  return User.create({
    username: await uniqueUsername(input.preferred || input.email),
    email: input.email,
    passwordHash: await hashPassword(randomToken(32)),
    role: userCount === 0 ? "admin" : "user",
    emailVerified: true,
    oidcIssuer: input.issuer,
    oidcSub: input.sub,
  });
}