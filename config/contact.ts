/**
 * Business contact details for the customer-facing "Request Cancellation" popup
 * (and any future contact surfaces).
 *
 * PLACEHOLDERS for the demo. At go-live these move into the owner-editable admin
 * settings (a `business_settings` table) so PSD Limo can change them without a
 * redeploy — same pattern as the rates. Kept here for now so the popup has real
 * values to render.
 */

export const BUSINESS_CONTACT = {
  /** mailto: target. The customer's mail app opens addressed here. */
  supportEmail: "support@psdlimo.com", // PLACEHOLDER

  /** tel: target. Tap-to-call on mobile. */
  supportPhone: "09555429372", // PLACEHOLDER

  /**
   * WhatsApp — intentionally NOT wired yet (no business number provisioned).
   * The button renders as "coming soon" and does nothing. When a number exists,
   * set this to the international form (no +, no spaces) and flip `whatsappEnabled`.
   */
  whatsappNumber: "", // e.g. "639555429372"
  whatsappEnabled: false,
} as const;
