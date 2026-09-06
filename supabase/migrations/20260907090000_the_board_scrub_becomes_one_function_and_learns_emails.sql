-- The public board's description scrub, in one place, and wider than it was.
--
-- ── What was wrong ─────────────────────────────────────────────────────────
--
-- open_jobs has masked descr since 20260826f. The expression was copied into
-- my_requested_jobs (20260905a) and again, in JavaScript, into
-- web/components/portal/BoardPreview.tsx, which is the card a client is shown
-- before they publish. Three copies of one rule, and the rule had holes:
--
--   1. It matched "Address:" and "Access contact:". A plain "Access:" line
--      matched neither, and "Access:" is exactly what yaad-inbound writes
--      (index.ts, the access_note line). So on 6 September 2026 the live board
--      carried "Access: Cousin Andre has key, [contact removed]. Mother is 74
--      and lives there, contact before arriving so she knows who is coming."
--
--   2. There was no email pattern at all. Only phone numbers were masked. The
--      same three live jobs carried two of the client's email addresses and
--      her full name, in the "In their own words" block, on a view granted to
--      anon. BoardPreview tells that client, in as many words, "Your name and
--      your email. A worker sees a job and a job number, not a person." That
--      sentence was false when it was shown to her.
--
--   3. The "Arrived by whatsapp from +447767171858, over 4 messages" line is a
--      desk artefact and always carries the channel identifier it names.
--
-- The 260 character truncation on the job card is not a control. open_jobs is
-- granted to anon and returns the whole column, so anybody with the
-- publishable key reads all of it without opening the page. CLAUDE.md §6.
--
-- ── What this does NOT do ──────────────────────────────────────────────────
--
-- It does not touch the "In their own words:" block itself, which is the raw
-- intake message and is where most of this ended up. That block is genuinely
-- useful to a worker pricing the job and removing it changes what the board
-- is, so it is a product decision and it is Monique's. This migration masks
-- identifiers. It does not decide how much raw intake belongs on a public
-- board. Same for the bracketed desk notes ("[No email yet. Reply on the same
-- channel...]"), which are internal but carry no identifier once the email
-- pattern below has run.
--
-- ── One definition ─────────────────────────────────────────────────────────
--
-- Both views call board_descr() now instead of carrying their own copy, and
-- BoardPreview.tsx no longer carries a JavaScript spelling of it at all: the
-- client portal calls this function through rpc and renders what comes back.
-- That is the actual repair. The reason hole 1 survived from 26 August to 6
-- September is that fixing it meant finding three identical expressions, and
-- a mirror cannot catch a rule that is wrong in the original.

-- ── WHAT WAS ACTUALLY APPLIED TO PRODUCTION, 7 September 2026 ──────────────
--
-- Not this file, quite. Applying it failed on `column j.request_state does not
-- exist`, which is how it came out that **20260905a has never been applied to
-- this project**: production has no request_state, no requested_at, no
-- requested_worker_email and no my_requested_jobs view at all, and its
-- open_jobs is still the 20260828c definition with no first-refusal clause.
-- The named-worker feature is in the repo and is not live. (web/app/jobs/page.tsx
-- fails soft on it: the my_requested_jobs query returns null and the band
-- renders nothing, which is why nobody noticed.)
--
-- So what went to production was this migration MINUS the first-refusal clause
-- and minus my_requested_jobs: the function, and open_jobs redefined on its own
-- live shape. Shipping 20260905a is a feature release and it was not this
-- change's to make.
--
-- ⚠ THE TRAP THIS LEAVES. Production's migration history now records this
-- version as applied. 20260905a is still pending, and it redefines open_jobs
-- WITHOUT board_descr. If it is applied on its own, the leak comes back
-- silently and this migration will NOT re-run to undo it, because its name is
-- already in the history table. **Applying 20260905a means re-applying the
-- open_jobs definition below in the same sitting.** The same warning is on the
-- open_jobs comment in the database itself, where somebody investigating that
-- view will actually meet it, and in RUNBOOK.md.
--
-- The file below is left as the repo's correct state, where 20260905a precedes
-- it and a clean ordered apply produces the right thing.

create or replace function public.board_descr(
  p_descr text,
  p_client_name text,
  p_client_email text,
  p_client_phone text
) returns text
language sql
immutable
as $$
  select nullif(btrim(
    -- 7. blank lines left behind by the strips above collapse. This runs
    --    last, after the trailing-whitespace trim below it, because a line
    --    reduced to spaces is not a bare newline and would survive it.
    regexp_replace(
      -- 6. trailing whitespace before a newline
      regexp_replace(
        -- 5. anything shaped like a phone number
        regexp_replace(
          -- 4. anything shaped like an email address. NEW.
          regexp_replace(
            -- 3. the desk's provenance line. NEW.
            regexp_replace(
              -- 2. labelled Address / Access lines. WIDENED: "Access:",
              --    "Access contact:", "Access note:", "Access to the back
              --    gate:". Up to three words after "Access" so that an
              --    ordinary sentence beginning "Access is via the lane" is
              --    left alone, and "Accessible bathroom:" is not caught
              --    because the alternation needs a space before each word.
              regexp_replace(
                -- 1. the client's own identifiers, by direct substitution,
                --    because a name cannot be found with a pattern. chr(1)
                --    stands in when a column is null or blank: it cannot
                --    occur in a description, so the replace is a no-op
                --    rather than replace(x, null, y), which returns null and
                --    would blank the whole description.
                replace(
                  replace(
                    replace(
                      coalesce(p_descr, ''),
                      coalesce(nullif(btrim(coalesce(p_client_email, '')), ''), chr(1)),
                      '[contact removed]'),
                    coalesce(nullif(btrim(coalesce(p_client_phone, '')), ''), chr(1)),
                    '[contact removed]'),
                  -- three characters minimum: a one or two letter name would
                  -- match inside ordinary words and shred the description.
                  coalesce(nullif(btrim(coalesce(p_client_name, '')), ''), chr(1)),
                  case when length(btrim(coalesce(p_client_name, ''))) >= 3
                       then '[name removed]' else chr(1) end),
                '(^|\n)\s*(Address|Access( +[a-z]+){0,3})\s*:[^\n]*', '\1', 'gi'),
              '(^|\n)\s*Arrived by [^\n]*', '\1', 'gi'),
            '[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}', '[contact removed]', 'g'),
          '\+?[0-9][0-9\s().-]{7,}[0-9]', '[contact removed]', 'g'),
        '[ \t]+\n', '\n', 'g'),
      '\n{3,}', '\n\n', 'g')
  ), '')
$$;

comment on function public.board_descr(text, text, text, text) is
  'The one description scrub for the public board. Strips Address and Access lines and the desk provenance line, substitutes the job''s own client name, email and phone, masks any other email address or phone number, and tidies the whitespace left behind. open_jobs and my_requested_jobs both call it, and the client portal calls it through rpc to render the board preview, so there is no second copy of these patterns anywhere.';

grant execute on function public.board_descr(text, text, text, text) to anon, authenticated, service_role;

-- ── the two views, same columns in the same order as 20260905a ─────────────

create or replace view public.open_jobs as
 SELECT j.id, j.title, j.parish,
    public.board_descr(j.descr, j.client_name, j.client_email, j.client_phone) AS descr,
    j.updated_at,
    cp.user_id IS NOT NULL AS client_signed,
    COALESCE(cp.jobs_completed, 0) AS client_jobs_completed,
    j.trade, j.job_type, j.size_band, j.access_type, j.materials_by, j.urgency,
    j.materials_store_type
   FROM jobs j
     LEFT JOIN client_profiles cp ON lower(cp.email) = lower(COALESCE(j.client_email, ''::text))
  WHERE j.open = true AND COALESCE(j.worker_email, ''::text) = ''::text AND j.stage = 0
    AND NOT public.request_is_live(j.request_state, j.requested_at);

create or replace view public.my_requested_jobs as
  SELECT j.id, j.title, j.parish,
    public.board_descr(j.descr, j.client_name, j.client_email, j.client_phone) AS descr,
    j.updated_at,
    j.trade, j.job_type, j.size_band, j.access_type, j.materials_by, j.urgency,
    j.materials_store_type,
    j.requested_at,
    j.requested_at + interval '48 hours' AS holds_until
  FROM jobs j
  WHERE j.open = true
    AND COALESCE(j.worker_email, ''::text) = ''::text
    AND j.stage = 0
    AND public.request_is_live(j.request_state, j.requested_at)
    AND lower(COALESCE(j.requested_worker_email, '')) = lower(COALESCE(auth.jwt() ->> 'email', ''));

-- my_requested_jobs is not granted to anon, and must not become so here:
-- there is no such thing as an anonymous requested worker. Same grants as
-- 20260905a, restated because create or replace view does not preserve them
-- when the column list is rewritten.
revoke all on public.my_requested_jobs from public, anon, authenticated;
grant select on public.my_requested_jobs to authenticated;

comment on view public.my_requested_jobs is
  'Jobs a client asked this signed-in worker for by name, still inside the 48 hour first-refusal window. Same masking as open_jobs, via board_descr(): no address, no access line, no name, no phone number, no email. Read only.';

comment on view public.open_jobs is
  'The public job board. Masked through board_descr(); granted to anon, so treat every column here as published.';
