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

export async function POST(request: Request) {
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
