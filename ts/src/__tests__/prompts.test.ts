import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadPrompts, renderPrompt } from "../agent-docs.js";

// Must match tests/test_prompts.py
const EXPECTED = ["check_setup", "solve_captcha", "integrate_into_project"];

function definition(name: string) {
  const def = loadPrompts().find((d) => d.name === name);
  assert.ok(def, `prompts.json has no ${name}`);
  return def;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = join(HERE, "..", "..", "..", "capmonster_agent");

let client: Client;

before(async () => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== "CAPMONSTER_API_KEY" && k !== "CM_API_KEY") env[k] = v;
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(HERE, "..", "server.js")],
    env,
    stderr: "pipe",
  });
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
});

after(async () => {
  await client.close();
});

test("prompts file is the single source (dist/agent is a byte-identical copy)", () => {
  const packaged = readFileSync(join(HERE, "..", "agent", "prompts.json"), "utf-8");
  assert.equal(packaged, readFileSync(join(SOURCE_DIR, "prompts.json"), "utf-8"));
});

test("placeholders match arguments, optional arguments have defaults", () => {
  for (const def of loadPrompts()) {
    const placeholders = new Set([...def.template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
    assert.deepEqual([...placeholders].sort(), def.arguments.map((a) => a.name).sort(), def.name);
    for (const arg of def.arguments) assert.ok(arg.required || arg.default, `${def.name}.${arg.name}`);
  }
});

test("texts are short and do not copy the skill", () => {
  const skill = readFileSync(join(SOURCE_DIR, "SKILL.md"), "utf-8");
  const skillLines = new Set(
    skill.split("\n").map((l) => l.trim()).filter((l) => l.length > 40),
  );
  for (const def of loadPrompts()) {
    assert.ok(def.template.length < 1500, def.name);
    for (const line of def.template.split("\n")) {
      assert.ok(!skillLines.has(line.trim()), `${def.name} copies a skill line: ${line}`);
    }
  }
});

test("step references exist in the skill", () => {
  const skill = readFileSync(join(SOURCE_DIR, "SKILL.md"), "utf-8");
  const headings = new Set([...skill.matchAll(/^## Step (\d+)/gm)].map((m) => m[1]));
  for (const def of loadPrompts()) {
    for (const m of def.template.matchAll(/Steps? (\d+)/g)) {
      assert.ok(headings.has(m[1]), `${def.name} mentions Step ${m[1]}`);
    }
  }
});

test("render uses defaults for empty optional arguments", () => {
  const solve = definition("solve_captcha");
  const text = renderPrompt(solve, { url: "https://x.test", how_it_appears: "  " });
  assert.match(text, /https:\/\/x\.test/);
  assert.match(text, /none given/);
  assert.match(text, /not specified/);
  assert.ok(!text.includes("{"));
  const withHints = renderPrompt(solve, { url: "https://x.test", hints: "proxy http://p:1" });
  assert.match(withHints, /proxy http:\/\/p:1/);
  assert.ok(!withHints.includes("none given"));
});

test("registered prompts match the definitions; analyze_and_solve is gone", async () => {
  const { prompts } = await client.listPrompts();
  assert.deepEqual(prompts.map((p) => p.name).sort(), [...EXPECTED].sort());
  for (const def of loadPrompts()) {
    const registered = prompts.find((p) => p.name === def.name);
    assert.ok(registered, def.name);
    assert.equal(registered.description, def.description);
    assert.equal(registered.title, def.title);
    const got = (registered.arguments ?? []).map((a) => [a.name, Boolean(a.required), a.description]);
    const want = def.arguments.map((a) => [a.name, a.required, a.description]);
    assert.deepEqual(got, want, def.name);
  }
});

test("prompt renders through the server", async () => {
  const res = await client.getPrompt({
    name: "solve_captcha",
    arguments: { url: "https://x.test", hints: "eu proxy" },
  });
  const solve = definition("solve_captcha");
  const content = res.messages[0].content as { type: string; text: string };
  assert.equal(content.text, renderPrompt(solve, { url: "https://x.test", hints: "eu proxy" }));
  const check = await client.getPrompt({ name: "check_setup" });
  assert.match((check.messages[0].content as { text: string }).text, /get_supported_tasks/);
});
