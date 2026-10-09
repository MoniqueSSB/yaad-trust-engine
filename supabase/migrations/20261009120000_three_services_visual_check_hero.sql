-- The services page goes to three services, founder decision 9 October 2026:
-- Visual Check (the hero, one visit or a monthly plan), Before You Pay Check
-- (the public name of the Project Setup Check, catalogue id deposit-check,
-- internal name unchanged) and Managed Work (quoted after scope, no
-- catalogue row, enquire only).
--
--   Visual Check (eyes-on-it)   founding £95 unchanged, full £149 -> £150
--   Visual Check, monthly plan  new row, £100 a month, one visit a month.
--                               Not bookable on the page and no card link:
--                               agreed in writing over WhatsApp, terms on
--                               docs/services.html#monthly.
--   Condition Report, Property Care (three tiers), Oversight Retainer
--   (fortnightly and weekly)    switched inactive, the same way
--                               retainer-ground was when its card came off.
--                               Rows are kept, so every existing booking
--                               still points at a real service.
--
-- job-visual-check (the £25 check added to a booked job) is untouched.
-- Stripe is NOT changed by this file.

update public.service_catalogue
   set full_pence = 15000,
       updated_at = now()
 where id = 'eyes-on-it';

insert into public.service_catalogue
  (id, name, blurb, founding_pence, full_pence, recurring, unit_label, active, sort)
values
  ('visual-monthly', 'Visual Check, monthly plan',
   'One visit a month, the same checklist, a timestamped photo set, changes since the last visit flagged. Records only, no rating or advice.',
   10000, 10000, true, 'month', true, 1)
on conflict (id) do update
   set name           = excluded.name,
       blurb          = excluded.blurb,
       founding_pence = excluded.founding_pence,
       full_pence     = excluded.full_pence,
       recurring      = excluded.recurring,
       unit_label     = excluded.unit_label,
       active         = excluded.active,
       updated_at     = now();

update public.service_catalogue
   set active = false,
       updated_at = now()
 where id in ('condition-report', 'care-standard', 'care-large', 'care-villa',
              'retainer', 'retainer-weekly');
