import { assert, assertEquals } from "jsr:@std/assert@1";
import { checkAttrs, deskPack, runEvidenceChecks, workerGaps, workerNotes } from "./evidence-checks.ts";

const CHECKLIST = [
  { stage: "Strip and make safe", items: [{ item: "Wide shot of the room" }, { item: "Close-up of the join" }] },
  { stage: "First fix", items: [{ item: "Pressure test" }, { item: "Receipt for the cement" }, { item: "Clip of the run" }] },
];

const arrival = (over: Record<string, unknown> = {}) => ({
  arrived_at: "2026-09-04T13:00:00Z",
  arrived_on: "2026-09-04",
  lat: 17.97,
  far_from_site: false,
  ...over,
});

const photo = (over: Record<string, unknown> = {}) => ({
  mime: "image/jpeg",
  captured_at: "2026-09-04T14:00:00Z",
  created_at: "2026-09-04T14:01:00Z",
  ...over,
});

const clip = (over: Record<string, unknown> = {}) => photo({ mime: "video/mp4", ...over });

const byName = (cs: ReturnType<typeof runEvidenceChecks>, n: string) => cs.find((c) => c.name === n)!;

// ── the governing rule ───────────────────────────────────────────────────

Deno.test("the checks never decide anything: every result is text for a person", () => {
  const checks = runEvidenceChecks({ stage: 1, evidence: [], arrivals: [], checklist: CHECKLIST });
  for (const c of checks) {
    assertEquals(typeof c.detail, "string");
    assert(c.severity === "gap" || c.severity === "note", "severity is only gap or note, never blocking");
  }
  // No field on a Check can carry an instruction to act. If one is ever added
  // this test is the thing that should stop it.
  const keys = new Set(checks.flatMap((c) => Object.keys(c)));
  assertEquals([...keys].sort().join(","), "audience,detail,name,passed,severity");
});

// ── the checklist is the spine ───────────────────────────────────────────

Deno.test("checklist counts against the approved pack for THIS stage", () => {
  const c = byName(runEvidenceChecks({
    stage: 2, evidence: [photo()], arrivals: [arrival()], checklist: CHECKLIST,
  }), "Checklist");
  assertEquals(c.passed, false);
  assert(c.detail.includes("asks for 3"), c.detail);
  assert(c.detail.includes("Receipt for the cement"), "it lists what the pack asks for");
});

Deno.test("checklist passes when enough is filed", () => {
  const c = byName(runEvidenceChecks({
    stage: 1, evidence: [photo(), photo()], arrivals: [arrival()], checklist: CHECKLIST,
  }), "Checklist");
  assertEquals(c.passed, true);
});

Deno.test("no pack means no checklist claim, and it says so to the desk", () => {
  const c = byName(runEvidenceChecks({
    stage: 1, evidence: [photo()], arrivals: [arrival()], checklist: null,
  }), "Checklist");
  assertEquals(c.passed, true);
  assertEquals(c.audience, "desk");
  assertEquals(c.severity, "note");
});

Deno.test("it never claims to know WHICH checklist item is missing", () => {
  const c = byName(runEvidenceChecks({
    stage: 2, evidence: [photo()], arrivals: [arrival()], checklist: CHECKLIST,
  }), "Checklist");
  // Matching a free-text label to a checklist line is guessing. The check
  // lists what the pack asks for and lets the worker do the matching.
  assert(!/missing:/i.test(c.detail), "must not name a specific missing item: " + c.detail);
});

// ── hard columns only ────────────────────────────────────────────────────

Deno.test("clip reads mime, not anything the worker typed", () => {
  const typed = runEvidenceChecks({
    stage: 1, evidence: [photo({ label: "after video walkthrough" })], arrivals: [arrival()], checklist: CHECKLIST,
  });
  assertEquals(byName(typed, "Clip").passed, false, "a caption saying video is not a video");

  const real = runEvidenceChecks({
    stage: 1, evidence: [clip({ label: "" })], arrivals: [arrival()], checklist: CHECKLIST,
  });
  assertEquals(byName(real, "Clip").passed, true, "an actual video/* mime is");
});

Deno.test("the dropped before-and-after check is gone and stays gone", () => {
  const checks = runEvidenceChecks({
    stage: 1, evidence: [photo({ label: "after" })], arrivals: [arrival()], checklist: CHECKLIST,
  });
  assert(!checks.some((c) => /before/i.test(c.name)), "no label-sniffing check may come back");
});

Deno.test("sequence catches evidence timestamped before the arrival", () => {
  const c = byName(runEvidenceChecks({
    stage: 1,
    evidence: [photo({ captured_at: "2026-09-04T09:00:00Z" })],
    arrivals: [arrival()],
    checklist: CHECKLIST,
  }), "Sequence");
  assertEquals(c.passed, false);
});

Deno.test("missing timestamps are a note to the desk, never a gap against the worker", () => {
  const c = byName(runEvidenceChecks({
    stage: 1,
    evidence: [photo({ captured_at: null, created_at: null })],
    arrivals: [arrival({ arrived_at: null })],
    checklist: CHECKLIST,
  }), "Sequence");
  assertEquals(c.passed, true);
  assertEquals(c.severity, "note");
});

// ── the site flag never reaches the worker ───────────────────────────────

Deno.test("a far-from-site flag is desk only and is never a gap", () => {
  const checks = runEvidenceChecks({
    stage: 1, evidence: [photo()], arrivals: [arrival({ far_from_site: true })],
    checklist: CHECKLIST, parish: "Portmore",
  });
  const site = byName(checks, "Site");
  assertEquals(site.audience, "desk");
  assertEquals(site.severity, "note");
  assert(site.detail.includes("materials run"), "it must say what else raises this flag");
  assert(!workerGaps(checks).some((g) => /30km|site/i.test(g)), "the worker is never shown this");
});

Deno.test("no GPS fix is stated plainly and blames nobody", () => {
  const site = byName(runEvidenceChecks({
    stage: 1, evidence: [photo()], arrivals: [arrival({ lat: null, far_from_site: null })], checklist: CHECKLIST,
  }), "Site");
  assertEquals(site.passed, true);
  assertEquals(site.audience, "desk");
});

// ── what each audience actually gets ─────────────────────────────────────

Deno.test("workerGaps is only worker gaps: no passes, no notes, no desk items", () => {
  const checks = runEvidenceChecks({
    stage: 2, evidence: [], arrivals: [arrival({ far_from_site: true })], checklist: CHECKLIST,
  });
  const gaps = workerGaps(checks);
  assert(gaps.length > 0);
  for (const g of gaps) {
    const c = checks.find((x) => x.detail === g)!;
    assertEquals(c.audience, "worker");
    assertEquals(c.passed, false);
    assertEquals(c.severity, "gap");
  }
});

Deno.test("a complete stage gives the worker nothing to do", () => {
  const checks = runEvidenceChecks({
    stage: 1, evidence: [photo(), clip()], arrivals: [arrival()], checklist: CHECKLIST,
  });
  assertEquals(workerGaps(checks), []);
});

Deno.test("the desk pack says plainly that it decides nothing", () => {
  const pack = deskPack(runEvidenceChecks({
    stage: 1, evidence: [photo()], arrivals: [arrival()], checklist: CHECKLIST,
  }));
  assert(pack.includes("Nothing here approves, blocks or pays anything."));
});

Deno.test("telemetry carries counts, never the detail text", () => {
  const checks = runEvidenceChecks({
    stage: 2, evidence: [], arrivals: [], checklist: CHECKLIST,
  });
  const attrs = checkAttrs(checks);
  assertEquals(typeof attrs["yaadly.evidence.gaps"], "number");
  const blob = JSON.stringify(attrs);
  for (const c of checks) {
    assert(!blob.includes(c.detail), "a check's sentence must not reach telemetry");
  }
});

// ── the location pin ─────────────────────────────────────────────────────
//
// Replaces the Python engine's "live pin on work log", which could not be
// ported: evidence rows carry no lat/lon, WhatsApp discards EXIF on send, and
// the portal upload path strips location deliberately. A WhatsApp location
// share is the live equivalent and a stronger one.

Deno.test("a shared pin is recorded as a note, never a gap", () => {
  const checks = runEvidenceChecks({
    stage: 1, evidence: [photo(), clip()], arrivals: [arrival()], checklist: CHECKLIST,
    pins: [{ shared_at: "2026-09-04T14:30:00Z", far_from_site: false, address: "Barbican, Kingston 8" }],
  });
  const pin = byName(checks, "Location pin");
  assertEquals(pin.passed, true);
  assertEquals(pin.severity, "note");
  assert(pin.detail.includes("Barbican"), "it shows the address a human would rather read");
});

Deno.test("NO pin is never a gap and never blocks: it is an offer", () => {
  const checks = runEvidenceChecks({
    stage: 1, evidence: [photo(), clip()], arrivals: [arrival()], checklist: CHECKLIST, pins: [],
  });
  const pin = byName(checks, "Location pin");
  assertEquals(pin.passed, false);
  assertEquals(pin.severity, "note", "a missing pin must never be a gap");
  // The rule arrival_log's own migration sets: it strengthens the record, it
  // never gates it. If this ever becomes a gap, a voluntary thing has quietly
  // turned into an obligation and a worker is being judged for declining.
  assertEquals(workerGaps(checks), [], "a missing pin must never reach the gap list");
  assert(workerNotes(checks).some((n) => /up to you/i.test(n)), "the ask must say it is optional");
});

Deno.test("the pin ask explains what it is FOR, and tells nobody off", () => {
  const notes = workerNotes(runEvidenceChecks({
    stage: 1, evidence: [photo()], arrivals: [arrival()], checklist: CHECKLIST, pins: [],
  }));
  const ask = notes.find((n) => /location/i.test(n))!;
  assert(/you were there|harder to argue/i.test(ask), "says what it buys him: " + ask);
  assert(!/must|required|need to|failed|missing/i.test(ask), "must not read as a demand: " + ask);
});

Deno.test("a far pin is desk only, like the arrival flag", () => {
  const checks = runEvidenceChecks({
    stage: 1, evidence: [photo()], arrivals: [arrival()], checklist: CHECKLIST, parish: "Portmore",
    pins: [{ shared_at: "2026-09-04T14:30:00Z", far_from_site: true }],
  });
  const far = byName(checks, "Pin distance");
  assertEquals(far.audience, "desk");
  assertEquals(far.severity, "note");
  assert(!workerGaps(checks).concat(workerNotes(checks)).some((t) => /30km/.test(t)),
    "the worker is never shown the distance flag");
});

Deno.test("pins are optional input: omitting them entirely still runs", () => {
  const checks = runEvidenceChecks({ stage: 1, evidence: [photo()], arrivals: [arrival()], checklist: CHECKLIST });
  assertEquals(byName(checks, "Location pin").passed, false);
  assertEquals(workerGaps(checks).length > 0, true, "the other checks still work");
});
