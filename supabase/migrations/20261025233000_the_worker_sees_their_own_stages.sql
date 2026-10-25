-- The worker sees their own stages. 25 Oct 2026.
--
-- The worker portal's "Before you can quote" list and "Before your first
-- payment" box (founder: profile stage, then ID stage, TRN before the first
-- payment; see 20261025230000). The list needs the ID check, the signature,
-- the referees and whether a skills video was filed, and the video lives in
-- vetting_documents, which a worker cannot read. So this returns the answers
-- and nothing else: true or false per item, the TRN's status, and the link
-- to their own ID stage. Their own row only, found through the signed-in
-- email, exactly as submit_my_trn() finds it. It reads; it changes nothing.

create or replace function public.my_worker_stages()
returns table(
  live boolean,
  id_checked boolean,
  has_email boolean,
  id_ok boolean,
  signed boolean,
  refs_or_video boolean,
  trn_status text,
  application_id uuid,
  upload_token text,
  app_ref text
)
language sql
stable security definer
set search_path to 'public'
as $function$
  select w.active,
         w.id_checked_at is not null,
         coalesce(nullif(btrim(w.worker_email), ''), nullif(btrim(a.email), '')) is not null,
         coalesce(a.persona_status, '') in ('approved', 'completed'),
         a.signed_at is not null,
         (coalesce(btrim(a.ref1), '') <> '' and coalesce(btrim(a.ref2), '') <> '' and coalesce(btrim(a.ref3), '') <> '')
           or exists (select 1 from vetting_documents v where v.application_id = a.id and v.doc_type = 'intro_video'),
         coalesce(a.trn_status, 'not_given'),
         a.id,
         a.upload_token::text,
         a.app_id
    from worker_profiles w
    join applications a on a.id = w.application_id
   where lower(coalesce(w.worker_email, '')) = nullif(btrim(lower(auth.jwt() ->> 'email')), '')
   limit 1;
$function$;

revoke all on function public.my_worker_stages() from public, anon;
grant execute on function public.my_worker_stages() to authenticated;
