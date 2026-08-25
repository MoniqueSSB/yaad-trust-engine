import { createClient } from "@/lib/supabase/server";

/**
 * Server-side auth check. Call this at the top of every protected page,
 * layout and Server Action.
 *
 * WHY THERE IS NO proxy.ts (the file formerly called middleware.ts):
 *
 * Next.js 16 pins Proxy to the Node.js runtime and refuses a `runtime`
 * override, and Cloudflare Workers cannot run Node.js middleware. So the
 * usual Supabase "refresh the session in middleware" recipe is unavailable
 * on this stack.
 *
 * That is not a security problem, because it was never a safe place to put
 * the check in the first place. Next's own docs say to verify auth inside
 * each Server Function rather than relying on Proxy: a matcher change or a
 * moved route silently removes Proxy coverage, and nothing tells you.
 *
 * Consequence to know about: token refresh happens in the browser client,
 * not on the server. A user returning after their access token expired can
 * look logged out for the moment it takes the client to refresh. Send them
 * to sign in rather than showing a broken page.
 */
export async function getUser() {
  const supabase = await createClient();
  // getUser() revalidates the token with Supabase. Never trust getSession()
  // for an authorisation decision: it only reads the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Convenience for pages that must have a signed-in user. */
export async function requireUser() {
  const user = await getUser();
  if (!user) throw new Error("Not signed in");
  return user;
}
