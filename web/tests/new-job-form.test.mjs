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
import { readFileSync } from "node:fs";

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

  test("a name, a contact detail and a portal code are never written", () => {
    const raw = m.serialiseDraft("JOB-WEB-1", full(), NOW);
    assert.doesNotMatch(raw, /Test Client/);
    assert.doesNotMatch(raw, /test@example\.com/);
    assert.deepEqual(Object.keys(JSON.parse(raw).fields).sort(),
      ["accessType", "desc", "parish", "trade", "urgency"]);
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

describe("the photo stage takes photographs, and still hands over the link", () => {
  /* Added 6 Sep 2026, founder instruction: the photo screen described a link
     and did not give one. It told somebody standing in front of the problem
     to remember, for two more screens, a route they could have taken there
     and then.

     Three properties, and each one is here because losing it quietly is easy.

     The link itself, aimed at next=photos, which is the only value the join
     page honours as a destination. Without it a client lands on /portal and
     hunts for the job, the board preview and an Add a photo button.

     target="_blank". Sending the job is what puts it in front of a person.
     The portal on its own does not, and the answers on the screen behind it
     live in localStorage and nowhere else. A link that takes over the tab
     lets somebody upload six photographs of their mother's roof and never
     send the job at all.

     A branch for the case where no reference saved. yaad-post-job is
     throttled per caller per hour and can trip on a shared connection, and
     that person carries on with no jobId and no portal code. Rendering a
     dead link at them is worse than the sentence that says why there is no
     link yet. */
  const source = readFileSync(join(HERE, "../app/jobs/new/PostJob.tsx"), "utf8");
  const evidence = source.slice(
    source.indexOf('key === "evidence"'),
    source.indexOf('key === "reach"'),
  );

  test("the evidence stage exists in the source and was found", () => {
    assert.ok(evidence.length > 500);
  });

  test("it links straight to the photo screen, not to the portal front door", () => {
    assert.match(evidence, /\/portal\/join\?job=/);
    assert.match(evidence, /next=photos/);
  });

  test("that link opens in a new tab, so an unsent job cannot be lost behind it", () => {
    assert.match(evidence, /target="_blank"/);
    assert.match(evidence, /rel="noopener noreferrer"/);
  });

  test("it says out loud that the job still has to be sent from this tab", () => {
    assert.match(evidence, /only reaches a person when you send it/);
  });

  test("a draft that never saved gets a sentence instead of a broken link", () => {
    assert.match(evidence, /jobId && portalCode \?/);
    assert.match(evidence, /no reference saved against it/);
  });

  /* Added 6 Sep 2026, founder instruction: "it should be in the form to
     attach a photo and it be included on the job card". The link alone was
     not the answer. It sent somebody who already had the picture on the phone
     in their hand away from a half finished form. */
  test("the file picker is on the form itself, with the job and its code", () => {
    assert.match(evidence, /<PhotoAttach/);
    assert.match(evidence, /jobId=\{jobId\}/);
    assert.match(evidence, /code=\{portalCode\}/);
  });
});

describe("what the form does with a photograph once it is picked", () => {
  /* The whole point of this component is WHERE the file goes. yaad-post-job
     still accepts a base64 photos array left over from the deleted funnel: no
     size limit, written into the immutable evidence table, with the phone's
     GPS coordinate left on it. Anything that moves these files onto that
     route undoes the reason this exists, and reads like a simplification
     while doing it, so it is asserted rather than trusted to a comment. */
  const source = readFileSync(join(HERE, "../app/jobs/new/PhotoAttach.tsx"), "utf8");
  /* Comments stripped for the two assertions that say a thing is ABSENT. The
     file explains at length which route it must never take, and naming the
     old route in a comment is how it stays named; a doesNotMatch over the raw
     text would fail on the explanation rather than on the code. */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  test("it uploads through yaad-job-photo, not through the job form's own save", () => {
    assert.match(code, /yaad-job-photo/);
    assert.doesNotMatch(code, /yaad-post-job/);
    assert.doesNotMatch(code, /toBase64|readAsDataURL/);
  });

  test("the server picks the path: the browser sends what it has, not where to put it", () => {
    assert.match(source, /action: "start"/);
    assert.match(source, /uploadToSignedUrl/);
    assert.match(source, /action: "finish"/);
  });

  test("nothing shows as attached until the finish call has come back", () => {
    const send = source.slice(source.indexOf("async function send("), source.indexOf("async function choose("));
    assert.ok(send.indexOf('action: "finish"') < send.indexOf('state: "done"'));
  });

  test("a photograph can be taken back off the job from this screen", () => {
    assert.match(source, /action: "remove"/);
  });

  test("nothing here can publish a photograph to the board", () => {
    assert.doesNotMatch(code, /board_ok|board: *true/);
  });

  test("only image types a browser will actually paint are offered", () => {
    assert.match(source, /accept="image\/jpeg,image\/png,image\/webp"/);
  });
});
