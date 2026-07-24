"use client";

/**
 * The site top bar — brand + auth control.
 *
 * Receives the session from the server (the layout reads the cookie in a Server
 * Component and passes it down). This component is only the interactive shell:
 * the login/register links, the account menu, and — for admins — the visible
 * "Admin Dashboard" button.
 *
 * SECURITY NOTE: the button is UX only. The /admin route is guarded on the
 * SERVER by role (requireAdmin). A regular user who removes the button in
 * devtools or types the URL is still blocked server-side.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type SessionUser = { name: string; email: string; role: "user" | "admin" } | null;

export function TopBar({ session }: { session: SessionUser }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setMenuOpen(false);
    // FULL navigation, not router.refresh(): the top bar lives in the ROOT
    // LAYOUT, which a soft refresh() does not reliably re-render — the page
    // updated but the bar stayed stale (the logout bug). A hard load re-reads
    // the session everywhere, exactly as the login flow does. Consistent.
    window.location.href = "/";
  }

  const initials = session
    ? session.name
        .split(/\s+/)
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase() || session.email[0]?.toUpperCase()
    : "";

  return (
    <header className="border-ink-700 bg-ink-900/80 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="text-brass-400 font-display text-lg tracking-tight">PSD Limo</span>
          <span className="text-paper-500 hidden text-xs tracking-[0.14em] uppercase sm:inline">
            San Francisco
          </span>
        </Link>

        <nav className="flex items-center gap-2">
          {!session ? (
            <>
              <Link
                href="/login"
                className="text-paper-300 hover:text-paper-100 rounded-sm px-4 py-2 text-sm transition-colors"
              >
                Log in
              </Link>
              <Link
                href="/register"
                className="bg-brass-400 text-ink-900 hover:bg-brass-500 rounded-sm px-4 py-2 text-sm font-medium transition-colors"
              >
                Create account
              </Link>
            </>
          ) : (
            <>
              {/* The role-gated button — only admins ever see this. */}
              {session.role === "admin" && (
                <Link
                  href="/admin"
                  className="border-brass-400/50 text-brass-400 hover:bg-brass-400/10 mr-1 rounded-sm border px-4 py-2 text-sm font-medium transition-colors"
                >
                  Admin Dashboard
                </Link>
              )}

              <div ref={menuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className="border-ink-600 hover:border-ink-500 flex items-center gap-2.5 rounded-sm border py-1.5 pr-3 pl-1.5 transition-colors"
                >
                  <span className="bg-ink-700 text-paper-300 flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium">
                    {initials}
                  </span>
                  <span className="text-paper-300 hidden max-w-[10rem] truncate text-sm sm:inline">
                    {session.name || session.email}
                  </span>
                  <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden className="text-paper-500">
                    <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </button>

                {menuOpen && (
                  <div
                    role="menu"
                    className="border-ink-600 bg-ink-800 animate-fade-rise absolute right-0 mt-2 w-56 rounded-sm border py-1 shadow-2xl shadow-black/60"
                  >
                    <div className="border-ink-700 border-b px-4 py-2.5">
                      <p className="text-paper-100 truncate text-sm">{session.name || "Account"}</p>
                      <p className="text-paper-500 truncate text-xs">{session.email}</p>
                      {session.role === "admin" && (
                        <p className="text-brass-400 mt-1 text-[11px] tracking-[0.1em] uppercase">
                          Administrator
                        </p>
                      )}
                    </div>
                    {session.role === "admin" && (
                      <Link
                        href="/admin"
                        role="menuitem"
                        onClick={() => setMenuOpen(false)}
                        className="text-paper-300 hover:bg-ink-700 hover:text-paper-100 block px-4 py-2 text-sm transition-colors"
                      >
                        Admin Dashboard
                      </Link>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={logout}
                      className="text-paper-300 hover:bg-ink-700 hover:text-paper-100 block w-full px-4 py-2 text-left text-sm transition-colors"
                    >
                      Log out
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
