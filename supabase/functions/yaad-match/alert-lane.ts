// The WhatsApp job alert: who gets one, what it says. 30 Sep 2026.
//
// Founder: "wire the alerts", yes. The list has filled since 6 September and
// nothing was sent. Now, when a person presses Match on the desk, everybody
// on the list whose trade keys match the job (and parish, when they named
// parishes) gets ONE template message. A number gets at most ALERT_CAP a day,
// whatever the desk does. Somebody not yet cleared hears about the job and
// is told to finish their check; they cannot quote until a person clears
// them, and the message says so. Pure, tested without a webhook.

export const ALERT_CAP = 5;

export type AlertSubscriber = { phone: string; name: string | null; can_quote: boolean; match_reason: string };

/** The third slot of the template: what to do about the job. */
export function alertAction(canQuote: boolean, appUrl: string): string {
  return canQuote
    ? `Price it in your portal: ${appUrl}/portal/sign-in`
    : `Finish your check to quote: ${appUrl}/apply`;
}

/** The key job_alerts records a number under. The list has no email. */
export function alertKey(phone: string): string {
  return "wa:" + (phone ?? "").replace(/\D/g, "");
}

/** One line, no personal data: trade and parish only. */
export function alertVars(trade: string, parish: string | null, canQuote: boolean, appUrl: string): Record<string, string> {
  return { "1": (trade || "property").slice(0, 60), "2": (parish || "Jamaica").slice(0, 40), "3": alertAction(canQuote, appUrl) };
}
