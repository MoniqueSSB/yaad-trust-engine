/**
 * Tests for the one endpoint that can move a deal to Funds Held.
 *
 * The assertions worth keeping are the negative ones. Any implementation can
 * make a correctly signed request work; what matters is that an unsigned,
 * forged, replayed or unconfigured request writes NOTHING. So most tests below
 * check the stub recorded no PATCH, not just that the status code was 401.
 *
 * No network. HubSpot is stubbed, so this runs anywhere, including in CI with
 * no credentials.
 *
 * Run: npm test   (from web/)
 */
import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(HERE, "ts-resolve-hooks.mjs")));

const SECRET = "test-secret-not-a-real-one";
process.env.HUBSPOT_STAGE_WEBHOOK_SECRET = SECRET;
process.env.HUBSPOT_TOKEN = "pat-fake-for-test";

let sig, route;
before(async () => {
  sig = await import(pathToFileURL(join(HERE, "../lib/webhookSignature.ts")).href);
  route = await import(pathToFileURL(join(HERE, "../app/api/hubspot/stage/route.ts")).href);
});

// Stubbed HubSpot. `patches` is the record of everything that would have been
// written, which is what the negative tests assert on.
let currentStage = "qualifiedtobuy";
let patches = [];
let hubspotStatus = 200;

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.includes("api.hubapi.com")) throw new Error(`unexpected outbound call to ${u}`);
  if (hubspotStatus !== 200) {
    return new Response(JSON.stringify({ message: "stubbed failure" }), { status: hubspotStatus });
  }
  if ((init.method ?? "GET") === "GET") {
    return new Response(JSON.stringify({ id: "123", properties: { dealstage: currentStage, pipeline: "default" } }), { status: 200 });
  }
  patches.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ id: "123" }), { status: 200 });
};

beforeEach(() => {
  patches = [];
  hubspotStatus = 200;
  currentStage = "qualifiedtobuy";
  process.env.HUBSPOT_STAGE_WEBHOOK_SECRET = SECRET;
});

async function send(payload, { sign = true, secret = SECRET, skewSeconds = 0 } = {}) {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000) + skewSeconds);
  const headers = { "content-type": "application/json" };
  if (sign) {
    headers["x-yaadly-signature"] = await sig.hmacSha256Hex(secret, `${ts}.${body}`);
    headers["x-yaadly-timestamp"] = ts;
  }
  const res = await route.POST(
    new Request("https://app.yaadly.co.uk/api/hubspot/stage", { method: "POST", headers, body }),
  );
  return { status: res.status, body: await res.json() };
}

describe("webhook signature", () => {
  test("accepts a correctly signed request", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const s = await sig.hmacSha256Hex(SECRET, `${ts}.body`);
    assert.deepEqual(await sig.verifyWebhookSignature({ secret: SECRET, rawBody: "body", signatureHeader: s, timestampHeader: ts }), { ok: true });
  });

  test("accepts the sha256= prefix form", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const s = await sig.hmacSha256Hex(SECRET, `${ts}.body`);
    assert.deepEqual(await sig.verifyWebhookSignature({ secret: SECRET, rawBody: "body", signatureHeader: `sha256=${s}`, timestampHeader: ts }), { ok: true });
  });

  test("a moved timestamp header invalidates the signature", async () => {
    // Proves the timestamp is inside the signed material. If it were not, an
    // attacker could hold a captured request and simply refresh the header.
    const ts = Math.floor(Date.now() / 1000);
    const s = await sig.hmacSha256Hex(SECRET, `${ts}.body`);
    const r = await sig.verifyWebhookSignature({ secret: SECRET, rawBody: "body", signatureHeader: s, timestampHeader: String(ts + 60) });
    assert.deepEqual(r, { ok: false, reason: "mismatch" });
  });

  test("a far future timestamp is stale, not valid forever", async () => {
    const future = Math.floor(Date.now() / 1000) + 10_000;
    const s = await sig.hmacSha256Hex(SECRET, `${future}.body`);
    const r = await sig.verifyWebhookSignature({ secret: SECRET, rawBody: "body", signatureHeader: s, timestampHeader: String(future) });
    assert.deepEqual(r, { ok: false, reason: "stale" });
  });

  test("timingSafeEqualHex compares correctly", () => {
    assert.equal(sig.timingSafeEqualHex("abcd", "abcd"), true);
    assert.equal(sig.timingSafeEqualHex("abcd", "abce"), false);
    assert.equal(sig.timingSafeEqualHex("abcd", "abc"), false);
  });
});

describe("POST /api/hubspot/stage", () => {
  test("an unsigned request writes nothing", async () => {
    const r = await send({ dealId: "123", event: "payment_held" }, { sign: false });
    assert.equal(r.status, 401);
    assert.equal(patches.length, 0);
  });

  test("a forged signature writes nothing and leaks no reason", async () => {
    const r = await send({ dealId: "123", event: "payment_held" }, { secret: "attacker" });
    assert.equal(r.status, 401);
    assert.equal(patches.length, 0);
    assert.equal(r.body.error, "Invalid signature");
  });

  test("a replay outside the window writes nothing", async () => {
    const r = await send({ dealId: "123", event: "payment_held" }, { skewSeconds: -400 });
    assert.equal(r.status, 401);
    assert.equal(patches.length, 0);
  });

  test("a signed request advances the deal to Funds Held", async () => {
    const r = await send({ dealId: "123", event: "payment_held" });
    assert.equal(r.status, 200);
    assert.equal(r.body.changed, true);
    assert.equal(patches[0].properties.dealstage, "presentationscheduled");
  });

  test("redelivery after the deal moved on does not drag it backwards", async () => {
    currentStage = "contractsent";
    const r = await send({ dealId: "123", event: "payment_held" });
    assert.equal(r.status, 200, "a redelivery must get a 2xx so the sender stops");
    assert.equal(r.body.changed, false);
    assert.equal(patches.length, 0);
  });

  test("a cancelled deal is a 409, not a retry", async () => {
    currentStage = "closedlost";
    const r = await send({ dealId: "123", event: "payment_held" });
    assert.equal(r.status, 409);
    assert.equal(patches.length, 0);
  });

  test("the sender cannot name a stage directly", async () => {
    const r = await send({ dealId: "123", event: "closedwon" });
    assert.equal(r.status, 400);
    assert.equal(patches.length, 0);
  });

  test("missing dealId is a 400", async () => {
    assert.equal((await send({ event: "payment_held" })).status, 400);
  });

  test("malformed JSON is a 400, checked after the signature", async () => {
    assert.equal((await send("not json")).status, 400);
  });

  test("a HubSpot 5xx becomes a retryable 503", async () => {
    hubspotStatus = 500;
    assert.equal((await send({ dealId: "123", event: "payment_held" })).status, 503);
  });

  test("a HubSpot 403 becomes a non-retryable 502", async () => {
    hubspotStatus = 403;
    assert.equal((await send({ dealId: "123", event: "payment_held" })).status, 502);
  });

  test("no configured secret means nothing moves", async () => {
    delete process.env.HUBSPOT_STAGE_WEBHOOK_SECRET;
    const r = await send({ dealId: "123", event: "payment_held" });
    assert.equal(r.status, 503);
    assert.equal(patches.length, 0);
  });

  test("exports POST only, so Next answers every other method with 405", () => {
    assert.equal(typeof route.POST, "function");
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      assert.equal(route[method], undefined, `${method} must not be exported`);
    }
  });
});
