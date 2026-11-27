import assert from "node:assert/strict";
import { test } from "node:test";
import { LEGACY_KEY_WARNING, loadSettings } from "../config.js";

test("loadSettings: reads CAPMONSTER_API_KEY", () => {
  const s = loadSettings({ CAPMONSTER_API_KEY: "new" });
  assert.equal(s.apiKey, "new");
  assert.equal(s.usesLegacyApiKey, false);
});

test("loadSettings: falls back to deprecated CM_API_KEY", () => {
  const s = loadSettings({ CM_API_KEY: "old" });
  assert.equal(s.apiKey, "old");
  assert.equal(s.usesLegacyApiKey, true);
});

test("loadSettings: CAPMONSTER_API_KEY wins when both are set", () => {
  const s = loadSettings({ CAPMONSTER_API_KEY: "new", CM_API_KEY: "old" });
  assert.equal(s.apiKey, "new");
  assert.equal(s.usesLegacyApiKey, false);
});

test("loadSettings: no key", () => {
  const s = loadSettings({});
  assert.equal(s.apiKey, "");
  assert.equal(s.usesLegacyApiKey, false);
});

test("legacy warning names both variables", () => {
  assert.match(LEGACY_KEY_WARNING, /CM_API_KEY/);
  assert.match(LEGACY_KEY_WARNING, /CAPMONSTER_API_KEY/);
});
