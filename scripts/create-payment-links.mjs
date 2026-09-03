#!/usr/bin/env node
/*
 * Creates the Yaadly fixed-price Stripe Payment Links, with a hold rather
 * than an immediate charge.
 *
 * WHY THIS EXISTS AS A SCRIPT AND NOT A CLICK. The Stripe Dashboard link
 * builder charges the card the moment the client pays. It has no hold
 * option. A hold needs payment_intent_data[capture_method]=manual, and that
 * is only reachable through the API. Every one-off service on the menu is
 * under £500, and under the 3 September 2026 rule everything at or under
 * £500 is a hold, so the Dashboard is the wrong tool for the whole menu.
 * The hold is what makes "your card is not charged until you approve the
 * work" true, and that sentence is on three pages of the site.
 *
 * WHY YOU RUN IT AND NOT A CHAT SESSION. It needs the Stripe secret key.
 * A secret key must never be pasted into a chat session. Export it in your
 * own terminal, run this, and paste back only the resulting
 * https://buy.stripe.com/... URLs, which are public and safe to share.
 *
 *   export STRIPE_SECRET_KEY=sk_live_...        # your terminal, not a chat
 *   node scripts/create-payment-links.mjs        # dry run, creates nothing
 *   node scripts/create-payment-links.mjs --live # actually creates them
 *
 * Prices come from scripts/payment-links.json. Read that file first. It
 * carries a note about where docs/services.html and service_catalogue
 * disagree, which is not settled and is a pricing decision, not a
 * technical one.
 *
 * Re-running is safe. Each object is created with an idempotency key
 * derived from the service id and its price, so running twice returns the
 * same link rather than making a second one. Change a price and you get a
 * new link, which is correct: a Payment Link's amount cannot be edited
 * after the fact, it has to be replaced and the old one deactivated.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE = process.argv.includes("--live");
const KEY = process.env.STRIPE_SECRET_KEY;

if (!KEY) {
  console.error("STRIPE_SECRET_KEY is not set. Export it in your terminal, never in a chat.");
  process.exit(1);
}
if (!/^sk_(live|test)_/.test(KEY)) {
  console.error("STRIPE_SECRET_KEY does not look like a secret key (expected sk_live_ or sk_test_).");
  process.exit(1);
}
if (KEY.startsWith("sk_live_") && !LIVE) {
  console.log("Live key detected. This is a DRY RUN, nothing will be created. Add --live when you mean it.\n");
}

const cfg = JSON.parse(readFileSync(join(HERE, "payment-links.json"), "utf8"));
const CURRENCY = cfg.currency || "gbp";
const THRESHOLD_PENCE = 50000; // £500. Above this a job is invoiced, not linked.

/* Stripe wants form-encoded bodies with bracketed nested keys. */
function form(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object" && !Array.isArray(v)) form(v, key, out);
    else if (Array.isArray(v)) v.forEach((item, i) => form(item, `${key}[${i}]`, out));
    else out.append(key, String(v));
  }
  return out;
}

async function stripe(path, body, idempotencyKey) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: form(body).toString(),
  });
  const json = await res.json();
  if (!res.ok) {
    // Never echo the request body: it is fine here, but the habit matters.
    throw new Error(`${path} ${res.status}: ${json.error?.message || JSON.stringify(json)}`);
  }
  return json;
}

/* Refuse anything that should be an invoice, before touching Stripe. */
const tooBig = cfg.links.filter((l) => l.mode !== "subscription" && l.amount_pence >= THRESHOLD_PENCE);
if (tooBig.length) {
  console.error("These are at or above £500 and must be invoiced, not linked. Remove them from payment-links.json:");
  tooBig.forEach((l) => console.error(`  ${l.name}  £${(l.amount_pence / 100).toFixed(2)}`));
  process.exit(1);
}

const results = [];
for (const l of cfg.links) {
  const tag = `${l.id}-${l.amount_pence}-${l.mode}`;
  const pounds = `£${(l.amount_pence / 100).toFixed(2)}`;
  const shape = l.mode === "subscription" ? "monthly subscription" : "hold, captured on approval";

  if (!LIVE) {
    console.log(`would create  ${l.name.padEnd(36)} ${pounds.padEnd(9)} ${shape}`);
    continue;
  }

  const product = await stripe("products", {
    name: l.name,
    description: l.description,
    metadata: { yaadly_service_id: l.id },
  }, `prod-${tag}`);

  const price = await stripe("prices", {
    product: product.id,
    unit_amount: l.amount_pence,
    currency: CURRENCY,
    ...(l.mode === "subscription" ? { recurring: { interval: "month" } } : {}),
    metadata: { yaadly_service_id: l.id },
  }, `price-${tag}`);

  const link = await stripe("payment_links", {
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: { yaadly_service_id: l.id },
    // A hold, not a charge. Only valid on one-off payments: a subscription
    // has no single payment intent to hold, so it bills on the day.
    ...(l.mode === "hold" ? { payment_intent_data: { capture_method: "manual" } } : {}),
  }, `link-${tag}`);

  results.push({ id: l.id, name: l.name, price: pounds, mode: l.mode, url: link.url });
  console.log(`created  ${l.name.padEnd(36)} ${pounds.padEnd(9)} ${shape}\n         ${link.url}`);
}

if (!LIVE) {
  console.log(`\nDry run. ${cfg.links.length} links would be created, nothing was. Add --live to create them.`);
  process.exit(0);
}

const out = join(HERE, "payment-links.out.json");
writeFileSync(out, JSON.stringify(results, null, 2) + "\n");
console.log(`\n${results.length} links created. URLs written to ${out}.`);
console.log("These URLs are public and safe to share. Your secret key is not in that file.");
console.log("\nA hold is not money in the bank. Each one must be captured within 7 days");
console.log("or it expires, and capturing is a named person's decision, not a timer.");
