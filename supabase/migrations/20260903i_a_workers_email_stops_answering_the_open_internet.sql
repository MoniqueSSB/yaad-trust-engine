-- A worker's email address stops answering the open internet.
--
-- Found 3 September 2026 by the post-optimisation regression audit. Same class
-- of gap as 20260903f, on the one table that migration did not reach.
--
-- 20260903f closed this on worker_profiles, worker_checks and portfolio: a
-- private column sitting on a row a stranger is allowed to read. RLS decides
-- which ROWS a role may see and says nothing about which COLUMNS, so a
-- table-level SELECT grant hands over every column on every visible row.
--
-- public.answers has exactly that shape and was missed. The policy "answers to
-- published questions are public" lets anon read any answer to a published
-- question, and the grant was table-level, so
--   GET /rest/v1/answers?select=worker_email
-- returned the email address of every vetted worker who has ever answered.
--
-- Nothing is exposed today: there are zero published questions and zero
-- answers, which is luck rather than design. /ask was given its first inbound
-- link from the job board in the same run that this audit covers, so the table
-- is about to start filling. Closing it before there is anything in it is the
-- cheap moment.
--
-- COLUMN GRANTS, NOT A VIEW. 20260903f needed views because those three tables
-- were joined on worker_email and the app had to be given a public slug to
-- join on instead. Nothing joins to answers: /ask reads answers by
-- question_id, renders only the body, and the answering worker is deliberately
-- anonymous on that page. So the smaller fix is the right one. Postgres cannot
-- subtract a column from a table-level grant, hence revoke then re-grant.
--
-- authenticated is untouched. The desk reads answers through the concierge
-- with is_admin(), and it is the desk's job to know who answered.

revoke select on public.answers from anon;

grant select (id, question_id, body, created_at) on public.answers to anon;

comment on column public.answers.worker_email is
  'Who answered. NOT readable by anon: the /ask page renders answers anonymously and joins on question_id, so nothing public needs this. Readable by authenticated, where is_admin() gates it at the desk. If a future page wants to credit an answer, give it a public slug the way published_reviews does, never this column.';
