import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { getDocs, ToolError } from "../docs.js";
import { OPENAPI_URL } from "../openapi.js";
import { mockFetch, restoreFetch, textResponse } from "./test-utils.js";

afterEach(() => {
  restoreFetch();
});

test("getDocs returns body for allowed host", async () => {
  const url = "https://docs.capmonster.cloud/docs/captchas/datadome.txt";
  mockFetch(() => textResponse(200, "DataDome docs body"));
  const body = await getDocs(url);
  assert.equal(body, "DataDome docs body");
});

test("getDocs allows api host", async () => {
  mockFetch(() => textResponse(200, "spec"));
  const body = await getDocs(OPENAPI_URL);
  assert.equal(body, "spec");
});

test("getDocs rejects other host", async () => {
  await assert.rejects(
    () => getDocs("https://example.com/evil.txt"),
    (err: unknown) => err instanceof ToolError && /only .* URLs are allowed/.test(err.message),
  );
});

test("getDocs 404 raises not found", async () => {
  const url = "https://docs.capmonster.cloud/docs/captchas/missing.txt";
  mockFetch(() => textResponse(404, "nope"));
  await assert.rejects(() => getDocs(url), /Doc not found/);
});

// ─── section jump + outline ─────────────────────────────────────────────────

const DOC_PAGE =
  "# Title\n\nintro text\n\n" +
  "## Request parameters\n\nfields here\n\n" +
  "## Create task\n\n### Without proxy\n\nexample A\n\n### With proxy\n\nexample B\n\n" +
  "## Examples of solving Foo\n\nthe worked recipe\n\n";
const DOC_URL = "https://docs.capmonster.cloud/docs/captchas/foo.txt";

test("getDocs section returns just that section", async () => {
  mockFetch(() => textResponse(200, DOC_PAGE));
  const out = await getDocs(DOC_URL, { section: "examples of solving" });
  assert.ok(out.includes("the worked recipe"));
  assert.ok(out.includes("## Examples of solving Foo"));
  assert.ok(!out.includes("fields here"));
});

test("getDocs section keeps nested subsections", async () => {
  mockFetch(() => textResponse(200, DOC_PAGE));
  const out = await getDocs(DOC_URL, { section: "Create task" });
  assert.ok(out.includes("### Without proxy"));
  assert.ok(out.includes("example A"));
  assert.ok(out.includes("### With proxy"));
  assert.ok(out.includes("example B"));
  assert.ok(!out.includes("Examples of solving"));
});

test("getDocs section unknown lists available", async () => {
  mockFetch(() => textResponse(200, DOC_PAGE));
  await assert.rejects(() => getDocs(DOC_URL, { section: "does-not-exist" }), /No section matching/);
});

test("getDocs first chunk has section outline", async () => {
  const big = DOC_PAGE + "x".repeat(25_000);
  mockFetch(() => textResponse(200, big));
  const out = await getDocs(DOC_URL, { offset: 0 });
  assert.ok(out.includes('Sections (jump with section="…")'));
  assert.ok(out.includes('section="Examples of solving Foo"'));
  assert.ok(out.includes("call again with offset="));
});
