-- The client's Accept button in the portal failed every time with
-- 'column reference "quote_id" is ambiguous'. Found 13 Sep 2026 on a test
-- job (JOB-WEB-1789253807959); nothing was half saved, the whole call rolled
-- back.
--
-- agree_quote_as_me returns table(..., job_id, quote_id), and in plpgsql
-- those output columns are variables in scope for the whole body. The insert
-- into quote_agreements ends "on conflict (quote_id, side)", where quote_id
-- could be the table's column or the output variable, so Postgres refuses.
-- The WhatsApp door had the same fault and was fixed on 2 Sep by renaming its
-- outputs to out_job_id and out_quote_id; the portal door came in on 10 Sep
-- (20260910130000) without it.
--
-- The fix here is one directive, #variable_conflict use_column: where a name
-- clashes, it means the table column. The outputs keep their names, so the
-- return type is unchanged, no drop is needed, and nothing that reads the
-- result changes. Every other line of the body is exactly as 20260910130000
-- left it: the client still presses Accept themselves, and the same checks
-- (signed in, is the client or the quoting worker, quote still open, quote
-- visible to the client) all still run before anything is written.

create or replace function public.agree_quote_as_me(p_quote uuid)
returns table(agreed_side text, both_confirmed boolean, job_id text, quote_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_quote public.job_quotes%rowtype;
  v_job   public.jobs%rowtype;
  v_side  text;
  v_both  boolean;
begin
  if v_email is null then
    raise exception 'Sign in to confirm a price.' using errcode = '28000';
  end if;

  select * into v_quote from public.job_quotes where id = p_quote;
  if v_quote.id is null then
    raise exception 'No such price.';
  end if;

  if v_quote.status <> 'submitted' then
    raise exception 'That price is not open for confirmation.';
  end if;

  select * into v_job from public.jobs where id = v_quote.job_id;
  if v_job.id is null then
    raise exception 'No such job.';
  end if;

  if v_email = lower(coalesce(v_job.client_email, '')) then
    v_side := 'client';
    -- 9 Sep 2026: on a yaadly-picks job the client confirms the price that
    -- was put to them, not one they found by id.
    if not public.client_may_see_quote(v_quote.job_id, v_quote.status, v_quote.recommended_at) then
      raise exception 'Yaadly is still choosing your tradesperson. The price to confirm will be on your page once a person has chosen.';
    end if;
  elsif v_email = lower(coalesce(v_quote.worker_email, '')) then
    v_side := 'worker';
  else
    raise exception 'Only the client of this job or the worker who quoted it may confirm this price.'
      using errcode = '28000';
  end if;

  insert into public.quote_agreements (quote_id, side, email)
  values (v_quote.id, v_side, v_email)
  on conflict (quote_id, side) do nothing;

  if v_side = 'client' then
    perform set_config('yaadly.choosing', '1', true);
    update public.job_quotes set status = 'quote_confirmed', updated_at = now() where id = v_quote.id;
    perform set_config('yaadly.choosing', '', true);
    perform public._do_choose_worker(v_job.id, v_quote.id);
    v_both := true;
  else
    v_both := false;
  end if;

  return query select v_side, v_both, v_job.id, v_quote.id;
end;
$function$;
revoke all on function public.agree_quote_as_me(uuid) from public, anon;
grant execute on function public.agree_quote_as_me(uuid) to authenticated;
