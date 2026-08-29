// Fails the build when the Supabase environment is missing, instead of
// shipping an app that builds cleanly and is dead on arrival.
//
// This exists because of a real outage on 28 August 2026. The whole app went
// to 500 on every page that creates a Supabase client at request time, while
// the build and the deploy both reported success. The Worker's own log said:
//
//     Your project's URL and Key are required to create a Supabase client!
//
// The cause: NEXT_PUBLIC_* values are inlined at BUILD time, they come from
// .env.local, and .env.local is gitignored. So a deploy run from a fresh git
// worktree or a fresh clone has no env file, Next inlines empty strings, and
// nothing anywhere complains. The build passes. The deploy passes. Only
// production breaks, and only on the routes that need a client.
//
// A missing value must therefore be an error on the machine doing the deploy,
// not a 500 for a client in Kingston twenty minutes later.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Load the .env files ourselves.
//
// Next.js loads these; plain `node` does not. Without this the guard fires on
// a machine that IS correctly configured, which would block every legitimate
// deploy and is a worse failure than the one it exists to prevent. Found
// exactly that way: the first version passed only because the test injected
// the variables by hand.
//
// Same precedence Next uses: a real environment variable always wins, then
// .env.local, then .env.production, then .env.
const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");

for (const file of [".env.local", ".env.production", ".env"]) {
  const path = join(webRoot, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    // Already set, by a real environment variable or by an earlier file in the
    // precedence order. Do not overwrite it.
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

const REQUIRED = [
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    valid: (v) => v.startsWith("https://") && v.includes(".supabase.co"),
    looksLike: "https://<project-ref>.supabase.co",
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    // Both key formats: the current sb_publishable_ prefix and the older JWT.
    valid: (v) => v.startsWith("sb_publishable_") || v.startsWith("eyJ"),
    looksLike: "sb_publishable_... (safe to expose; RLS is what protects the data)",
  },
];

const problems = [];

for (const { name, valid, looksLike } of REQUIRED) {
  const raw = process.env[name];
  const v = typeof raw === "string" ? raw.trim() : "";

  if (!v) {
    problems.push(`${name} is missing or empty. Expected ${looksLike}`);
  } else if (v.includes("replace_me")) {
    // .env.example is a template, not a configuration. Copying it verbatim is
    // the other way to deploy something that cannot talk to the database.
    problems.push(`${name} is still the placeholder from .env.example. Expected ${looksLike}`);
  } else if (!valid(v)) {
    problems.push(`${name} does not look right. Expected ${looksLike}`);
  }
}

// PASSING MUST BE SILENT, AND MUST RETURN.
//
// This said `process.exit(0)` here, and that one line stopped the app being
// buildable at all. next.config.ts imports this file for its side effect, so
// it runs INSIDE the Next process, not beside it. A correct environment
// therefore killed Next the instant it loaded its own config: the banner
// printed, the config was read, the process exited zero, and nothing was
// built. `next build` wrote no output and reported success. `next dev` said
// "Ready" and died. Every wrapper above it, npm, opennextjs-cloudflare, CI,
// saw exit code zero and called it a pass.
//
// The guard was exactly inverted in effect. A misconfigured machine carried on
// building, which is the thing this file exists to stop, and a correctly
// configured one could not build at all.
//
// So: a pass does nothing and lets the import finish. Only a failure exits,
// which is the only case that ever wanted to.
if (problems.length > 0) {
  const isProductionBuild = process.env.NODE_ENV === "production";
  const heading = isProductionBuild
    ? "BUILD STOPPED. The Supabase environment is not set."
    : "WARNING. The Supabase environment is not set.";

  const message = [
    "",
    "  " + heading,
    "",
    ...problems.map((p) => "    - " + p),
    "",
    "  These are inlined at BUILD time, so a build without them produces an app",
    "  that deploys successfully and then returns 500 on every page that talks to",
    "  Supabase. That has happened in production before.",
    "",
    "  Most likely cause: you are building from a git worktree or a fresh clone.",
    "  web/.env.local is gitignored, so it does not come with the checkout.",
    "",
    "  Fix: copy web/.env.local from the main checkout, or create it from",
    "  web/.env.example with the real publishable key.",
    "",
  ].join("\n");

  if (isProductionBuild) {
    console.error(message);
    process.exit(1);
  }

  console.warn(message);
}
