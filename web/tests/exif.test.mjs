/**
 * Tests for the evidence photo metadata pass.
 *
 * Two properties matter and they are opposites, so both are asserted on the
 * same synthetic file: the shutter time comes OUT, and the GPS never survives.
 * The fixture carries a distinctive string inside its GPS IFD precisely so a
 * leak is greppable rather than a matter of trusting the parser.
 *
 * No image library. The JPEG is assembled byte by byte here, which keeps the
 * test honest about the format instead of testing a decoder's opinion of it.
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

let exif;
before(async () => {
  exif = await import(pathToFileURL(join(HERE, "../lib/exif.ts")).href);
});

const GPS_CANARY = "GPSSECRET42\0"; // 12 bytes, must never reach storage

/** A TIFF block holding DateTimeOriginal and a GPS IFD, in either byte order. */
function tiffBlock(stamp, le) {
  const b = Buffer.alloc(106);
  const w16 = (o, v) => (le ? b.writeUInt16LE(v, o) : b.writeUInt16BE(v, o));
  const w32 = (o, v) => (le ? b.writeUInt32LE(v, o) : b.writeUInt32BE(v, o));

  b.write(le ? "II" : "MM", 0, "latin1");
  w16(2, 0x2a);
  w32(4, 8); // IFD0 starts at 8

  w16(8, 2); // two entries
  w16(10, 0x8769); w16(12, 4); w32(14, 1); w32(18, 38); // Exif IFD pointer
  w16(22, 0x8825); w16(24, 4); w32(26, 1); w32(30, 56); // GPS IFD pointer
  w32(34, 0);

  w16(38, 1); // Exif IFD
  w16(40, 0x9003); w16(42, 2); w32(44, 20); w32(48, 74); // DateTimeOriginal
  w32(52, 0);

  w16(56, 1); // GPS IFD
  w16(58, 0x0004); w16(60, 2); w32(62, 12); w32(66, 94); // GPSLongitude, as ASCII
  w32(70, 0);

  b.write(stamp + "\0", 74, "latin1");
  b.write(GPS_CANARY, 94, "latin1");
  return b;
}

const SCAN = Buffer.from([0xff, 0xda, 0x00, 0x02, 0xaa, 0xbb, 0xcc, 0xff, 0xd9]);

function jpegWithExif(stamp, le = true) {
  const tiff = tiffBlock(stamp, le);
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xffe1, 0);
  head.writeUInt16BE(2 + 6 + tiff.length, 2);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    head,
    Buffer.from("Exif\0\0", "latin1"),
    tiff,
    SCAN,
  ]);
}

const jpegNoExif = () => Buffer.concat([Buffer.from([0xff, 0xd8]), SCAN]);
const NOW = new Date("2027-01-15T00:00:00Z");

describe("readCapturedAt", () => {
  test("reads DateTimeOriginal and places it at the site offset", () => {
    const at = exif.readCapturedAt(jpegWithExif("2026:12:11 14:32:05"), NOW);
    // 14:32 in Jamaica (UTC-5, no daylight saving) is 19:32 UTC.
    assert.equal(at?.toISOString(), "2026-12-11T19:32:05.000Z");
  });

  test("reads big-endian EXIF too", () => {
    const at = exif.readCapturedAt(jpegWithExif("2026:12:11 14:32:05", false), NOW);
    assert.equal(at?.toISOString(), "2026-12-11T19:32:05.000Z");
  });

  test("refuses a photograph from the future", () => {
    assert.equal(exif.readCapturedAt(jpegWithExif("2030:01:01 09:00:00"), NOW), null);
  });

  test("refuses a clock reset to the epoch", () => {
    assert.equal(exif.readCapturedAt(jpegWithExif("1970:01:01 00:00:00"), NOW), null);
  });

  test("returns null rather than guessing when there is no EXIF", () => {
    assert.equal(exif.readCapturedAt(jpegNoExif(), NOW), null);
    assert.equal(exif.readCapturedAt(Buffer.from("not an image at all"), NOW), null);
  });
});

describe("stripApp1", () => {
  test("the GPS coordinate does not survive the strip", () => {
    const out = exif.stripApp1(jpegWithExif("2026:12:11 14:32:05"));
    assert.equal(out.includes(Buffer.from("GPSSECRET42", "latin1")), false);
    assert.equal(out.includes(Buffer.from("Exif\0\0", "latin1")), false);
  });

  test("what is left is still the same JPEG", () => {
    const out = exif.stripApp1(jpegWithExif("2026:12:11 14:32:05"));
    assert.equal(out.readUInt16BE(0), 0xffd8);
    assert.deepEqual(out.subarray(2), SCAN); // scan data byte for byte
  });

  test("a file with nothing to strip is returned unchanged", () => {
    const plain = jpegNoExif();
    assert.deepEqual(exif.stripApp1(plain), plain);
    const other = Buffer.from("not an image at all");
    assert.deepEqual(exif.stripApp1(other), other);
  });

  test("the timestamp is readable before the strip and gone after it", () => {
    const raw = jpegWithExif("2026:12:11 14:32:05");
    assert.notEqual(exif.readCapturedAt(raw, NOW), null);
    assert.equal(exif.readCapturedAt(exif.stripApp1(raw), NOW), null);
  });
});
