"use client";

/**
 * "Request Cancellation" — a contact popup, NOT an automated cancellation.
 *
 * Cancellation touches refunds, so it belongs in a human conversation. This just
 * gives the customer three ways to reach the business, then redirects:
 *   Email → mailto: (opens their mail app, addressed to support, ref in subject)
 *   Call  → tel: (tap-to-call on mobile)
 *   WhatsApp → not wired yet (renders disabled until a number exists)
 *
 * No backend, no database — pure redirects. See ARCHITECTURE.md §11.
 */

import { useEffect } from "react";
import { BUSINESS_CONTACT } from "@/config/contact";

export function CancellationPopup({
  bookingRef,
  onClose,
}: {
  bookingRef?: string;
  onClose: () => void;
}) {
  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const subject = encodeURIComponent(
    bookingRef ? `Cancellation request — booking ${bookingRef}` : "Cancellation request",
  );
  const body = encodeURIComponent(
    `Hello PSD Limo,\n\nI would like to request a cancellation` +
      (bookingRef ? ` for booking ${bookingRef}` : "") +
      `.\n\nThank you.`,
  );
  const mailto = `mailto:${BUSINESS_CONTACT.supportEmail}?subject=${subject}&body=${body}`;
  const tel = `tel:${BUSINESS_CONTACT.supportPhone}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Request cancellation"
    >
      <div
        className="border-ink-600 bg-ink-800 animate-fade-rise w-full max-w-sm rounded-sm border p-6 shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-display text-paper-100 text-xl">Request a cancellation</h2>
            <p className="text-paper-300 mt-1 text-sm">
              Choose how you&apos;d like to reach us and we&apos;ll take care of it personally.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-paper-500 hover:text-paper-100 -mt-1 -mr-1 shrink-0 p-1 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
              <path
                d="M4 4l10 10M14 4L4 14"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="mt-5 space-y-2.5">
          {/* Email — mailto */}
          <a
            href={mailto}
            onClick={onClose}
            className="border-ink-600 hover:border-brass-400 hover:bg-brass-400/5 flex items-center gap-3.5 rounded-sm border px-4 py-3 transition-colors"
          >
            <ContactIcon kind="email" />
            <span>
              <span className="text-paper-100 block text-sm">Email us</span>
              <span className="text-paper-500 block text-xs">{BUSINESS_CONTACT.supportEmail}</span>
            </span>
          </a>

          {/* Call — tel */}
          <a
            href={tel}
            onClick={onClose}
            className="border-ink-600 hover:border-brass-400 hover:bg-brass-400/5 flex items-center gap-3.5 rounded-sm border px-4 py-3 transition-colors"
          >
            <ContactIcon kind="phone" />
            <span>
              <span className="text-paper-100 block text-sm">Call us</span>
              <span className="text-paper-500 block text-xs">{BUSINESS_CONTACT.supportPhone}</span>
            </span>
          </a>

          {/* WhatsApp — disabled until a number is provisioned */}
          <div
            className="border-ink-700 flex cursor-not-allowed items-center gap-3.5 rounded-sm border px-4 py-3 opacity-40"
            aria-disabled
            title="WhatsApp support is coming soon"
          >
            <ContactIcon kind="whatsapp" />
            <span>
              <span className="text-paper-300 block text-sm">WhatsApp</span>
              <span className="text-paper-500 block text-xs">Coming soon</span>
            </span>
          </div>
        </div>

        <p className="text-paper-500 mt-5 text-xs leading-relaxed">
          Cancellations are handled personally so we can confirm timing and any refund
          under our cancellation policy.
        </p>
      </div>
    </div>
  );
}

function ContactIcon({ kind }: { kind: "email" | "phone" | "whatsapp" }) {
  return (
    <span className="bg-ink-700 text-brass-400 flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
      {kind === "email" && (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
          <rect x="2" y="4" width="16" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M3 5l7 5 7-5" stroke="currentColor" strokeWidth="1.4" fill="none" />
        </svg>
      )}
      {kind === "phone" && (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M5 3h3l1.5 4-2 1.5a10 10 0 004 4l1.5-2 4 1.5v3a1.5 1.5 0 01-1.6 1.5A14 14 0 013.5 5.6 1.5 1.5 0 015 4z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {kind === "whatsapp" && (
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M10 3a7 7 0 00-6 10.5L3 17l3.6-1A7 7 0 1010 3z"
            stroke="currentColor"
            strokeWidth="1.3"
          />
        </svg>
      )}
    </span>
  );
}
