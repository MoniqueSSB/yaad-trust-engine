-- service_catalogue catches up with the 26 Aug pricing decision
-- 3 Sep 2026
--
-- specs/PRICING.md and CHANGELOG-2026-08-26.md §4 both record, same day as
-- the invoicing migration, that the visit-report product was renamed
-- "Visual Check" (was "Eyes On It" / "Property Check In") and the
-- whole-property report renamed "Condition Report" (was "Property Condition
-- Report" / "Site Verification Visit"). The seed data in
-- 20260826_invoicing.sql never picked the new names up, so the catalogue
-- that actually prices invoices still spoke the old names. Renaming here,
-- not touching either row's price: the fee-figure gap between this table
-- and specs/PRICING.md is a separate, bigger, money-touching question, left
-- for its own session.
--
-- The same two documents list "Project Setup Pack" and "Document Pack
-- Check" under "Removed", the second carrying its own reason (Legal
-- Profession Act s8/s31 exposure). Both rows are still active := true here,
-- which is why they were still raisable from the concierge desk's own
-- catalogue dropdown (concierge/concierge.html, loadCatalogueOptions) and
-- still bookable through the public form's leftover <option>s even though
-- neither has had a product card on docs/services.html since the removal.
-- Deactivating rather than deleting: nothing references these ids from
-- existing data, but there is no reason to break a foreign key if that
-- ever changes.

update public.service_catalogue
   set name = 'Visual Check',
       updated_at = now()
 where id = 'eyes-on-it';

update public.service_catalogue
   set name = 'Condition Report',
       updated_at = now()
 where id = 'condition-report';

update public.service_catalogue
   set active = false,
       updated_at = now()
 where id in ('setup-pack', 'document-check');
