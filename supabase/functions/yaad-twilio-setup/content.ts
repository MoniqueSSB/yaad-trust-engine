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
