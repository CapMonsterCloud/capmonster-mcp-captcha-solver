import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  apiPost,
  CAPMONSTER_API_URL,
  pollTaskResult,
  pollTaskResultWait,
} from "../capmonster.js";
import { ToolError } from "../docs.js";
import { jsonResponse, mockFetch, restoreFetch } from "./test-utils.js";

const FAKE_KEY = "test-api-key-123";

afterEach(() => {
  restoreFetch();
});

// ─── apiPost ────────────────────────────────────────────────────────────────

test("apiPost: createTask success", async () => {
  mockFetch((url) => {
    assert.equal(url, `${CAPMONSTER_API_URL}/createTask`);
    return jsonResponse(200, { errorId: 0, taskId: 42 });
  });
  const data = await apiPost("/createTask", {
    clientKey: FAKE_KEY,
    task: { type: "ImageToTextTask" },
  });
  assert.equal(data.taskId, 42);
});

test("apiPost: CapMonster error raises ToolError", async () => {
  mockFetch(() =>
    jsonResponse(200, {
      errorId: 1,
      errorCode: "ERROR_KEY_DOES_NOT_EXIST",
      errorDescription: "Account authorization key not found.",
    }),
  );
  await assert.rejects(
    () => apiPost("/createTask", {}),
    (err: unknown) => err instanceof ToolError && err.message.includes("ERROR_KEY_DOES_NOT_EXIST"),
  );
});

test("apiPost: getTaskResult ready", async () => {
  mockFetch(() =>
    jsonResponse(200, {
      errorId: 0,
      status: "ready",
      solution: { gRecaptchaResponse: "abc123" },
    }),
  );
  const data = await apiPost("/getTaskResult", { clientKey: FAKE_KEY, taskId: 42 });
  assert.equal(data.status, "ready");
  assert.equal(data.solution.gRecaptchaResponse, "abc123");
});

test("apiPost: getTaskResult processing", async () => {
  mockFetch(() => jsonResponse(200, { errorId: 0, status: "processing" }));
  const data = await apiPost("/getTaskResult", { clientKey: FAKE_KEY, taskId: 42 });
  assert.equal(data.status, "processing");
});

// ─── pollTaskResult ─────────────────────────────────────────────────────────

test("pollTaskResult: ready returns full solution verbatim", async () => {
  const solution = { domains: { "example.com": { cookies: { datadome: "abc" } } } };
  mockFetch(() =>
    jsonResponse(200, {
      errorId: 0,
      status: "ready",
      solution,
      cost: "0.001",
      ip: "1.2.3.4",
    }),
  );
  const result = await pollTaskResult(FAKE_KEY, 42);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.solution, solution);
  assert.equal(
    (result.solution as any).domains["example.com"].cookies.datadome,
    "abc",
  );
  assert.equal(result.cost, "0.001");
  assert.equal(result.ip, "1.2.3.4");
});

test("pollTaskResult: preserves solution userAgent", async () => {
  mockFetch(() =>
    jsonResponse(200, {
      errorId: 0,
      status: "ready",
      solution: { token: "tok", userAgent: "Mozilla/5.0 ..." },
    }),
  );
  const result = await pollTaskResult(FAKE_KEY, 1);
  assert.equal((result.solution as any).userAgent, "Mozilla/5.0 ...");
});

test("pollTaskResult: processing returns dict", async () => {
  mockFetch(() => jsonResponse(200, { errorId: 0, status: "processing" }));
  const result = await pollTaskResult(FAKE_KEY, 7);
  assert.equal(result.status, "processing");
  assert.equal(result.taskId, 7);
});

test("pollTaskResult: empty solution raises", async () => {
  mockFetch(() => jsonResponse(200, { errorId: 0, status: "ready", solution: {} }));
  await assert.rejects(() => pollTaskResult(FAKE_KEY, 9), /solution was empty/);
});

// ─── pollTaskResultWait ─────────────────────────────────────────────────────

test("pollTaskResultWait: polls until ready", async () => {
  const responses = [
    { errorId: 0, status: "processing" },
    { errorId: 0, status: "processing" },
    { errorId: 0, status: "ready", solution: { token: "t" } },
  ];
  let call = 0;
  mockFetch(() => jsonResponse(200, responses[call++]));

  const result = await pollTaskResultWait(FAKE_KEY, 5, 120, 0.001);
  assert.equal(result.status, "ready");
  assert.equal(call, 3);
});

test("pollTaskResultWait: clamps interval to 2s and eventually times out", async () => {
  mockFetch(() => jsonResponse(200, { errorId: 0, status: "processing" }));
  await assert.rejects(
    () => pollTaskResultWait(FAKE_KEY, 1, 3, 0.1),
    /still processing/,
  );
});

test("pollTaskResultWait: times out", async () => {
  mockFetch(() => jsonResponse(200, { errorId: 0, status: "processing" }));
  await assert.rejects(
    () => pollTaskResultWait(FAKE_KEY, 2, 3, 1),
    /still processing after/,
  );
});
