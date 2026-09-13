# Compliance and Responsible AI Statement

**Yaad Trust Engine · Track 02, Finance, Payments and MSME Capital**
Yaadly Ltd, England and Wales, company number 17358077. 7 September 2026.

**Governing rule.** AI coordinates, verifies and drafts. It never releases money, rules on a dispute, or alters a reputation. A named human confirms every consequential step.

Enforced in code, not in a prompt. `yaad/guardrails.py` names the seven actions no agent may take: release funds, withhold funds, refund client, rule on dispute, adjust Yaad Score, suspend worker, approve job. An attempt to take one raises, proved by tests. The same screen runs in the live server runtime, `supabase/functions/_shared/guardrails.ts`, because a rule true of the engine but not of the live system reads as covered while protecting nobody. Both suites assert the same phrases, so drift fails CI.

**Pricing is deliberately not a language model.** It is a lookup against researched benchmarks. Where no public price exists in Jamaica for a piece of work, it says so rather than inventing a band. A hallucinated price would recreate the exact harm this product exists to remove: the premium an overseas owner is quoted for identical work.

**Language screened automatically.** No claim of removing all fraud, no "100 per cent", no "zero", no "fully covered", never the word escrow. Yaadly is the principal contractor: the client buys the job at one agreed price, and Yaadly engages and pays the tradesperson. Agent output is scanned before it reaches anyone.

**Identity documents never reach a model.** The government photo ID, live selfie and face video are withheld before they are fetched from storage, so they are never retrieved. No override, no flag. Persona does the identity check.

**Supporting paperwork reaches a model only with consent.** Proof of address, TRN, certificates, CV and portfolio reach the review agent only where the applicant granted consent explicitly. A null answer counts as declined. The gate sits inside the review function, not at the caller, so no operator can override what the applicant was told, and the consent version moves with the wording that earned it.

**Data protection.** Two regimes bite at once: UK GDPR, because a UK company processes UK client data, and Jamaica's Data Protection Act 2020, because the workers and the properties are in Jamaica. A full inventory of what is collected and who receives it exists. Jamaica OIC registration and a DPIA are open, named rather than claimed.

**Where the text goes.** The text model moved from MiniMax in China to Mistral in the EU on 4 September 2026, ahead of any real client data, because which country receives personal data is a legal decision, not a technical one. MiniMax stays only as a disclosed fallback for a refused key or a rate limit that survives our retries; its key is unset today, and any call using it is logged. Photographs still go to NVIDIA in the United States and voice notes to a chain with United States providers in it, and the privacy page says so.

**What is not true yet.** Professional indemnity cover is not in force, and no external user has put a real job through the system. Both are recorded, not hidden.
