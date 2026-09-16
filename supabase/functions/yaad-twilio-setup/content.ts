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
