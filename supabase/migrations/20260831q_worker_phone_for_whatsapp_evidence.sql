-- The missing link for WhatsApp evidence intake: nothing in this schema
-- connects a WhatsApp number to a worker. worker_profiles is keyed on
-- worker_email; applications.phone exists but is raw, unnormalised text
-- captured once at signup, with no ongoing relationship to worker_profiles
-- beyond application_id, and nothing keeps it current if a worker changes
-- numbers.
--
-- worker_profiles.phone is the real column, digits only, matched the same
-- way this codebase already matches a client's phone in
-- yaad-whatsapp-webhook's findHistory(): last 9 digits, not full E.164.
-- Jamaican and UK numbers arrive with inconsistent country-code prefixes
-- from WhatsApp's own "From" field, and the existing convention already
-- tolerates that rather than pretending to a precision nobody's numbers
-- actually have. Consistency with what is already there, not new rigor.
--
-- link_worker_phone() is the one door, same shape as record_pay_info:
-- worker_profiles carries no self-write RLS policy at all (admin write,
-- signed-in read only), so a SECURITY DEFINER function is how a worker
-- records their own number, checked against their own email or their own
-- worker_user id.

alter table public.worker_profiles
  add column if not exists phone text;

comment on column public.worker_profiles.phone is
  'Digits only, no leading +. The number this worker sends evidence from over WhatsApp, matched by yaad-whatsapp-webhook on the last 9 digits, the same convention findHistory() already uses for a client''s phone. Set through link_worker_phone(), or automatically at signup for a worker who applied through the WhatsApp flow.';

create index if not exists worker_profiles_phone_tail_idx
  on public.worker_profiles (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9));

create or replace function public.link_worker_phone(p_phone text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email  text;
  v_uid    uuid := auth.uid();
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if v_uid is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  if length(v_digits) < 7 then
    raise exception 'That does not look like a real phone number.' using errcode = 'check_violation';
  end if;

  select lower(btrim(u.email)) into v_email from auth.users u where u.id = v_uid;

  update public.worker_profiles
     set phone = v_digits,
         updated_at = now()
   where worker_user = v_uid
      or lower(coalesce(worker_email, '')) = coalesce(v_email, '__none__');

  if not found then
    raise exception 'No worker profile found for this account.' using errcode = '28000';
  end if;
end;
$$;

revoke all on function public.link_worker_phone(text) from public, anon, authenticated;
grant execute on function public.link_worker_phone(text) to authenticated;
