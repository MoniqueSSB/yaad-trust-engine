-- Applied to production 30 Aug 2026 via MCP as
-- the_id_check_hires_a_liveness_vendor.
--
-- Step 3 of the join flow captured a live photo and a face turn through the
-- browser, and the code was honest about its own ceiling: virtual camera
-- software can feed a recording into getUserMedia and the page cannot tell.
-- "Anything stronger is a liveness vendor." The founder bought one. Persona
-- now runs the government ID and selfie check inside the join flow, with real
-- document authenticity and liveness detection, and the ID images live with
-- Persona rather than in our vetting bucket.
--
-- What we keep is the OUTCOME, which is the same rule the bucket's purge
-- clock already follows: the decision survives, the passport does not.
--
--   persona_inquiry_id   the inquiry Persona minted for this applicant. The
--                        desk can open it in the Persona dashboard.
--   persona_status       Persona's word for where the inquiry stands, as
--                        CONFIRMED BY OUR SERVER against Persona's API, never
--                        as claimed by the browser. "unchecked" means the
--                        server had no API key to confirm with and the desk
--                        must look it up by hand.
--   persona_checked_at   when our server last asked Persona.
--
-- No constraint on persona_status beyond text: the value is Persona's
-- vocabulary, not ours, and pinning their words in a CHECK constraint means a
-- vendor renaming a status breaks our inserts.

alter table public.applications
  add column if not exists persona_inquiry_id text,
  add column if not exists persona_status text,
  add column if not exists persona_checked_at timestamptz;
