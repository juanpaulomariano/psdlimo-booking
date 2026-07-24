/**
 * Database access — the single Neon connection for the whole app.
 *
 * SERVER ONLY. Imports "server-only" so a client component that reaches for the
 * DB fails the build rather than leaking the connection string into the browser.
 *
 * We use Neon's serverless driver (HTTP-based), which is built for serverless
 * functions: no connection pool to exhaust, no idle sockets, each query is an
 * independent request. That matches how Vercel runs our routes.
 *
 * Usage:  const rows = await sql`SELECT * FROM rates WHERE key = ${key}`;
 * Values interpolated with ${} are sent as PARAMETERS, never string-concatenated,
 * so this is SQL-injection-safe by construction — never build a query by
 * concatenating user input into the template.
 */

import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * LAZY connection. Created on first USE, never on import.
 *
 * This matters for the build: Next.js imports every route during compilation to
 * analyze it. If the client were created at module top-level, importing any
 * DB-touching route during a build where DATABASE_URL is not yet present would
 * THROW and fail the whole deployment (this happened — see the git history).
 * Creating it lazily means importing the module is always safe; it only reaches
 * for the env when a query actually runs.
 */
let client: NeonQueryFunction<false, false> | null = null;

function getClient(): NeonQueryFunction<false, false> {
  if (client) return client;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add the Neon connection string to .env.local " +
        "(see .env.example) and to the Vercel project env.",
    );
  }
  client = neon(url);
  return client;
}

/**
 * The tagged-template query function. A thin proxy so callers still write
 * `sql\`SELECT …\`` while the underlying client is created lazily on first call.
 * Values interpolated with ${} are parameters, never concatenated — injection-safe.
 */
function sqlProxy(...args: unknown[]) {
  const fn = getClient() as unknown as (...a: unknown[]) => unknown;
  return fn(...args);
}

export const sql = sqlProxy as unknown as NeonQueryFunction<false, false>;

/** True when a DB is configured. Lets pricing fall back to code rates if not. */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
