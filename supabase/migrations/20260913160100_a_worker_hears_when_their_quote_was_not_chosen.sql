-- A worker hears when their quote was not chosen. Founder, 13 September 2026:
-- a worker who quoted still sees the job afterwards (20260913160000), "but
-- just an alert goes to their phone letting them know they were not
-- selected."
--
-- When it fires. _do_choose_worker() is the only thing on production that
-- sets a quote to 'declined', and it does it to every other live quote on the
-- job in the same statement that books the chosen worker. So "this quote just
-- became declined" means exactly "somebody else was booked", and the trigger
-- runs once per worker who was not.
--
-- What it sends is the shared trigger shape (20260913130000): the secret, the
-- job id, the kind, and the quote id in meta. Never text. yaad-notify-client
-- reads the quote itself, sends to the worker who wrote it (never to
-- jobs.worker_email, which is now the other worker), and only while the quote
-- is still declined, so a desk correction or a double fire cannot tell
-- somebody they lost when they did not.
--
-- None of this approves, releases, rules or scores anything. It tells people.

begin;

create or replace function public.notify_worker_quote_not_selected()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'declined' and old.status is distinct from 'declined' then
    perform net.http_post(
      url := 'https://leffyisvfvjwzilydlwf.supabase.co/functions/v1/yaad-notify-client',
      body := jsonb_build_object('secret', public.notify_trigger_secret(), 'jobId', new.job_id,
        'kind', 'quote_not_selected', 'meta', jsonb_build_object('quoteId', new.id)),
      headers := jsonb_build_object('Content-Type','application/json','apikey','sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz','Authorization','Bearer '||'sb_publishable_NS1flo5NWLLsktXHg5FHdQ_7ctM8Xvz'),
      timeout_milliseconds := 15000
    );
  end if;
  return new;
end;
$$;

revoke all on function public.notify_worker_quote_not_selected() from public, anon, authenticated;

drop trigger if exists trg_notify_worker_quote_not_selected on public.job_quotes;
create trigger trg_notify_worker_quote_not_selected
  after update of status on public.job_quotes
  for each row execute function public.notify_worker_quote_not_selected();

commit;
