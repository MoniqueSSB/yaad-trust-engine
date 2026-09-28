-- A typed note is not an unprinted file.
--
-- Founder, 28 Sep 2026, on the desk's "No print: 1 sign-off is not bound to
-- the exact files": "keeps raising issues". The one sign-off was stage 1 of a
-- test job whose five photographs were all fingerprinted; the sixth item was
-- a worker's typed WhatsApp update, "report", which has no file at all.
-- Typed WhatsApp updates were filed with no fingerprint (fixed in yaad-inbound
-- the same day, which now prints the words the way the portal always has), and
-- because the count is all time, one such note kept the warning up for good.
--
-- evidence_at_signoff.fingerprinted now counts an item as bound when it
-- carries a fingerprint, OR when the evidence row it was snapshotted from has
-- no file at all (no storage_path, no img): a typed note, which the warning's
-- own words, "not bound to the exact files", were never about. A photograph or
-- video without a fingerprint still counts against it, and so does an item
-- whose evidence row can no longer be found.
--
-- Nothing in stage_approvals is changed: the snapshot is the record of what
-- was in front of the person who approved, and it is not edited after the
-- fact. Only the reading of it changes. Every other column is as live on
-- 28 Sep 2026.

create or replace view public.evidence_at_signoff as
 SELECT job_id,
    stage,
    approved_at,
    approved_by,
    confirmed_method,
        CASE
            WHEN jsonb_typeof(evidence) = 'array'::text THEN jsonb_array_length(evidence)
            ELSE 0
        END AS items,
        CASE
            WHEN jsonb_typeof(evidence) = 'array'::text THEN ( SELECT count(*) AS count
               FROM jsonb_array_elements(sa.evidence) e(value)
              WHERE NULLIF(e.value ->> 'sha256'::text, ''::text) IS NOT NULL
                 OR EXISTS ( SELECT 1 FROM evidence ev
                              WHERE ev.id::text = (e.value ->> 'id'::text)
                                AND ev.storage_path IS NULL AND ev.img IS NULL))
            ELSE 0::bigint
        END AS fingerprinted,
    (EXISTS ( SELECT 1
           FROM arrival_log a
          WHERE a.job_id = sa.job_id AND a.stage = sa.stage AND a.arrived_at <= sa.approved_at)) AS arrival_logged,
    (EXISTS ( SELECT 1
           FROM arrival_log a
          WHERE a.job_id = sa.job_id AND a.stage = sa.stage AND a.arrived_at <= sa.approved_at AND a.lat IS NOT NULL)) OR (EXISTS ( SELECT 1
           FROM work_log_pins w
          WHERE w.job_id = sa.job_id AND w.stage = sa.stage AND w.shared_at <= sa.approved_at)) AS located,
    (EXISTS ( SELECT 1
           FROM arrival_log a
          WHERE a.job_id = sa.job_id AND a.stage = sa.stage AND a.arrived_at <= sa.approved_at AND a.far_from_site IS TRUE)) AS flagged_far_from_site,
        CASE
            WHEN jsonb_typeof(evidence) = 'array'::text THEN (EXISTS ( SELECT 1
               FROM jsonb_array_elements(sa.evidence) e(value)
              WHERE (e.value ->> 'phase'::text) = 'before'::text))
            ELSE false
        END AS has_before,
        CASE
            WHEN jsonb_typeof(evidence) = 'array'::text THEN (EXISTS ( SELECT 1
               FROM jsonb_array_elements(sa.evidence) e(value)
              WHERE (e.value ->> 'phase'::text) = 'after'::text))
            ELSE false
        END AS has_after,
        CASE
            WHEN jsonb_typeof(evidence) = 'array'::text THEN (EXISTS ( SELECT 1
               FROM jsonb_array_elements(sa.evidence) e(value)
              WHERE (e.value ->> 'phase'::text) = 'before'::text)) AND (EXISTS ( SELECT 1
               FROM jsonb_array_elements(sa.evidence) e(value)
              WHERE (e.value ->> 'phase'::text) = 'after'::text))
            ELSE false
        END AS before_and_after,
        CASE
            WHEN jsonb_typeof(evidence) = 'array'::text THEN (EXISTS ( SELECT 1
               FROM jsonb_array_elements(sa.evidence) e(value)
              WHERE (e.value ->> 'phase'::text) = 'during'::text))
            ELSE false
        END AS has_during,
        CASE
            WHEN jsonb_typeof(evidence) = 'array'::text THEN ( SELECT count(*) AS count
               FROM jsonb_array_elements(sa.evidence) e(value)
              WHERE (e.value ->> 'phase'::text) = 'issue'::text)
            ELSE 0::bigint
        END AS issues
   FROM stage_approvals sa;
