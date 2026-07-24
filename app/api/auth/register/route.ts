/**
 * POST /api/auth/register — create a user account and log them in.
 *
 * Public registration ALWAYS creates a plain "user" — admin is never grantable
 * via this route (lib/users enforces it), so nobody can self-elevate.
 */

import { NextResponse } from "next/server";
import { registerSchema } from "@/lib/auth-schema";
import { registerUser } from "@/lib/users";
import { setSessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Those details are not valid." },
      { status: 400 },
    );
  }

  const result = await registerUser(parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: "An account with that email already exists." },
      { status: 409 },
    );
  }

  await setSessionCookie(result.user);
  return NextResponse.json({
    user: { name: result.user.name, email: result.user.email, role: result.user.role },
  });
}
