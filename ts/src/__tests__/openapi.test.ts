import assert from "node:assert/strict";
import { test } from "node:test";
import { collectProperties, resolveRef } from "../openapi.js";

// ─── resolveRef ─────────────────────────────────────────────────────────────

test("resolveRef: simple", () => {
  const spec = { components: { schemas: { Foo: { type: "object" } } } };
  const result = resolveRef(spec, "#/components/schemas/Foo");
  assert.deepEqual(result, { type: "object" });
});

test("resolveRef: nested", () => {
  const spec = { a: { b: { c: "value" } } };
  assert.equal(resolveRef(spec, "#/a/b/c"), "value");
});

// ─── collectProperties ──────────────────────────────────────────────────────

test("collectProperties: flat", () => {
  const spec = {};
  const schema = {
    properties: {
      websiteURL: { type: "string", description: "URL" },
      websiteKey: { type: "string", description: "Key" },
    },
    required: ["websiteURL"],
  };
  const { properties, required } = collectProperties(spec, schema);
  assert.ok("websiteURL" in properties);
  assert.ok("websiteKey" in properties);
  assert.ok(required.has("websiteURL"));
  assert.ok(!required.has("websiteKey"));
});

test("collectProperties: allOf", () => {
  const spec = {
    components: {
      schemas: {
        Base: {
          properties: { type: { type: "string", description: "task type" } },
          required: ["type"],
        },
      },
    },
  };
  const schema = {
    allOf: [{ $ref: "#/components/schemas/Base" }],
    properties: { websiteURL: { type: "string", description: "URL" } },
    required: ["websiteURL"],
  };
  const { properties, required } = collectProperties(spec, schema);
  assert.ok("type" in properties);
  assert.ok("websiteURL" in properties);
  assert.ok(required.has("type"));
  assert.ok(required.has("websiteURL"));
});

test("collectProperties: nested object", () => {
  const spec = {};
  const schema = {
    properties: {
      metadata: {
        type: "object",
        description: "meta",
        properties: {
          url: { type: "string", description: "page url" },
        },
        required: ["url"],
      },
    },
  };
  const { properties } = collectProperties(spec, schema);
  assert.equal(properties.metadata.type, "object");
  assert.ok("url" in properties.metadata.properties);
  assert.equal(properties.metadata.properties.url.required, true);
});
