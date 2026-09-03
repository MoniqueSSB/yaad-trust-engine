import { redirect } from "next/navigation";

/**
 * There is nothing to forget any more.
 *
 * This page asked for an email and sent a password recovery link. Sign in was
 * rebuilt passwordless on 31 August 2026: it calls verifyOtp with a code, and
 * its own comment says "there are no passwords now". This page outlived the
 * mechanism it served, kept describing it, and was linked from nowhere.
 *
 * Its actual job still exists though, and sign in already does it: somebody
 * who cannot get in types their email, leaves the code box blank, and the same
 * button sends them a fresh code. So this forwards rather than 404s. A route
 * that has been in the wild deserves to keep working, and anything that still
 * points here (an old email, a bookmark, a message from months ago) lands on
 * the page that can actually help rather than on an error.
 *
 * Removed with it: the resetPasswordForEmail call. Nothing in this codebase
 * mints a password link any more, because nothing accepts a password.
 *
 * Founder decision needed on the last step, and it is deliberately NOT taken
 * here: the Supabase Auth email templates may still contain a "reset your
 * password" template pointing at /portal/reset. Retiring that template is a
 * change to what clients receive, so it is hers, not this file's. Until then
 * both routes forward and nobody lands anywhere broken.
 */
export default function Forgot() {
  redirect("/portal/sign-in");
}
