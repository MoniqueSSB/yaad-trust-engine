/**
 * Tests for lib/portal/job-files.ts: what a job file may be, and who may take
 * one back. The module mirrors the job_files policies in 20260910120000 and
 * the job-files bucket's allowed types. If one of these has to change to
 * pass, the form and the database have stopped agreeing. Fix the code, never
 * the assertion.
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
  m = await import(pathToFileURL(join(HERE, "../lib/portal/job-files.ts")).href);
});

describe("what a file may be", () => {
  test("the six accepted types are exactly the bucket's", () => {
    assert.deepEqual(Object.keys(m.ACCEPTED_MIMES).sort(), [
      "application/msword",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });

  test("a PDF of a sensible size is fine", () => {
    assert.equal(m.fileProblem("application/pdf", 2_000_000), null);
  });

  test("a video is refused with a sentence, not a code", () => {
    assert.match(m.fileProblem("video/mp4", 1000), /PDF/);
  });

  test("HEIC is refused: most browsers cannot open it", () => {
    assert.notEqual(m.fileProblem("image/heic", 1000), null);
  });

  test("an empty file is refused", () => {
    assert.equal(m.fileProblem("application/pdf", 0), "no file chosen");
  });

  test("the size cap sits under the bucket's 26214400", () => {
    assert.ok(m.MAX_FILE_BYTES < 26214400);
    assert.match(m.fileProblem("application/pdf", m.MAX_FILE_BYTES + 1), /too large/);
  });

  test("the extension follows the type, case-insensitively", () => {
    assert.equal(m.extFor("IMAGE/JPEG"), "jpg");
    assert.equal(m.extFor("application/octet-stream"), null);
  });

  test("only the six kinds are kinds", () => {
    assert.equal(m.isFileKind("receipt"), true);
    assert.equal(m.isFileKind("selfie"), false);
    assert.equal(m.fileKindLabel("permit"), "Permit or approval");
    assert.equal(m.fileKindLabel(null), "File");
  });
});

describe("who may add and who may take back", () => {
  test("adding is open while the job is open, same as the insert policy", () => {
    assert.equal(m.canAddFile("in_progress"), true);
    assert.equal(m.canAddFile("evidence"), true);
    assert.equal(m.canAddFile("complete"), false);
    assert.equal(m.canAddFile("cancelled"), false);
  });

  test("you may remove your own file while the job is not complete", () => {
    assert.equal(
      m.canRemoveFile({ uploadedBy: "Ann@Example.com", viewerEmail: "ann@example.com", jobStatus: "in_progress" }),
      true,
    );
  });

  test("you may not remove the other side's file", () => {
    assert.equal(
      m.canRemoveFile({ uploadedBy: "worker@example.com", viewerEmail: "ann@example.com", jobStatus: "in_progress" }),
      false,
    );
  });

  test("nothing is removable once the job is complete", () => {
    assert.equal(
      m.canRemoveFile({ uploadedBy: "ann@example.com", viewerEmail: "ann@example.com", jobStatus: "complete" }),
      false,
    );
  });

  test("no email means no removal", () => {
    assert.equal(m.canRemoveFile({ uploadedBy: "", viewerEmail: "", jobStatus: "in_progress" }), false);
  });
});

describe("sizes read like a person wrote them", () => {
  test("kilobytes and megabytes", () => {
    assert.equal(m.humanBytes(512_000), "512 KB");
    assert.equal(m.humanBytes(2_400_000), "2.4 MB");
    assert.equal(m.humanBytes(0), "");
  });
});
