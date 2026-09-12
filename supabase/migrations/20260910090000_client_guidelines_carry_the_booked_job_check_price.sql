-- Founder instruction, 10 Sep 2026: the Client Guidelines section 6 quoted
-- only the standalone price for an independent check at sign-off (£149 Visual
-- Check, £300 Technical Sign-off) and said nothing about the price a client
-- who has already booked a job with Yaadly actually pays for the same check
-- (£45 and £149, founding £25 and £100; 20260909180000). The document a
-- client signs has to say what the portal charges them.
--
-- web/lib/legal-copy.json moved to Client Guidelines v1.5. This is the
-- matching half in the database, same shape as 20260828e and 20260903k:
-- current_doc_version() reads app_settings and client_go_live() requires a
-- signature's doc_version to equal it exactly. Bump the JSON without this and
-- everybody who signs the new text fails the gate on the old number.
--
-- KNOWN AND INTENDED CONSEQUENCE. Checked live before writing this: the
-- database holds '1.4', and the only two client signatures on record are both
-- against '1.3', so they were already stale and nobody newly loses a match.
-- Anyone who signs from now on signs the text that names the price they pay.

update public.app_settings set value = '1.5' where key = 'client_guidelines_version';
