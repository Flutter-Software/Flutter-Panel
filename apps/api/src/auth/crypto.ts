import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@flutter-software/shared";

const HASH_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export function validatePassword(password: string) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
}

export function hashPassword(password: string) {
  return hash(password, HASH_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string) {
  try {
    return await verify(passwordHash, password, HASH_OPTIONS);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

export function dummyPasswordHash() {
  dummyHash ??= hash("flutter-invalid-password", HASH_OPTIONS);
  return dummyHash;
}

export function tokenEquals(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function publicUser(row: {
  id?: string;
  _id?: { toString(): string };
  username: string;
  email: string;
  role: string;
  totpEnabled: boolean;
  createdAt: Date;
}) {
  return {
    id: row.id ?? row._id?.toString() ?? "",
    username: row.username,
    email: row.email,
    role: row.role as "admin" | "user",
    totpEnabled: row.totpEnabled,
    createdAt: row.createdAt.toISOString(),
  };
}
