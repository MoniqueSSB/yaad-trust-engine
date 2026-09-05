# Materials: who supplies them, and where that is decided

**Spec of 5 September 2026. Describes what is built today, what is wrong with the
order it happens in, and what the journey should be. Nothing in here is built
yet.**

Route A and Route B are defined in `legal/subcontractor-agreement-DRAFT.md`
clause 8. This spec is about **where in the customer journey the client answers
which one**, and what has to move to put it there.

---

## 1. What is built today

| Step | Who acts | What happens | Where |
|---|---|---|---|
| Post a job | Client | `materialsBy` is accepted as **free text** and stored on `jobs.materials_by` | `supabase/functions/yaad-post-job/index.ts` |
| Board | Worker | `materials_by` is shown as a spec chip next to job type, size band and access | `web/app/jobs/page.tsx` |
| Quote | **Worker** | He enters `labour_jmd` and `materials_jmd`, with `materials_at_cost: true` | `web/app/jobs/actions.ts` |
| See quotes | Client | Quotes are shown with labour split from materials, and one is accepted | `web/app/jobs/[id]/quotes/page.tsx` |
| Go live | Client | **Only if the accepted quote carries materials money**, a checklist item appears: "Say where materials are kept" | `web/lib/portal/gates.ts`, `web/app/portal/materials-actions.ts` |
| Release | Desk | A `materials_releases` row is refused outright unless a store is nominated | `supabase/migrations/20260828c` |

The clickable prototype at `preview/index.html` asks the question with four
options: *Worker supplies and invoices with receipts*, *I supply the materials*,
*Split, agree item by item*, *Not sure, worker to advise*.

---

## 2. Four things wrong with that, in order of how much they cost

**1. The wrong person decides.** Nobody asks the client whether they are
supplying materials. In practice the **worker** decides the route, by whether he
puts a number in `materials_jmd`. The client's only materials question is where
to keep them, and that is asked after the fact.

**2. It happens too late to be useful.** "Say where materials are kept" fires
after the client has accepted a quote. The route question cannot live there,
because by then every quote on the job is already priced. A worker who priced
materials for a client who was always going to supply them has quoted the wrong
job, and the client accepted a number that should never have been on the page.
The gate's own code comment makes the argument for moving it: *"A worker cannot
price this honestly without it."* That is true of the store, and it is far more
true of who is buying.

**3. `jobs.materials_by` is decoration.** Free text, no check constraint,
written once by `yaad-post-job` and read only to print a chip on the board and a
column in the desk. Nothing branches on it. If it becomes the route decision it
needs a constrained set of values and things have to read it.

**4. Two of the prototype's four options cannot survive the principal
structure.**

- *"Worker supplies and invoices with receipts"* describes the venue model. The
  worker does not invoice the client, because the client does not contract with
  the worker.
- *"Split, agree item by item"* mixes both routes on one job. Clause 8 forbids
  that, and not for tidiness: the workmanship obligation and the risk on the
  goods have to sit with the same party, and a split job cannot say who is
  answerable when a wall fails.
- *"Not sure, worker to advise"* leaves it open at exactly the moment quoting
  starts, which is the thing being fixed.

Only *"I supply the materials"* survives, as Route B.

---

## 3. The journey it should be

The materials question is answered **once, by the client, at the point the job is
posted**, before any worker sees it. Everything downstream reads that answer.

### Stage 1. Client posts the job

**The question, in two options and no others:**

> **Who is buying the materials for this job?**
>
> - **Yaadly buys them.** They are part of the price, and they are the first
>   payment on the job. You will see the receipt and photographs of them on your
>   property before any labour is paid for. *(Route A, the normal one.)*
> - **I am supplying them myself.** You buy and deliver the materials, and Yaadly
>   is engaged for the labour only. *(Route B.)*

Beneath Route B, in plain sight rather than in terms, what it changes:

> If you supply the materials, the tradesperson is not answerable for them being
> short, late, wrong or not fit for the work, dates move if they are not there,
> and the workmanship guarantee covers his work and not your materials.

**On Route A the client also answers where materials are kept, here, at posting,
not after acceptance.** It moves up for the reason the current gate already
states: the worker cannot price the job honestly without it. `none_available` is
a real answer and puts the job on the drops fallback, which the worker prices in.

### Stage 2. Board

The route is on the job spec, so the worker sees which he is quoting before he
opens it.

### Stage 3. Worker quotes

- **Route A:** labour and materials, as today.
- **Route B:** labour only. The materials field is **not shown**, so it cannot be
  filled in by habit and a Route B quote cannot carry a materials number.

### Stage 4. Client accepts a quote

Unchanged, except the total the client is accepting now means what it says,
because it was priced against a known route.

### Stage 5. Route A only: materials is the first payment

1. The client is invoiced for the **materials stage**, and pays it before
   anything is bought. This is a stage of Yaadly's price for the job, not a fund
   held for the worker.
2. Yaadly releases that money to the worker against the materials list
   (`materials_releases`).
3. The worker buys, and files **the receipt, photographs, and a video of the
   materials in the nominated store**.
4. That evidence closes the materials stage. Until the receipt reference is on
   the row, the tranche shows in `materials_open_releases` and it is chased.

**Route B has no materials stage.** The client supplies. The worker records what
arrived and its condition, photographed, **before he builds with any of it**,
which is the only thing that protects him later.

### Stage 6 onward

Labour stages as today: Arrival Log, before capture, Midnight Work-Log, walk
round at the end. Client accepts the work. Yaadly pays the worker under its own
agreement with him.

---

## 4. What has to change to build this

Listed so the size is visible before anything moves. Roughly smallest first.

1. **Constrain `jobs.materials_by`.** A check constraint permitting two values,
   `yaadly` and `client`, plus null for jobs posted before this. Migration.
2. **Ask it on the post-a-job form**, as the two options above, with the Route B
   consequences shown. `yaad-post-job` maps the answer, the way it already maps
   the three store types, and refuses an unrecognised value rather than storing
   free text.
3. **Move the store question to posting on Route A.** It stays enforced in
   Postgres by `materials_store_nominated()`; what changes is when it is asked.
   The go-live gate in `gates.ts` becomes a catch for jobs that somehow reached
   acceptance without it, rather than the normal path.
4. **Hide the materials field on a Route B quote** and reject a Route B quote
   carrying `materials_jmd > 0` server side, not only in the form.
5. **Make materials stage one on Route A** in the invoicing path, payable before
   the labour stages run.
6. **Retire the four prototype options** in `preview/index.html` and replace them
   with the two.

**Not in this spec, and each is its own decision:** the client-facing copy on
`docs/`, which still says materials are "passed through"; whether Route B is
offered on every job or only above a size; and the £500 card threshold, which
Route A collides with and which is recorded in `DECISIONS.md`.

---

## 5. The one thing to get right

The client's answer at Stage 1 is a **commercial decision about who carries the
risk on the goods**, and it is dressed as a form field. Route B is not a
cheaper Route A. It moves the materials risk, the programme risk and part of the
guarantee onto the client, and a client who ticks it to save money without
understanding that will be angry later, with reason.

So the two options are written with their consequence attached, at the moment of
choosing, and not left to the terms page. That is the same rule the rest of this
product runs on: the person deciding sees what the decision costs, before they
make it, and a named human is on the other side of it.
