#!/usr/bin/env node
/* The banned-language sweep for PAGE COPY, run in CI.
 *
 * Why this exists. CLAUDE.md section 8 says guardrails.scan catches banned
 * language in engine output but does not read page copy, so the rule applies
 * to whoever writes the page. That worked for the marketing site, which was
 * swept by hand, and did not work for the admin desk, which was not: from
 * 3 to 19 September 2026 the Money view said "Holding goes live once PI
 * insurance is in force", two weeks after Yaadly stopped holding anybody's
 * money and became the principal contractor. Not one word in that sentence is
 * banned, which is exactly the failure mode section 8 warns about, so only a
 * phrase check finds it.
 *
 * Deliberately narrow, for the reason written over the desk job in ci.yml: a
 * job that cries wolf gets switched off. Exact phrases from
 * docs/COPY-GUIDELINES.md section 6, nothing inferred, and only files that are
 * page copy end to end. web/ and supabase/ are left alone on purpose: they
 * carry source comments that discuss these phrases in order to ban them, and
 * they have their own guardrail test suites.
 *
 * Run: node scripts/check-copy.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Phrases nobody may write, anywhere in the files below. Lower case; the file
// is lower cased before matching.
const BANNED = [
  "held in escrow",
  "escrow account",
  "held safely with a licensed provider",
  "holding goes live",
  "holding starts",
  "holds no money",
  "holds none of the money",
  "holds none of your money",
  "holds none of it",
  "money is held",
  "is held by yaadly",
  "you release the funds",
  "release the funds",
  "nobody is paid until you sign off",
  "nobody's paid until you sign off",
  "you pay your contractor directly",
  "your contractor stays yours",
  "sells the eyes",
  "removes all fraud",
  "zero fraud",
  "risk free",
  "fully protected",
];

// The word on its own. docs/ may answer the worry head on, and only that way:
// see the deliberate asymmetry in docs/COPY-GUIDELINES.md section 2. The desk
// and the prototype may not say it at all.
const ESCROW_OK = "does not operate an escrow service";

const TARGETS = ["concierge", "docs", "preview"];
const SKIP_FILES = new Set(["docs/COPY-GUIDELINES.md"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(html|md)$/i.test(name)) out.push(p);
  }
  return out;
}

const problems = [];
for (const t of TARGETS) {
  let files = [];
  try { files = walk(t); } catch { continue; }   // a missing folder is not a failure
  for (const file of files) {
    if (SKIP_FILES.has(file)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      const low = line.toLowerCase();
      for (const b of BANNED) {
        if (low.includes(b)) problems.push({ file, n: i + 1, found: b, line: line.trim().slice(0, 160) });
      }
      if (low.includes("escrow") && !low.includes(ESCROW_OK)) {
        // docs may carry the sanctioned denial; anything else, including the
        // bare word inside a longer sentence, is a finding.
        problems.push({ file, n: i + 1, found: "escrow", line: line.trim().slice(0, 160) });
      }
    });
  }
}

if (!problems.length) {
  console.log("Page copy is clean: no banned phrase in " + TARGETS.join(", ") + ".");
  process.exit(0);
}

console.error("Banned language in page copy. See docs/COPY-GUIDELINES.md section 6.\n");
for (const p of problems) console.error(`  ${p.file}:${p.n}  "${p.found}"\n    ${p.line}\n`);
console.error("The copy is wrong, never this list. If a phrase here is genuinely fine,");
console.error("say so to Monique and change COPY-GUIDELINES and this script together.");
process.exit(1);
