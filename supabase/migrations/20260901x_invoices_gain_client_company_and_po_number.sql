alter table public.invoices add column if not exists client_company text;
alter table public.invoices add column if not exists po_number text;

comment on column public.invoices.client_company is
  'Optional. Shown under the client name on the invoice document. Never invented by the agent, left blank unless given.';
comment on column public.invoices.po_number is
  'Optional purchase order reference the client gave, shown on the invoice document. Never invented by the agent, left blank unless given.';
