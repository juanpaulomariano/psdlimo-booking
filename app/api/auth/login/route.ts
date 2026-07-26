/**
 * POST /api/auth/login — verify credentials and start a session.
 *
 * The error message is intentionally identical for "no such user" and "wrong
 * password" — combined with the constant-time compare in authenticate(), this
 * prevents an attacker from learning which emails are registered.
 */

import { NextResponse } from "next/server";
import { loginSchema } from "@/lib/auth-schema";
import { authenticate } from "@/lib/users";
import { setSessionCookie } from "@/lib/auth";
import { RATE_LIMITS, checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  // Password endpoint — cap attempts per IP to slow credential stuffing. The
  // limit is far above an honest user who mistyped a couple of times.
  const limited = checkRateLimit(request, "auth", RATE_LIMITS.auth.limit, RATE_LIMITS.auth.windowMs);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please enter your email and password." }, { status: 400 });
  }

  const user = await authenticate(parsed.data.email, parsed.data.password);
  if (!user) {
    // Same message whether the email is unknown or the password is wrong.
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
  }

  await setSessionCookie(user);
  return NextResponse.json({
    user: { name: user.name, email: user.email, role: user.role },
  });
}
