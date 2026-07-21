/**
 * Payment-boundary assertions — currency conversion and callback verification.
 *
 * These run WITHOUT touching the network. Anything requiring a live Xendit call
 * is verified manually against the API and recorded in the commit message; here
 * we pin the pure logic that would otherwise be easy to break silently.
 *
 * Run with `npm run test:payments`.
 */

import assert from "node:assert/strict";
import { USD_TO_PHP_FALLBACK } from "@/config/rates";
import { parseCallback, toChargeAmount, verifyCallback } from "@/lib/payments";

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.error(`  ✗ ${name}`);
    console.error(`      ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log("\nCurrency conversion (this Xendit account is PHP-only)\n");

check("USD passes through untouched when the account supports it", () => {
  process.env.XENDIT_CURRENCY = "USD";
  const r = toChargeAmount(234);
  assert.equal(r.currency, "USD");
  assert.equal(r.amount, 234);
});

check("USD converts to whole pesos at the configured rate", () => {
  process.env.XENDIT_CURRENCY = "PHP";
  process.env.XENDIT_USD_TO_PHP = "58.5";
  const r = toChargeAmount(234);
  assert.equal(r.currency, "PHP");
  assert.equal(r.amount, 13689); // 234 × 58.5 exactly — matches the live invoice
});

check("converted amounts are always integers (Xendit rejects PHP sub-units)", () => {
  process.env.XENDIT_CURRENCY = "PHP";
  process.env.XENDIT_USD_TO_PHP = "58.53";
  for (const usd of [95, 113, 163, 203, 234, 463, 1000]) {
    const r = toChargeAmount(usd);
    assert.ok(Number.isInteger(r.amount), `${usd} USD produced ${r.amount} PHP, not an integer`);
  }
});

check("an unsupported currency throws rather than charging a wrong amount", () => {
  process.env.XENDIT_CURRENCY = "EUR";
  assert.throws(() => toChargeAmount(234), /does not know how to convert/);
});

check("a missing or unparseable rate falls back to the config constant", () => {
  process.env.XENDIT_CURRENCY = "PHP";
  delete process.env.XENDIT_USD_TO_PHP;
  assert.equal(toChargeAmount(100).amount, Math.round(100 * USD_TO_PHP_FALLBACK));

  process.env.XENDIT_USD_TO_PHP = "not-a-number";
  assert.equal(toChargeAmount(100).amount, Math.round(100 * USD_TO_PHP_FALLBACK));
});

console.log("\nCallback verification\n");

const TOKEN = "test-callback-token-abc123";

function headersWith(token?: string): Headers {
  const h = new Headers();
  if (token !== undefined) h.set("x-callback-token", token);
  return h;
}

check("the correct token is accepted", () => {
  process.env.XENDIT_CALLBACK_TOKEN = TOKEN;
  assert.equal(verifyCallback(headersWith(TOKEN)), true);
});

check("a wrong token of the same length is rejected", () => {
  process.env.XENDIT_CALLBACK_TOKEN = TOKEN;
  const wrong = "test-callback-token-abc124"; // differs in the final byte only
  assert.equal(wrong.length, TOKEN.length, "test setup: lengths must match");
  assert.equal(verifyCallback(headersWith(wrong)), false);
});

check("a token of a different length is rejected without throwing", () => {
  process.env.XENDIT_CALLBACK_TOKEN = TOKEN;
  assert.equal(verifyCallback(headersWith("short")), false);
});

check("a missing header is rejected", () => {
  process.env.XENDIT_CALLBACK_TOKEN = TOKEN;
  assert.equal(verifyCallback(headersWith()), false);
});

check("an empty header is rejected", () => {
  process.env.XENDIT_CALLBACK_TOKEN = TOKEN;
  assert.equal(verifyCallback(headersWith("")), false);
});

check("FAILS CLOSED when the server has no token configured", () => {
  // The dangerous failure mode: a missing secret must never mean
  // "accept everything". Even a syntactically valid token must be rejected.
  delete process.env.XENDIT_CALLBACK_TOKEN;
  assert.equal(verifyCallback(headersWith(TOKEN)), false);
  assert.equal(verifyCallback(headersWith("anything")), false);
});

console.log("\nCallback parsing\n");

const paidBody = {
  id: "inv_123",
  external_id: "psdlimo-1784621663221-GedmI4MZ",
  status: "PAID",
  amount: 13689,
  paid_amount: 13689,
  currency: "PHP",
  payment_method: "CREDIT_CARD",
  metadata: { quoted_total: 234, currency: "USD" },
};

check("a PAID invoice is parsed into a booking", () => {
  const r = parseCallback(paidBody);
  assert.ok(r, "expected a parsed callback");
  assert.equal(r.externalId, "psdlimo-1784621663221-GedmI4MZ");
  assert.equal(r.status, "PAID");
  assert.equal(r.paymentMethod, "CREDIT_CARD");
  assert.equal(r.metadata.quoted_total, 234);
});

check("SETTLED is treated as paid", () => {
  const r = parseCallback({ ...paidBody, status: "SETTLED" });
  assert.ok(r);
  assert.equal(r.status, "SETTLED");
});

check("lowercase status is handled", () => {
  assert.ok(parseCallback({ ...paidBody, status: "paid" }));
});

check("EXPIRED yields null — an abandoned invoice is not an error", () => {
  assert.equal(parseCallback({ ...paidBody, status: "EXPIRED" }), null);
});

check("PENDING yields null", () => {
  assert.equal(parseCallback({ ...paidBody, status: "PENDING" }), null);
});

check("a PAID callback with no external_id yields null rather than a keyless booking", () => {
  const { external_id: _omitted, ...withoutId } = paidBody;
  void _omitted;
  assert.equal(parseCallback(withoutId), null);
});

check("junk bodies yield null rather than throwing", () => {
  for (const junk of [null, undefined, "string", 42, [], {}]) {
    assert.equal(parseCallback(junk), null, `${JSON.stringify(junk)} should parse to null`);
  }
});

// ── Summary ────────────────────────────────────────────────────────────────
// Must remain the LAST statement in this file.
console.log("");
if (failures.length > 0) {
  console.error(`FAILED — ${failures.length} of ${passed + failures.length} checks failed:`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`All ${passed} checks passed.\n`);
