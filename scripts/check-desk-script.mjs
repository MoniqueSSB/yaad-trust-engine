// The admin desk is one HTML file with one very large inline script, and until
// 5 September 2026 nothing in CI read a line of it.
//
// That is not a tidiness point. Twice now the same bug class has shipped from
// this file: the 17-18 August temporal dead zone that broke admin sign-in on a
// direct link, and a second one found on 5 September where three consts were
// declared below the tile that read them, so loadOverview() threw
// "Cannot access 'owedOldest' before initialization" and rendered 13 tiles
// instead of 29. Everything after that point was lost, including the whole
// "what needs me today" alert list. Both were found by a person walking into
// them. Neither would have survived one lint run.
//
// So: pull the inline script out of concierge.html and lint it, with
// no-use-before-define as the rule that actually matters. The extraction keeps
// line numbers aligned with the original file by replacing everything outside
// the script with blank lines, so an error points at the real line in
// concierge.html rather than at an offset nobody can find.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// ESLint lives in web/node_modules, which is the only place this repository
// installs anything. Resolved explicitly rather than by moving this script
// under web/, because it lints the desk and the desk is not part of the app.
const require = createRequire(new URL("../web/package.json", import.meta.url));
const { ESLint } = require("eslint");

const SOURCE = "concierge/concierge.html";
const html = readFileSync(SOURCE, "utf8");

// Every inline <script> without a src. Keep the outside as blank lines.
const lines = html.split("\n");
const keep = new Array(lines.length).fill("");
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let m, found = 0;
while ((m = re.exec(html)) !== null) {
  if (/\bsrc\s*=/i.test(m[1])) continue;
  if (/\btype\s*=\s*["'](?!text\/javascript|module)/i.test(m[1])) continue;
  found++;
  const startLine = html.slice(0, m.index + m[0].indexOf(">") + 1).split("\n").length - 1;
  const body = m[2].split("\n");
  // First body line shares the <script> line, so it starts one line later.
  for (let i = 1; i < body.length; i++) keep[startLine + i] = body[i];
}

if (!found) {
  console.error(`::error file=${SOURCE}::No inline script found. If the desk was restructured, update scripts/check-desk-script.mjs rather than deleting this job.`);
  process.exit(1);
}

// A reference is a dead zone read when it sits in the same scope as the
// let/const that declares it and appears before that declaration. Nested
// functions are excluded by the scope comparison, which is the whole point:
// they run later, after the binding is initialised.
const deskPlugin = {
  rules: {
    "no-dead-zone-read": {
      meta: { type: "problem", schema: [] },
      create(context) {
        return {
          "Program:exit"(node) {
            const sc = context.sourceCode ?? context.getSourceCode();
            const visit = (scope) => {
              for (const variable of scope.variables) {
                const def = variable.defs[0];
                if (!def || def.type !== "Variable") continue;
                if (def.parent.kind !== "const" && def.parent.kind !== "let") continue;
                const declAt = def.name.range[0];
                for (const ref of variable.references) {
                  if (ref.from !== variable.scope) continue;      // nested function, runs later
                  if (ref.identifier.range[0] >= declAt) continue; // after the declaration
                  context.report({
                    node: ref.identifier,
                    message: `'${variable.name}' is read here but '${def.parent.kind} ${variable.name}' is not declared until line ${sc.getLocFromIndex(declAt).line}. A ${def.parent.kind} is not hoisted, so this throws.`,
                  });
                }
              }
              scope.childScopes.forEach(visit);
            };
            visit(sc.getScope(node));
          },
        };
      },
    },
  },
};

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: { window: "readonly", document: "readonly", console: "readonly",
                 fetch: "readonly", location: "readonly", localStorage: "readonly",
                 sessionStorage: "readonly", setTimeout: "readonly", clearTimeout: "readonly",
                 setInterval: "readonly", clearInterval: "readonly", supabase: "readonly",
                 navigator: "readonly", alert: "readonly", confirm: "readonly",
                 prompt: "readonly", crypto: "readonly", URL: "readonly", Blob: "readonly",
                 FormData: "readonly", FileReader: "readonly", Image: "readonly",
                 requestAnimationFrame: "readonly", matchMedia: "readonly",
                 getComputedStyle: "readonly", history: "readonly", CustomEvent: "readonly",
                 AbortController: "readonly", TextDecoder: "readonly", TextEncoder: "readonly",
                 btoa: "readonly", atob: "readonly", structuredClone: "readonly" },
    },
    // ONE rule, and a custom one, because the stock rule is wrong for this
    // file. no-use-before-define flags any reference that appears textually
    // before its declaration, including one inside a function body that only
    // runs later. On this file that is 17 findings, every one of them safe:
    // `tile`, `sb`, `ROWS`, `currentView` are all read inside functions called
    // long after the module has finished initialising. A check that fires 17
    // times on correct code gets switched off within a week, which is the same
    // reasoning the secrets scanner's own comment gives for filtering
    // documentation placeholders.
    //
    // What actually breaks the desk is narrower and provable: a reference in
    // the SAME scope as the declaration, textually before it. That is a
    // temporal dead zone read, it throws whenever that line runs, and it is
    // exactly the shape of both crashes this file has shipped.
    plugins: { desk: deskPlugin },
    rules: { "desk/no-dead-zone-read": "error" },
  },
});

// lintText rather than lintFiles: ESLint 9 refuses a file outside the config's
// base path, and the extracted script is not a real file on disk anyway.
const results = await eslint.lintText(keep.join("\n"), { filePath: "desk.js" });
let problems = 0;
for (const r of results) {
  for (const msg of r.messages) {
    problems++;
    console.error(`::error file=${SOURCE},line=${msg.line}::${msg.message} (${msg.ruleId ?? "parse error"})`);
    console.error(`  ${SOURCE}:${msg.line}  ${msg.message}`);
  }
}

if (problems) {
  console.error(`\n${problems} problem(s) in the desk's inline script.`);
  console.error("A const is not hoisted. Move the declaration above its first use; do not disable the rule.");
  process.exit(1);
}
console.log(`Desk inline script is clean (${found} script block(s), no use-before-define).`);
