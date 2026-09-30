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
export const UPDATE_DRAFT_NAME = "yaadly_update_read_back_v1";

export const UPDATE_DRAFT_BODY =
  'Ready to go on {{1}}:\n"{{2}}"\n\n{{3}}\n\nNothing is filed until you tap Put it on the job.';

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
 *  {{1}} is the lead sentence. On joining it carries the consent sentence,
 *  ALERT_TERMS, word for word, so what somebody agreed to is still a thing
 *  they read. Used in session only, so nothing is submitted to Meta. */
export const ALERT_TRADES_NAME = "yaadly_alert_trades_menu_v1";
export const ALERT_TRADES_BODY = "{{1}}\n\nWhat work do you do?\nTap Choose and pick one.\nDo more than one? Type them all.";
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

export const ALERT_PARISHES_NAME = "yaadly_alert_parishes_menu_v1";
export const ALERT_PARISHES_BODY = "{{1}}\n\nWhich parishes will you work in?\nTap Choose and pick one.\nMore than one? Type them all.";
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
