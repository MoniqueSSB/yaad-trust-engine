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
# Needs: the Supabase CLI, logged in. Same auth `supabase functions list` uses.

set -euo pipefail

PROJECT_REF="${YAAD_PROJECT_REF:-leffyisvfvjwzilydlwf}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v npx >/dev/null 2>&1 || { echo "npx not found. Install Node, then retry." >&2; exit 1; }

echo "Project: $PROJECT_REF"
echo "Branch:  $(git -C "$here" branch --show-current 2>/dev/null || echo 'not a git checkout')"
echo

live_json="$(npx --yes supabase functions list --project-ref "$PROJECT_REF" 2>/dev/null)" || {
  echo "Could not reach Supabase. Are you logged in? Try: npx supabase login" >&2
  exit 1
}

# The CLI prints an upgrade notice after the JSON, so take the object only.
parse() {
  python3 -c '
import sys, json
raw = sys.stdin.read()
d = json.loads(raw[raw.find("{"):raw.rfind("}") + 1])
mode = sys.argv[1]
for f in sorted(d["functions"], key=lambda x: x["slug"]):
    if mode == "slugs":
        print(f["slug"])
    elif mode == "open" and not f["verify_jwt"]:
        print(f["slug"])
' "$1"
}

printf '%s\n' "$live_json" | parse slugs > /tmp/yaad_live_fns.$$
ls -d "$here"/supabase/functions/yaad-* 2>/dev/null | sed 's|.*/||' | sort > /tmp/yaad_repo_fns.$$

drift=0

echo "== Deployed, but no source on this branch =="
if out=$(comm -13 /tmp/yaad_repo_fns.$$ /tmp/yaad_live_fns.$$) && [ -n "$out" ]; then
  echo "$out" | sed 's/^/  /'
  echo "  (check other branches before assuming it is orphaned: git log --all -- supabase/functions/<name>)"
  drift=1
else
  echo "  none"
fi
echo

echo "== On this branch, but not deployed =="
if out=$(comm -23 /tmp/yaad_repo_fns.$$ /tmp/yaad_live_fns.$$) && [ -n "$out" ]; then
  echo "$out" | sed 's/^/  /'
  drift=1
else
  echo "  none"
fi
echo

echo "== Running WITHOUT platform auth (verify_jwt false) =="
echo "   Compare against the list in CLAUDE.md 12. Each one needs --no-verify-jwt"
echo "   preserved on every redeploy, or it silently gains a token check."
printf '%s\n' "$live_json" | parse open | sed 's/^/  /'
echo

rm -f /tmp/yaad_live_fns.$$ /tmp/yaad_repo_fns.$$

if [ "$drift" -eq 1 ]; then
  echo "Drift found. Nothing has been changed: read the notes above and decide."
else
  echo "No drift. Deployed and this branch agree."
fi
