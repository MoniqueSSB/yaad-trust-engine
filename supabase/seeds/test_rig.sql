-- ============================================================================
-- TEST RIG: one client, one worker, one job, enough to walk the whole loop.
-- Written 29 August 2026. NOT a migration. Never run in a deploy.
-- ============================================================================
--
-- Two seeded accounts rather than the founder's real ones, deliberately. A
-- worker profile and a signed set of Worker Guidelines are records about a
-- person, and attaching them to a real identity to test a button leaves a
-- signature nobody meant to give and a tradesperson listing nobody meant to
-- publish. These two are obviously fake, and teardown at the bottom removes
-- every trace in one statement.
--
-- WHAT IS DELIBERATELY NOT DONE FOR THE CLIENT
--
-- The client is seeded EMPTY: confirmed mailbox, one job, and nothing else.
-- No guidelines signature, no client_profiles row, no nominated materials
-- store. That is the point. Those three are exactly what the go-live
-- checklist asks for, so pre-clearing them would seed away the thing being
-- tested. Sign in as the client and walk the list.
--
-- The WORKER is seeded complete, because the worker side is supply, not the
-- journey under test: without an active profile and a signed set of Worker
-- Guidelines, jq_insert_vetted refuses every quote and the client's test
-- dead-ends at an empty board.
--
-- PUBLIC EXPOSURE: worker_profiles.active = true puts "Test Worker (SEED)" on
-- the public directory at /jobs?tab=workers for as long as this rig exists.
-- That is unavoidable, because the same flag is what jq_insert_vetted reads.
-- Run the teardown when you are done.

begin;

-- ------------------------------------------------------------ the accounts

-- THE PASSWORD IS NOT IN THIS FILE, AND MUST NOT BE PUT IN IT.
--
-- This repository is public. A working password for a live Supabase account
-- committed here is a credential published to the internet, and the worker
-- account it opens is an ACTIVE vetted worker that can insert quotes. So the
-- password is supplied at run time and never stored:
--
--   psql "$DATABASE_URL" -v pw="'the-password-here'" -f supabase/seeds/test_rig.sql
--
-- In the Supabase SQL editor, replace :pw with a quoted literal by hand, run
-- it, and do not save the query.
with new_users as (
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  )
  values
    (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'test.client@yaadly.co.uk',
     crypt(:pw, gen_salt('bf')),
     now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
     'authenticated', 'authenticated', 'test.worker@yaadly.co.uk',
     crypt(:pw, gen_salt('bf')),
     now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', '')
  returning id, email
)
-- GoTrue will not sign an email user in without a matching identity row.
insert into auth.identities (
  id, provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select gen_random_uuid(), u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email,
                          'email_verified', true, 'phone_verified', false),
       'email', now(), now(), now()
from new_users u;

-- ------------------------------------------------------------- the worker

insert into public.worker_profiles (
  worker_email, worker_user, name, trade, parish, lane,
  jobs_completed, active, slug, about, years, areas
)
select 'test.worker@yaadly.co.uk', u.id,
       'Test Worker (SEED)', 'Roofing', 'Kingston', 'vet',
       0, true, 'test-worker-seed',
       'Seeded account for testing the quote and evidence loop. Not a real tradesperson.',
       10, 'Kingston and Portmore'
from auth.users u where u.email = 'test.worker@yaadly.co.uk';

-- jq_insert_vetted needs this at the exact version in app_settings, so it is
-- read from there rather than typed and left to drift.
insert into public.doc_signatures (
  signer_user, signer_email, signer_name, doc_type, doc_version, consent_text
)
select u.id, 'test.worker@yaadly.co.uk', 'Test Worker (SEED)',
       'worker_guidelines',
       coalesce(public.current_doc_version('worker_guidelines'), '1.3'),
       'SEEDED TEST SIGNATURE, NOT A REAL CONSENT. Created by supabase/seeds/test_rig.sql to make jq_insert_vetted pass.'
from auth.users u where u.email = 'test.worker@yaadly.co.uk';

-- ---------------------------------------------------------------- the job

-- Left in awaiting_client_setup on purpose: this is the job the checklist is
-- meant to be tested on, so every gate it names is genuinely unmet.
insert into public.jobs (
  id, title, trade, parish, descr, status, open, stage, client_email
)
values (
  'JOB-TEST-0001',
  'Zinc roof leak over the back bedroom',
  'Roofing',
  'Kingston',
  E'Water comes in over the back bedroom whenever it rains hard. Looks like the overlaps have lifted on the lower run.\n\nSeeded test job, not a real property.',
  'awaiting_client_setup',
  false,
  0,
  'test.client@yaadly.co.uk'
);

commit;

-- ============================================================================
-- TEARDOWN. Removes the rig and nothing else.
-- ============================================================================
-- begin;
-- delete from public.intake_threads  where job_id = 'JOB-TEST-0001';
-- delete from public.job_quotes      where job_id = 'JOB-TEST-0001';
-- delete from public.evidence        where job_id = 'JOB-TEST-0001';
-- delete from public.messages        where job_id = 'JOB-TEST-0001';
-- delete from public.scope_agreements where job_id = 'JOB-TEST-0001';
-- delete from public.kickoff_packs   where job_id = 'JOB-TEST-0001';
-- delete from public.jobs            where id = 'JOB-TEST-0001';
-- delete from public.worker_profiles where worker_email = 'test.worker@yaadly.co.uk';
-- delete from public.client_profiles where email in ('test.client@yaadly.co.uk','test.worker@yaadly.co.uk');
-- delete from public.doc_signatures  where signer_email in ('test.client@yaadly.co.uk','test.worker@yaadly.co.uk');
-- delete from auth.users             where email in ('test.client@yaadly.co.uk','test.worker@yaadly.co.uk');
-- commit;
