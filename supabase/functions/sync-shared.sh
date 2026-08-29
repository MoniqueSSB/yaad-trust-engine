#!/usr/bin/env bash
# Supabase deploys each Edge Function as a self-contained bundle, so the shared
# tracer has to physically exist in every function directory. Edit
# _shared/otel.ts, then run this.
set -euo pipefail
cd "$(dirname "$0")"
for d in yaad-agent yaad-vision yaad-whatsapp-webhook yaad-website-intake yaad-post-job yaad-vetting-upload yaad-vetting-purge yaad-transcribe yaad-inbound yaad-kickoff yaad-completion yaad-portal-signup yaad-enquiry; do  # yaad-match has no otel import
  cp _shared/otel.ts "$d/otel.ts"
  echo "synced -> $d/otel.ts"
done
