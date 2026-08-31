/* RETIRED, 31 August 2026 (Stage 3, the single front door).
 *
 * This served the public "Tell us what needs doing" form on yaadly.co.uk. That
 * form was deleted in Stage 1, when docs/ became short marketing and the app
 * became the only place a job is created. Nothing has called this since: the
 * only reference left anywhere was one line in web/README.md.
 *
 * It is a stub rather than a deletion because of what it was. It created JOBS,
 * it took no authentication by design (a visitor filling a public form has no
 * session), and it was reachable by anyone who knew the URL. An unreferenced
 * public endpoint that writes rows is the kind of thing that survives three
 * refactors because nobody remembers it exists. A 410 that says what happened
 * is a better answer than a 404 that says nothing, and if something out there
 * is still calling it, this is how we find out rather than losing the job.
 *
 * Where the work went: web/app/jobs/new posts to yaad-post-job in draft mode,
 * which writes no personal data at all, and the contact details go separately
 * to yaad-enquiry. WhatsApp and email intake are unchanged and still land in
 * the same tables.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  console.warn("yaad-website-intake called after retirement:", req.headers.get("referer") ?? "no referer");
  return new Response(
    JSON.stringify({
      error: "This intake has been retired. Post the job at https://app.yaadly.co.uk/jobs/new, or message Yaadly on WhatsApp.",
      moved_to: "https://app.yaadly.co.uk/jobs/new",
    }),
    { status: 410, headers: { ...CORS, "Content-Type": "application/json" } },
  );
});
