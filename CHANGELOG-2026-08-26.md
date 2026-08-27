# Changeset, 26 August 2026

Everything decided and built in one working session. Grouped by what it touches.

---

## 1 · Database, applied to production, now versioned here

| File | What it does | Status |
|---|---|---|
| `supabase/migrations/20260826_yaad_match.sql` | Adds `jobs.trade`, `parish_key()`, `trade_key()`, the `job_alerts` table with a unique index on `(job_id, lower(worker_email), channel)`, and `match_workers_for_job()` | **Applied to prod** as `yaad_match_setup` |
| `supabase/migrations/20260826b_trade_classifier.sql` | Adds `jobs.trade_source` (`wizard\|model\|regex\|admin`), `set_job_trade()`, `backfill_missing_trades()`, seeds `app_settings.trade_list` | **Applied to prod** as `yaad_trade_classifier` |

`match_workers_for_job()` ranks trade 100 + parish 50 + `least(jobs_completed,25)` and
requires a **current-version** `worker_guidelines` signature. `parish_key()` was tested
against 12 real spellings including the Kingston 5 to 10 → `st andrew` case.

`set_job_trade()` refuses to overwrite a `wizard` or `admin` choice unless an admin forces it.

## 2 · Edge functions

`supabase/functions/yaad-match/index.ts` and the classifier patch to
`supabase/functions/yaad-agent/index.ts` are **already in this repo**, no change here.

**Still to deploy:**

```
supabase functions deploy yaad-match
supabase functions deploy yaad-agent
```

Then backfill: `select * from backfill_missing_trades(false);` (dry run said 2 jobs).

## 3 · Job taxonomy, new

| File | What it is |
|---|---|
| `data/job-taxonomy.js` | 18 trades, 97 job types, 84 size bands, 23 evidence checklists, stage count per type |
| `specs/JOB-TAXONOMY.md` | The same, human-readable, for review and editing |

Keyed **`Trade\|Type`**, never `Type` alone, two trades share a type name and a flat key
silently gave the wrong evidence to the wrong trade:

- **Leak trace and repair** exists under Plumbing *and* Roofing
- **Fault finding on an existing system** exists under Solar Install *and* CCTV & Alarms

Jamaica-specific types that must survive any future edit: hurricane strapping and fixings ·
tank, stand and pump · inverter, battery or backup power · soakaway or absorption pit ·
window grilles and security grille doors (evidence includes **emergency egress release
working, on video**) · louvre repair · remote viewing set up for an overseas owner.

## 4 · Pricing, decided, with sources

`specs/PRICING.md` carries the full ladder and every UK comparable behind it.

Headline changes:

| | Was | Now | Why |
|---|---|---|---|
| Visual Check | £25 / £45 | **£149** | Those were the inspection ladder's internal cost lines, not a client price. UK property inspection report is £80 to 150. |
| Condition Report | £249 | **£325** | RICS Level 1 is £300 to 900 |
| Technical Sign-off | £50 | **£300** | A UK structural engineer charges £300 for the site visit alone |
| Property Care | £45 | **£95** | UK periodic property inspection is £80 + VAT for the identical product |
| Oversight Retainer | £350/mo flat | **£595 fortnightly / £1,095 weekly** | Two visits at ladder rate are £298, the retainer was priced below the sum of its own visits |
| Full Project Management | 8 to 15% | **12 to 15%, min £2,500** | Decided 13 Aug, was mis-stated |
| Live viewing |, | **£40** add-on | New |

**Removed:** Project Setup Pack · Certified Milestone Sign-off · Document Pack Check ·
Founding Pros 0% for 90 days.

**No price band is shown to a worker, ever.** The "fair band" figures previously on the
prototype were invented, they were not in `Yaadly_Cost_Benchmarks.md` or anywhere else.
Publishing a band is price estimation, which the founder rule excludes. The client's budget
band is client-side only.

## 5 · Prototype preview, new

`preview/index.html` publishes to **yaadly.co.uk/preview/**. A separate path, so
`docs/index.html` (production) is untouched. `preview/README.md` records the product
decisions it carries.

## 6 · Guidelines, needs a production edit

The prototype carries **Worker Guidelines v1.1** and **Client Guidelines v1.1** with real
corrections that are **not yet in `docs/index.html`**:

- **WG §1**, v1.0 says *"you are never charged to be on Yaadly or to take a job."*
  The decided model charges **12%**. No worker may sign v1.0. Corrected wording is in the
  preview's `wgDoc()`.
- **WG §2**, police check rule rewritten: mandatory over £500, inside occupied homes, and
  wherever the worker holds keys or attends an empty property.
- **WG §8**, added: one dispute site visit covered, any further visit chargeable, and
  Yaadly attends for a **visual review only** and does not certify.
- **CG**, v1.0 has **no fee clause at all**, and clients sign it. Added as §5.
- **CG §3**, the "fair band indicator" sentence removed; Yaadly does not publish bands.
- **CG §6**, new section on independent review at sign-off, with the four rungs and the
  chargeable-visit rule.
- Founding Pros removed from both.

Bump both to **v1.1** so signature records stay distinguishable, and require re-signature.

## Still open

- **A3 Full Report with advice, £595**, a rung with no founder decision behind it. Confirm or cut.
- **Property Care £95 vs the £85 floor**, recurring care sits outside the one-off ladder;
  local J$ menu (J$7,500 / 12,000 / 18,000) untouched.
- **Fee stacking**, Full PM at 12 to 15% against a UK norm of 8 to 15% for *all* professional fees.
- `client_profiles.jobs_completed` never increments, open since the 25 Aug gap check.
- Payout speed contradicts across three documents: 24 hours vs 3 working days.
- names.co.uk zone-file export still blocks the admin-desk subdomain move.
- 2FA on the Supabase admin account, and leaked-password protection.
