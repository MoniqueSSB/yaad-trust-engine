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
  NVIDIA_EVIDENCE_MODEL: null, NVIDIA_SKETCH_MODEL: null, NVIDIA_VETTING_MODEL: null,
};

Deno.test("no key configured is null, never a silent route to a country nobody chose", () => {
  withEnv({ ...CLEAR }, () => {
    assertEquals(pickVisionProvider("evidence"), null);
    assertEquals(pickVisionProvider("sketch"), null);
    assertEquals(pickVisionProvider("vetting"), null);
  });
});

Deno.test("the defaults reproduce exactly what each call site resolved to before", () => {
  withEnv({ ...CLEAR, NVIDIA_API_KEY: "k" }, () => {
    assertEquals(pickVisionProvider("evidence")!.model, "meta/llama-3.2-11b-vision-instruct");
    assertEquals(pickVisionProvider("sketch")!.model, "meta/llama-3.2-90b-vision-instruct");
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
