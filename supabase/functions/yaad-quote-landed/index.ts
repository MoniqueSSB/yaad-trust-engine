/* RETIRED, 31 August 2026 (Stage 5.3, client notifications on every state change).
 *
 * This told a client a price had landed. It was called from one place:
 * web/app/jobs/actions.ts, fired from the UI right after the worker's quote
 * insert succeeded. Stage 5.3 moved that job to a database trigger instead
 * (notify_client_quote_arrived, on job_quotes AFTER INSERT WHEN status =
 * 'submitted'), alongside evidence_landed, stage_released and
 * dispute_raised, all firing from the same generalised notifier,
 * yaad-notify-client. The rule going forward: state changes fire
 * notifications, never the UI that caused them.
 *
 * It is a stub rather than a deletion for the same reason as
 * yaad-website-intake: this took the caller's session token and looked up
 * a job's client contact details on the caller's behalf. An unreferenced
 * endpoint that reads client email and phone against a bearer token is the
 * kind of thing that should say what happened if something still calls it,
 * not silently 404.
 *
 * Where the work went: supabase/functions/yaad-notify-client, driven by
 * supabase/migrations/20260831i_notify_client_from_the_state_change.sql and
 * 20260831j_stage_released_fires_on_the_first_stage_too.sql.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  console.warn("yaad-quote-landed called after retirement:", req.headers.get("referer") ?? "no referer");
  return new Response(
    JSON.stringify({
      error: "This notifier has been retired. Quote notifications now fire from a database trigger on job_quotes, not from the UI.",
      moved_to: "yaad-notify-client",
    }),
    { status: 410, headers: { ...CORS, "Content-Type": "application/json" } },
  );
});
