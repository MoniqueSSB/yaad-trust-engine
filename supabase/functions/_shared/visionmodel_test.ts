import { assertEquals } from "jsr:@std/assert@1";
import { pickVisionProvider, visionAttrs } from "./visionmodel.ts";

/** Env is process-wide, so every test puts back what it found. */
function withEnv(vars: Record<string, string | null>, run: () => void) {
  const before: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) before[k] = Deno.env.get(k);
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === null) Deno.env.delete(k); else Deno.env.set(k, v);
    }
    run();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) Deno.env.delete(k); else Deno.env.set(k, v);
    }
  }
}

const CLEAR = {
  VISION_MODEL_KEY: null, VISION_MODEL_API: null, VISION_MODEL_NAME: null,
  VISION_MODEL_REGION: null, VISION_MODEL_PROVIDER: null,
  NVIDIA_API_KEY: null, NVIDIA_VISION_MODEL: null,
  MISTRAL_API_KEY: null, MISTRAL_VISION_MODEL: null,
  NVIDIA_EVIDENCE_MODEL: null, NVIDIA_SKETCH_MODEL: null, NVIDIA_VETTING_MODEL: null,
};

Deno.test("no key configured is null, never a silent route to a country nobody chose", () => {
  withEnv({ ...CLEAR }, () => {
    assertEquals(pickVisionProvider("evidence"), null);
    assertEquals(pickVisionProvider("sketch"), null);
    assertEquals(pickVisionProvider("vetting"), null);
  });
});

// Sketch moved to the 11b on 6 September 2026: the 90b answered nothing in
// forty seconds, twice, on the first real walkthrough. See visionmodel.ts.
Deno.test("the defaults are the ones each job is meant to run on", () => {
  withEnv({ ...CLEAR, NVIDIA_API_KEY: "k" }, () => {
    assertEquals(pickVisionProvider("evidence")!.model, "meta/llama-3.2-11b-vision-instruct");
    assertEquals(pickVisionProvider("sketch")!.model, "meta/llama-3.2-11b-vision-instruct");
    assertEquals(pickVisionProvider("vetting")!.model, "meta/llama-3.2-90b-vision-instruct");
  });
});

Deno.test("the old shared secret still moves all three, so nothing breaks for a project that only set that", () => {
  withEnv({ ...CLEAR, NVIDIA_API_KEY: "k", NVIDIA_VISION_MODEL: "shared/model" }, () => {
    assertEquals(pickVisionProvider("evidence")!.model, "shared/model");
    assertEquals(pickVisionProvider("sketch")!.model, "shared/model");
    assertEquals(pickVisionProvider("vetting")!.model, "shared/model");
  });
});

Deno.test("a job's own secret moves that job alone, which is the point of the change", () => {
  withEnv({
    ...CLEAR, NVIDIA_API_KEY: "k",
    NVIDIA_VISION_MODEL: "shared/model", NVIDIA_EVIDENCE_MODEL: "evidence/only",
  }, () => {
    assertEquals(pickVisionProvider("evidence")!.model, "evidence/only");
    assertEquals(pickVisionProvider("sketch")!.model, "shared/model");
    assertEquals(pickVisionProvider("vetting")!.model, "shared/model");
  });
});

Deno.test("NVIDIA is declared as United States, and the region reaches telemetry", () => {
  withEnv({ ...CLEAR, NVIDIA_API_KEY: "k" }, () => {
    const p = pickVisionProvider("evidence")!;
    assertEquals(p.region, "us");
    assertEquals(p.api, "https://integrate.api.nvidia.com/v1/chat/completions");
    const a = visionAttrs(p);
    assertEquals(a["yaadly.model.region"], "us");
    assertEquals(a["server.address"], "integrate.api.nvidia.com");
    assertEquals(a["yaadly.agent.name"], "photo_review");
  });
});

Deno.test("the override wins over NVIDIA, so a move is a secret change and not a deploy", () => {
  withEnv({
    ...CLEAR, NVIDIA_API_KEY: "k",
    VISION_MODEL_KEY: "other", VISION_MODEL_API: "https://eu.example.test/v1/chat/completions",
    VISION_MODEL_PROVIDER: "somewhere", VISION_MODEL_REGION: "eu",
  }, () => {
    const p = pickVisionProvider("vetting")!;
    assertEquals(p.name, "somewhere");
    assertEquals(p.region, "eu");
    assertEquals(p.api, "https://eu.example.test/v1/chat/completions");
    // No VISION_MODEL_NAME set, so the job's own model choice still applies.
    assertEquals(p.model, "meta/llama-3.2-90b-vision-instruct");
    assertEquals(visionAttrs(p)["yaadly.agent.name"], "vetting_review");
  });
});

// ── 15 September 2026: job photographs go to Mistral, the vetting read does not ──

Deno.test("with both keys set, evidence and sketch go to Mistral in the EU and vetting stays on NVIDIA", () => {
  withEnv({ ...CLEAR, MISTRAL_API_KEY: "m", NVIDIA_API_KEY: "k" }, () => {
    const ev = pickVisionProvider("evidence")!;
    const sk = pickVisionProvider("sketch")!;
    const vt = pickVisionProvider("vetting")!;
    assertEquals([ev.name, ev.region, ev.model], ["mistral", "eu", "mistral-small-latest"]);
    assertEquals(new URL(ev.api).host, "api.mistral.ai");
    assertEquals([sk.name, sk.region], ["mistral", "eu"]);
    assertEquals([vt.name, vt.region], ["nvidia_nim", "us"]);
    assertEquals(new URL(vt.api).host, "integrate.api.nvidia.com");
  });
});

Deno.test("MISTRAL_VISION_MODEL moves the Mistral jobs and leaves the NVIDIA per-job secrets alone", () => {
  withEnv({ ...CLEAR, MISTRAL_API_KEY: "m", NVIDIA_API_KEY: "k", MISTRAL_VISION_MODEL: "pixtral-large-latest", NVIDIA_EVIDENCE_MODEL: "evidence/only" }, () => {
    assertEquals(pickVisionProvider("evidence")!.model, "pixtral-large-latest");
    assertEquals(pickVisionProvider("vetting")!.model, "meta/llama-3.2-90b-vision-instruct");
  });
});

Deno.test("no Mistral key means job photographs fall to NVIDIA, still declared as United States", () => {
  withEnv({ ...CLEAR, NVIDIA_API_KEY: "k" }, () => {
    const ev = pickVisionProvider("evidence")!;
    assertEquals([ev.name, ev.region], ["nvidia_nim", "us"]);
  });
});

Deno.test("a Mistral key alone gives the vetting read nothing, never a silent EU route for applicant paperwork", () => {
  withEnv({ ...CLEAR, MISTRAL_API_KEY: "m" }, () => {
    assertEquals(pickVisionProvider("vetting"), null);
    assertEquals(pickVisionProvider("evidence")!.name, "mistral");
  });
});

Deno.test("the override still wins over Mistral", () => {
  withEnv({ ...CLEAR, MISTRAL_API_KEY: "m", VISION_MODEL_KEY: "o", VISION_MODEL_API: "https://eu.example.test/v1/chat/completions", VISION_MODEL_PROVIDER: "somewhere" }, () => {
    assertEquals(pickVisionProvider("evidence")!.name, "somewhere");
  });
});

// The report read, 25 September 2026. A contractor's quote and a client's site
// photographs go where the job photographs go: Mistral, EU. With no Mistral
// key they fall to NVIDIA and say so, the same as evidence and sketch, never
// to nothing and never quietly.
Deno.test("a quote photographed for a report goes to Mistral in the EU, and is named as the report job", () => {
  withEnv({ ...CLEAR, MISTRAL_API_KEY: "m", NVIDIA_API_KEY: "n" }, () => {
    const p = pickVisionProvider("report")!;
    assertEquals(p.name, "mistral");
    assertEquals(p.region, "eu");
    assertEquals(p.job, "report");
  });
});

Deno.test("with no Mistral key the report read falls to NVIDIA, declared as United States", () => {
  withEnv({ ...CLEAR, MISTRAL_API_KEY: null, NVIDIA_API_KEY: "n" }, () => {
    const p = pickVisionProvider("report")!;
    assertEquals(p.name, "nvidia_nim");
    assertEquals(p.region, "us");
  });
});
