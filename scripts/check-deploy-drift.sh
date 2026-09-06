#!/usr/bin/env bash
#
# What is deployed, versus what is in this repository.
#
# Why this exists: Edge Functions are deployed BY HAND (CLAUDE.md 12), from
# whichever branch somebody happened to be on, and parallel Claude sessions
# share this working tree. Nothing anywhere reconciles the two. On 4 Sep 2026
# a live check found five functions out of step in both directions at once,
# including one deployed to production from a branch that had not been
# merged. None of it was broken. All of it was invisible.
#
# It also prints the verify_jwt state, because CLAUDE.md 12 carries a written
# list of the endpoints running without platform auth and warns, correctly,
# that the list is the control and the control goes stale. On 3 Sep 2026 that
# list named four when ten were live. Reading it should be one command, not a
# careful manual comparison somebody does once and then trusts for a month.
#
# This is a READ ONLY script. It deploys nothing and deletes nothing. Both of
# those are decisions, not chores: a function on main that is not deployed may
# be waiting deliberately, and deleting a deployed function is not reversible.
#
# Run:  scripts/check-deploy-drift.sh
# Needs: the Supabase CLI, authenticated. Run `npx supabase login` once, or
#        export SUPABASE_ACCESS_TOKEN.
#
# ON ERRORS. The first version of this script hid the CLI's stderr and then
# guessed at the cause, so an unauthenticated run produced a Python traceback
# about empty JSON, and a malformed project ref produced the confident and
# wrong sentence "most likely you are not logged in". It now prints what the
# CLI actually said and offers login as a possibility, not a diagnosis.
# Guessing at somebody else's error is worse than showing it to them.

set -euo pipefail

PROJECT_REF="${YAAD_PROJECT_REF:-leffyisvfvjwzilydlwf}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

command -v npx >/dev/null 2>&1 || { echo "npx not found. Install Node, then retry." >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 not found." >&2; exit 1; }

echo "Project: $PROJECT_REF"
echo "Branch:  $(git -C "$here" branch --show-current 2>/dev/null || echo 'not a git checkout')"
echo

# stdout and stderr kept apart, and both kept. `|| rc=$?` rather than a bare
# call so `set -e` does not kill us before the diagnosis can run.
rc=0
npx --yes supabase functions list --project-ref "$PROJECT_REF" \
  >"$tmp/out" 2>"$tmp/err" || rc=$?

read_list() {
  python3 - "$1" "$tmp/out" "$tmp/err" "$rc" <<'PYEOF'
import json, sys

mode, out_path, err_path, rc = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
out = open(out_path).read().strip()
err = open(err_path).read().strip()

def die(*lines):
    for line in lines:
        print(line, file=sys.stderr)
    print("", file=sys.stderr)
    print("If that reads like an authorisation problem, the fix is one of:", file=sys.stderr)
    print("  npx supabase login", file=sys.stderr)
    print("  export SUPABASE_ACCESS_TOKEN=sbp_...   (Supabase, Account, Access Tokens)", file=sys.stderr)
    sys.exit(1)

doc = None
if out:
    try:
        doc = json.loads(out[out.find("{"):out.rfind("}") + 1])
    except Exception:
        doc = None

if isinstance(doc, dict) and "functions" in doc:
    for f in sorted(doc["functions"], key=lambda x: x["slug"]):
        if mode == "slugs":
            print(f["slug"])
        elif mode == "open" and not f.get("verify_jwt", True):
            print(f["slug"])
    sys.exit(0)

print("Could not read the deployed function list.", file=sys.stderr)
print("", file=sys.stderr)
if isinstance(doc, dict) and isinstance(doc.get("error"), dict):
    e = doc["error"]
    die("The Supabase CLI returned an error:",
        "  %s" % e.get("message", "(no message)"),
        "  code: %s" % e.get("code", "(none)"))
if err:
    die("The Supabase CLI said:", *["  " + l for l in err.splitlines()[:20]])
if out:
    die("It returned this, which is not a function list:", *["  " + l for l in out.splitlines()[:10]])
die("  It returned nothing at all (exit %s)." % rc)
PYEOF
}

read_list slugs >"$tmp/live"
ls -d "$here"/supabase/functions/yaad-* 2>/dev/null | sed 's|.*/||' | sort >"$tmp/repo"

drift=0

echo "== Deployed, but no source on this branch =="
if out="$(comm -13 "$tmp/repo" "$tmp/live")" && [ -n "$out" ]; then
  echo "$out" | sed 's/^/  /'
  echo "  (check other branches before assuming it is orphaned: git log --all -- supabase/functions/<name>)"
  drift=1
else
  echo "  none"
fi
echo

echo "== On this branch, but not deployed =="
if out="$(comm -23 "$tmp/repo" "$tmp/live")" && [ -n "$out" ]; then
  echo "$out" | sed 's/^/  /'
  drift=1
else
  echo "  none"
fi
echo

echo "== Running WITHOUT platform auth (verify_jwt false) =="
echo "   Compare against the list in CLAUDE.md 12. Each one needs --no-verify-jwt"
echo "   preserved on every redeploy, or it silently gains a token check."
read_list open | sed 's/^/  /'
echo

if [ "$drift" -eq 1 ]; then
  echo "Drift found. Nothing has been changed: read the notes above and decide."
else
  echo "No drift. Deployed and this branch agree."
fi
