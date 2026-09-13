-- The money RPCs stop answering the open internet.
--
-- Found 3 September 2026 in a read-only audit of the whole application.
--
-- PostgREST publishes every function in `public` that the caller's role may
-- execute, at /rest/v1/rpc/<name>. Supabase's default privileges hand each new
-- function EXECUTE to anon and authenticated, so a function is exposed to the
-- open internet unless somebody remembers to take that away. Most of these
-- were never meant to be called by a browser at all: their only legitimate
-- caller is an Edge Function holding the service role.
--
-- Two of them checked nothing whatsoever about who was calling:
--
--   _do_agree_kickoff_pack(pack, side, email)
--     Takes the SIDE and the EMAIL as arguments and writes the agreement row.
--     Anyone holding a pack id could file both sides and flip
--     both_confirmed_at. The dual agreement on a Kickoff Pack is one of the
--     two things this product sells, and it was reachable from a browser
--     address bar.
--
--   agree_quote_via_whatsapp(job, phone)
--     Authenticates by matching a phone number supplied IN THE REQUEST BODY
--     against jobs.client_phone. A phone number is not a secret, so that is
--     authentication by assertion. It is safe when Twilio is the caller,
--     because Twilio has already proved the sender; it is not safe when the
--     caller is anybody with curl.
--
-- The others (the raise_* invoice family, release_materials_tranche) DO check
-- public.is_admin() and were never exploitable. They are still closed to anon
-- here, because an admin-only function has no business being callable by a
-- signed-out stranger even when it refuses them: the refusal itself confirms
-- the job id exists.
--
-- WHAT IS DELIBERATELY LEFT ALONE.
--   * `authenticated` keeps EXECUTE on everything the concierge desk calls.
--     The desk is a static page reading Postgres with the PUBLISHABLE key, so
--     Monique signed in IS `authenticated`, and is_admin() is what separates
--     her from everybody else. Revoking authenticated on those would take the
--     desk's invoicing and materials release offline.
--   * `service_role` keeps EXECUTE on all of them. That is how the Edge
--     Functions call them, and it is the intended path.
--   * approve_stage_via_whatsapp, choose_worker_via_whatsapp and
--     relay_confirmed_report already had exactly this treatment. This migration
--     is that same pattern, applied to the ones that were missed.
--
-- release_materials_tranche additionally carries a grant to PUBLIC (the bare
-- "=X/postgres" in its ACL). Revoking anon alone would have been a no-op on
-- that one, because PUBLIC covers anon anyway. It is the reason every REVOKE
-- below names PUBLIC too.

begin;

-- ── Internal only: no browser, signed in or not, has any business here ──────
-- _do_agree_kickoff_pack is the unguarded helper; the guarded, code-checked
-- wrapper agree_kickoff_pack(pack, code) is what the portal calls and it keeps
-- its grant to authenticated. A SECURITY DEFINER function runs as its owner,
-- so the wrapper can still reach the helper with no grant to the caller.
revoke all on function public._do_agree_kickoff_pack(p_pack_id text, p_side text, p_email text)
  from public, anon, authenticated;
revoke all on function public.agree_quote_via_whatsapp(p_job text, p_phone text)
  from public, anon, authenticated;
revoke all on function public.agree_kickoff_pack_via_whatsapp(p_job text, p_phone text)
  from public, anon, authenticated;

grant execute on function public._do_agree_kickoff_pack(p_pack_id text, p_side text, p_email text) to service_role;
grant execute on function public.agree_quote_via_whatsapp(p_job text, p_phone text) to service_role;
grant execute on function public.agree_kickoff_pack_via_whatsapp(p_job text, p_phone text) to service_role;

-- ── Admin only: keep `authenticated` for the desk, close it to strangers ────
revoke all on function public.raise_job_agency_fee_invoice(p_job text, p_currency text, p_manual_fee numeric) from public, anon;
revoke all on function public.raise_service_invoice(p_catalogue_id text, p_client_name text, p_client_email text, p_client_address text, p_service_id text, p_period_label text) from public, anon;
revoke all on function public.release_materials_tranche(p_job text, p_amount_jmd numeric, p_receipt_ref text, p_stage integer, p_note text) from public, anon;
revoke all on function public.raise_job_worker_pay_invoice(p_job text) from public, anon;
revoke all on function public.raise_job_stage_worker_pay_invoice(p_job text, p_stage integer) from public, anon;
revoke all on function public.approve_quote_pack_draft(p_draft_id uuid) from public, anon;
revoke all on function public.confirm_service_booking(p_service text, p_due date, p_price text) from public, anon;
revoke all on function public.convert_enquiry_to_service(p_enquiry uuid, p_catalogue_id text, p_client_name text, p_client_email text, p_phone text, p_parish text) from public, anon;
revoke all on function public.request_independent_review(p_job text) from public, anon;

-- Re-granted explicitly rather than left to survive the REVOKE. On
-- release_materials_tranche the desk's access came partly through the PUBLIC
-- grant that has just been taken away, so leaving this implicit would have
-- broken the desk on exactly the one function whose ACL differed.
grant execute on function public.raise_job_agency_fee_invoice(p_job text, p_currency text, p_manual_fee numeric) to authenticated, service_role;
grant execute on function public.raise_service_invoice(p_catalogue_id text, p_client_name text, p_client_email text, p_client_address text, p_service_id text, p_period_label text) to authenticated, service_role;
grant execute on function public.release_materials_tranche(p_job text, p_amount_jmd numeric, p_receipt_ref text, p_stage integer, p_note text) to authenticated, service_role;
grant execute on function public.raise_job_worker_pay_invoice(p_job text) to authenticated, service_role;
grant execute on function public.raise_job_stage_worker_pay_invoice(p_job text, p_stage integer) to authenticated, service_role;
grant execute on function public.approve_quote_pack_draft(p_draft_id uuid) to authenticated, service_role;
grant execute on function public.confirm_service_booking(p_service text, p_due date, p_price text) to authenticated, service_role;
grant execute on function public.convert_enquiry_to_service(p_enquiry uuid, p_catalogue_id text, p_client_name text, p_client_email text, p_phone text, p_parish text) to authenticated, service_role;
grant execute on function public.request_independent_review(p_job text) to authenticated, service_role;

commit;
