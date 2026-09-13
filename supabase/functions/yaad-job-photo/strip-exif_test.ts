// The location comes off the photograph, and the caller can prove it.
//
// This is the one guarantee the anonymous upload door has to keep. A signed-in
// client's photograph is stripped by web/lib/exif.ts inside a Server Action;
// this is the same rule ported to Deno for the door that has no session behind
// it. A photograph of an empty house in Portmore, sent by somebody in London,
// must not carry that house's latitude, and one of these may later be
// published to a public board.
//
// Run: deno test --allow-read --allow-env supabase/functions/
import { assert, assertEquals } from "jsr:@std/assert";
import { stripApp1, hasApp1 } from "./strip-exif.ts";

/** A minimal JPEG: SOI, one APP1 segment carrying the given payload, one APP0
 *  that must survive, then SOS and two bytes of scan data. */
function jpeg(app1: Uint8Array | null): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  if (app1) {
    const len = app1.length + 2;
    parts.push(0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...app1);
  }
  const app0 = [0x4a, 0x46, 0x49, 0x46, 0x00]; // "JFIF\0"
  parts.push(0xff, 0xe0, 0x00, app0.length + 2, ...app0);
  parts.push(0xff, 0xda, 0x00, 0x02, 0x11, 0x22);
  return new Uint8Array(parts);
}

const EXIF_WITH_GPS = new Uint8Array([
  0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
  0x49, 0x49, 0x2a, 0x00,             // little endian TIFF header
  0x08, 0x00, 0x00, 0x00,
  0x25, 0x88, 0x03, 0x00,             // a GPS-ish tag, contents irrelevant
]);

Deno.test("the APP1 segment is gone, and nothing else is", () => {
  const withExif = jpeg(EXIF_WITH_GPS);
  assert(hasApp1(withExif), "the fixture should carry APP1 to begin with");

  const out = stripApp1(withExif);
  assert(!hasApp1(out), "APP1 survived the strip");
  assert(out.length < withExif.length, "nothing was removed");

  // The JFIF segment and the scan data are still there, in order.
  const bytes = Array.from(out);
  assertEquals(bytes.slice(0, 2), [0xff, 0xd8]);
  assert(bytes.join(",").includes([0xff, 0xe0].join(",")), "the APP0 segment was dropped too");
  assertEquals(bytes.slice(-6), [0xff, 0xda, 0x00, 0x02, 0x11, 0x22]);
});

Deno.test("a photograph with no EXIF comes back byte for byte, so no re-upload happens", () => {
  const clean = jpeg(null);
  const out = stripApp1(clean);
  assertEquals(out.length, clean.length);
  assertEquals(out, clean);
});

Deno.test("something that is not a JPEG is passed through rather than half rewritten", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  assertEquals(stripApp1(png), png);
  assertEquals(hasApp1(png), false);
});

Deno.test("a truncated segment length stops the walk instead of reading past the end", () => {
  // Claims a 4KB APP1 in a file that is 12 bytes long.
  const lying = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x10, 0x00, 1, 2, 3, 4, 5, 6]);
  const out = stripApp1(lying);
  assertEquals(out, lying);
  assertEquals(hasApp1(lying), false);
});
