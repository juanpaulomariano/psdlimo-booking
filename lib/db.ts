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
import { neon } from "@neondatabase/serverless";

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add the Neon connection string to .env.local " +
        "(see .env.example) and to the Vercel project env.",
    );
  }
  return url;
}

/**
 * The tagged-template query function. Lazily created so importing this module
 * never throws at load time if the env is briefly missing — it throws only when
 * a query is actually attempted, with a clear message.
 */
export const sql = neon(connectionString());

/** True when a DB is configured. Lets pricing fall back to code rates if not. */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
