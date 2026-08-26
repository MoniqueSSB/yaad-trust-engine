/**
 * The contact scrub, PORTAL-SPEC 5.4, regex set verbatim. Runs before
 * insert AND before render: a message that slipped into the table by any
 * other path still cannot show a phone number.
 */
const RX: [RegExp, string][] = [
  [/\b[\w.+%-]+\s*(?:@|\(at\)|\sat\s)\s*[\w-]+\s*(?:\.|\sdot\s)\s*[\w.]{2,}\b/gi, "email"],
  [/(\+?\d[\d\s().\-]{6,}\d)/g, "number"],
  [/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|oh)\b(?:[\s,-]+\b(?:zero|one|two|three|four|five|six|seven|eight|nine|oh)\b){4,}/gi, "spelled-out number"],
  [/\b(whats\s?app|whatsapp|telegram|instagram|messenger|signal|gmail|hotmail|yahoo)\b/gi, "off-platform app"],
  [/\b(cash\s+in\s+hand|pay\s+me\s+direct(?:ly)?|off\s+the\s+(?:app|site|platform))\b/gi, "off-platform payment"],
  [/@[A-Za-z0-9_.]{3,}/g, "handle"],
];

export function scrub(text: string): { clean: string; hits: string[] } {
  const hits: string[] = [];
  let clean = text;
  for (const [re, label] of RX) {
    clean = clean.replace(re, () => {
      if (!hits.includes(label)) hits.push(label);
      return "[removed]";
    });
  }
  return { clean, hits };
}
