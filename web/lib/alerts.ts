/* The job alert list, the one thing the app needs to know about it.
 *
 * Anybody may put their number on the list and be told when a job opens in
 * their trades and parishes. Only a vetted worker may quote, and the reply they
 * get when they join says so rather than letting them find out when a job they
 * cannot take arrives.
 *
 * WHY THIS IS A LINK AND NOT A FORM. The message they send is what puts them on
 * the list, and that single message proves three things a typed number box
 * proves none of: the number really is theirs, they asked for this in their own
 * words, and WhatsApp's 24 hour window is open so the replies are ordinary
 * messages rather than approved templates. Nothing on this side stores
 * anything; the button opens WhatsApp with the sentence already typed and the
 * person presses send.
 *
 * The wording is the one Monique approved on 6 September for the board's
 * "Launching soon" panel, adopted as the spec on 13 September when two
 * sessions were found to have shipped two sentences for the same button.
 *
 * THIS SENTENCE IS DUPLICATED ON PURPOSE, the same way web/lib/taxonomy.ts
 * duplicates the trade list. The lane that recognises it runs on Deno, in
 * supabase/functions/yaad-inbound/job-alerts.ts, which owns the original and
 * cannot be imported from a Next.js build. A test in that folder reads this
 * file and fails if the two drift, because a button carrying a sentence the
 * lane does not recognise looks perfectly fine and silently does nothing.
 */

export const ALERTS_OPENER = "Hello Yaadly, I am a worker and I want WhatsApp job alerts. My trades and parishes are:";

/** The Yaadly WhatsApp sender, the same number every button on the site uses. */
export const ALERTS_WA_LINK =
  "https://wa.me/447878877567?text=" + encodeURIComponent(ALERTS_OPENER);
