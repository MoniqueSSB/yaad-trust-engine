-- The client approves finished extra work, the same way they accept a stage.
--
-- WHY. Founder decision, 28 Sep 2026, after running a live job end to end.
-- A payment stage is accepted by the client in the portal; a finished add-on
-- was signed off only by Yaadly at the desk (sign_off_addon, admin only), so
-- the client never said the extra work they paid for was done. The two now
-- match: the client approves, on the Extra work tab.
--
-- WHAT THIS DOES.
--   _sign_off_addon(p_addon, p_by): the body of sign_off_addon, lifted out
--     unchanged, with the name of whoever approved passed in. Granted to
--     nobody; only the two functions below call it.
--   sign_off_addon(p_addon): unchanged for the desk. Admin only, as before.
--     It stays as the fallback for a client who cannot be reached, the same
--     named-human step it always was.
--   approve_addon_as_me(p_addon): the client of this job only, matched on
--     their own JWT email. Same gates as the desk: agreed, its invoice paid,
--     at least one photo filed on it, a booked worker. Stamps the client's
--     email as signed_off_by.
--
-- WHAT THIS DOES NOT DO. Nobody is paid by it. Approving raises the worker's
-- pay invoice (agreed amount less 5%) on Pay workers, exactly as the desk
-- sign-off did; paying it is still mark_worker_paid, a named person at the
-- desk. On half now, half on sign-off terms it drafts the second client
-- invoice, which a person still sends. The worker cannot approve their own
-- extra work, and there is no automatic approval of any kind.
--
-- Built from the live definition of sign_off_addon read on 28 Sep 2026, not
-- from the migration file, because create or replace replaces the whole body.

create or replace function public._sign_off_addon(p_addon uuid, p_by text)
returns table(worker_payable text, second_invoice text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_a      job_addons%rowtype;
  v_job    jobs%rowtype;
  v_rate   integer;
  v_pay    text;
  v_second text;
begin
  if coalesce(btrim(p_by), '') = '' then
    raise exception 'A named person has to approve this.' using errcode = '28000';
  end if;
  select * into v_a from job_addons where id = p_addon for update;
  if not found then
    raise exception 'No such add-on.';
  end if;
  if v_a.status <> 'agreed' then
    raise exception 'Only an agreed add-on can be signed off. This one is %.', replace(v_a.status, '_', ' ');
  end if;
  if not exists (select 1 from invoices i
                  where i.addon_id = p_addon and coalesce(i.payable_to, 'yaadly') = 'yaadly' and i.status = 'paid') then
    raise exception 'The add-on''s invoice is not marked paid, so the work should not have started.';
  end if;
  if not exists (select 1 from job_addon_evidence e where e.addon_id = p_addon) then
    raise exception 'No evidence has been filed on this add-on. Sign-off is on evidence.';
  end if;
  select * into v_job from jobs where id = v_a.job_id;
  if coalesce(v_job.worker_email, '') = '' then
    raise exception 'This job has no booked tradesperson to pay.';
  end if;

  update job_addons
     set status = 'signed_off', signed_off_at = now(), signed_off_by = lower(btrim(p_by)), updated_at = now()
   where id = p_addon;

  -- What Yaadly owes the worker for it: the agreed amount less 5%, as on the
  -- main job. Recorded as sent, like a stage payable; paying it is still
  -- mark_worker_paid, which waits for every client invoice on this add-on.
  v_rate := v_a.amount_jmd - round(v_a.amount_jmd * 0.05);
  v_pay := public.new_invoice_number();
  insert into public.invoices (id, client_name, client_email, worker_email, job_id, addon_id, drafted_by, currency, period_label, payable_to, worker_labour_jmd, worker_fee_jmd, notes)
  values (v_pay, 'Yaadly Ltd', 'payable@yaadly.invalid', v_job.worker_email, v_a.job_id, v_a.id, 'human', 'JMD', 'Add-on completed', 'worker', v_a.amount_jmd, v_a.amount_jmd - v_rate,
    'What Yaadly owes ' || coalesce(v_job.worker_name, 'the tradesperson') || ' for agreed add-on work on this job: the amount agreed with the client less 5%, with nothing else deducted. Yaadly pays this directly. The client is not a party to it.');
  insert into public.invoice_lines (invoice_id, catalogue_id, description, qty, unit_amount_pence, price_source)
  values (v_pay, null, 'Add-on: ' || left(regexp_replace(btrim(v_a.scope), '\s+', ' ', 'g'), 100) || ', agreed amount less 5%', 1, v_rate, 'manual');
  -- Lines first, then sent, the order raise_job_stage_worker_payable uses.
  update public.invoices set status = 'sent' where id = v_pay;

  if v_a.terms = 'half_now_half_on_signoff' then
    v_second := public._draft_addon_client_invoice(p_addon, 'second');
  end if;

  perform public._touch_job(v_a.job_id);
  return query select v_pay, v_second;
end $function$;

revoke all on function public._sign_off_addon(uuid, text) from public, anon, authenticated;

create or replace function public.sign_off_addon(p_addon uuid)
returns table(worker_payable text, second_invoice text)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'Admin only.' using errcode = '28000';
  end if;
  return query select * from public._sign_off_addon(p_addon, lower(nullif(btrim(auth.jwt() ->> 'email'), '')));
end $function$;

create or replace function public.approve_addon_as_me(p_addon uuid)
returns table(worker_payable text, second_invoice text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_job   text;
begin
  if v_email is null then
    raise exception 'Sign in to approve this.' using errcode = '28000';
  end if;
  select a.job_id into v_job from job_addons a where a.id = p_addon;
  if v_job is null then
    raise exception 'No such add-on.';
  end if;
  if not exists (select 1 from jobs j
                  where j.id = v_job and lower(coalesce(j.client_email, '')) = v_email) then
    raise exception 'Only the client on this job can approve its extra work.' using errcode = '28000';
  end if;
  return query select * from public._sign_off_addon(p_addon, v_email);
end $function$;

comment on function public.approve_addon_as_me(uuid) is
  'The client approves finished, paid, evidenced extra work (founder, 28 Sep 2026). Raises the worker''s pay invoice; pays nobody. Same gates as the desk''s sign_off_addon.';

revoke all on function public.approve_addon_as_me(uuid) from public, anon;
grant execute on function public.approve_addon_as_me(uuid) to authenticated;
