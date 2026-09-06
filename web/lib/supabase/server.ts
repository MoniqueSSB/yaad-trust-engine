import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Always create a fresh one per request. Never hoist this into a module level
 * variable: on a server, one shared client would leak one user's session into
 * another user's request.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components cannot set cookies, and this throw is how Next
            // says so. Safe to ignore, but NOT for the reason this comment used
            // to give: it said "middleware.ts refreshes the session on every
            // request", and there is no middleware. There cannot be one. Next
            // 16 pins Proxy to the Node runtime and refuses a runtime override,
            // and Cloudflare Workers cannot run it, so the usual Supabase
            // refresh-in-middleware recipe is unavailable on this stack. See
            // lib/supabase/auth.ts, which explains it at length and disagreed
            // with this file for as long as both existed.
            //
            // What actually happens: the browser client holds the session and
            // refreshes the token. A Server Component that wanted to write a
            // refreshed cookie simply cannot, and the next browser-side call
            // will do it instead. The real consequence is in auth.ts: a user
            // returning after their access token expired can look signed out
            // for the moment it takes the client to refresh.
          }
        },
      },
    },
  );
}
