import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { toDataURL } from "qrcode";
import { TOTP_CHALLENGE_TTL_MS } from "@flutter-software/shared";
import { tokenEquals } from "./crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD_MS = 30_000;
const DIGITS = 6;
const WINDOWS = [-1, 0, 1] as const;

type TotpChallenge = {
  v: 1;
  userId: string;
  remember: boolean;
  expiresAt: number;
};

function sign(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function otpauthUrl(input: { issuer: string; account: string; secret: string }) {
  const issuer = encodeURIComponent(input.issuer);
  const account = encodeURIComponent(input.account);
  return `otpauth://totp/${issuer}:${account}?secret=${input.secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

export async function totpQrDataUrl(otpauth: string) {
  return toDataURL(otpauth, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240,
    color: { dark: "#0a0a0a", light: "#ffffff" },
  });
}

export function verifyTotpCode(secret: string, code: string, at = Date.now()) {
  if (!secret || code.length !== DIGITS) return false;
  let key: Buffer;
  try {
    key = base32Decode(secret);
  } catch {
    return false;
  }
  if (!key.length) return false;
  const counter = Math.floor(at / PERIOD_MS);
  // ±30s for phone clock skew. Loop every window even after a hit so valid
  // and invalid codes take the same number of HMAC compares.
  let matched = false;
  for (const window of WINDOWS) {
    if (tokenEquals(hotp(key, counter + window), code)) matched = true;
  }
  return matched;
}

export function signTotpChallenge(
  secret: string,
  input: { userId: string; remember?: boolean },
  ttlMs = TOTP_CHALLENGE_TTL_MS,
) {
  const payload: TotpChallenge = {
    v: 1,
    userId: input.userId,
    remember: Boolean(input.remember),
    expiresAt: Date.now() + ttlMs,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(secret, body)}`;
}

export function verifyTotpChallenge(secret: string, token: string | null | undefined): TotpChallenge | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(secret, body);
  try {
    const left = Buffer.from(signature, "utf8");
    const right = Buffer.from(expected, "utf8");
    if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TotpChallenge;
    if (payload?.v !== 1 || !payload.userId || Date.now() > payload.expiresAt) return null;
    return payload;
  } catch {
    return null;
  }
}

function hotp(secret: Buffer, counter: number) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.max(0, counter)));
  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

function base32Encode(bytes: Buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string) {
  const clean = input.toUpperCase().replace(/[\s=]+/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Invalid secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
