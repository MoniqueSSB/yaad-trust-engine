/**
 * The one branch driving the sign in form: does the code box hold something
 * worth trying, or does the page need to send a fresh one.
 *
 * Pulled out of the page component so it can be tested without rendering
 * React: the founder's own requirement, 31 Aug 2026, was that a returning
 * visitor who already has a code should be able to type it straight in,
 * alongside their email, on the one screen. Whether that is possible is
 * exactly this function.
 *
 * CODE_LENGTH is 8, not 6, and this is load bearing, found live and the
 * hard way, 31 Aug 2026: every page in this app called it a "six digit
 * code", and the very first version of this gate checked for exactly six
 * digits before ever attempting to verify. Supabase actually issues eight
 * for this project. A real code, typed correctly, was being read as
 * incomplete every single time, so the button never did anything but send
 * another one, forever, and nobody could sign in. Confirmed against a real
 * email: "16969202 is your Yaadly sign in code." If this project's OTP
 * length is ever reconfigured, this is the one number to change, and nowhere
 * in this app's own copy should commit to a specific digit count again,
 * which is why the visible text just says "code" now, not "six digit code".
 */

export const CODE_LENGTH = 8;

export function normalizeCode(input: string): string {
  return input.replace(/\D/g, "");
}

export function isCodeComplete(input: string): boolean {
  return normalizeCode(input).length === CODE_LENGTH;
}

export function signInButtonLabel(otp: string, busy: boolean): string {
  // "Sign in" is the literal word the founder asked for, 31 Aug 2026, once
  // a full code is typed: not "Open my portal", which does not read as an
  // action to somebody looking for a way in.
  if (busy) return isCodeComplete(otp) ? "Signing in..." : "Sending your code...";
  return isCodeComplete(otp) ? "Sign in" : "Send me a sign in code";
}
