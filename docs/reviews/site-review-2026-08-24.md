# [C] Yaadly site review, 24 Aug 2026

Live site reviewed: **yaadly.co.uk** (served from `docs/index.html`, one file).
Reviewed after the three journey-hardening packages landed this morning. This is my own review. OllyGarden's Rose has a separate copy to comment on.

## The headline

The site is in good shape. Every page loads, every journey works, there are no console errors and no failed network calls. The three guards from Package 1 hold up under inspection: I confirmed at the database level that the public jobs board scrubs the property address and masks phone numbers, so an anonymous visitor cannot read where a job is. That was the thing that mattered most and it is genuinely closed.

What follows is not a list of things that are broken. It is the smaller stuff worth fixing before you push traffic at it.

## What I checked and what passed

- **All five nav panes** (Website, Marketplace, Services, Client portal, Worker portal) render cleanly.
- **Empty states are handled well.** No open jobs and no listed workers yet, and both say so plainly rather than showing a broken or blank grid.
- **Both portals gate correctly.** Signed out, you can browse open jobs and apply to join (as intended), but you cannot see anyone's jobs or money without signing in.
- **WhatsApp and Cal.com links** are correct and well formed. The WhatsApp "Start your job" link pre-fills the full intake question list.
- **No console errors, no failed requests.** Every Supabase call returned 200. Fonts, Sentry and Supabase all load.

## Worth fixing (site / UX)

**1. The mobile menu does not collapse.** On a phone the five nav pills wrap onto multiple lines and "Client portal" and "Worker portal" each break in two. Your primary traffic is TikTok and Instagram, so most people arrive on a phone and this is the first thing they see. Recommend a single menu button (hamburger) below roughly 600px wide. This is the most worthwhile fix on the list.

**2. Content depends on JavaScript to become visible.** 46 of 54 content blocks start fully transparent and are revealed by a scroll animation. When it works it looks lovely. But if that animation does not fire (an older phone browser, a script hiccup, a slow connection that a visitor scrolls past), whole sections stay invisible with no fallback. Safer pattern: content visible by default, animation as a bonus on top. On a low-bandwidth audience this is a real resilience gain, not a nicety.

**3. Link previews and search basics are missing.** No favicon, no social share image (og:image), no canonical tag. The share image is the one that stings: when someone drops yaadly.co.uk into a WhatsApp group or an Instagram story, the preview has no picture. A single branded image fixes it and makes every share look deliberate.

## Worth fixing (security / the money side)

These come from the Supabase security advisor run against the live database, so they are real, not guesses.

**4. Eight internal database functions are needlessly callable by the public.** Trigger and helper functions (including the one that increments a worker's Yaad Score) can be invoked directly by anyone through the API. Right now this is not exploitable: they are trigger functions and error out when called on their own, without the row context a trigger gives them. But on a product whose whole promise is a trustworthy score, "not exploitable today" is not the same as "locked". Revoke public execute on them. It is a short, one-time database change and it closes the door properly.

**5. Leaked-password protection is off.** Supabase can refuse passwords known to be in public breach lists (HaveIBeenPwned). It is a single toggle in the Auth settings. Turn it on.

## Not a problem, for the record

- The public jobs view is flagged as "security definer" by the advisor. That is by design here: it has to bypass normal row security so it can show open jobs to people who are not signed in, and it only ever exposes scrubbed columns. Leave it.
- Two tables (`app_settings`, `portal_code_attempts`) have security on with no policy. That is the safe state: it denies everyone by default and only your server-side functions reach them. No action needed.

## The one thing

If you do only one item from this list, do the **mobile menu (#1)**. It is on the first screen every phone visitor sees, and phones are your whole funnel.
