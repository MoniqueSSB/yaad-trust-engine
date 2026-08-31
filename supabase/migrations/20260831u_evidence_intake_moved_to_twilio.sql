-- worker_profiles.phone's own comment said it was matched by
-- yaad-whatsapp-webhook against Meta's Cloud API. That moved to yaad-inbound
-- (Twilio) the same day, once Meta's own business verification proved to be
-- the actual blocker rather than anything about this feature. See
-- DECISIONS.md, "WhatsApp evidence intake moves to Twilio, same day it was
-- built on Meta."

comment on column public.worker_profiles.phone is
  'Digits only, no leading +. The number this worker sends evidence from over WhatsApp, matched by yaad-inbound on the last 9 digits, the same convention findHistory() uses for a client''s phone in yaad-whatsapp-webhook. Set through link_worker_phone(), or automatically at signup for a worker who applied through the WhatsApp flow. Originally matched by yaad-whatsapp-webhook against Meta''s Cloud API; moved to yaad-inbound (Twilio) same day, 31 Aug 2026, once Meta''s own business verification proved to be the actual blocker, not this feature. See DECISIONS.md.';
