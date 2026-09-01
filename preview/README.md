# Yaadly, prototype preview

**Live at:** https://yaadly.co.uk/preview/
**Does not touch the live site.** `docs/index.html` is production; this is a separate
path so the prototype can be reviewed at a real URL without risk.

Last updated 26 August 2026.

---

## What this is

A clickable prototype of the whole platform, homepage, marketplace, services,
client and worker portals, the post-a-job wizard, the WhatsApp intake workflow,
and the worker join journey. Nothing is saved and no money moves. There is no
Supabase connection: all data on these screens is illustrative.

It exists to settle product and pricing decisions before they are built into
`docs/index.html`.

## Screens

| Route | What it shows |
|---|---|
| Home | The verified job loop, the WhatsApp lane, an animated held-money graphic |
| Marketplace | Job cards with structured fields and photos, worker profiles, quoting |
| Services | The full inspection ladder and the UK market table it is priced against |
| Portals | Client, worker and service-client journeys, calendar-first |
| Join as a pro | Nine-step worker onboarding with a live vetting record |
| WhatsApp intake | Six-step playable workflow, manual and automated modes |
| How it's wired | Agent inventory, gates, schema notes |

## Decisions this prototype carries

**Gating.** Anyone can build a job with no account. It saves as a draft. It reaches
the marketplace only when the client signs up **and** confirms the Client Guidelines.
No signature, no listing, whichever door they came through.

**Agents are locked until signature.** No AI touches a client's work until they have
signed and have a profile. The first job is a fully manual intake.

**Yaadly does not price work.** No price band is shown to a worker, ever. The client's
budget band is client-side only and carries a "never shown to workers" marker. Yaadly
does project management and oversight, not price estimation.

**Reference gate.** A worker cannot quote any job over £500, any work inside an
occupied home, or any job where they hold keys or attend an empty property, until
their telephoned references are done.

**Documents.** Worker Guidelines v1.1 and Client Guidelines v1.1 are full signed
agreements with acknowledgement blocks, not tickboxes. Both carry a visible
"amended in v1.1" note explaining what changed and why.

**Kickoff packs are tiered.** One stage gets a one-page Scope of Works & Job Sheet
built from the accepted quote. Two or three stages get a full Kickoff Pack. Four or
more get a pack plus programme and materials schedule.

## Pricing, anchored to published UK rates

Every figure below has a live market comparable; the full table is on the Services
screen with sources.

**Whole-property reports**, Visual Check £149 · Condition Report £325 ·
Full Report with advice £595

**In-job sign-offs**, Visual Check £149 · Technical Sign-off £300

**Recurring**, Property Care £95 / £135 / £175 per visit ·
Oversight Retainer fortnightly £595/mo, weekly £1,095/mo

**Advisory**, Deposit Protection Check £249 · Full Project Management 12 to 15%,
minimum £2,500

**Add-on**, Live viewing £40 on any rung

Founding prices for the first five run below each full price and are shown as a real,
dated discount off a price that is genuinely purchasable, required under DMCCA 2024 s226.

Marketplace fee is unchanged: 27% blended on labour only, never on materials, 15% client, 12% worker, worker keeps 88%.

## Removed, deliberately

- **Project Setup Pack**, not required
- **Certified Milestone Sign-off**, removed
- **Document Pack Check**, removed
- **Founding Pros 0% for 90 days**, not happening

## Still open

- **A3 Full Report with advice, £595**, a rung with no founder decision behind it.
  Confirm or cut.
- **Property Care £95 vs the £85 floor**, recurring care sits outside the one-off
  ladder; the local J$ menu (J$7,500 / 12,000 / 18,000) is untouched.
- **Fee stacking**, Full PM at 12 to 15% against a UK norm of 8 to 15% for all
  professional fees combined.
- Client counter (`client_profiles.jobs_completed`) still never increments in production.
- `yaad-match` and the patched `yaad-agent` are written and tested but not deployed.

## Not in here

No Supabase auth, no live payments, no admin desk, no service worker. Those live in
`docs/index.html` and `concierge/concierge.html`.
