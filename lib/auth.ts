/**
 * Authentication core — password hashing + signed-JWT sessions.
 *
 * SERVER ONLY. Every security-sensitive primitive lives here, built from vetted
 * libraries (bcrypt for hashing, jose for JWT). Nothing crypto is hand-rolled.
 *
 * Security properties (see also the route guards that use these):
 *   · Passwords are stored ONLY as bcrypt hashes (salted, slow) — a DB leak
 *     never exposes a password.
 *   · The session is a JWT signed with AUTH_SECRET; a tampered/forged token
 *     fails verification and is rejected.
 *   · The token lives in an httpOnly + Secure + SameSite=Lax cookie: JS can't
 *     read it (XSS-resistant), it's HTTPS-only in prod, and it's not sent on
 *     cross-site requests (CSRF-resistant).
 *   · Login is constant-response for unknown-email vs wrong-password (no user
 *     enumeration).
 */

import "server-only";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

/** bcrypt work factor. 12 is the current sensible default — slow enough to make
 *  brute-force expensive, fast enough not to hurt login UX. */
const BCRYPT_ROUNDS = 12;

/** Session lifetime. 7 days — a booking admin logs in occasionally. */
const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60;

const COOKIE_NAME = "psdlimo_session";

export type Role = "user" | "admin";
export type SessionUser = { id: string; email: string; name: string; role: Role };

/* ── Password hashing ──────────────────────────────────────────────────────── */

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/** Constant-time compare via bcrypt. Returns false for any mismatch — never throws. */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/* ── JWT session ───────────────────────────────────────────────────────────── */

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    // Fail loudly rather than sign with a weak/absent secret — a weak secret is
    // a forgeable session.
    throw new Error(
      "AUTH_SECRET is missing or too short (need >=32 chars). Generate one with " +
        "`openssl rand -base64 48` and set it in .env.local + Vercel.",
    );
  }
  return new TextEncoder().encode(secret);
}

/** Sign a session token for a user. */
export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_S}s`)
    .sign(secretKey());
}

/** Verify a token and return the session user, or null if invalid/expired. */
export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.email !== "string") return null;
    const role: Role = payload.role === "admin" ? "admin" : "user";
    return {
      id: payload.sub,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : "",
      role,
    };
  } catch {
    // Any verification failure (bad signature, expired, malformed) → no session.
    return null;
  }
}

/* ── Cookie helpers ────────────────────────────────────────────────────────── */

export async function setSessionCookie(user: SessionUser): Promise<void> {
  const token = await createSessionToken(user);
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true, // JS cannot read it → XSS can't steal the session
    secure: process.env.NODE_ENV === "production", // HTTPS-only in prod
    sameSite: "lax", // not sent on cross-site POSTs → CSRF-resistant
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

/**
 * The current session, read from the cookie. Returns null when logged out.
 * Use this in Server Components and route handlers to gate on auth/role.
 */
export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/** Throws unless the caller is an admin. The SERVER-SIDE guard behind the admin
 *  UI — a hidden button is not security; this is. */
export async function requireAdmin(): Promise<SessionUser> {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    throw new Error("FORBIDDEN");
  }
  return session;
}
