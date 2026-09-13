# Compliance and Responsible AI Statement

**Yaad Trust Engine** · Yaadly Ltd (England and Wales, company no. 17358077) · Track 02, Finance, Payments and MSME Capital

**The governing rule.** AI coordinates, verifies and drafts. It never releases money, rules on a dispute, or alters a worker's reputation. This is enforced in code rather than trusted to a prompt. `yaad/guardrails.py` holds a frozen set of human-only decisions (release funds, withhold funds, refund client, rule on dispute, adjust Yaad Score, suspend worker, approve job) and any attempt by an agent to take one raises instead of proceeding. Tests prove it.

**Pricing is deliberately not a language model.** This product exists because an overseas owner gets quoted more than the neighbour for identical work. A hallucinated price band would break the exact thing we are fixing, so pricing is a lookup against researched benchmarks and returns "no public price exists in Jamaica for this work" rather than a guess.

**Every outbound message is screened.** Banned terms are blocked in code: "escrow", because payment holding is never marketed that way; absolute claims such as 100%, zero fraud and fully covered; and any wording implying Yaadly holds funds itself. A reply that fails is not sent: the client gets a holding message and a person picks it up.

**Identity documents never reach a model.** Government photo ID, live selfie and face video go to Persona and to a named human at Yaadly, and to nothing else. This is enforced before the file is fetched from storage, with no override. Worker documents sit in a private bucket no browser can reach, under a 90 day deletion clock that is verified to run.

**Two jurisdictions apply.** UK GDPR, because Yaadly Ltd is a UK company processing UK client data, and Jamaica's Data Protection Act 2020, because the workers and the properties are in Jamaica. Registration with the Jamaica Office of the Information Commissioner is required before processing real personal data begins. Row level security is enabled on all 47 tables and was tested on 29 August 2026 against both an anonymous caller and a signed-in stranger: every sensitive table returned zero rows.

**Two decisions recorded honestly rather than hidden.** First, the text model is currently MiniMax, hosted in China, and every record in the system today is synthetic. All eight functions read one shared setting, CI fails the build if an endpoint is hard-coded, and Mistral (EU hosted) is one secret away. The switch trigger is real client and worker data, not a date. Second, `verify_portal_code` is intentionally callable without an account, because a client needs it before they have one. It is throttled rather than removed: five failures for an email inside a rolling fifteen minutes and further attempts are refused without the code being checked.

**Consent is opt in and versioned.** AI review of worker documents requires explicit agreement, a null answer counts as declined, and the exact wording version is recorded, so agreement to one sentence is never read as agreement to a broader one.
