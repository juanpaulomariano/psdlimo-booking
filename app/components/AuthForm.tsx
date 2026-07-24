"use client";

/**
 * Shared login/register form. mode="login" | "register".
 * Posts to the auth API, then hard-navigates so the server re-reads the session
 * and the top bar reflects the new state (and the admin button appears).
 */

import Link from "next/link";
import { useState } from "react";
import { PrimaryButton, TextField } from "./ui";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const isRegister = mode === "register";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isRegister ? { name, email, password } : { email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      // Full navigation so the layout re-reads the session cookie.
      window.location.href = data.user?.role === "admin" ? "/admin" : "/";
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <div className="animate-fade-rise">
        <h1 className="font-display text-paper-100 text-3xl">
          {isRegister ? "Create your account" : "Welcome back"}
        </h1>
        <p className="text-paper-300 mt-2 text-sm">
          {isRegister
            ? "Save your details and manage your bookings."
            : "Log in to your PSD Limo account."}
        </p>

        <form onSubmit={submit} className="mt-8 space-y-5">
          {isRegister && (
            <TextField
              label="Full name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Jane Whitfield"
            />
          )}
          <TextField
            label="Email"
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="jane@example.com"
          />
          <TextField
            label="Password"
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isRegister ? "new-password" : "current-password"}
            placeholder={isRegister ? "At least 8 characters" : "Your password"}
            hint={isRegister ? "At least 8 characters." : undefined}
          />

          {error && (
            <div className="border-danger/40 bg-danger/5 rounded-sm border px-4 py-2.5">
              <p className="text-danger text-sm">{error}</p>
            </div>
          )}

          <PrimaryButton type="submit" loading={submitting} className="w-full">
            {isRegister ? "Create account" : "Log in"}
          </PrimaryButton>
        </form>

        <p className="text-paper-500 mt-6 text-center text-sm">
          {isRegister ? "Already have an account? " : "New to PSD Limo? "}
          <Link
            href={isRegister ? "/login" : "/register"}
            className="text-brass-400 hover:text-brass-500 transition-colors"
          >
            {isRegister ? "Log in" : "Create one"}
          </Link>
        </p>
      </div>
    </main>
  );
}
