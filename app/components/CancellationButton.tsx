"use client";

/** The "Need to cancel?" trigger + its popup. A thin client wrapper so the
 *  success page can stay a Server Component. */

import { useState } from "react";
import { CancellationPopup } from "./CancellationPopup";

export function CancellationButton({ bookingRef }: { bookingRef?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-paper-500 hover:text-paper-300 text-sm underline underline-offset-4 transition-colors"
      >
        Need to cancel?
      </button>
      {open && <CancellationPopup bookingRef={bookingRef} onClose={() => setOpen(false)} />}
    </>
  );
}
