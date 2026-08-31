/**
 * The one branch driving the sign in form: does the code box hold something
 * worth trying, or does the page need to send a fresh one.
 *
 * Pulled out of the page component so it can be tested without rendering
 * React: the founder's own requirement, 31 Aug 2026, was that a returning
 * visitor who already has a six digit code should be able to type it
 * straight in, alongside their email, on the one screen. Whether that is
 * possible is exactly this function.
 */

export function normalizeCode(input: string): string {
  return input.replace(/\D/g, "");
}

export function isCodeComplete(input: string): boolean {
  return normalizeCode(input).length === 6;
}

export function signInButtonLabel(otp: string, busy: boolean): string {
  if (busy) return isCodeComplete(otp) ? "Checking..." : "Sending your code...";
  return isCodeComplete(otp) ? "Open my portal" : "Send me a sign in code";
}
