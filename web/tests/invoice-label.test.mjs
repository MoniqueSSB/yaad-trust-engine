/**
 * Tests for lib/portal/invoice-label.ts.
 *
 * The client's bill on a job carries the labour, the 15% and the materials.
 * Calling it "Yaadly Guarantee & Support fee" told a client they were paying
 * a J$134,250 fee (14 Sep 2026). These stop any Yaadly invoice on a job
 * being named as the fee again.
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
  m = await import(pathToFileURL(join(HERE, "../lib/portal/invoice-label.ts")).href);
});

describe("invoiceLabel", () => {
  test("the invoice that starts the job is the job bill", () => {
    assert.equal(m.invoiceLabel({ payable_to: "yaadly", stage: null, starts_job: true, part_of: null }), "Job bill");
  });

  test("a part says it is a part, whether or not it carries the 15%", () => {
    assert.equal(m.invoiceLabel({ payable_to: "yaadly", stage: null, starts_job: true, part_of: "INV-2026-0021" }), "Part of the job bill");
    assert.equal(m.invoiceLabel({ payable_to: "yaadly", stage: null, starts_job: false, part_of: "INV-2026-0021" }), "Part of the job bill");
  });

  test("a stage bill names its stage", () => {
    assert.equal(m.invoiceLabel({ payable_to: "yaadly", stage: 2, starts_job: false, part_of: null }), "Job bill · stage 2");
  });

  test("worker pay stays worker pay", () => {
    assert.equal(m.invoiceLabel({ payable_to: "worker", stage: 1 }), "Worker pay · stage 1");
    assert.equal(m.invoiceLabel({ payable_to: "worker", stage: null }), "Worker pay");
  });

  test("no Yaadly invoice on a job is ever called the fee", () => {
    const shapes = [
      { payable_to: "yaadly", stage: null, starts_job: true, part_of: null },
      { payable_to: "yaadly", stage: null, starts_job: false, part_of: null },
      { payable_to: "yaadly", stage: 1, starts_job: false, part_of: null },
      { payable_to: null, stage: null },
    ];
    for (const s of shapes) assert.doesNotMatch(m.invoiceLabel(s), /fee/i);
  });
});
