-- verify_portal_code() is dead. Retire it.
--
-- It was the original gate: does a row exist carrying BOTH this code and this
-- email. 20260829f established why that could never be satisfied by a job that
-- arrived on WhatsApp, and 20260829g replaced the whole idea with pend then
-- bind on confirmation. Nothing has called this since.
--
-- It is read only and was locked to the service role, so leaving it would not
-- have hurt anything. It goes because a function whose name still sounds like
-- the live gate is a thing somebody reaches for later, believing it is the
-- live gate. pend_portal_code() is the live gate.

drop function if exists public.verify_portal_code(text, text);

-- While here: portal_claim_on_confirm() was created with the default grants,
-- which include PUBLIC. Postgres will not let anyone call a trigger function
-- directly and PostgREST will not expose one, so this is not a hole. It is
-- consistency: every other function touching this flow says out loud who may
-- call it, and one that does not invites the reader to wonder why.

revoke all on function public.portal_claim_on_confirm() from public;
revoke all on function public.portal_claim_on_confirm() from anon;
revoke all on function public.portal_claim_on_confirm() from authenticated;
