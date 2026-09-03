/**
 * What Ask a Yaad will accept, and the exact words it says when it will not.
 *
 * This is a pure module on purpose: no React, no Supabase, no request. The
 * server action calls it before the insert and the form calls it as you type,
 * so there is one set of rules and one set of sentences rather than two that
 * drift. tests/ask.test.mjs holds it.
 *
 * The board is PUBLIC and it is answered by strangers. That is the whole
 * reason the contact-details rule exists below: everywhere else on this site
 * a phone number is wanted, and here it is the one thing that must not be
 * published. A visitor who types their number into a public question has been
 * failed by the form, not by themselves.
 */

/** Matches the database CHECK in 20260903d and the maxLength on the input. */
export const BODY_MIN = 10;
export const BODY_MAX = 500;
export const AREA_MAX = 60;

/** Where the message belongs, so the form can mark the right field. */
export type AskField = "body" | "area";

export type AskProblem = { field: AskField; message: string };

/**
 * An email address, loosely. Loose is correct here: this is not deciding
 * whether post can be delivered, it is deciding whether something that looks
 * like a way to contact a person is about to be printed on a public page.
 */
const EMAILISH = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

/**
 * A phone number, deliberately narrower than "seven digits somewhere", and
 * the narrowness is the considered part of this file.
 *
 * A bare run of seven digits is a Jamaican local number. It is ALSO a price
 * in Jamaican dollars: 1500000 is one and a half million, and "is 1500000
 * fair for a bathroom" is the archetypal question this board exists to
 * answer. The two are genuinely indistinguishable, so a rule has to choose
 * which way to be wrong.
 *
 * It chooses to let the bare seven-digit run through, for two reasons. The
 * cost of the other choice is paid on every honest pricing question, by the
 * exact people the board is for, with a message they cannot act on because
 * their number IS the question. The cost of this choice is paid only when
 * somebody types a bare local number AND the person at the desk misses it,
 * and nothing here publishes without that person. The desk view marks a
 * question that carries anything number-shaped so it is looked at, which is
 * where the ambiguity belongs: with the human who can read the sentence
 * around it.
 *
 * So what is refused is what cannot be a price: a run long enough to carry a
 * country or area code, anything after a plus, and digits grouped the way a
 * phone number is grouped rather than the way money is.
 */
const PHONEISH = [
  /(?<![\d,.])\d{10,}(?![\d,.])/,                        // 8765551234
  /\+\d[\d\s().-]{6,}\d/,                                // +44 7700 900123
  /(?<![\d,.])\d{3}[\s.-]\d{4}(?![\d,.])/,               // 555-1234, 555 1234
  /(?<![\d,.])\d{3}[\s.\-()]{1,3}\d{3}[\s.-]\d{4}/,      // 876-555-1234, (876) 555 1234
];

/** True when the text carries something that reads as a way to reach a person. */
export function hasContactDetails(text: string): boolean {
  return EMAILISH.test(text) || PHONEISH.some((re) => re.test(text));
}

/**
 * Looser than the rule above, and it stops nothing. This is what the desk
 * uses to mark a question worth a second read before it is published: it
 * includes the bare seven-digit run that hasContactDetails deliberately lets
 * through. A chip on a moderation queue can afford to be wrong. A message
 * that blocks somebody's question cannot.
 */
export function mightCarryContactDetails(text: string): boolean {
  return hasContactDetails(text) || /(?<![\d,.])\d{7,}(?![\d,.])/.test(text);
}

/**
 * The one gate. Returns null when the question may be saved, or the field and
 * the sentence to show. Nothing here is a warning: everything it returns
 * stops the submit, because a public board cannot be un-published quietly.
 */
export function checkQuestion(bodyRaw: string, areaRaw: string): AskProblem | null {
  const body = bodyRaw.trim();
  const area = areaRaw.trim();

  if (body.length < BODY_MIN) {
    return {
      field: "body",
      message: "A little more please, at least ten characters, so a tradesperson has something to answer.",
    };
  }
  if (body.length > BODY_MAX) {
    return {
      field: "body",
      message: "That is over 500 characters. Trim it, or split it into two questions.",
    };
  }
  if (hasContactDetails(body)) {
    return {
      field: "body",
      message:
        "That looks like a phone number or email address. This board is public, so leave those out. For a private reply use Ask Yaadly, the chat tab on the right.",
    };
  }
  if (area.length > AREA_MAX) {
    return {
      field: "area",
      message: "A parish or a town is enough, so that is longer than it needs to be.",
    };
  }
  if (hasContactDetails(area)) {
    return {
      field: "area",
      message: "Leave contact details out of the area. A parish or a town is all that is needed.",
    };
  }
  return null;
}

/** What the insert receives. Trimmed here so the action and the tests agree. */
export function tidyQuestion(bodyRaw: string, areaRaw: string): { body: string; area: string | null } {
  return {
    body: bodyRaw.trim().slice(0, BODY_MAX),
    area: areaRaw.trim().slice(0, AREA_MAX) || null,
  };
}

/**
 * What the server action hands back to the form.
 *
 * This lives HERE, not in app/ask/actions.ts, and that is not tidiness. A
 * file marked "use server" may only export async functions: everything it
 * exports becomes a callable endpoint, so a plain constant in it is a build
 * error. Next says so in as many words, and it says it at request time
 * rather than at typecheck, which is how it reached a browser on
 * 3 September 2026 before it was noticed.
 */
export type AskState = {
  status: "idle" | "sent" | "error";
  /** What to show, and which field to mark. Both empty when idle or sent. */
  message?: string;
  field?: AskField;
  /** Kept so a failed submit does not lose what somebody typed. */
  body: string;
  area: string;
  /** Echoed back on success so the page can show the question it took. */
  sentBody?: string;
  /**
   * When this result was made. The form uses it as a React key, so every
   * answer from the server remounts the fields and reseeds them from what
   * came back. Without it, asking the same question twice returns an
   * identical object and the form does not notice it has been answered.
   */
  at: number;
};

export const ASK_IDLE: AskState = { status: "idle", body: "", area: "", at: 0 };
