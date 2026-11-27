import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Black-box tests: spawn the built server over stdio like a real MCP client.
// Must match tests/test_annotations_and_api_key.py
const READ_ONLY = [
  "get_supported_tasks",
  "get_task_parameters",
  "get_docs",
  "get_task_result",
  "get_task_result_wait",
  "get_actual_user_agent",
  "get_balance",
  "get_skill",
];
const PAID = ["create_task"];

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "server.js");
// Single source of the agent documents (repo root); dist/agent must be a byte-identical copy.
const SOURCE_DIR = join(HERE, "..", "..", "..", "capmonster_agent");
const SKILL_URI = "skill://capmonster-mcp/SKILL.md";

function baseEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== "CAPMONSTER_API_KEY" && k !== "CM_API_KEY") env[k] = v;
  }
  return { ...env, ...extra };
}

async function connect(extraEnv: Record<string, string>) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: baseEnv(extraEnv),
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (d) => {
    stderr += String(d);
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
  return { client, getStderr: () => stderr };
}

let tools: Awaited<ReturnType<Client["listTools"]>>["tools"];
let noKey: Awaited<ReturnType<typeof connect>>;

before(async () => {
  noKey = await connect({});
  tools = (await noKey.client.listTools()).tools;
});

after(async () => {
  await noKey.client.close();
});

test("every tool is classified as read-only or paid", () => {
  assert.deepEqual(tools.map((t) => t.name).sort(), [...READ_ONLY, ...PAID].sort());
});

for (const name of READ_ONLY) {
  test(`annotations: ${name} is read-only and idempotent`, () => {
    const ann = tools.find((t) => t.name === name)?.annotations;
    assert.equal(ann?.readOnlyHint, true);
    assert.equal(ann?.idempotentHint, true);
  });
}

test("annotations: create_task is paid, not read-only, not idempotent", () => {
  const ann = tools.find((t) => t.name === "create_task")?.annotations;
  assert.equal(ann?.readOnlyHint, false);
  assert.equal(ann?.idempotentHint, false);
  assert.equal(ann?.destructiveHint, false);
});

test("missing key: error names CAPMONSTER_API_KEY, no warning", async () => {
  const res = await noKey.client.callTool({ name: "get_balance", arguments: {} });
  assert.equal(res.isError, true);
  const text = (res.content as Array<{ text: string }>)[0].text;
  assert.match(text, /CAPMONSTER_API_KEY/);
  assert.doesNotMatch(noKey.getStderr(), /deprecated/);
});

test("legacy CM_API_KEY: server starts and warns on stderr", async () => {
  const legacy = await connect({ CM_API_KEY: "old" });
  try {
    await legacy.client.listTools();
    assert.match(legacy.getStderr(), /CM_API_KEY is deprecated/);
  } finally {
    await legacy.client.close();
  }
});

// ─── M3: SKILL.md as resource, get_skill, instructions ──────────────────────

test("packaged SKILL.md and INSTRUCTIONS.md are copies of the single source", () => {
  for (const name of ["SKILL.md", "INSTRUCTIONS.md"]) {
    const packaged = readFileSync(join(HERE, "..", "agent", name), "utf-8");
    const source = readFileSync(join(SOURCE_DIR, name), "utf-8");
    assert.equal(packaged, source, `${name} differs from capmonster_agent/${name}`);
  }
});

test("instructions: 3-5 lines, cover the required points", () => {
  const text = noKey.client.getInstructions() ?? "";
  const lines = text.split("\n").filter((l) => l.trim());
  assert.ok(lines.length >= 3 && lines.length <= 5, `got ${lines.length} lines`);
  assert.ok(text.includes(SKILL_URI) && text.includes("get_skill"));
  assert.ok(text.includes("CAPMONSTER_API_KEY"));
  assert.ok(text.includes("userAgent"));
  assert.ok(text.includes("one-time"));
  assert.equal(text, readFileSync(join(SOURCE_DIR, "INSTRUCTIONS.md"), "utf-8").trim());
});

test("skill resource is listed and readable", async () => {
  const { resources } = await noKey.client.listResources();
  const match = resources.filter((r) => r.uri === SKILL_URI);
  assert.equal(match.length, 1);
  assert.equal(match[0].mimeType, "text/markdown");
  const res = await noKey.client.readResource({ uri: SKILL_URI });
  const skill = readFileSync(join(SOURCE_DIR, "SKILL.md"), "utf-8");
  assert.equal((res.contents[0] as { text: string }).text, skill);
});

test("get_skill returns the skill without an API key", async () => {
  const res = await noKey.client.callTool({ name: "get_skill", arguments: {} });
  assert.notEqual(res.isError, true);
  const text = (res.content as Array<{ text: string }>)[0].text;
  assert.equal(text, readFileSync(join(SOURCE_DIR, "SKILL.md"), "utf-8"));
});

// ─── which tools need the API key (mirrors KEYLESS_TOOLS in middleware.py) ──

test("keyed tools fail without a key and name CAPMONSTER_API_KEY", async () => {
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [
    { name: "create_task", arguments: { task: { type: "X" } } },
    { name: "get_task_result", arguments: { task_id: 1 } },
    { name: "get_task_result_wait", arguments: { task_id: 1 } },
    { name: "get_balance", arguments: {} },
  ];
  for (const call of calls) {
    const res = await noKey.client.callTool(call);
    assert.equal(res.isError, true, call.name);
    assert.match((res.content as Array<{ text: string }>)[0].text, /CAPMONSTER_API_KEY/, call.name);
  }
});

test("documentation tools do not ask for a key", async () => {
  // A disallowed host is rejected before any network call; the point is that the
  // error is about the host, not about a missing key.
  const res = await noKey.client.callTool({
    name: "get_docs",
    arguments: { url: "https://example.com/" },
  });
  assert.equal(res.isError, true);
  const text = (res.content as Array<{ text: string }>)[0].text;
  assert.doesNotMatch(text, /CAPMONSTER_API_KEY/);
  assert.match(text, /Refusing to fetch/);
});
