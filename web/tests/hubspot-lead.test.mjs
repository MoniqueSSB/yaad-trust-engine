/**
 * Tests for the endpoint that puts a WhatsApp lead into the CRM.
 *
 * Two sets of assertions matter here, and neither is "the happy path works".
 *
 * THE NEGATIVE ONES, same as the stage webhook: an unsigned, forged, replayed
 * or unconfigured request must write NOTHING. Most tests below assert on the
 * record of what would have been sent to HubSpot, not on the status code.
 *
 * THE PRIVACY ONE, which is specific to this route. It exists because
 * Monique asked for the CRM sync after it was flagged as a data protection
 * decision rather than a technical one. The list of fields that may leave is
 * the boundary, and a test that fails when somebody widens it is the only
 * thing that keeps that list honest six months from now. A signed caller is
 * not a reason to write whatever arrives.
 *
 * No network. HubSpot is stubbed, so this runs in CI with no credentials.
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
process.env.HUBSPOT_LEAD_WEBHOOK_SECRET = SECRET;
process.env.HUBSPOT_TOKEN = "pat-fake-for-test";

let sig, route;
before(async () => {
  sig = await import(pathToFileURL(join(HERE, "../lib/webhookSignature.ts")).href);
  route = await import(pathToFileURL(join(HERE, "../app/api/hubspot/lead/route.ts")).href);
});

// Stubbed HubSpot. `writes` is everything that would have left this machine.
let writes = [];
let existingContact = null;
let existingDeal = null;

globalThis.fetch = async (url, init = {}) => {
  const path = String(url).replace("https://api.hubapi.com", "");
  const method = init.method ?? "GET";
  const body = init.body ? JSON.parse(init.body) : null;
  writes.push({ path, method, body });

  if (path.endsWith("/contacts/search")) {
    return json({ results: existingContact ? [{ id: existingContact }] : [] });
  }
  if (path.endsWith("/deals/search")) {
    return json({ results: existingDeal ? [{ id: existingDeal }] : [] });
  }
  if (path === "/crm/v3/objects/contacts" && method === "POST") return json({ id: "contact-new" });
  if (path === "/crm/v3/objects/deals" && method === "POST") return json({ id: "deal-new" });
  return json({ ok: true });
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

async function signedRequest(payload, opts = {}) {
  const raw = JSON.stringify(payload);
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const signature = opts.signature ?? await sig.hmacSha256Hex(opts.secret ?? SECRET, `${ts}.${raw}`);
  return new Request("https://app.yaadly.co.uk/api/hubspot/lead", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(opts.omitSignature ? {} : { "x-yaadly-signature": signature }),
      ...(opts.omitTimestamp ? {} : { "x-yaadly-timestamp": String(ts) }),
    },
    body: raw,
  });
}

const LEAD = {
  jobId: "JOB-WA-1757000000000",
  phone: "+18765551234",
  name: "Marcia",
  parish: "St Thomas",
  trade: "Roofing",
  urgency: "urgent",
  source: "whatsapp",
};

const mutations = () => writes.filter((w) => w.method === "POST" || w.method === "PATCH" || w.method === "PUT")
  .filter((w) => !w.path.endsWith("/search"));

describe("the lead webhook", () => {
  beforeEach(() => { writes = []; existingContact = null; existingDeal = null; });

  test("a correctly signed lead creates a contact and a deal", async () => {
    const res = await route.POST(await signedRequest(LEAD));
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.created, true);
    assert.equal(out.dealId, "deal-new");
    const deal = mutations().find((w) => w.path === "/crm/v3/objects/deals");
    assert.ok(deal, "no deal was created");
    assert.equal(deal.body.properties.yaadly_job_id, LEAD.jobId);
  });

  test("an unsigned request writes nothing", async () => {
    const res = await route.POST(await signedRequest(LEAD, { omitSignature: true }));
    assert.equal(res.status, 401);
    assert.deepEqual(mutations(), []);
  });

  test("a forged signature writes nothing", async () => {
    const res = await route.POST(await signedRequest(LEAD, { secret: "not-the-secret" }));
    assert.equal(res.status, 401);
    assert.deepEqual(mutations(), []);
  });

  test("a replayed request from last week writes nothing", async () => {
    const old = Math.floor(Date.now() / 1000) - 7 * 86400;
    const res = await route.POST(await signedRequest(LEAD, { ts: old }));
    assert.equal(res.status, 401);
    assert.deepEqual(mutations(), []);
  });

  test("a missing timestamp writes nothing", async () => {
    const res = await route.POST(await signedRequest(LEAD, { omitTimestamp: true }));
    assert.equal(res.status, 401);
    assert.deepEqual(mutations(), []);
  });

  test("no secret configured means nothing is written, ever", async () => {
    const saved = process.env.HUBSPOT_LEAD_WEBHOOK_SECRET;
    delete process.env.HUBSPOT_LEAD_WEBHOOK_SECRET;
    try {
      const res = await route.POST(await signedRequest(LEAD));
      assert.equal(res.status, 503);
      assert.deepEqual(mutations(), []);
    } finally {
      process.env.HUBSPOT_LEAD_WEBHOOK_SECRET = saved;
    }
  });

  test("a lead with no job code is refused, because it is the idempotency key", async () => {
    const noJob = { ...LEAD };
    delete noJob.jobId;
    const res = await route.POST(await signedRequest(noJob));
    assert.equal(res.status, 400);
    assert.deepEqual(mutations(), []);
  });

  test("syncing the same job twice updates, it does not make a second deal", async () => {
    existingDeal = "deal-already-here";
    const res = await route.POST(await signedRequest(LEAD));
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.created, false);
    assert.equal(out.dealId, "deal-already-here");
    assert.equal(mutations().filter((w) => w.path === "/crm/v3/objects/deals" && w.method === "POST").length, 0,
      "a second deal was created for a job that already had one");
  });

  test("an update never carries a stage, so a redelivery cannot drag a deal backwards", async () => {
    existingDeal = "deal-already-here";
    await route.POST(await signedRequest(LEAD));
    const patch = mutations().find((w) => w.method === "PATCH" && w.path.includes("/deals/"));
    assert.ok(patch, "no update was sent");
    assert.equal(patch.body.properties.dealstage, undefined,
      "the lead sync is setting a deal stage, which is /api/hubspot/stage's job alone");
  });

  test("an existing contact is updated rather than duplicated", async () => {
    existingContact = "contact-already-here";
    await route.POST(await signedRequest(LEAD));
    assert.equal(mutations().filter((w) => w.path === "/crm/v3/objects/contacts" && w.method === "POST").length, 0,
      "a second contact was created for a number already on file");
  });

  test("a blank field is left out rather than sent as empty and clearing what is there", async () => {
    await route.POST(await signedRequest({ ...LEAD, name: "" }));
    const contact = mutations().find((w) => w.path === "/crm/v3/objects/contacts");
    assert.equal("firstname" in contact.body.properties, false, "an empty name would wipe one entered by hand");
  });

  test("only one custom property is ever written, so nothing else can 400", async () => {
    // Checked against the live portal on 4 Sep 2026: most of the properties
    // hubspotConfig.ts describes do not exist there, and HubSpot rejects a
    // whole write for one unrecognised property. If this list grows, the
    // property has to be created in HubSpot first or every lead fails.
    const STANDARD = new Set([
      "phone", "firstname", "dealname", "pipeline", "dealstage", "description",
    ]);
    await route.POST(await signedRequest(LEAD));
    for (const w of mutations()) {
      for (const key of Object.keys(w.body?.properties ?? {})) {
        assert.ok(
          STANDARD.has(key) || key === "yaadly_job_id",
          `"${key}" is a custom property this sync does not require. Create it in HubSpot or do not send it.`,
        );
      }
    }
  });

  /* ── the boundary ────────────────────────────────────────────────────── */

  test("nothing beyond the agreed fields ever reaches HubSpot", async () => {
    // The description is the one that matters. It is whatever somebody typed
    // on WhatsApp and routinely carries the address, who is alone in the
    // house, and a transcribed voice note in their own words. If this test
    // ever fails, the change is wrong: widening this list is a data
    // protection decision and it is Monique's, not a session's.
    const withExtras = {
      ...LEAD,
      descr: "The back bedroom at 12 Mango Walk, my mother is there alone on Tuesdays",
      addr: "12 Mango Walk, Kingston 8",
      client_email: "marcia@example.com",
      photos: ["https://example.com/roof.jpg"],
      transcript: "Mi roof a leak bad",
    };
    await route.POST(await signedRequest(withExtras));

    const sent = JSON.stringify(mutations().map((w) => w.body));
    for (const leaked of ["Mango Walk", "alone on Tuesdays", "marcia@example.com", "roof.jpg", "Mi roof a leak"]) {
      assert.equal(sent.includes(leaked), false, `"${leaked}" reached HubSpot and must not have`);
    }
  });

  test("the fields that are allowed to leave, do", async () => {
    await route.POST(await signedRequest(LEAD));
    const sent = JSON.stringify(mutations().map((w) => w.body));
    for (const expected of [LEAD.jobId, LEAD.phone, LEAD.name, LEAD.parish, LEAD.trade]) {
      assert.ok(sent.includes(expected), `${expected} did not reach HubSpot and should have`);
    }
  });

  test("a missing yaadly_job_id property is explained, not left as a bare 400", async () => {
    // The one setup step. HubSpot's own error names the property but not what
    // to do about it, and this is the failure somebody will hit first.
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes("/deals/search")) {
        return json({ message: "Property \"yaadly_job_id\" does not exist" }, 400);
      }
      return realFetch(url, init);
    };
    try {
      const res = await route.POST(await signedRequest(LEAD));
      assert.equal(res.status, 502);
      assert.deepEqual(mutations().filter((w) => w.method !== "GET"), [],
        "nothing may be written when the idempotency key cannot be checked");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
