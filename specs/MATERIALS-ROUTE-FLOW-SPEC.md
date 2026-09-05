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

### Stage 3. Worker quotes, and says what the job needs

**On both routes the worker lists the materials the job requires**, item by item,
with quantities. This is not description and it is not optional dressing on the
quote. It exists to stop the failure every site knows: the tradesperson travels
to Portmore, and the blocks are not there.

- **Route A:** labour, materials money, and the list. The list is what the
  materials money is released against, and what the receipt is read against
  afterwards.
- **Route B:** labour only, and the list. The materials money field is **not
  shown**, and a Route B quote carrying a materials figure is refused by
  Postgres, not only by the form. Here **the list is the order the client
  fills.** Without it, Route B tells a client they are supplying the materials
  and gives them no way to know what to buy, which guarantees the wasted
  journey rather than preventing it.

**On Route B each line is ticked off as it arrives**, by the client, and an
outstanding line is why a start date moves rather than the worker being at
fault. The worker can see before he sets out whether the site is ready for him.

There are deliberately **no prices on the list**. The money is `labour_jmd` and
`materials_jmd` on the quote itself, and a second set of figures beside them is a
second source of truth about the same job.

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

**Step 1. The database, done 5 September 2026** (`20260905d`). The route becomes
a constrained column, the materials list becomes a table hanging off the quote,
a Route B quote carrying materials money is refused by a trigger, and the client
ticks a line off through `mark_material_supplied()` rather than a broad update
policy. Nothing visible moves yet, which is the point: the rules exist before
any form relies on them. Guard tests in
`supabase/tests/materials_route_guards.sql`.

**Step 2. The post-a-job form asks the question.** The two options above, with
the Route B consequence shown next to it. `yaad-post-job` maps the answer the
way it already maps the three store types, and refuses an unrecognised value
rather than storing free text.

**Step 3. The store question moves to posting on Route A, done 5 September
2026.** It stays enforced in Postgres by `materials_store_nominated()`; what
changed is when it is asked. `STORES` and `storeAnswered()` in
`web/lib/jobs/new-form.ts` mirror the three codes and the rule that the two
named stores require a description; the server side already existed in
`yaad-post-job`. The go-live gate in `gates.ts` is now a catch for jobs arriving
by other doors, WhatsApp through `yaad-inbound`, the desk, and everything posted
before the question existed, with a comment saying so, since a redundant-looking
gate is one somebody deletes.

Route B does not ask, because the client is delivering their own materials, so
there is no tranche for Postgres to refuse and no pricing question for the
worker. A required question with no consequence is how a form teaches people to
skip questions.

The free-text room description is deliberately kept OUT of the saved draft. Its
type is kept, because "nowhere securable" is a fact the worker prices against
and it names no room, while the description names where the valuable things are
kept on a property that is often empty, and a draft sits in `localStorage` for a
week on a phone other people use.

**Step 4. The quote form carries the materials list**, on both routes, and hides
the materials money field on Route B. The trigger from step 1 is already behind
it.

**Step 5. The client sees the list, and on Route B ticks it off.** The worker
sees what is outstanding before he travels.

**Step 6. Materials becomes stage one on Route A** in the invoicing path,
payable before the labour stages run.

**Step 7. Retire the four prototype options** in `preview/index.html` and
replace them with the two.

**Legacy rows.** The check constraint on `materials_by` went in `NOT VALID`, so
old free-text values survive and only new and updated rows are held to the two
answers. Backfilling them is a data decision that belongs with step 2, once the
form settles what a legacy job should become.

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
