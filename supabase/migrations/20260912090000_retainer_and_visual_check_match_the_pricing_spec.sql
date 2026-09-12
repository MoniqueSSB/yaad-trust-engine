-- The Oversight Retainer and the Visual Check move to the prices in
-- specs/PRICING.md, on Monique's instruction of 12 September 2026 ("match to
-- prototype"). The spec, the prototype and the 30 August ledger ruling all
-- agree; this table and docs/services.html were the two copies still behind.
-- RUNBOOK section 17 recorded the gap on 3 September.
--
--   Visual Check (eyes-on-it)       founding £95 unchanged, full £125 -> £149
--   Oversight Retainer, fortnightly founding £395 -> £495, full £495 -> £595
--   Oversight Retainer, weekly      new row, founding £895, full £1,095
--
-- The fortnightly row keeps its id and its name, so the booking page, the
-- CRM dropdown and every existing services row still point at it. Its blurb
-- loses "contractor accountability call": the retainer watches the property,
-- it does not manage anybody's contractor (COPY-GUIDELINES section 2).
--
-- The weekly row is over £500 a month, so it is invoiced and never given a
-- card link. Retainer On The Ground is not in the spec and is left alone.
--
-- Stripe is NOT changed by this file. The live retainer payment link still
-- charges £395 until a new £495 monthly price is attached to it by hand.

update public.service_catalogue
   set full_pence = 14900,
       updated_at = now()
 where id = 'eyes-on-it';

update public.service_catalogue
   set founding_pence = 49500,
       full_pence     = 59500,
       blurb          = 'Two documented site visits a month, monthly cost and progress report, scheduled accountability call, WhatsApp line.',
       updated_at     = now()
 where id = 'retainer';

insert into public.service_catalogue
  (id, name, blurb, founding_pence, full_pence, recurring, unit_label, active, sort)
values
  ('retainer-weekly', 'Oversight Retainer, weekly',
   'Four documented site visits a month, monthly cost and progress report, scheduled accountability call, WhatsApp line.',
   89500, 109500, true, 'month', true, 5)
on conflict (id) do update
   set name           = excluded.name,
       blurb          = excluded.blurb,
       founding_pence = excluded.founding_pence,
       full_pence     = excluded.full_pence,
       recurring      = excluded.recurring,
       unit_label     = excluded.unit_label,
       active         = excluded.active,
       updated_at     = now();
