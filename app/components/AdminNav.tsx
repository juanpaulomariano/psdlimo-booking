import Link from "next/link";

/**
 * The admin section's two-tab nav (Rates · Dispatch). A plain server component —
 * the `current` prop just styles the active link. Both destinations are behind
 * the same server-side role guard, so this is purely navigation, not security.
 */
export function AdminNav({ current }: { current: "rates" | "dispatch" }) {
  const tabs = [
    { key: "rates", label: "Rates & pricing", href: "/admin" },
    { key: "dispatch", label: "Dispatch", href: "/admin/dispatch" },
  ] as const;

  return (
    <nav className="border-ink-600 mt-8 mb-2 flex gap-6 border-b">
      {tabs.map((tab) => {
        const active = tab.key === current;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 pb-3 text-sm transition-colors ${
              active
                ? "border-brass-400 text-paper-100"
                : "text-paper-400 hover:text-paper-200 border-transparent"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
