/**
 * User data access — registration and lookup against the app_user table.
 *
 * SERVER ONLY. All password handling goes through lib/auth.ts (bcrypt); this
 * module never sees or stores a plaintext password beyond hashing it on the way
 * in. SQL is parameterized by the Neon driver — user input is never concatenated
 * into a query, so injection is structurally impossible.
 */

import "server-only";
import { nanoid } from "nanoid";
import { sql } from "@/lib/db";
import { hashPassword, verifyPassword, type Role, type SessionUser } from "@/lib/auth";

type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: string;
};

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role === "admin" ? "admin" : "user",
  };
}

/** Look up a user by email (lowercased). Null if none. */
async function findByEmail(email: string): Promise<UserRow | null> {
  const rows = (await sql`
    SELECT id, email, name, password_hash, role
    FROM app_user WHERE email = ${email.toLowerCase().trim()}
    LIMIT 1
  `) as unknown as UserRow[];
  return rows[0] ?? null;
}

/**
 * Register a new user. Everyone who self-registers is a plain "user" — admin is
 * only ever set by the seed/console, never by public registration (so nobody can
 * make themselves an admin by signing up).
 *
 * @returns the session user on success, or an error code. Does NOT reveal
 *   whether an email exists beyond the unavoidable "already registered" — which
 *   is acceptable for a signup form (unlike login, where we hide it).
 */
export async function registerUser(input: {
  email: string;
  name: string;
  password: string;
}): Promise<{ ok: true; user: SessionUser } | { ok: false; error: "email_taken" }> {
  const email = input.email.toLowerCase().trim();

  const existing = await findByEmail(email);
  if (existing) return { ok: false, error: "email_taken" };

  const passwordHash = await hashPassword(input.password);
  const id = `usr-${nanoid(16)}`;
  const role: Role = "user"; // public registration is ALWAYS a plain user

  await sql`
    INSERT INTO app_user (id, email, name, password_hash, role)
    VALUES (${id}, ${email}, ${input.name.trim()}, ${passwordHash}, ${role})
  `;

  return { ok: true, user: { id, email, name: input.name.trim(), role } };
}

/**
 * Verify a login. CONSTANT-RESPONSE for unknown-email vs wrong-password: we run
 * a bcrypt compare even when the user doesn't exist (against a dummy hash) so the
 * response time and the result ("invalid") don't reveal whether the email is
 * registered — defeating user enumeration.
 */
const DUMMY_HASH = "$2a$12$abcdefghijklmnopqrstuv0123456789012345678901234567890a";

export async function authenticate(
  email: string,
  password: string,
): Promise<SessionUser | null> {
  const row = await findByEmail(email);
  // Always run a compare — against the real hash if the user exists, a dummy if
  // not — so timing is the same either way.
  const ok = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) return null;
  return toSessionUser(row);
}

/**
 * The user's CURRENT role, straight from the database.
 *
 * Used by requireAdmin() to re-verify on every admin request rather than trusting
 * the role baked into a 7-day session token. Returns null when the user no longer
 * exists — a deleted account must not retain access via a live cookie.
 */
export async function getUserRole(id: string): Promise<Role | null> {
  const rows = (await sql`
    SELECT role FROM app_user WHERE id = ${id} LIMIT 1
  `) as unknown as { role: string }[];
  if (rows.length === 0) return null;
  return rows[0].role === "admin" ? "admin" : "user";
}

/** Set a user's password (used to give the seeded admin a real password). */
export async function setUserPassword(email: string, password: string): Promise<boolean> {
  const hash = await hashPassword(password);
  const rows = (await sql`
    UPDATE app_user SET password_hash = ${hash}
    WHERE email = ${email.toLowerCase().trim()} RETURNING id
  `) as unknown as { id: string }[];
  return rows.length > 0;
}
