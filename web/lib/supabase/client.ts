import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components (anything with "use client").
 *
 * Uses the publishable key, which is public by design. Row level security in
 * Postgres is what actually protects the data. Never put a service role key
 * anywhere it can reach the browser.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
