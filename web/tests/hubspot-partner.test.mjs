/**
 * Tests for the endpoint that puts a partnership enquiry into the CRM.
 *
 * Same two families as hubspot-lead.test.mjs. The negative ones: unsigned,
 * forged, replayed or unconfigured writes NOTHING. The privacy one: the
 * message somebody typed into the contact form never reaches HubSpot, and
 * neither does anything but the short list the route reads by name. And one
 * that is specific to this route: a partner deal lands on the Partnerships
 * pipeline and never on the Sales Pipeline, because a journalist counted as
 * a job would overstate the one number a funding conversation turns on.
 *
 * No network. Run: npm test   (from web/)
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

let sig, route, config;
before(async () => {
  sig = await import(pathToFileURL(join(HERE, "../lib/webhookSignature.ts")).href);
  route = await import(pathToFileURL(join(HERE, "../app/api/hubspot/partner/route.ts")).href);
  config = await import(pathToFileURL(join(HERE, "../lib/hubspotConfig.ts")).href);
});

let writes = [];
let existingContact = null;
let existingDeal = null;

globalThis.fetch = async (url, init = {}) => {
  const path = String(url).replace("https://api.hubapi.com", "");
  const method = init.method ?? "GET";
  const body = init.body ? JSON.parse(init.body) : null;
  writes.push({ path, method, body });
  if (path.endsWith("/contacts/search")) return json({ results: existingContact ? [{ id: existingContact }] : [] });
  if (path.endsWith("/deals/search")) return json({ results: existingDeal ? [{ id: existingDeal }] : [] });
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
  return new Request("https://app.yaadly.co.uk/api/hubspot/partner", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(opts.omitSignature ? {} : { "x-yaadly-signature": signature }),
      ...(opts.omitTimestamp ? {} : { "x-yaadly-timestamp": String(ts) }),
    },
    body: raw,
  });
}

const PARTNER = {
  enquiryId: "0f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
  name: "Devon",
  email: "Devon@Example.com",
  source: "form",
};

const mutations = () => writes
  .filter((w) => w.method === "POST" || w.method === "PATCH" || w.method === "PUT")
  .filter((w) => !w.path.endsWith("/search"));

describe("the partner webhook", () => {
  beforeEach(() => { writes = []; existingContact = null; existingDeal = null; });

  test("a signed partnership enquiry creates a contact and a deal on the Partnerships pipeline", async () => {
    const res = await route.POST(await signedRequest(PARTNER));
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.created, true);
    const deal = mutations().find((w) => w.path === "/crm/v3/objects/deals");
    assert.ok(deal, "no deal was created");
    assert.equal(deal.body.properties.pipeline, config.PARTNER_PIPELINE_ID);
    assert.notEqual(deal.body.properties.pipeline, config.PIPELINE_ID, "a partner must never land on the Sales Pipeline");
    assert.equal(deal.body.properties.dealstage, config.PARTNER_STAGES.INBOUND);
    assert.equal(deal.body.properties.yaadly_job_id, `ENQ-${PARTNER.enquiryId}`);
    const contact = mutations().find((w) => w.path === "/crm/v3/objects/contacts");
    assert.equal(contact.body.properties.email, "devon@example.com");
  });

  test("an unsigned request writes nothing", async () => {
    const res = await route.POST(await signedRequest(PARTNER, { omitSignature: true }));
    assert.equal(res.status, 401);
    assert.deepEqual(mutations(), []);
  });

  test("a forged signature writes nothing", async () => {
    const res = await route.POST(await signedRequest(PARTNER, { secret: "wrong" }));
    assert.equal(res.status, 401);
    assert.deepEqual(mutations(), []);
  });

  test("a replayed request from last week writes nothing", async () => {
    const res = await route.POST(await signedRequest(PARTNER, { ts: Math.floor(Date.now() / 1000) - 7 * 86400 }));
    assert.equal(res.status, 401);
    assert.deepEqual(mutations(), []);
  });

  test("no secret configured means nothing is written, ever", async () => {
    const saved = process.env.HUBSPOT_LEAD_WEBHOOK_SECRET;
    delete process.env.HUBSPOT_LEAD_WEBHOOK_SECRET;
    try {
      const res = await route.POST(await signedRequest(PARTNER));
      assert.equal(res.status, 503);
      assert.deepEqual(mutations(), []);
    } finally {
      process.env.HUBSPOT_LEAD_WEBHOOK_SECRET = saved;
    }
  });

  test("an enquiry with no id is refused, because it is the idempotency key", async () => {
    const res = await route.POST(await signedRequest({ ...PARTNER, enquiryId: "" }));
    assert.equal(res.status, 400);
    assert.deepEqual(mutations(), []);
  });

  test("syncing the same enquiry twice updates, it does not make a second deal", async () => {
    existingDeal = "deal-existing";
    const res = await route.POST(await signedRequest(PARTNER));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).created, false);
    assert.equal(mutations().filter((w) => w.path === "/crm/v3/objects/deals").length, 0);
    const patch = mutations().find((w) => w.path === "/crm/v3/objects/deals/deal-existing");
    assert.ok(patch);
    assert.equal(patch.body.properties.dealstage, undefined, "an update never carries a stage");
  });

  test("only one custom property is ever written, so nothing else can 400", async () => {
    await route.POST(await signedRequest(PARTNER));
    const STANDARD = new Set(["email", "phone", "firstname", "dealname", "pipeline", "dealstage", "description"]);
    for (const w of mutations()) {
      for (const key of Object.keys(w.body?.properties ?? {})) {
        assert.ok(STANDARD.has(key) || key === "yaadly_job_id",
          `"${key}" is a custom property this sync does not require. Create it in HubSpot or do not send it.`);
      }
    }
  });

  test("the message, category and country never reach HubSpot, whatever the caller sends", async () => {
    const message = "My mother is alone at 14 Hope Road and the house is empty on Tuesdays";
    await route.POST(await signedRequest({
      ...PARTNER,
      message,
      topic: "Press, partnership or investment",
      partner_category: "Investor",
      partner_operational_country: "United Kingdom",
      dealstage: config.PARTNER_STAGES.ACTIVE,
    }));
    const sent = JSON.stringify(mutations());
    for (const leaked of ["Hope Road", "alone", "Investor", "United Kingdom", "partner_category"]) {
      assert.equal(sent.includes(leaked), false, `"${leaked}" reached HubSpot and must not have`);
    }
    const deal = mutations().find((w) => w.path === "/crm/v3/objects/deals");
    assert.equal(deal.body.properties.dealstage, config.PARTNER_STAGES.INBOUND, "a caller cannot choose the stage");
  });
});
