#!/usr/bin/env bash
# Supabase deploys each Edge Function as a self-contained bundle, so a shared
# module has to physically exist in every function directory that imports it.
# Edit the file in _shared/, then run this.
#
# Import driven rather than list driven. The old version carried a hand-kept
# list of directories for otel.ts, which meant adding a second shared file
# meant a second list to forget to update. Now: if a function imports
# ./<name>.ts and _shared/<name>.ts exists, it gets a copy. If it stops
# importing it, the stale copy is removed. CI enforces exactly the same rule,
# so a green run here means a green run there.
set -euo pipefail
cd "$(dirname "$0")"

changed=0

for shared in _shared/*.ts; do
  name="$(basename "$shared")"
  for d in yaad-*/; do
    d="${d%/}"
    [ -f "$d/index.ts" ] || continue

    if grep -q "from \"./$name\"" "$d/index.ts"; then
      if ! cmp -s "$shared" "$d/$name"; then
        cp "$shared" "$d/$name"
        echo "synced   -> $d/$name"
        changed=1
      fi
    elif [ -f "$d/$name" ]; then
      rm "$d/$name"
      echo "removed  -> $d/$name (nothing imports it)"
      changed=1
    fi
  done
done

[ "$changed" -eq 0 ] && echo "Everything already in sync."
exit 0
