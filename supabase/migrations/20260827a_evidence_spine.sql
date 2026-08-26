-- Applied to production 27 Aug 2026 via MCP (evidence_spine).
-- PORTAL-SPEC 5.2 and 5.3: sha256 computed server-side at upload, stored
-- on the row, never recomputed on read. stage groups evidence under the
-- ledger.
alter table public.evidence
  add column if not exists sha256 text,
  add column if not exists stage int;
