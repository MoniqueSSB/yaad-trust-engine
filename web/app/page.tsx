import { createClient } from "@/lib/supabase/server";

// Rendered per request on the server, not baked at build time. This is the
// whole reason the app is Next.js rather than another static page.
export const dynamic = "force-dynamic";

type Health =
  | { ok: true; openJobs: number }
  | { ok: false; message: string };

async function checkDatabase(): Promise<Health> {
  try {
    const supabase = await createClient();
    // open_jobs is the redacted public view: addresses and phone numbers are
    // already stripped before anything leaves Postgres.
    const { count, error } = await supabase
      .from("open_jobs")
      .select("*", { count: "exact", head: true });

    if (error) return { ok: false, message: error.message };
    return { ok: true, openJobs: count ?? 0 };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const PORTALS = [
  {
    name: "Client portal",
    detail: "Track a job, review evidence, approve release of payment.",
  },
  {
    name: "Worker portal",
    detail: "See open jobs, file one evidence package, get paid in 3 days.",
  },
  {
    name: "Admin desk",
    detail: "Vet workers, review evidence, hold the line before money moves.",
  },
];

export default async function Home() {
  const health = await checkDatabase();

  return (
    <main className="mx-auto max-w-4xl px-5 py-16">
      <header className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-[9px] bg-teal font-display text-lg text-[#04211d]">
          Y
        </div>
        <b className="text-lg font-bold">
          Yaad<span className="text-mango">ly</span>
        </b>
      </header>

      <h1 className="mt-10 font-display text-5xl leading-tight tracking-wide sm:text-6xl">
        The app starts here
      </h1>
      <p className="mt-4 max-w-2xl text-mute">
        Next.js on Cloudflare Workers, wired to the live Supabase project. The
        marketing site at yaadly.co.uk is untouched and stays exactly where it
        is.
      </p>

      <section className="mt-10 rounded-xl border border-line bg-panel p-5">
        <div className="flex items-center gap-2.5">
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              health.ok ? "bg-tealb" : "bg-coral"
            }`}
          />
          <h2 className="font-bold">
            {health.ok ? "Database connected" : "Database unreachable"}
          </h2>
        </div>
        <p className="mt-2 text-sm text-mute">
          {health.ok ? (
            <>
              Queried server-side at request time. The redacted{" "}
              <code className="text-tealb">open_jobs</code> view currently
              returns{" "}
              <b className="text-ink">
                {health.openJobs} open {health.openJobs === 1 ? "job" : "jobs"}
              </b>
              .
            </>
          ) : (
            health.message
          )}
        </p>
      </section>

      <section className="mt-8 grid gap-3 sm:grid-cols-3">
        {PORTALS.map((p) => (
          <div
            key={p.name}
            className="rounded-xl border border-line bg-panel2 p-4"
          >
            <h3 className="text-sm font-bold">{p.name}</h3>
            <p className="mt-1.5 text-sm text-dim">{p.detail}</p>
            <p className="mt-3 text-xs font-bold tracking-wide text-mango">
              NOT BUILT YET
            </p>
          </div>
        ))}
      </section>
    </main>
  );
}
