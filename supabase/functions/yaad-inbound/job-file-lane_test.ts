// Proves the WhatsApp document lane's pure rules: only the three document
// types count, images never do, the kind comes from the caption or is
// 'other', and the label is the sender's own words or where it came from.
//
// Run: deno test supabase/functions/yaad-inbound/job-file-lane_test.ts

import { assertEquals } from "jsr:@std/assert@1";
import { docExt, fileLabel, guessFileKind, isDocMime, isFileableStatus } from "./job-file-lane.ts";

Deno.test("a PDF, a .doc and a .docx are documents", () => {
  assertEquals(docExt("application/pdf"), "pdf");
  assertEquals(docExt("application/msword"), "doc");
  assertEquals(docExt("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), "docx");
});

Deno.test("Twilio's content type with a charset still matches", () => {
  assertEquals(docExt("application/pdf; charset=binary"), "pdf");
  assertEquals(isDocMime("APPLICATION/PDF"), true);
});

Deno.test("an image, a video or a voice note is never a document", () => {
  assertEquals(isDocMime("image/jpeg"), false);
  assertEquals(isDocMime("video/mp4"), false);
  assertEquals(isDocMime("audio/ogg"), false);
  assertEquals(isDocMime(""), false);
});

Deno.test("a spreadsheet is not accepted, the bucket refuses it", () => {
  assertEquals(isDocMime("application/vnd.ms-excel"), false);
});

Deno.test("the kind follows a plain caption", () => {
  assertEquals(guessFileKind("Hardware & Lumber receipt for the cement"), "receipt");
  assertEquals(guessFileKind("here is the quote from the electrician"), "quote");
  assertEquals(guessFileKind("KSPA approval letter"), "permit");
  assertEquals(guessFileKind("the drawing for the extension"), "plan");
  assertEquals(guessFileKind("warranty for the tank"), "certificate");
});

Deno.test("no caption, or an unclear one, is 'other' rather than a guess", () => {
  assertEquals(guessFileKind(""), "other");
  assertEquals(guessFileKind("see attached"), "other");
});

Deno.test("the label is the sender's words, else where it came from", () => {
  assertEquals(fileLabel("  Receipt from Rapid True Value  "), "Receipt from Rapid True Value");
  assertEquals(fileLabel(""), "Sent on WhatsApp");
  assertEquals(fileLabel("", "sms"), "Sent in a message");
  assertEquals(fileLabel("x".repeat(200)).length, 140);
});

Deno.test("a document can be filed on any live job, never a finished or draft one", () => {
  assertEquals(isFileableStatus("quoted"), true);
  assertEquals(isFileableStatus("in_progress"), true);
  assertEquals(isFileableStatus("complete"), false);
  assertEquals(isFileableStatus("cancelled"), false);
  assertEquals(isFileableStatus("draft"), false);
  assertEquals(isFileableStatus(null), false);
});
