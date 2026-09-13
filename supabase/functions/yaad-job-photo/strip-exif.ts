/**
 * Drop every APP1 segment from a JPEG, in Deno, over plain bytes.
 *
 * A port of stripApp1() in web/lib/exif.ts, which runs in the Next.js server
 * action a signed-in client uploads through. This function is the anonymous
 * door into the same bucket, so it needs the same guarantee in a runtime with
 * no Buffer. Same rule, same reason: EXIF, GPS and XMP all live in APP1, so
 * dropping the whole segment leaves no tag ordering, no maker note and no XMP
 * packet that could smuggle a location through.
 *
 * Why it matters more here than anywhere else in the product. This runs on a
 * photograph of a house, often an empty one, sent by somebody who is usually
 * in another country. The coordinate the phone wrote when the shutter fired is
 * the address of a property nobody is living in, and one of these photographs
 * may later be published to a public board. It does not get to carry that.
 *
 * Anything that is not a JPEG passes through untouched: PNG and WebP hold
 * their metadata in containers this does not parse, and a half-understood
 * rewrite of a file is worse than an honest pass. The caller is what limits
 * the accepted types.
 */

const SOI = 0xffd8;
const MARKER_APP1 = 0xe1;
const MARKER_SOS = 0xda;

const u16 = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];

export function stripApp1(buf: Uint8Array): Uint8Array {
  if (buf.length < 4 || u16(buf, 0) !== SOI) return buf;

  const keep: Uint8Array[] = [buf.subarray(0, 2)];
  let i = 2;
  let dropped = false;

  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    if (marker === MARKER_SOS) break; // scan data runs to the end, leave it alone
    const len = u16(buf, i + 2);
    if (len < 2 || i + 2 + len > buf.length) break;
    if (marker === MARKER_APP1) dropped = true;
    else keep.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  if (!dropped) return buf; // nothing to do, and the caller skips a re-upload

  keep.push(buf.subarray(i));
  const total = keep.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of keep) { out.set(part, at); at += part.length; }
  return out;
}

/** True when the bytes still carry an APP1 segment. Used to assert the strip. */
export function hasApp1(buf: Uint8Array): boolean {
  if (buf.length < 4 || u16(buf, 0) !== SOI) return false;
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return false;
    const marker = buf[i + 1];
    if (marker === MARKER_SOS) return false;
    const len = u16(buf, i + 2);
    if (len < 2 || i + 2 + len > buf.length) return false;
    if (marker === MARKER_APP1) return true;
    i += 2 + len;
  }
  return false;
}
