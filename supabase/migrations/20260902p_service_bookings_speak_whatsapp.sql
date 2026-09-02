-- Service bookings speak WhatsApp (2 Sep 2026). The marketplace notifies
-- the client from the state change itself, never from the UI (20260831i);
-- the services lane built in 20260902o had the states but sent nothing.
-- One trigger on public.services now fires the same notification hub,
-- yaad-notify-client, at the three moments 20260902o defined: converted
-- (service_booked, a receipt with the portal code), confirmed by the
-- founder (service_confirmed, the invoice is coming), and marked paid by
-- a named admin (service_live). The hub composes every sentence itself
-- from the services row; the trigger sends only {secret, serviceId, kind}.
--
-- SECRET RULE, learned the hard way in 20260831z2 and again on 31 Aug:
-- never generate a new notify secret. The plaintext is extracted from a
-- live trigger function that already holds it and re-baked here, so every
-- existing trigger keeps working and app_settings is not touched at all.

create extension if not exists pg_net with schema extensions;

do $do$
declare
  s      text;
  fn_url text := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client';
  pubkey text := 'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz';
begin
  select substring(prosrc from '''secret'', ''([0-9a-f]+)''')
    into s
    from pg_proc
   where proname = 'notify_client_quote_arrived';

  if s is null then
    raise exception 'Could not recover the notify secret from notify_client_quote_arrived(). Do not generate a new one; find where the plaintext lives first.';
  end if;

  execute format($f$
    create or replace function public.notify_client_service_change()
    returns trigger
    language plpgsql
    security definer
    set search_path to 'public'
    as $fn$
    declare
      v_kind text := null;
    begin
      if tg_op = 'INSERT' then
        if new.status = 'held' then
          v_kind := 'service_booked';
        end if;
      else
        if new.status = 'awaiting_payment' and coalesce(old.status,'') is distinct from 'awaiting_payment' then
          v_kind := 'service_confirmed';
        elsif new.status = 'live' and coalesce(old.status,'') is distinct from 'live' then
          v_kind := 'service_live';
        end if;
      end if;

      if v_kind is not null then
        perform net.http_post(
          url := %L,
          body := jsonb_build_object('secret', %L, 'serviceId', new.id, 'kind', v_kind),
          headers := jsonb_build_object('Content-Type','application/json','apikey',%L,'Authorization','Bearer '||%L),
          timeout_milliseconds := 15000
        );
      end if;

      return new;
    end;
    $fn$;
  $f$, fn_url, s, pubkey, pubkey);

  drop trigger if exists trg_notify_service_change on public.services;
  create trigger trg_notify_service_change
    after insert or update on public.services
    for each row execute function public.notify_client_service_change();
end $do$;
