/**
 * EXIF handling for evidence photographs.
 *
 * Two requirements that pull in opposite directions, satisfied by one pass.
 *
 * The Midnight Work-Log needs to know WHEN a photograph was taken, which is a
 * different question from when it reached us. evidence.created_at answers the
 * second. evidence.captured_at was added to answer the first and nothing ever
 * wrote it, so a worker could shoot on Tuesday, upload on Thursday, and the
 * record could not tell the two apart.
 *
 * The worker one-pager promises no tracking. EXIF GPS is tracking, or close
 * enough that a worker deciding whether to join would read it that way.
 *
 * Both hold if we read the timestamp and then store the image with every APP1
 * segment removed. The time lands in a column, the coordinates never land at
 * all. Dropping the whole segment rather than blanking the GPS tags is the
 * point: EXIF, GPS and XMP all live in APP1, so there is no tag ordering, no
 * maker note and no XMP packet left that could smuggle a location through.
 *
 * captured_at is what the camera said. A device clock can be wrong or set
 * deliberately, so it is evidence and not proof, and a human still reads it.
 * Values that cannot be true are dropped rather than stored.
 *
 * JPEG only. HEIC and WebP hold EXIF in containers this does not parse, so
 * they store with captured_at null rather than with a guess.
 */

const SOI = 0xffd8;
const MARKER_APP1 = 0xe1;
const MARKER_SOS = 0xda;

const TAG_DATETIME = 0x0132; // IFD0, when the file was last written
const TAG_EXIF_IFD = 0x8769; // IFD0, pointer to the Exif sub-IFD
const TAG_DATETIME_ORIGINAL = 0x9003; // Exif IFD, when the shutter fired

/**
 * EXIF timestamps carry no timezone. Evidence photographs are taken on site,
 * and site is Jamaica, which sits at UTC-5 all year with no daylight saving.
 * Reading them as UTC would put every evidence photo five hours off on the
 * desk. If evidence ever gets captured somewhere else, this is the constant
 * to revisit.
 */
const SITE_UTC_OFFSET_MINUTES = -5 * 60;

/** Rebuild a JPEG without any APP1 segment. Anything else passes through. */
export function stripApp1(buf: Buffer): Buffer {
  if (buf.length < 4 || buf.readUInt16BE(0) !== SOI) return buf;
  const keep: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    if (marker === MARKER_SOS) break; // scan data runs to the end, leave it alone
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) break;
    if (marker !== MARKER_APP1) keep.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  keep.push(buf.subarray(i));
  return Buffer.concat(keep);
}

/** The TIFF block inside the Exif APP1 segment, or null. */
function findExifTiff(buf: Buffer): Buffer | null {
  if (buf.length < 4 || buf.readUInt16BE(0) !== SOI) return null;
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === MARKER_SOS) return null;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) return null;
    if (marker === MARKER_APP1) {
      const seg = buf.subarray(i + 4, i + 2 + len);
      if (seg.length > 6 && seg.toString("latin1", 0, 6) === "Exif\0\0") return seg.subarray(6);
    }
    i += 2 + len;
  }
  return null;
}

const u16 = (b: Buffer, o: number, le: boolean) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
const u32 = (b: Buffer, o: number, le: boolean) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));

function eachEntry(
  tiff: Buffer,
  le: boolean,
  ifd: number,
  fn: (tag: number, entry: number) => void,
): void {
  if (ifd <= 0 || ifd + 2 > tiff.length) return;
  const n = u16(tiff, ifd, le);
  for (let k = 0; k < n; k++) {
    const entry = ifd + 2 + k * 12;
    if (entry + 12 > tiff.length) return;
    fn(u16(tiff, entry, le), entry);
  }
}

/** An ASCII EXIF value, read from the entry inline or from its offset. */
function asciiValue(tiff: Buffer, le: boolean, entry: number): string | null {
  if (u16(tiff, entry + 2, le) !== 2) return null; // type 2 is ASCII
  const count = u32(tiff, entry + 4, le);
  if (count === 0 || count > 64) return null;
  const start = count <= 4 ? entry + 8 : u32(tiff, entry + 8, le);
  if (start < 0 || start + count > tiff.length) return null;
  return tiff.toString("latin1", start, start + count).replace(/\0[\s\S]*$/, "").trim();
}

/** "YYYY:MM:DD HH:MM:SS" at the site offset, or null if it cannot be true. */
function parseExifDate(value: string | null, now: Date): Date | null {
  if (!value) return null;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const utcMs = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - SITE_UTC_OFFSET_MINUTES * 60_000;
  const when = new Date(utcMs);
  if (Number.isNaN(when.getTime())) return null;
  // A photograph from the future is a wrong clock, not a photograph. A day of
  // slack absorbs ordinary device drift and a timezone set to the wrong place.
  if (when.getTime() > now.getTime() + 25 * 3600_000) return null;
  if (when.getUTCFullYear() < 2020) return null;
  return when;
}

/** When the shutter fired, per the camera. Null when nothing usable is there. */
export function readCapturedAt(buf: Buffer, now: Date = new Date()): Date | null {
  const tiff = findExifTiff(buf);
  if (!tiff || tiff.length < 8) return null;

  const bom = tiff.toString("latin1", 0, 2);
  const le = bom === "II";
  if (!le && bom !== "MM") return null;
  if (u16(tiff, 2, le) !== 0x2a) return null;

  const ifd0 = u32(tiff, 4, le);
  let exifIfd = 0;
  let written: string | null = null;
  eachEntry(tiff, le, ifd0, (tag, entry) => {
    if (tag === TAG_EXIF_IFD) exifIfd = u32(tiff, entry + 8, le);
    else if (tag === TAG_DATETIME) written = asciiValue(tiff, le, entry);
  });

  let original: string | null = null;
  eachEntry(tiff, le, exifIfd, (tag, entry) => {
    if (tag === TAG_DATETIME_ORIGINAL) original = asciiValue(tiff, le, entry);
  });

  return parseExifDate(original ?? written, now);
}
