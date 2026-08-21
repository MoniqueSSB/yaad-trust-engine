#!/usr/bin/env bash
#
# Yaadly database backup.
#
# Why this exists: the Supabase free tier has no daily backups and no
# point-in-time recovery. This database holds client names, phone numbers,
# property addresses, photographs of people's homes, worker government photo
# ID, proof of address, and JCF police record checks. Running that with no
# restore path is not a saving, it is an exposure. Until Pro is affordable,
# this is the restore path.
#
# The dump is written OUTSIDE any git repository, on purpose. A database dump
# in a repo, or in a CI artifact on a public repo, is downloadable by anyone.
# The script refuses to write into a git working tree, and refuses to run if
# the destination looks public.
#
# SETUP, once:
#
#   1. Install the Postgres client tools (macOS):
#        brew install libpq && brew link --force libpq
#      Check with: pg_dump --version
#
#   2. Get the connection string:
#        Supabase dashboard -> Project Settings -> Database -> Connection string
#        -> URI. Use the "Session pooler" URI. Replace [YOUR-PASSWORD] with the
#        database password.
#
#   3. Put it in a private config file that lives outside this repo:
#        mkdir -p ~/.yaadly && touch ~/.yaadly/backup.env
#        chmod 600 ~/.yaadly/backup.env
#      Then add ONE line to that file:
#        SUPABASE_DB_URL="postgresql://postgres.xxxx:PASSWORD@aws-0-eu-west-3.pooler.supabase.com:5432/postgres"
#
#      Never paste that password into a chat window, a commit, or this file.
#
# USE:
#   ./scripts/backup-db.sh              # normal backup
#   ./scripts/backup-db.sh --check      # verify setup, take no backup
#
set -euo pipefail

CONFIG="${YAADLY_BACKUP_CONFIG:-$HOME/.yaadly/backup.env}"
DEST_DEFAULT="$HOME/Yaadly Backups"
KEEP=14
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

red()  { printf "\033[31m%s\033[0m\n" "$*"; }
grn()  { printf "\033[32m%s\033[0m\n" "$*"; }
warn() { printf "\033[33m%s\033[0m\n" "$*"; }

fail() { red "FAILED: $*"; exit 1; }

# ---------------------------------------------------------------- preflight
command -v pg_dump >/dev/null 2>&1 || fail "pg_dump not found.
  macOS:  brew install libpq && brew link --force libpq
  Then reopen the terminal and check: pg_dump --version"

if [ ! -f "$CONFIG" ]; then
  fail "No config at $CONFIG
  Create it with:
    mkdir -p \"\$(dirname \"$CONFIG\")\" && touch \"$CONFIG\" && chmod 600 \"$CONFIG\"
  Then add one line:
    SUPABASE_DB_URL=\"postgresql://...\"
  See the setup notes at the top of this script."
fi

# Refuse a world-readable config holding a database password.
# stat is not portable: GNU takes -c, BSD/macOS takes -f, and on Linux the BSD
# form is "filesystem status" and prints a wall of unrelated text rather than
# failing. So validate that what came back is actually an octal mode.
octal_mode() {
  local m
  m=$(stat -c "%a" "$1" 2>/dev/null || true)
  printf '%s' "$m" | grep -qE '^[0-7]{3,4}$' && { printf '%s' "$m"; return 0; }
  m=$(stat -f "%Lp" "$1" 2>/dev/null || true)
  printf '%s' "$m" | grep -qE '^[0-7]{3,4}$' && { printf '%s' "$m"; return 0; }
  return 1
}
perms="$(octal_mode "$CONFIG" || true)"
case "$perms" in
  600|400|0600|0400) ;;
  "") warn "Could not read the file mode of $CONFIG. Check it is not world-readable." ;;
  *) fail "$CONFIG is mode $perms, which other accounts on this machine can read.
  It holds your database password. Fix with: chmod 600 \"$CONFIG\"" ;;
esac

# shellcheck disable=SC1090
set +u; . "$CONFIG"; set -u
[ -n "${SUPABASE_DB_URL:-}" ] || fail "SUPABASE_DB_URL is not set inside $CONFIG"

DEST="${YAADLY_BACKUP_DIR:-$DEST_DEFAULT}"

# --------------------------------------------------- destination safety net
# A dump of this database must never land somewhere that gets published.
probe="$DEST"
while [ "$probe" != "/" ] && [ -n "$probe" ]; do
  if [ -d "$probe/.git" ]; then
    fail "Refusing to write backups into a git repository ($probe).
  A database dump committed or pushed would publish client addresses and worker
  ID documents. Choose a destination outside any repo, or set YAADLY_BACKUP_DIR."
  fi
  probe="$(dirname "$probe")"
done
case "$DEST" in
  */Dropbox/*|*/Google\ Drive/*|*/OneDrive/*|*/iCloud*)
    warn "Destination is inside a cloud-sync folder. The dump will be uploaded to that
provider. That may be what you want as offsite storage, but know that it is happening." ;;
esac

mkdir -p "$DEST"
chmod 700 "$DEST" 2>/dev/null || true

if [ "$CHECK_ONLY" = "1" ]; then
  grn "Setup looks correct."
  echo "  pg_dump:     $(pg_dump --version)"
  echo "  config:      $CONFIG (mode $perms)"
  echo "  destination: $DEST"
  exit 0
fi

# ------------------------------------------------------------------- backup
STAMP="$(date +%Y-%m-%d_%H%M)"
OUT="$DEST/yaadly_${STAMP}.sql.gz"
# mktemp -t means different things on macOS and GNU. An explicit template works on both.
TMP="$(mktemp "${TMPDIR:-/tmp}/yaadly_dump.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

echo "Dumping public and auth schemas..."
# --no-owner / --no-privileges: Supabase manages roles, and a restore into a
# fresh project must not try to recreate them.
if ! pg_dump "$SUPABASE_DB_URL" \
      --schema=public --schema=auth \
      --no-owner --no-privileges \
      --quote-all-identifiers \
      -f "$TMP" 2>"$TMP.err"; then
  # Never echo the URL: it contains the password.
  red "pg_dump failed. Error output:"
  sed -E 's#postgres(ql)?://[^ ]*#postgresql://[REDACTED]#g' "$TMP.err" >&2
  rm -f "$TMP.err"
  exit 1
fi
rm -f "$TMP.err"

# ------------------------------------------------------- verify, then keep
# A backup nobody has verified is not a backup. Check the dump actually
# contains the tables that matter before trusting it.
missing=""
for t in jobs applications evidence admins; do
  grep -q "CREATE TABLE .*\"$t\"" "$TMP" || missing="$missing $t"
done
[ -z "$missing" ] || fail "Dump is missing expected tables:$missing
  Nothing has been saved. Check the connection string points at the right project."

lines=$(wc -l < "$TMP" | tr -d ' ')
[ "$lines" -gt 50 ] || fail "Dump is only $lines lines, which is too small to be real. Nothing saved."

gzip -c "$TMP" > "$OUT"
chmod 600 "$OUT"

size=$(du -h "$OUT" | cut -f1)
grn "Saved $OUT ($size, $lines lines before compression)"

# ---------------------------------------------------------------- retention
count=$(ls -1 "$DEST"/yaadly_*.sql.gz 2>/dev/null | wc -l | tr -d ' ')
if [ "$count" -gt "$KEEP" ]; then
  ls -1t "$DEST"/yaadly_*.sql.gz | tail -n +$((KEEP+1)) | while read -r old; do
    rm -f "$old" && echo "Pruned $(basename "$old")"
  done
fi

echo
echo "Backups held: $(ls -1 "$DEST"/yaadly_*.sql.gz | wc -l | tr -d ' ') (keeping the newest $KEEP)"
echo
echo "To restore into a fresh Supabase project:"
echo "  gunzip -c \"$OUT\" | psql \"<new-project-connection-string>\""
echo
warn "Untested restores are folklore. Restore one of these into a throwaway"
warn "Supabase project once, before you ever need it in anger."
