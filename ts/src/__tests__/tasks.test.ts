import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { clearOpenApiSpecCache } from "../openapi.js";
import { getSupportedTasks, getTaskParameters } from "../tasks.js";
import { mockFetch, restoreFetch, textResponse } from "./test-utils.js";

const MINIMAL_SPEC = {
  components: {
    schemas: {
      Task: {
        discriminator: {
          mapping: {
            RecaptchaV2Task: "#/components/schemas/RecaptchaV2Task",
            TurnstileTask: "#/components/schemas/TurnstileTask",
            CustomTask: "#/components/schemas/CustomTask",
          },
        },
      },
      CustomTask: {
        discriminator: {
          mapping: {
            DataDome: "#/components/schemas/DataDomeCustomTask",
          },
        },
      },
      RecaptchaV2Task: {
        properties: {
          websiteURL: { type: "string", description: "Target page URL" },
          websiteKey: { type: "string", description: "Site key" },
        },
        required: ["websiteURL", "websiteKey"],
      },
      TurnstileTask: {
        description: "Turnstile. The `cloudflareTaskType` field selects the variant.",
        "x-solution": "TurnstileSolution",
        properties: {
          websiteURL: { type: "string", description: "Target page URL" },
        },
        required: ["websiteURL"],
      },
      DataDomeCustomTask: {
        properties: {
          userAgent: { type: "string", description: "User agent" },
        },
        required: [],
      },
    },
  },
};

beforeEach(() => {
  clearOpenApiSpecCache();
  mockFetch(() => textResponse(200, `window.openApiSpec = ${JSON.stringify(MINIMAL_SPEC)};`));
});

afterEach(() => {
  clearOpenApiSpecCache();
  restoreFetch();
});

test("getSupportedTasks returns top-level and custom", async () => {
  const tasks = await getSupportedTasks();
  assert.ok(tasks.includes("RecaptchaV2Task"));
  assert.ok(tasks.includes("TurnstileTask"));
  assert.ok(tasks.includes("DataDome"));
  assert.ok(!tasks.includes("CustomTask"));
});

test("getTaskParameters: top-level type", async () => {
  const result = await getTaskParameters("RecaptchaV2Task");
  assert.ok("websiteURL" in result.all_parameters);
  assert.ok(result.required.includes("websiteURL"));
  assert.ok(result.required.includes("websiteKey"));
});

test("getTaskParameters: custom type", async () => {
  const result = await getTaskParameters("DataDome");
  assert.ok("userAgent" in result.all_parameters);
});

test("getTaskParameters: surfaces description and solution", async () => {
  const result = await getTaskParameters("TurnstileTask");
  assert.ok(result.description?.includes("cloudflareTaskType"));
  assert.equal(result.solution, "TurnstileSolution");
});

test("getTaskParameters: omits absent optional fields", async () => {
  const result = await getTaskParameters("RecaptchaV2Task");
  assert.equal(result.description, undefined);
  assert.equal(result.solution, undefined);
});

test("getTaskParameters: unknown type throws", async () => {
  await assert.rejects(() => getTaskParameters("FakeTask"), /Unknown task type 'FakeTask'/);
});
