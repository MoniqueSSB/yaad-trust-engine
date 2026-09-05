/**
 * Tests for lib/jobs/new-form.ts, the rules behind the six-stage "Post a job"
 * form.
 *
 * Why this file exists, and it is not really about the form.
 *
 * Two of the answers this form collects are read by things outside it. The
 * urgency wording is chipped red at the admin desk by a regex in
 * concierge.html. The access wording is read by enforce_vetted_worker_on_quote
 * in Postgres (migration 20260831d), which refuses a worker still in Probation
 * a job where they would hold keys or work inside an occupied home.
 *
 * That makes those sentences load bearing in a way nothing about them looks.
 * Somebody tidying "A key is held locally, by family or a neighbour" into
 * "A neighbour can open up" removes the only word the gate matches on, and a
 * worker whose police check has not come back can then quote a job where
 * somebody hands them the key to an empty house. Nothing would go red. The
 * copy would read better.
 *
 * So the two patterns from the migration are restated in the module and
 * asserted here, per option, both ways. A wording change that moves an option
 * across the gate fails this file, and the failure names the option.
 *
 * The rest is the ordinary work: the validation carried over from the old
 * three-screen version, unchanged, and the saved-draft parser, which must
 * never throw and must never keep a personal detail.
 *
 * Run: npm test   (from web/)
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(join(HERE, "ts-resolve-hooks.mjs")));

let m;
before(async () => {
  m = await import(pathToFileURL(join(HERE, "../lib/jobs/new-form.ts")).href);
});

/** A filled-in form, so each test can break one thing rather than build one. */
const full = () => ({
  trade: "Roofing",
  parish: "Kingston",
  desc: "Zinc lifted off the back roof and water is coming in",
  urgency: "Urgent, within 48 hours",
  accessType: "No inside access needed, outside work only",
  materialsBy: "Yaadly buys the materials",
  materialsStore: "A lockable room, store or container on site",
  materialsStoreWhere: "The back room off the veranda, key with my aunt",
  name: "Test Client",
  contact: "test@example.com",
});

describe("the access wording carries the probation gate", () => {
  // The desk chips urgency red on this. concierge.html, the jobs view.
  const DESK_URGENT = /urgent|emergency/i;

  test("every access option is a distinct non-empty sentence", () => {
    const vals = m.ACCESS.map((a) => a.value);
    assert.equal(new Set(vals).size, vals.length);
    for (const v of vals) assert.ok(v.trim().length > 10, v);
  });

  /* One row per option, with the answer the gate must give. Written out
     rather than derived, so the expectation is a decision somebody made and
     not a restatement of the code under test. */
  const EXPECTED = [
    ["Somebody lives there and is at home day to day", true, "inside an occupied home"],
    ["A key is held locally, by family or a neighbour", true, "the worker would hold a key"],
    ["No inside access needed, outside work only", false, "outside work, no keys, nobody home to be around"],
    ["Still to be arranged, I will sort it out with Yaadly", false, "unanswered, same as the null this form used to write"],
  ];

  test("the four options are exactly the four the gate was reasoned about", () => {
    assert.deepEqual(m.ACCESS.map((a) => a.value), EXPECTED.map(([v]) => v));
  });

  for (const [value, blocked, why] of EXPECTED) {
    test(`"${value}" ${blocked ? "blocks" : "does not block"} a probation worker (${why})`, () => {
      assert.equal(m.blocksProbation(value), blocked);
    });
  }

  test("the patterns are the ones in migration 20260831d, character for character", () => {
    assert.equal(m.PROBATION_KEYS.source, "(key|keys)");
    assert.equal(m.PROBATION_OCCUPIED.source, "(on site|occupied|lives there|at home)");
  });

  test("no access option publishes that a house is empty", () => {
    // open_jobs is granted to anon and selects access_type, so these
    // sentences are readable by anybody who opens the marketplace.
    for (const a of m.ACCESS) {
      assert.doesNotMatch(a.value, /empty|nobody (is )?(there|home)|unoccupied/i, a.value);
    }
  });

  test("exactly one urgency option reads as urgent at the desk", () => {
    const hits = m.URGENCY.filter((u) => DESK_URGENT.test(u.value));
    assert.equal(hits.length, 1);
    assert.equal(hits[0].value, "Urgent, within 48 hours");
  });

  test("no urgency option promises a date on Yaadly's behalf", () => {
    for (const u of m.URGENCY) {
      assert.doesNotMatch(u.value, /guarantee|guaranteed|same day|tomorrow/i, u.value);
    }
  });
});

describe("the validation carried over from the three-screen version", () => {
  test("an email needs a dot in the domain, as before", () => {
    assert.ok(m.looksLikeEmail("a@b.co"));
    assert.ok(m.looksLikeEmail("  monique@yaadly.co.uk "));
    assert.ok(!m.looksLikeEmail("a@b"));
    assert.ok(!m.looksLikeEmail("no at sign"));
    assert.ok(!m.looksLikeEmail(""));
  });

  test("a phone is seven digits or more, however they are written", () => {
    assert.ok(m.looksLikePhone("876 555 0142"));
    assert.ok(m.looksLikePhone("+44 7700 900000"));
    assert.ok(m.looksLikePhone("(876) 555-0142"));
    assert.ok(!m.looksLikePhone("555012"));
    assert.ok(!m.looksLikePhone(""));
  });

  test("the description floor is still more than ten characters once trimmed", () => {
    assert.equal(m.MIN_DESC, 11);
    const f = { ...full(), desc: "  ten chars  " };
    assert.equal(f.desc.trim().length, 9);
    assert.equal(m.stageComplete("work", f), false);
    assert.equal(m.stageComplete("work", { ...full(), desc: "Roof leaking" }), true);
  });
});

describe("a stage is complete or it is not", () => {
  test("six stages, in the founder's order", () => {
    assert.deepEqual(m.STAGES.map((s) => s.key),
      ["work", "property", "urgency", "evidence", "reach", "review"]);
  });

  test("the work stage wants a trade and enough words", () => {
    assert.equal(m.stageComplete("work", full()), true);
    assert.equal(m.stageComplete("work", { ...full(), trade: "" }), false);
    assert.equal(m.stageComplete("work", { ...full(), desc: "" }), false);
  });

  test("the property stage wants a parish AND who lets a worker in", () => {
    assert.equal(m.stageComplete("property", full()), true);
    assert.equal(m.stageComplete("property", { ...full(), parish: "" }), false);
    assert.equal(m.stageComplete("property", { ...full(), accessType: "" }), false);
  });

  test("urgency is required, because an optional question is a skipped one", () => {
    assert.equal(m.stageComplete("urgency", full()), true);
    assert.equal(m.stageComplete("urgency", { ...full(), urgency: "" }), false);
  });

  test("the photos stage takes no input, so it never blocks anybody", () => {
    assert.equal(m.stageComplete("evidence", m.EMPTY_FIELDS), true);
  });

  test("the contact stage takes either an email or a number, not both", () => {
    assert.equal(m.stageComplete("reach", { ...full(), contact: "876 555 0142" }), true);
    assert.equal(m.stageComplete("reach", { ...full(), contact: "not a contact" }), false);
    assert.equal(m.stageComplete("reach", { ...full(), name: "M" }), false);
  });

  test("review is complete only when all five before it are", () => {
    assert.equal(m.stageComplete("review", full()), true);
    assert.equal(m.stageComplete("review", { ...full(), urgency: "" }), false);
    assert.equal(m.stageComplete("review", m.EMPTY_FIELDS), false);
  });

  test("firstIncomplete points at the earliest gap, and at nothing when there is none", () => {
    assert.equal(m.firstIncomplete(full()), null);
    assert.equal(m.firstIncomplete(m.EMPTY_FIELDS), "work");
    assert.equal(m.firstIncomplete({ ...full(), parish: "" }), "property");
    assert.equal(m.firstIncomplete({ ...full(), urgency: "" }), "urgency");
    assert.equal(m.firstIncomplete({ ...full(), contact: "" }), "reach");
  });
});

describe("the saved draft keeps the work and none of the person", () => {
  const NOW = 1_760_000_000_000;

  /* The key list is an allowlist, not a description. It fails whenever the
     draft shape changes, which is the point: a new field on Fields that
     happens to be personal would land in localStorage silently otherwise.
     materialsBy was added on 5 September 2026 and is the client's answer to
     who buys the materials, which is about the job and not about the person.
     The two doesNotMatch lines above are the guard that never moves. */
  test("a name, a contact detail and a portal code are never written", () => {
    const raw = m.serialiseDraft("JOB-WEB-1", full(), NOW);
    assert.doesNotMatch(raw, /Test Client/);
    assert.doesNotMatch(raw, /test@example\.com/);
    assert.deepEqual(Object.keys(JSON.parse(raw).fields).sort(),
      ["accessType", "desc", "materialsBy", "materialsStore", "parish", "trade", "urgency"]);
  });

  test("what is written comes back", () => {
    const d = m.parseDraft(m.serialiseDraft("JOB-WEB-1", full(), NOW), NOW + 1000);
    assert.equal(d.jobId, "JOB-WEB-1");
    assert.equal(d.fields.desc, full().desc);
    assert.equal(d.fields.accessType, full().accessType);
  });

  test("a draft with no job id is still worth keeping, because the words are", () => {
    // A first save that failed the throttle leaves exactly this shape.
    const d = m.parseDraft(m.serialiseDraft("", full(), NOW), NOW);
    assert.equal(d.jobId, "");
    assert.equal(d.fields.trade, "Roofing");
  });

  test("nothing readable comes back as null rather than throwing", () => {
    for (const raw of [null, "", "not json", "{}", "[]", '{"v":2,"at":1}', '"a string"', "null"]) {
      assert.equal(m.parseDraft(raw, NOW), null, JSON.stringify(raw));
    }
  });

  test("a draft older than a week is gone, one inside the week is not", () => {
    const raw = m.serialiseDraft("JOB-WEB-1", full(), NOW);
    assert.equal(m.parseDraft(raw, NOW + m.DRAFT_TTL_MS - 1) !== null, true);
    assert.equal(m.parseDraft(raw, NOW + m.DRAFT_TTL_MS + 1), null);
  });

  test("an empty form is not saved, so a stray tap does not raise a banner", () => {
    assert.equal(m.worthKeeping({ trade: "", parish: "", desc: "", urgency: "", accessType: "" }), false);
    assert.equal(m.worthKeeping({ ...m.draftFields(full()), desc: "", trade: "" }), true); // parish alone counts
    assert.equal(m.parseDraft(m.serialiseDraft("JOB-WEB-1", m.EMPTY_FIELDS, NOW), NOW), null);
  });

  test("a field with the wrong type in storage is treated as blank, not trusted", () => {
    const raw = JSON.stringify({ v: 1, jobId: 42, at: NOW,
      fields: { trade: ["Roofing"], parish: "Kingston", desc: null, urgency: 7, accessType: {} } });
    const d = m.parseDraft(raw, NOW);
    assert.equal(d.jobId, "");
    assert.equal(d.fields.trade, "");
    assert.equal(d.fields.desc, "");
    assert.equal(d.fields.parish, "Kingston");
  });
});

describe("restoring only ever offers values the lists still have", () => {
  const NOW = 1_760_000_000_000;
  const lists = { trades: ["Roofing", "Plumbing"], parishes: ["Kingston"] };

  test("a trade dropped from the taxonomy comes back blank and gets asked again", () => {
    const raw = m.serialiseDraft("JOB-WEB-1", { ...full(), trade: "Thatching" }, NOW);
    const r = m.restoreFields(m.parseDraft(raw, NOW), lists);
    assert.equal(r.trade, "");
    assert.equal(r.parish, "Kingston");
  });

  test("an urgency or access answer that is no longer offered is dropped too", () => {
    const raw = m.serialiseDraft("JOB-WEB-1",
      { ...full(), urgency: "Whenever", accessType: "The dog lets you in" }, NOW);
    const r = m.restoreFields(m.parseDraft(raw, NOW), lists);
    assert.equal(r.urgency, "");
    assert.equal(r.accessType, "");
  });

  test("the description is never filtered, because it is the person's own words", () => {
    const raw = m.serialiseDraft("JOB-WEB-1", { ...full(), desc: "Di zinc dem lif off" }, NOW);
    const r = m.restoreFields(m.parseDraft(raw, NOW), lists);
    assert.equal(r.desc, "Di zinc dem lif off");
  });

  test("a live answer survives a round trip through storage and the lists", () => {
    const raw = m.serialiseDraft("JOB-WEB-1", full(), NOW);
    const r = m.restoreFields(m.parseDraft(raw, NOW),
      { trades: ["Roofing"], parishes: ["Kingston"] });
    assert.equal(r.urgency, "Urgent, within 48 hours");
    assert.equal(r.accessType, "No inside access needed, outside work only");
  });
});

/* ── who buys the materials ───────────────────────────────────────────────
 *
 * Step 2 of specs/MATERIALS-ROUTE-FLOW-SPEC.md, and these sentences are load
 * bearing in the same way the access ones are, for a different reason.
 *
 * yaad-post-job maps them onto jobs.materials_by by matching the lowercased
 * sentence, so a copy edit here that is not made there stops mapping and the
 * route silently becomes null. Null means "not asked", the job carries no
 * route, and the client is never asked again. Nothing goes red.
 *
 * The MATERIALS_BY map in supabase/functions/yaad-post-job/index.ts is:
 *
 *     "yaadly buys the materials"          -> yaadly
 *     "i am supplying the materials myself" -> client
 *
 * Those two strings are restated below and asserted against the option list.
 * Change a word in either place without the other and this file fails, naming
 * the option. That is the whole point of the test.
 */
describe("the materials wording maps to a route", () => {
  const MAPPED = {
    "yaadly buys the materials": "yaadly",
    "i am supplying the materials myself": "client",
  };

  test("there are exactly two options, and no not-sure escape hatch", () => {
    assert.equal(m.MATERIALS.length, 2);
    for (const o of m.MATERIALS) {
      assert.doesNotMatch(o.value, /not sure|split|advise/i, o.value);
    }
  });

  test("every option still maps to a route in yaad-post-job", () => {
    for (const o of m.MATERIALS) {
      assert.ok(
        MAPPED[o.value.toLowerCase()],
        `"${o.value}" does not match MATERIALS_BY in yaad-post-job, so it would post as null`,
      );
    }
  });

  test("Yaadly buying is first, because it is the answer for somebody unsure", () => {
    assert.equal(MAPPED[m.MATERIALS[0].value.toLowerCase()], "yaadly");
  });

  test("the client-supplied option says what it costs, on the option", () => {
    const note = m.MATERIALS[1].note;
    assert.match(note, /guarantee/i);
    assert.match(note, /short|late|wrong/i);
  });

  test("clientSuppliesMaterials is true only for the second option", () => {
    assert.equal(m.clientSuppliesMaterials(m.MATERIALS[1].value), true);
    assert.equal(m.clientSuppliesMaterials(m.MATERIALS[0].value), false);
    assert.equal(m.clientSuppliesMaterials(""), false);
  });
});

describe("the materials answer is required to leave the first stage", () => {
  test("a job with no materials answer cannot advance", () => {
    const f = { ...full(), materialsBy: "" };
    assert.equal(m.stageComplete("work", f), false);
  });

  test("with it answered, the work stage completes", () => {
    assert.equal(m.stageComplete("work", full()), true);
  });

  test("firstIncomplete points at the work stage when only materials is missing", () => {
    assert.equal(m.firstIncomplete({ ...full(), materialsBy: "" }), "work");
  });
});

describe("a saved draft keeps the materials answer", () => {
  test("it survives a serialise and parse round trip", () => {
    const raw = m.serialiseDraft("JOB-1", full(), Date.now());
    const back = m.parseDraft(raw, Date.now());
    assert.equal(back.fields.materialsBy, "Yaadly buys the materials");
  });

  test("a retired option is dropped on restore rather than posted", () => {
    const d = {
      v: 1, jobId: "JOB-1", at: Date.now(),
      fields: { ...full(), materialsBy: "Split, agree item by item" },
    };
    const kept = m.restoreFields(d, { trades: ["Roofing"], parishes: ["Kingston"] });
    assert.equal(kept.materialsBy, "");
  });
});

/* ── where materials are kept ─────────────────────────────────────────────
 *
 * Step 3 of specs/MATERIALS-ROUTE-FLOW-SPEC.md. Load bearing twice over.
 *
 * yaad-post-job maps these three sentences, lowercased, onto the three codes
 * jobs_materials_store_type_chk permits. A copy edit here that is not made
 * there stops mapping, materials_store_type lands null, and
 * materials_store_nominated() in 20260828c then refuses every materials
 * release on the job. Nothing goes red at the time; it fails weeks later
 * when somebody tries to pay for cement.
 *
 * The STORE_TYPE map in supabase/functions/yaad-post-job/index.ts is:
 *
 *     "a lockable room, store or container on site" -> lockable
 *     "indoors, inside the house"                   -> indoors
 *     "nowhere securable, buy in drops"             -> none_available
 *
 * And storeAnswered() mirrors materials_store_nominated(). If those two
 * disagree, a client sees "nothing outstanding" while Postgres still refuses
 * to release a tranche, which is the exact failure the gates.ts comment
 * warns about.
 */
describe("the store wording maps to a store type", () => {
  const MAPPED = {
    "a lockable room, store or container on site": "lockable",
    "indoors, inside the house": "indoors",
    "nowhere securable, buy in drops": "none_available",
  };

  test("every option still maps to a code in yaad-post-job", () => {
    assert.equal(m.STORES.length, 3);
    for (const o of m.STORES) {
      assert.ok(
        MAPPED[o.value.toLowerCase()],
        `"${o.value}" does not match STORE_TYPE in yaad-post-job, so it would post as null`,
      );
    }
  });

  test("the none_available option is the one flagged as standing alone", () => {
    assert.equal(MAPPED[m.STORE_NONE_AVAILABLE.toLowerCase()], "none_available");
  });
});

describe("storeAnswered mirrors materials_store_nominated in Postgres", () => {
  test("nothing chosen is not answered", () => {
    assert.equal(m.storeAnswered("", ""), false);
    assert.equal(m.storeAnswered("", "the back room"), false);
  });

  test("a lockable store with no room named is NOT answered", () => {
    assert.equal(m.storeAnswered(m.STORES[0].value, ""), false);
    assert.equal(m.storeAnswered(m.STORES[0].value, "   "), false);
  });

  test("indoors with no room named is NOT answered either", () => {
    assert.equal(m.storeAnswered(m.STORES[1].value, ""), false);
  });

  test("nowhere securable stands on its own", () => {
    assert.equal(m.storeAnswered(m.STORE_NONE_AVAILABLE, ""), true);
  });

  test("a named room completes the other two", () => {
    assert.equal(m.storeAnswered(m.STORES[0].value, "The back room off the veranda"), true);
    assert.equal(m.storeAnswered(m.STORES[1].value, "The spare bedroom"), true);
  });
});

describe("the store question is asked on Route A only", () => {
  const routeB = () => ({
    ...full(),
    materialsBy: "I am supplying the materials myself",
    materialsStore: "", materialsStoreWhere: "",
  });

  test("Route A cannot leave the property stage without it", () => {
    const f = { ...full(), materialsStore: "", materialsStoreWhere: "" };
    assert.equal(m.stageComplete("property", f), false);
  });

  test("Route A completes once it is answered", () => {
    assert.equal(m.stageComplete("property", full()), true);
  });

  test("Route B does not ask, and completes without it", () => {
    assert.equal(m.yaadlyBuysMaterials(routeB().materialsBy), false);
    assert.equal(m.stageComplete("property", routeB()), true);
  });

  test("Route A with a lockable store but no room named is still incomplete", () => {
    assert.equal(
      m.stageComplete("property", { ...full(), materialsStoreWhere: "" }),
      false,
    );
  });
});

describe("the saved draft keeps the store TYPE and not the room", () => {
  /* The type is a fact about the job the worker prices against and names no
     room. The free text names where the valuable things are kept on a
     property that is often empty, and a draft sits in localStorage for a
     week on a phone other people use. */
  test("the room description is never written to the draft", () => {
    const raw = m.serialiseDraft("JOB-WEB-1", full(), Date.now());
    assert.doesNotMatch(raw, /veranda/i);
    assert.doesNotMatch(raw, /my aunt/i);
  });

  test("the type does come back, so the worker's pricing answer survives", () => {
    const back = m.parseDraft(m.serialiseDraft("JOB-WEB-1", full(), Date.now()), Date.now());
    assert.equal(back.fields.materialsStore, "A lockable room, store or container on site");
  });

  test("a store option that no longer exists is dropped on restore", () => {
    const d = {
      v: 1, jobId: "JOB-1", at: Date.now(),
      fields: { ...full(), materialsStore: "In the yard under a tarpaulin" },
    };
    const kept = m.restoreFields(d, { trades: ["Roofing"], parishes: ["Kingston"] });
    assert.equal(kept.materialsStore, "");
  });
});
