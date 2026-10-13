// The WhatsApp content Yaadly sends through Twilio templates, defined in
// code so it is reviewed, tested and reproducible, rather than typed into a
// console once and remembered by nobody.
//
// Only one so far: the section menu. Its row ids are the letters the typed
// question has always accepted (readPhaseAnswer in yaad-inbound), which is
// the whole reason a tap changes nothing downstream. Change a letter here and
// the tap stops matching; the test next to this file holds them.

export const SECTION_MENU_NAME = "yaadly_section_menu_v1";

export function sectionMenuContent() {
  return {
    friendly_name: SECTION_MENU_NAME,
    language: "en",
    variables: { "1": "Got it, going on JOB-WEB-1789253807959, stage 1." },
    types: {
      "twilio/list-picker": {
        body: "{{1}} Which section is this? Tap Choose and pick one.",
        button: "Choose",
        items: [
          { id: "B", item: "Before", description: "The state before you started" },
          { id: "D", item: "During the work", description: "Mid-work" },
          { id: "A", item: "After", description: "The finished work" },
          { id: "P", item: "A problem with the work", description: "Wrong with work already in the job" },
          { id: "N", item: "Something new I found", description: "Never in the job" },
          { id: "S", item: "Skip", description: "File it without a section" },
        ],
      },
    },
  };
}

/** What Meta is asked to approve the section menu as, 19 Sep 2026.
 *
 *  Submitted on the founder's instruction after the menu was found never to
 *  have sent once: Twilio refuses it with "Invalid Parameter" and yaad-inbound
 *  falls back to the typed letters. Utility, because it is a question about a
 *  job the worker is already doing, never marketing. Approval was believed
 *  unnecessary for an in-session send; that belief had never been tested, and
 *  submitting costs nothing either way. */
export const SECTION_MENU_APPROVAL = { name: SECTION_MENU_NAME, category: "UTILITY" };

// The worker update template, 17 Sep 2026. The one Yaadly template that goes
// out to people who have NOT written in within 24 hours, so unlike the section
// menu it needs Meta's approval before it is any use, and the setting that
// switches it on is written only once that approval comes back. The body is
// held word for word against yaad-notify-client/worker-template.ts by the test
// next to this file: that file supplies the sentence that fills {{2}}.
export const WORKER_UPDATE_NAME = "yaadly_worker_job_update_v1";

export const WORKER_UPDATE_BODY =
  "Yaadly update on your job {{1}}: {{2}}. The full details are on the job in your Yaadly portal: {{3}} Reply here if you have a question.";

export function workerUpdateContent() {
  return {
    friendly_name: WORKER_UPDATE_NAME,
    language: "en",
    variables: {
      "1": "Replace stair rails (JOB-WEB-1789253807959)",
      "2": "the client has paid, so the job is live and you can start. When you arrive on site, send your location in this chat to check in",
      "3": "https://app.yaadly.co.uk/portal/jobs/JOB-WEB-1789253807959",
    },
    types: { "twilio/text": { body: WORKER_UPDATE_BODY } },
  };
}

/** What Meta is asked to approve it as. Utility: it is about a job the worker
 *  is already part of, never marketing. */
export const WORKER_UPDATE_APPROVAL = { name: WORKER_UPDATE_NAME, category: "UTILITY" };

// The client's stage report, 29 Sep 2026. Founder: "the client should be
// informed on whatsapp of the job update." Goes to a client who has not
// written in within 24 hours, so like the worker update it needs Meta's
// approval and is switched on only once that comes back. The body is held
// word for word against yaad-notify-client/client-template.ts by the test
// next to this file.
export const CLIENT_UPDATE_NAME = "yaadly_client_job_update_v1";

export const CLIENT_UPDATE_BODY =
  "Yaadly update on your job {{1}}. Your tradesperson reports: {{2}} The photographs and the full report are on the job in your Yaadly portal, where you can approve the work or ask for a change: {{3}} Reply here if you have a question.";

export function clientUpdateContent() {
  return {
    friendly_name: CLIENT_UPDATE_NAME,
    language: "en",
    variables: {
      "1": "Replace stair rails (JOB-WEB-1789253807959)",
      "2": "The new rails are fixed along the full run of the stairs and the old fixings are made good.",
      "3": "https://app.yaadly.co.uk/portal/jobs/JOB-WEB-1789253807959",
    },
    types: { "twilio/text": { body: CLIENT_UPDATE_BODY } },
  };
}

/** Utility: it is about a job the client has already booked, never marketing. */
export const CLIENT_UPDATE_APPROVAL = { name: CLIENT_UPDATE_NAME, category: "UTILITY" };

/** The worker's Sign button on the Completion Report, 28 Sep 2026. Founder:
 *  "it has to be a button the work presses, through whatsapp or the portal".
 *  The button's id is the job's own code, so a tap reaches yaad-inbound as
 *  that code and signs through sign_completion_report_via_whatsapp(), the
 *  same way the client's Approve button works. It follows the message that
 *  carries the link, inside the 24 hour window, which needs no Meta approval. */
// v2, 28 Sep 2026: three buttons, after the founder found "no way to edit"
// and asked for "raise an issue" too, as buttons. Content is immutable in
// Twilio, so a change is a new name; v1 stays in the account unused.
export const SIGN_REPORT_NAME = "yaadly_sign_completion_report_v2";

export const SIGN_REPORT_BODY =
  "{{1}}: your Completion Report is ready. Sign it as it stands, change your words first, or raise an issue if something is wrong.";

export function signReportContent() {
  return {
    friendly_name: SIGN_REPORT_NAME,
    language: "en",
    variables: { "1": "Shower wall retiled (JOB-WEB-1789253807959)", "2": "JOB-WEB-1789253807959" },
    types: {
      "twilio/quick-reply": {
        body: SIGN_REPORT_BODY,
        actions: [
          { title: "Sign the report", id: "{{2}}" },
          { title: "Change my words", id: "EDIT {{2}}" },
          { title: "Raise an issue", id: "ISSUE {{2}}" },
        ],
      },
    },
  };
}

/** The three buttons under a report draft, 29 Sep 2026. Founder: "this should
 *  also all be buttons also that people tap instead of writing".
 *
 *  They follow the draft, which is sent as a message of its own so that a
 *  long press copies the draft and nothing else. Each id carries the job's
 *  code, so a button tapped days later on an old message cannot act on a
 *  different job's draft: yaad-inbound checks the code against the draft that
 *  is actually waiting. A tap reaches yaad-inbound as text, the same as the
 *  other buttons, so "Send as written" is a way of replying 1 and not a new
 *  authority. Used in session only, straight after the worker's own photos,
 *  so nothing is submitted to Meta. */
// v2, 29 Sep 2026: the same three buttons under short lines. Founder: "it is
// a whole paragraph", "the sentences cant be long". It also says the typed
// way, reply 1, because a button does not show on every phone and this is
// now the one message that says what to do. Content is immutable in Twilio,
// so a change is a new name; v1 stays in the account unused.
export const REPORT_DRAFT_NAME = "yaadly_report_draft_buttons_v2";

export const REPORT_DRAFT_BODY =
  "Your job: {{1}}\n\nThe draft above is for the client.\nTap a button, or reply 1 to send it.\n\nNothing goes to the client until you choose.";

export const REPORT_DRAFT_SEND = "DRAFTSEND";
export const REPORT_DRAFT_EDIT = "DRAFTEDIT";
export const REPORT_DRAFT_OWN = "DRAFTOWN";

export function reportDraftContent() {
  return {
    friendly_name: REPORT_DRAFT_NAME,
    language: "en",
    variables: { "1": "Replace stair rails (JOB-WEB-1789253807959)", "2": "JOB-WEB-1789253807959" },
    types: {
      "twilio/quick-reply": {
        body: REPORT_DRAFT_BODY,
        actions: [
          { title: "Send as written", id: `${REPORT_DRAFT_SEND} {{2}}` },
          { title: "Edit it", id: `${REPORT_DRAFT_EDIT} {{2}}` },
          { title: "Write my own", id: `${REPORT_DRAFT_OWN} {{2}}` },
        ],
      },
    },
  };
}

/** The daily check-in, as a button, 29 Sep 2026. One check-in a day covers
 *  every stage worked that day and may be sent before or after the work.
 *
 *  Unlike the draft buttons this goes to people who may NOT have written in
 *  within 24 hours, so it needs Meta's approval before it is any use, and the
 *  setting that switches it on is written only once that approval comes back,
 *  the same as the worker update template. */
// v2, 30 Sep 2026, founder: "split this into two messages are you on site
// with a add location button then the other stuff in a 1.2.3". This is the
// first message: the question, the button, and how to add the location.
// WhatsApp has no button that attaches a location through Twilio, so the
// location is the three taps in words. The 1.2.3 goes as a second message
// through the approved worker update template (yaad-daily-checkin). v1
// stays in the account; Meta approval starts again for v2.
export const ON_SITE_NAME = "yaadly_on_site_checkin_v2";

export const ON_SITE_BODY =
  "Yaadly, your job {{1}}.\n\nAre you on site today?\nTap I am on site.\nThen add your location: tap +, Location, Send current location.";

/** The second message, one line, through the approved worker update
 *  template: "Yaadly update on your job {{1}}: {{2}}. The full details are on
 *  the job in your Yaadly portal: {{3}} Reply here if you have a question." */
export const ON_SITE_STEPS =
  "1. Photos and videos before, during and after. 2. One line on what each shows. 3. Send them here before you leave";

export const ON_SITE_TAP = "ONSITE";

export function onSiteContent() {
  return {
    friendly_name: ON_SITE_NAME,
    language: "en",
    variables: { "1": "Replace stair rails (JOB-WEB-1789253807959)", "2": "JOB-WEB-1789253807959" },
    types: {
      "twilio/quick-reply": {
        body: ON_SITE_BODY,
        actions: [{ title: "I am on site", id: `${ON_SITE_TAP} {{2}}` }],
      },
    },
  };
}

export const ON_SITE_APPROVAL = { name: ON_SITE_NAME, category: "UTILITY" };

/** The two buttons under a worker's own words read back, 29 Sep 2026.
 *  Founder: "add buttons that can be pressed for options".
 *
 *  A typed update is read back and waits for a 1 before it goes on the job
 *  (yaad-inbound/update-draft.ts). These are that 1 and that "no", as taps.
 *  Each id carries the job's code, so a button tapped later on an old message
 *  cannot file or drop a different update: yaad-inbound checks the code
 *  against the update that is actually waiting. A tap is a way of typing and
 *  never a new authority. Change my words asks for the new words, and the
 *  words typed next replace the update and are read back in their turn.
 *
 *  Used in session only, straight after the worker's own message, so nothing
 *  is submitted to Meta. {{3}} is the sentence about photographs, which is
 *  different for a note on photos already filed. */
// v2, 30 Sep 2026: the last line also says the typed way, reply 1, because
// a button does not show on every phone and the typed read-back has always
// said reply 1 (update-draft.ts). The same fix the report draft had in its
// v2. Content is immutable in Twilio, so a change is a new name; v1 stays in
// the account unused once create-update-draft has been run again.
export const UPDATE_DRAFT_NAME = "yaadly_update_read_back_v2";

export const UPDATE_DRAFT_BODY =
  'Ready to go on {{1}}:\n"{{2}}"\n\n{{3}}\n\nNothing is filed until you tap Put it on the job, or reply 1.';

export const UPDATE_DRAFT_FILE = "UPDATEFILE";
export const UPDATE_DRAFT_DROP = "UPDATEDROP";
export const UPDATE_DRAFT_CHANGE = "UPDATECHANGE";

export function updateDraftContent() {
  return {
    friendly_name: UPDATE_DRAFT_NAME,
    language: "en",
    variables: {
      "1": "JOB-WEB-1789253807959 (Replace stair rails)",
      "2": "stage one done, the new rails are in",
      "3": "Photos you send next carry these words.",
      "4": "JOB-WEB-1789253807959",
    },
    types: {
      "twilio/quick-reply": {
        body: UPDATE_DRAFT_BODY,
        actions: [
          { title: "Put it on the job", id: `${UPDATE_DRAFT_FILE} {{4}}` },
          { title: "Change my words", id: `${UPDATE_DRAFT_CHANGE} {{4}}` },
          { title: "Drop it", id: `${UPDATE_DRAFT_DROP} {{4}}` },
        ],
      },
    },
  };
}

/** The trades and parishes questions as lists to tap, 29 Sep 2026. Founder:
 *  "all of these choice shoulld be a button".
 *
 *  WhatsApp allows three buttons, or one list of ten rows where one row is
 *  picked. There are eighteen trades and fourteen parishes and a worker may
 *  have several, so the list carries the ten most likely and the body says
 *  that typing still works, which is how somebody names more than one or one
 *  that is not listed. Each row's id is a word the typed question has always
 *  understood (trade_key and parish_key in Postgres), so a tap reaches
 *  yaad-inbound as text and nothing downstream changes.
 *
 *  {{1}} is the lead sentence. On joining it carries what they joined,
 *  ALERT_TERMS_JOINED, word for word, so what somebody agreed to is still a
 *  thing they read. Used in session only, so nothing is submitted to Meta. */
// v2, 30 Sep 2026: the list shows ten of eighteen trades, and v1 only said
// how to name more than one, never how to name one that is not listed. Now
// it says both, with the same examples the typed question gives.
export const ALERT_TRADES_NAME = "yaadly_alert_trades_menu_v2";
export const ALERT_TRADES_BODY =
  "{{1}}\n\nWhat work do you do?\nTap Choose and pick one.\nMore than one, or yours is not on the list? Type them, like: plumbing, tiling, solar.";
export const ALERT_TRADE_ROWS: readonly string[] = [
  "Plumbing", "Electrical", "Masonry", "Painting", "Roofing",
  "Tiling", "Carpentry", "Welding", "Air conditioning", "Handyman",
];

export function alertTradesContent() {
  return {
    friendly_name: ALERT_TRADES_NAME,
    language: "en",
    variables: { "1": "You are on the list." },
    types: {
      "twilio/list-picker": {
        body: ALERT_TRADES_BODY,
        button: "Choose",
        items: ALERT_TRADE_ROWS.map((t) => ({ id: t, item: t })),
      },
    },
  };
}

// v2, 30 Sep 2026: nine of fourteen parishes fit on the list (St James,
// Trelawny, Hanover, Westmoreland and St Elizabeth do not), so it says how to
// name one that is missing, and asks the question in the typed words.
export const ALERT_PARISHES_NAME = "yaadly_alert_parishes_menu_v2";
export const ALERT_PARISHES_BODY =
  "{{1}}\n\nWhich parishes will you go to?\nTap Choose and pick one.\nMore than one, or yours is not on the list? Type them, like: St James, Kingston.";
export const ALERT_PARISH_ROWS: readonly { id: string; item: string }[] = [
  { id: "Kingston", item: "Kingston" },
  { id: "St Andrew", item: "St Andrew" },
  { id: "St Catherine", item: "St Catherine (Portmore)" },
  { id: "St Thomas", item: "St Thomas" },
  { id: "Portland", item: "Portland" },
  { id: "St Mary", item: "St Mary" },
  { id: "Clarendon", item: "Clarendon" },
  { id: "Manchester", item: "Manchester" },
  { id: "St Ann", item: "St Ann" },
  { id: "Anywhere", item: "Anywhere in Jamaica" },
];

export function alertParishesContent() {
  return {
    friendly_name: ALERT_PARISHES_NAME,
    language: "en",
    variables: { "1": "Got it: Plumbing." },
    types: {
      "twilio/list-picker": {
        body: ALERT_PARISHES_BODY,
        button: "Choose",
        items: ALERT_PARISH_ROWS.map((r) => ({ id: r.id, item: r.item })),
      },
    },
  };
}

/** The client's Accept button on a walkthrough time, 30 Sep 2026. The id is
 *  WALKOK plus the job's code, which yaad-inbound reads exactly as the typed
 *  "ACCEPT <code>" (walkthrough-offer.ts). Used in session only; outside the
 *  window the client gets the approved update template with one true line. */
export const WALK_ACCEPT_NAME = "yaadly_walkthrough_accept_v1";
export const WALK_ACCEPT_BODY = "{{1}}\n\nTap Accept, or reply with another time.";
export function walkAcceptContent() {
  return {
    friendly_name: WALK_ACCEPT_NAME,
    language: "en",
    variables: { "1": "Your tradesperson can do the walkthrough on Kitchen cupboards (JOB-WEB-1789253807959): Saturday 10am, on WhatsApp video.", "2": "JOB-WEB-1789253807959" },
    types: {
      "twilio/quick-reply": {
        body: WALK_ACCEPT_BODY,
        actions: [{ title: "Accept", id: "WALKOK {{2}}" }],
      },
    },
  };
}

/** The two client decision moments, as buttons, 13 Oct 2026. Founder:
 *  "yes do two buttons."
 *
 *  Until today the stage report outside WhatsApp's 24 hour window went as
 *  the plain client update template with a link, and the Approve button
 *  (yaadly_stage_approval_v1, one button, read from the
 *  TWILIO_CONTENT_SID_APPROVE secret) followed only inside the window. A
 *  price arriving had no button at all.
 *
 *  A BUTTON IS NOT A NEW AUTHORITY. Each Approve or Accept carries the bare
 *  job code as its payload, so a tap reaches yaad-inbound as the same string
 *  a typed code does, through the same matchApprovingJob(), the same phone
 *  check and the same RPC (button-tap.ts). The second button carries
 *  "ASK <code>" or "CHANGE <code>", which no allowlist reads as agreement,
 *  and yaad-inbound answers it by telling the client to say it in their own
 *  words and by alerting the desk. Nothing is approved by either.
 *
 *  Both are submitted to Meta as UTILITY, recorded as pending, and written
 *  live by the morning record-approvals job once approved. The report
 *  template is v2 of yaadly_stage_approval; v1 keeps going out inside the
 *  window until v2 is recorded. */
export const STAGE_APPROVAL_NAME = "yaadly_stage_approval_v2";
export const STAGE_APPROVAL_BODY =
  "Yaadly: there is a report on {{1}} waiting for your review. The photographs and your tradesperson's words are on the job in your portal.\n\nLook at the photographs before you approve. Tap Approve to record your sign off for this stage; tap Ask a question and a person at Yaadly answers.\n\nJob code, if you would rather type it: {{2}}";
export const STAGE_APPROVAL_APPROVAL = { name: STAGE_APPROVAL_NAME, category: "UTILITY" };
export function stageApprovalContent() {
  return {
    friendly_name: STAGE_APPROVAL_NAME,
    language: "en",
    variables: { "1": "Replace stair rails (JOB-WEB-1789253807959)", "2": "JOB-WEB-1789253807959" },
    types: {
      "twilio/quick-reply": {
        body: STAGE_APPROVAL_BODY,
        actions: [
          { title: "Approve", id: "{{2}}" },
          { title: "Ask a question", id: "ASK {{2}}" },
        ],
      },
    },
  };
}

export const QUOTE_ACCEPT_NAME = "yaadly_quote_accept_v1";
export const QUOTE_ACCEPT_BODY =
  "Yaadly: a price is in on {{1}}. Your all-in price from Yaadly is {{3}}. The breakdown and what your tradesperson proposes are on the price page in the message before this one.\n\nTap Accept to accept this price and book your tradesperson. Tap Ask for a change to go back to them before you accept. Nothing is booked and nothing is charged until you accept.\n\nJob code, if you would rather type it: {{2}}";
export const QUOTE_ACCEPT_APPROVAL = { name: QUOTE_ACCEPT_NAME, category: "UTILITY" };
export function quoteAcceptContent() {
  return {
    friendly_name: QUOTE_ACCEPT_NAME,
    language: "en",
    variables: { "1": "Replace stair rails (JOB-WEB-1789253807959)", "2": "JOB-WEB-1789253807959", "3": "J$57,500" },
    types: {
      "twilio/quick-reply": {
        body: QUOTE_ACCEPT_BODY,
        actions: [
          { title: "Accept", id: "{{2}}" },
          { title: "Ask for a change", id: "CHANGE {{2}}" },
        ],
      },
    },
  };
}

/** The YES or NO question in the joining flow, as buttons. 30 Sep 2026.
 *  (The AI consent question was one of two; it went the same day: the read
 *  is automatic now, see join-lane.ts.) The
 *  ids are the words YES and NO, which yaad-inbound already reads as the
 *  typed answers, so a tap and a typed reply are the same thing. In session
 *  only, straight after the worker's own message, so nothing goes to Meta.
 *  The bodies are held word for word against join-lane.ts and job-alerts.ts
 *  by the tests, because the words are what somebody agrees to. */
// v2, 30 Sep 2026: joining asks six questions (join-lane.ts, "Six quick
// questions"), and v1 said "2 of 7", so a phone that showed the buttons read
// 1 of 6, 2 of 7, 3 of 6. The consent sentence is unchanged, word for word.
export const JOIN_ALERTS_NAME = "yaadly_join_alerts_v2";
export const JOIN_ALERTS_BODY = "{{1}}\n\n2 of 6: Can we message you here when there is a job for you? It is free. Send STOP any time.";
export function joinAlertsContent() {
  return {
    friendly_name: JOIN_ALERTS_NAME,
    language: "en",
    variables: { "1": "Thanks, Marcus." },
    types: { "twilio/quick-reply": { body: JOIN_ALERTS_BODY, actions: [{ title: "Yes", id: "YES" }, { title: "No", id: "NO" }] } },
  };
}


/** The WhatsApp job alert, 30 Sep 2026. Goes to people who have not written
 *  in within 24 hours, so it needs Meta's approval before it is any use, and
 *  the setting yaad-match reads is written only once that comes back. Trade
 *  and parish only; nothing personal; the way out in every message. */
// v2, 30 Sep 2026: v1 put "a" in front of the trade, so it read "a Air
// conditioning job" and "a Electrical job". The trade and parish now stand as
// labels, so no article is needed whatever the trade is. Submitted to Meta by
// create-job-alert; v1 stays switched on until job-alert-status finds v2
// approved and writes the live setting.
export const JOB_ALERT_NAME = "yaadly_job_alert_v2";
export const JOB_ALERT_BODY =
  "Yaadly: a new job is open.\nWork: {{1}}\nParish: {{2}}\n\nWhat to do: {{3}}\n\nReply STOP to end these alerts.";
export function jobAlertContent() {
  return {
    friendly_name: JOB_ALERT_NAME,
    language: "en",
    variables: { "1": "Plumbing", "2": "St Catherine", "3": "Price it in your portal: https://app.yaadly.co.uk/portal/sign-in" },
    types: { "twilio/text": { body: JOB_ALERT_BODY } },
  };
}
export const JOB_ALERT_APPROVAL = { name: JOB_ALERT_NAME, category: "UTILITY" };


/* ── Worker templates for outside the 24 hour window, 30 Sep 2026 ─────────
   Founder: "fix the issues", after a review of every worker WhatsApp message.

   Each of these replaces a message that today goes as free text, or rides
   inside the approved worker update template carrying a sentence it was not
   approved for. Free text outside the window is accepted by Twilio and then
   fails as 63016, which nobody sees. Each one here is its own template, so
   what Meta approves is the sentence that is actually sent.

   None of them is used by anything yet. create-worker-template submits one
   to Meta and records its ContentSid under "<setting>_pending";
   worker-template-status writes "<setting>" only once Meta has approved it.
   The sender then has to be changed to read "<setting>", which is a code
   change in that sender and nothing to do with this file.

   Meta's rules, followed here: a body never starts or ends with a variable,
   and every variable has a sample value. Every one is Utility, about work
   the worker has already applied for or agreed to, never marketing. */

export type MetaWorkerTemplate = {
  /** The action word: create-worker-template with {"template": slug}. */
  slug: string;
  name: string;
  /** The app_settings key the sender will read once approved. */
  setting: string;
  /** Who sends it, so the switch can be made in the right place. */
  sender: string;
  body: string;
  variables: Record<string, string>;
};

/** The daily check-in's second message. Today it rides in the approved
 *  worker update template, which reads "Yaadly update on your job X: 1.
 *  Photos...". It asks for photos and videos, and says the words can be a
 *  voice note, so it no longer disagrees with the first message. Checking
 *  in is asked, never required: the photos and videos are what count. */
export const DAILY_STEPS_BODY =
  "Yaadly, your job {{1}}.\n\nFor today:\n1. Photos and videos, before, during and after.\n2. Say what each shows, in a line or a voice note.\n3. Send them here before you leave.\n\nNothing goes to the client until you say so.";

/** The Completion Report, outside the window. The worker update template
 *  says "The full details are on the job in your Yaadly portal" around a
 *  link that needs no login, which contradicts itself. This says what the
 *  link is, and says client, never owner. */
export const COMPLETION_REPORT_BODY =
  "Yaadly: your Completion Report for {{1}} is ready.\n\nIt is your document. Open it here, no login needed: {{2}}\n\nSign it, change your words, or raise an issue. It goes to the client only when you sign.";

/** "You are cleared", from worker-cleared.ts, as a template. The email is
 *  left out: a template carries as little personal detail as it can.
 *  v2, 2 Oct 2026: v1 was rejected by Meta with no reason given. v1 was
 *  short and the link sat mid sentence, so v2 gives the link its own line
 *  after full sentences of fixed text, the shape v1 of the Completion
 *  Report was approved in. Same two variables, so no sender change.
 *  v3, 13 Oct 2026, founder instruction: v2 was rejected too, again with
 *  no reason. v1 and v2 both carried a link, "sign in" and "we will send
 *  you a code" in one message, which is the shape of a phishing template
 *  to an automated review, and v2 also talked about being paid. v3 keeps
 *  the fact (you are on the board), says what arrives next, gives the
 *  account link its own line, and ends with fixed text. Same two
 *  variables, so no sender change. The text message and the email
 *  (worker-cleared.ts) keep their own wording. */
export const WORKER_CLEARED_BODY =
  "Hi {{1}}, this is Yaadly. Your checks are complete and you are now on the Yaadly board.\n\nNew jobs that match your trade and parish will reach you here, and you price the ones you want.\n\nYour account: {{2}}\n\nReply to this message if you have a question.";

/** The reminder to finish the check, day 3 and day 10. v2, 2 Oct 2026:
 *  v1 was rejected by Meta with no reason given. v1 put a whole sentence
 *  in {{2}}, and Meta rejects variables that carry the message itself, so
 *  v2 has two variables only, the name and the link, and the same words
 *  for both reminders. The text message and the email still say "Last
 *  reminder from us" the second time (worker-cleared.ts). Referees are
 *  optional, founder 2 Oct 2026: without them, a video of the worker
 *  talking through their skills.
 *  v3, 13 Oct 2026, founder instruction: Meta approved v2 but filed it
 *  as MARKETING, which costs more per send and can be paused to people
 *  who do not reply. v2 read as a nudge ("gets you on the board", "until
 *  it is done you cannot price jobs"). v3 is a status update on an
 *  application the person started: what is still needed, where to
 *  complete it, how to ask. Same facts, same two variables, no sender
 *  change. Meta decides the category; this is the shape UTILITY takes. */
export const CHECK_REMINDER_BODY =
  "Hi {{1}}, this is Yaadly. An update on your application: it is still incomplete.\n\nStill needed: your ID, your TRN, and the Guidelines to sign. Referees are optional at this stage; a short video of you talking through your skills can stand in for them. Referees are needed before jobs over £500.\n\nComplete your application here: {{2}}\n\nIf you have a question, reply to this message.";

/** The job health nudge at 72 quiet hours, from yaad-job-health. It asks
 *  for evidence and does not ask for a check-in: checking in asks, it never
 *  gates. */
export const JOB_QUIET_BODY =
  "Yaadly: nothing has come in on your job {{1}} for a few days.\n\nSend a photo or a short video of where the work is, when you can. The client is waiting to see progress.\n\nIf something is holding you up, tell us here.";

/** The draft report, outside the window. The draft itself is never a
 *  template, because the worker has to read it before replying 1, and that
 *  does not change. This only says a draft is waiting and opens the window:
 *  one reply and it comes straight through. */
export const DRAFT_WAITING_BODY =
  "Yaadly: the draft report for your job {{1}} is ready for you to check.\n\nWhatsApp only lets us send it after you message us, so reply here with anything and it comes straight through.\n\nNothing goes to the client until you choose.";

const SAMPLE_JOB = "Replace stair rails (JOB-WEB-1789253807959)";

export const META_WORKER_TEMPLATES: readonly MetaWorkerTemplate[] = [
  {
    slug: "daily-steps", name: "yaadly_daily_steps_v1", setting: "twilio_content_sid_daily_steps",
    sender: "yaad-daily-checkin, the second message", body: DAILY_STEPS_BODY,
    variables: { "1": SAMPLE_JOB },
  },
  {
    slug: "completion-report", name: "yaadly_worker_completion_report_v1", setting: "twilio_content_sid_worker_completion_report",
    sender: "yaad-notify-client, completion_report_worker outside the window", body: COMPLETION_REPORT_BODY,
    variables: { "1": SAMPLE_JOB, "2": "https://app.yaadly.co.uk/sign/JOB-WEB-1789253807959?t=sample" },
  },
  {
    slug: "worker-cleared", name: "yaadly_worker_cleared_v3", setting: "twilio_content_sid_worker_cleared",
    sender: "yaad-notify-client, worker_cleared", body: WORKER_CLEARED_BODY,
    variables: { "1": "Marcus", "2": "https://app.yaadly.co.uk/portal/sign-in" },
  },
  {
    slug: "check-reminder", name: "yaadly_worker_check_reminder_v3", setting: "twilio_content_sid_worker_check_reminder",
    sender: "yaad-notify-client, worker_check_reminder", body: CHECK_REMINDER_BODY,
    variables: { "1": "Marcus", "2": "https://app.yaadly.co.uk/apply?app=sample&token=sample&ref=sample" },
  },
  {
    slug: "job-quiet", name: "yaadly_worker_job_quiet_v1", setting: "twilio_content_sid_worker_job_quiet",
    sender: "yaad-job-health, the 72 hour nudge", body: JOB_QUIET_BODY,
    variables: { "1": SAMPLE_JOB },
  },
  {
    slug: "draft-waiting", name: "yaadly_worker_draft_waiting_v1", setting: "twilio_content_sid_worker_draft_waiting",
    sender: "yaad-notify-client, evidence_landed outside the window", body: DRAFT_WAITING_BODY,
    variables: { "1": SAMPLE_JOB },
  },
];

export function metaWorkerContent(t: MetaWorkerTemplate) {
  return {
    friendly_name: t.name,
    language: "en",
    variables: t.variables,
    types: { "twilio/text": { body: t.body } },
  };
}

export function metaWorkerApproval(t: MetaWorkerTemplate) {
  return { name: t.name, category: "UTILITY" };
}
