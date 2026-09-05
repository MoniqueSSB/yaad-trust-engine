// A new migration must be named so it sorts last.
//
// WHY THIS EXISTS. Migrations here were named with a date and a single letter,
// 20260904a, 20260904b, and so on. Parallel Claude sessions share this
// repository and cannot see each other's branches, so two sessions both take
// the next free letter and both are right at the time. On 5 September 2026
// that happened FOUR times in one day: 20260904k through n were claimed twice,
// then 20260905a and b were claimed twice more.
//
// The reason it is dangerous rather than annoying is that it does not conflict.
// The filenames differ, so git merges both sets silently into a directory whose
// entire purpose is applying things in order. Nobody sees a marker. The only
// symptom is two files sharing a prefix and an order nobody chose.
//
// THE RULE IS NOT "USE A TIMESTAMP", it is "sort last", which is the property
// that actually matters and the one a format alone does not guarantee. A
// 14-digit timestamp added today would sort BEFORE the legacy letter files of
// the same date, because '0' sorts before 'a'. Checking the real property
// catches that; checking the format would wave it through.
//
// Only newly ADDED files are checked. The 182 existing letter-named migrations
// are applied history and renaming them would be worse than the problem.

import { execFileSync } from "node:child_process";

const BASE = process.env.MIGRATION_BASE_REF || "origin/main";
const DIR = "supabase/migrations";

const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();

// Committed additions, plus anything staged or untracked. CI only ever sees
// the first kind, but a check that says "nothing to see" while the new file is
// sitting in your index is a check nobody runs before pushing, which is how it
// ends up only ever failing in CI.
let added = [];
try {
  const out = git(["diff", "--name-only", "--diff-filter=A", `${BASE}...HEAD`, "--", DIR]);
  added = out ? out.split("\n").filter(Boolean) : [];
} catch {
  console.log("No merge base to compare against; nothing to check.");
  process.exit(0);
}
try {
  const local = git(["status", "--porcelain", "--", DIR])
    .split("\n").filter(Boolean)
    .filter((l) => /^(A |\?\?|AM)/.test(l))
    .map((l) => l.slice(3).trim());
  added = [...new Set([...added, ...local])];
} catch { /* not fatal: CI path above is the one that gates */ }

if (!added.length) {
  console.log("No new migrations in this branch.");
  process.exit(0);
}

// Every migration on the base branch, which is what a new one must sort after.
const existing = git(["ls-tree", "-r", "--name-only", BASE, "--", DIR])
  .split("\n").filter((f) => f.endsWith(".sql")).map((f) => f.split("/").pop()).sort();
const last = existing[existing.length - 1] ?? "";

// A file that is already ON the base branch is not new, whatever the index
// says. Merging the base in stages every file the merge brought with it, so
// without this the check fires on somebody else's already-merged migrations
// the moment you merge main, which is exactly when a person would run it. It
// even compared the newest base migration against itself. A check that cries
// wolf is one people stop reading, which is the whole reason it exists.
const onBase = new Set(existing);
added = added.filter((p) => !onBase.has(p.split("/").pop()));

let bad = 0;
for (const path of added.sort()) {
  const name = path.split("/").pop();
  if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(name)) {
    console.error(`::error file=${path}::Name it <14-digit timestamp>_<lower_snake_name>.sql, e.g. ${stamp()}_what_it_does.sql. Single-letter suffixes collide silently between parallel sessions.`);
    bad++;
    continue;
  }
  if (name <= last) {
    console.error(`::error file=${path}::This sorts BEFORE ${last}, which is already on ${BASE}, so it would run out of order. Rename it to something that sorts last, e.g. ${stamp()}_${name.replace(/^\d+_/, "")}`);
    bad++;
  }
}

function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

if (bad) {
  console.error(`\n${bad} migration name(s) would not apply in the intended order.`);
  console.error(`Last migration already on ${BASE}: ${last}`);
  process.exit(1);
}
console.log(`${added.length} new migration(s), all sorting after ${last}.`);
