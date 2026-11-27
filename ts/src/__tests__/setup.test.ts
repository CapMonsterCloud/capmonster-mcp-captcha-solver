import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "../setup/args.js";
import { checkBrowser, interpretBalance } from "../setup/checks.js";
import { runSetup } from "../setup/run.js";
import { maskKey } from "../setup/servers.js";
import type { Deps, RunResult, SetupOptions, SetupReport, VerifyResult } from "../setup/types.js";

const KEY = "cm-test-0123456789abcdef";

function options(over: Partial<SetupOptions> = {}): SetupOptions {
  return {
    agent: "cursor",
    runtime: "node",
    nonInteractive: true,
    json: false,
    force: false,
    headless: false,
    dryRun: false,
    skipVerify: true,
    skipBrowser: true,
    help: false,
    ...over,
  };
}

interface Fake {
  deps: Deps;
  files: Map<string, string>;
  writes: { path: string; content: string; secret: boolean }[];
  copies: [string, string][];
  runs: [string, string[]][];
  verified: { command: string; args: string[] }[];
  probed: { command: string; args: string[] }[];
}

function fake(
  over: {
    files?: Record<string, string>;
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    have?: string[];
    run?: (command: string, args: string[]) => RunResult;
    verify?: VerifyResult;
    probe?: { ok: boolean; message: string };
    interactive?: boolean;
    answers?: { confirm?: boolean };
  } = {},
): Fake {
  const files = new Map(Object.entries(over.files ?? {}));
  const writes: Fake["writes"] = [];
  const copies: Fake["copies"] = [];
  const runs: Fake["runs"] = [];
  const verified: Fake["verified"] = [];
  const probed: Fake["probed"] = [];
  const have = over.have ?? ["npx", "uvx"];
  const deps: Deps = {
    env: over.env ?? { CAPMONSTER_API_KEY: KEY },
    platform: over.platform ?? "linux",
    home: "/home/u",
    cwd: "/work",
    interactive: over.interactive ?? false,
    exists: async (path) => files.has(path) || [...files.keys()].some((name) => name.startsWith(`${path}/`)),
    readFile: async (path) => {
      const text = files.get(path);
      if (text === undefined) throw new Error(`ENOENT ${path}`);
      return text;
    },
    writeFile: async (path, content, secret) => {
      files.set(path, content);
      writes.push({ path, content, secret });
    },
    copyFile: async (from, to) => {
      files.set(to, files.get(from) as string);
      copies.push([from, to]);
    },
    which: async (command) => (have.includes(command) ? `/usr/bin/${command}` : null),
    run: async (command, args) => {
      runs.push([command, args]);
      if (over.run) return over.run(command, args);
      return args[1] === "get" || args[0] === "mcp" && args[1] === "get"
        ? { code: 1, stdout: "", stderr: "not found" }
        : { code: 0, stdout: "", stderr: "" };
    },
    verify: async (launch) => {
      verified.push(launch);
      return over.verify ?? { ok: true, balance: 5, message: "The key works, balance 5." };
    },
    probe: async (launch) => {
      probed.push(launch);
      return over.probe ?? { ok: true, message: "started, 7 tools." };
    },
    prompt: {
      confirm: async () => over.answers?.confirm ?? false,
      choose: async (_question, choices) => choices[0].value,
      secret: async () => KEY,
    },
    now: () => new Date("2026-11-26T10:20:30.000Z"),
  };
  return { deps, files, writes, copies, runs, verified, probed };
}

const step = (report: SetupReport, name: string) => report.steps.find((s) => s.step === name);

// ------------------------------------------------------------------ arguments

test("parseArgs: defaults and values", () => {
  const { options: o, error } = parseArgs(["--agent", "codex", "--scope=project", "--force", "--runtime", "python"]);
  assert.equal(error, undefined);
  assert.equal(o?.agent, "codex");
  assert.equal(o?.scope, "project");
  assert.equal(o?.runtime, "python");
  assert.equal(o?.force, true);
  assert.equal(o?.nonInteractive, false);
});

test("parseArgs: rejects unknown input", () => {
  assert.match(parseArgs(["--agent", "vim"]).error ?? "", /--agent must be one of/);
  assert.match(parseArgs(["--scope", "global"]).error ?? "", /--scope/);
  assert.match(parseArgs(["--wat"]).error ?? "", /unknown option/);
  assert.match(parseArgs(["--agent"]).error ?? "", /needs a value/);
});

test("parseArgs: agent mode needs --agent and takes the key from the environment only", () => {
  assert.match(parseArgs(["--non-interactive"]).error ?? "", /needs --agent/);
  assert.match(parseArgs(["--non-interactive", "--agent", "cursor", "--api-key", "x"]).error ?? "", /environment variable only/);
  assert.equal(parseArgs(["--non-interactive", "--agent", "cursor"]).error, undefined);
});

// ------------------------------------------------------------------ JSON clients

test("cursor user scope: creates the file with a literal key readable by the owner only", async () => {
  const f = fake();
  const report = await runSetup(options(), f.deps);
  assert.equal(report.exitCode, 0);
  const file = "/home/u/.cursor/mcp.json";
  const written = JSON.parse(f.files.get(file) as string);
  assert.deepEqual(written.mcpServers.capmonster, {
    command: "npx",
    args: ["-y", "capmonster-mcp"],
    env: { CAPMONSTER_API_KEY: KEY, CM_API_KEY: KEY },
  });
  assert.deepEqual(written.mcpServers.patchright, { command: "npx", args: ["-y", "capmonster-mcp-patchright"] });
  assert.equal(f.writes[0].secret, true);
  assert.equal(report.restartRequired, true);
});

test("cursor: keeps other servers and backs the file up before changing it", async () => {
  const before = JSON.stringify({ mcpServers: { other: { command: "x" } }, theme: "dark" });
  const f = fake({ files: { "/home/u/.cursor/mcp.json": before } });
  await runSetup(options(), f.deps);
  const written = JSON.parse(f.files.get("/home/u/.cursor/mcp.json") as string);
  assert.deepEqual(written.mcpServers.other, { command: "x" });
  assert.equal(written.theme, "dark");
  assert.deepEqual(f.copies, [["/home/u/.cursor/mcp.json", "/home/u/.cursor/mcp.json.bak-20261126-102030"]]);
  assert.equal(f.files.get("/home/u/.cursor/mcp.json.bak-20261126-102030"), before);
});

test("an invalid JSON file is never overwritten", async () => {
  const f = fake({ files: { "/home/u/.cursor/mcp.json": '{ "mcpServers": // comment\n}' } });
  const report = await runSetup(options(), f.deps);
  assert.equal(report.exitCode, 1);
  assert.equal(f.writes.length, 0);
  assert.match(step(report, "config")?.message ?? "", /not valid JSON/);
});

test("project scope writes a reference, never the key", async () => {
  const f = fake();
  const report = await runSetup(options({ scope: "project" }), f.deps);
  assert.equal(report.exitCode, 0);
  const content = f.files.get("/work/.cursor/mcp.json") as string;
  assert.ok(!content.includes(KEY));
  assert.match(content, /\$\{env:CAPMONSTER_API_KEY\}/);
  assert.equal(f.writes[0].secret, false);
});

test("claude-code project scope writes .mcp.json directly with a variable reference", async () => {
  const f = fake();
  const report = await runSetup(options({ agent: "claude-code", scope: "project" }), f.deps);
  assert.equal(report.exitCode, 0);
  const content = f.files.get("/work/.mcp.json") as string;
  assert.ok(!content.includes(KEY));
  assert.equal(JSON.parse(content).mcpServers.capmonster.env.CAPMONSTER_API_KEY, `\${CAPMONSTER_API_KEY}`);
  assert.equal(f.runs.length, 0, "the native CLI must not be used here: it expands the variable into the file");
});

test("vscode: servers root, stdio type and a password input for the key", async () => {
  const f = fake();
  const report = await runSetup(options({ agent: "vscode", scope: "project" }), f.deps);
  assert.equal(report.exitCode, 0);
  const written = JSON.parse(f.files.get("/work/.vscode/mcp.json") as string);
  assert.equal(written.servers.capmonster.type, "stdio");
  assert.equal(written.servers.capmonster.env.CAPMONSTER_API_KEY, `\${input:capmonster_api_key}`);
  assert.deepEqual(written.inputs, [
    { type: "promptString", id: "capmonster_api_key", description: "CapMonster Cloud API key", password: true },
  ]);
  assert.ok(!(f.files.get("/work/.vscode/mcp.json") as string).includes(KEY));
});

test("vscode has no user scope: it is refused when asked for and project is the default", async () => {
  const refused = await runSetup(options({ agent: "vscode", scope: "user" }), fake().deps);
  assert.equal(refused.exitCode, 2);
  assert.match(step(refused, "scope")?.message ?? "", /supports only: project/);
  const byDefault = await runSetup(options({ agent: "vscode" }), fake().deps);
  assert.equal(byDefault.exitCode, 0);
  assert.equal(byDefault.scope, "project");
});

test("claude-desktop on Windows wraps npx in cmd /c and uses %APPDATA%", async () => {
  const f = fake({ platform: "win32", env: { CAPMONSTER_API_KEY: KEY, APPDATA: "C:\\Users\\u\\AppData\\Roaming" } });
  const report = await runSetup(options({ agent: "claude-desktop" }), f.deps);
  assert.equal(report.exitCode, 0);
  const [file] = [...f.files.keys()];
  assert.match(file, /AppData.Roaming.Claude.claude_desktop_config\.json$/);
  const written = JSON.parse(f.files.get(file) as string);
  assert.deepEqual(written.mcpServers.capmonster.args.slice(0, 3), ["/c", "npx", "-y"]);
  assert.equal(written.mcpServers.capmonster.command, "cmd");
});

test("claude-desktop is not available on Linux", async () => {
  const report = await runSetup(options({ agent: "claude-desktop" }), fake().deps);
  assert.equal(report.exitCode, 1);
  assert.match(step(report, "client")?.message ?? "", /not available/);
});

// ------------------------------------------------------------------ idempotence, legacy, force

test("a second run changes nothing", async () => {
  const f = fake();
  await runSetup(options(), f.deps);
  f.writes.length = 0;
  const again = await runSetup(options(), f.deps);
  assert.equal(again.exitCode, 0);
  assert.equal(f.writes.length, 0);
  assert.equal(step(again, "capmonster")?.status, "skipped");
  assert.equal(again.restartRequired, false);
});

test("an entry with the legacy CM_API_KEY is reported, and replaced with --force using the new name", async () => {
  const old = JSON.stringify({
    mcpServers: { capmonster: { command: "uvx", args: ["capmonster-mcp"], env: { CM_API_KEY: "cm-old-0123456789" } } },
  });
  const files = { "/home/u/.cursor/mcp.json": old };
  const quiet = fake({ files });
  const without = await runSetup(options(), quiet.deps);
  assert.equal(without.exitCode, 0);
  assert.equal(step(without, "capmonster")?.status, "warn");
  assert.match(step(without, "capmonster")?.message ?? "", /deprecated CM_API_KEY/);
  assert.equal(quiet.writes.filter((w) => w.content.includes("capmonster-mcp-patchright")).length, 1, "only patchright was added");

  const forced = fake({ files });
  const report = await runSetup(options({ force: true }), forced.deps);
  assert.equal(report.exitCode, 0);
  const env = JSON.parse(forced.files.get("/home/u/.cursor/mcp.json") as string).mcpServers.capmonster.env;
  assert.deepEqual(env, { CAPMONSTER_API_KEY: KEY, CM_API_KEY: KEY });
});

test("the key of an existing entry is reused when the environment has none", async () => {
  const old = JSON.stringify({
    mcpServers: { capmonster: { command: "npx", args: ["-y", "capmonster-mcp"], env: { CM_API_KEY: "cm-old-0123456789" } } },
  });
  const f = fake({ env: {}, files: { "/home/u/.cursor/mcp.json": old } });
  const report = await runSetup(options({ force: true }), f.deps);
  assert.equal(report.exitCode, 0);
  const env = JSON.parse(f.files.get("/home/u/.cursor/mcp.json") as string).mcpServers.capmonster.env;
  assert.deepEqual(env, { CAPMONSTER_API_KEY: "cm-old-0123456789", CM_API_KEY: "cm-old-0123456789" });
});

test("interactive: a differing entry is replaced only after confirmation", async () => {
  const old = JSON.stringify({ mcpServers: { capmonster: { command: "node", args: ["x.js"] } } });
  const no = fake({ interactive: true, files: { "/home/u/.cursor/mcp.json": old }, answers: { confirm: false } });
  await runSetup(options({ nonInteractive: false }), no.deps);
  assert.equal(JSON.parse(no.files.get("/home/u/.cursor/mcp.json") as string).mcpServers.capmonster.command, "node");
  const yes = fake({ interactive: true, files: { "/home/u/.cursor/mcp.json": old }, answers: { confirm: true } });
  await runSetup(options({ nonInteractive: false }), yes.deps);
  assert.equal(JSON.parse(yes.files.get("/home/u/.cursor/mcp.json") as string).mcpServers.capmonster.command, "npx");
});

// ------------------------------------------------------------------ native CLIs

test("claude-code user scope: the native command, --env before the --", async () => {
  const f = fake();
  const report = await runSetup(options({ agent: "claude-code" }), f.deps);
  assert.equal(report.exitCode, 0);
  const adds = f.runs.filter(([, args]) => args[1] === "add");
  assert.deepEqual(adds[0], [
    "claude",
    ["mcp", "add", "--scope", "user", "capmonster", "--env", `CAPMONSTER_API_KEY=${KEY}`, "--env", `CM_API_KEY=${KEY}`, "--", "npx", "-y", "capmonster-mcp"],
  ]);
  assert.deepEqual(adds[1], [
    "claude",
    ["mcp", "add", "--scope", "user", "patchright", "--", "npx", "-y", "capmonster-mcp-patchright"],
  ]);
});

test("claude-code: an existing entry is left alone without --force and replaced with it", async () => {
  const exists = (_command: string, args: string[]): RunResult =>
    args[1] === "get" ? { code: 0, stdout: "Scope: User config\nEnvironment:\n  CAPMONSTER_API_KEY=x", stderr: "" } : { code: 0, stdout: "", stderr: "" };
  const first = fake({ run: exists });
  const left = await runSetup(options({ agent: "claude-code" }), first.deps);
  assert.equal(left.exitCode, 0);
  assert.equal(first.runs.filter(([, a]) => a[1] === "add").length, 0);
  assert.equal(left.restartRequired, false);

  const second = fake({ run: exists });
  await runSetup(options({ agent: "claude-code", force: true }), second.deps);
  assert.deepEqual(
    second.runs.filter(([, a]) => a[1] === "remove").map(([, a]) => a.slice(0, 5)),
    [
      ["mcp", "remove", "capmonster", "--scope", "user"],
      ["mcp", "remove", "patchright", "--scope", "user"],
    ],
  );
  assert.equal(second.runs.filter(([, a]) => a[1] === "add").length, 2);
});

test("claude-code: an entry in another scope is reported", async () => {
  const f = fake({
    run: (_command, args) =>
      args[1] === "get" ? { code: 0, stdout: "Scope: Local config", stderr: "" } : { code: 0, stdout: "", stderr: "" },
  });
  const report = await runSetup(options({ agent: "claude-code" }), f.deps);
  assert.match(step(report, "capmonster")?.message ?? "", /also exists in the local scope/);
});

test("codex: native command with --env before the --", async () => {
  const f = fake();
  const report = await runSetup(options({ agent: "codex" }), f.deps);
  assert.equal(report.exitCode, 0);
  assert.deepEqual(f.runs.find(([, a]) => a[1] === "add"), [
    "codex",
    ["mcp", "add", "capmonster", "--env", `CAPMONSTER_API_KEY=${KEY}`, "--env", `CM_API_KEY=${KEY}`, "--", "npx", "-y", "capmonster-mcp"],
  ]);
});

test("a failing native command becomes an error step with the real reason", async () => {
  const f = fake({
    run: (_command, args) =>
      args[1] === "get"
        ? { code: 1, stdout: "", stderr: "" }
        : { code: 1, stdout: "", stderr: "WARNING: something\nError: config is read-only\n" },
  });
  const report = await runSetup(options({ agent: "codex" }), f.deps);
  assert.equal(report.exitCode, 1);
  assert.match(step(report, "write")?.message ?? "", /config is read-only/);
});

test("python runtime registers uvx and needs it", async () => {
  const f = fake({ files: {} });
  await runSetup(options({ runtime: "python" }), f.deps);
  const written = JSON.parse(f.files.get("/home/u/.cursor/mcp.json") as string);
  assert.deepEqual(written.mcpServers.capmonster, {
    command: "uvx",
    args: ["capmonster-mcp"],
    env: { CAPMONSTER_API_KEY: KEY, CM_API_KEY: KEY },
  });
  const missing = await runSetup(options({ runtime: "python" }), fake({ have: ["npx"] }).deps);
  assert.equal(missing.exitCode, 1);
  assert.match(step(missing, "runtime")?.message ?? "", /uvx/);
});

test("--headless is added to the browser server", async () => {
  const f = fake();
  await runSetup(options({ headless: true }), f.deps);
  const written = JSON.parse(f.files.get("/home/u/.cursor/mcp.json") as string);
  assert.deepEqual(written.mcpServers.patchright.args, ["-y", "capmonster-mcp-patchright", "--headless"]);
});

test("dry run writes nothing", async () => {
  const f = fake();
  const report = await runSetup(options({ dryRun: true }), f.deps);
  assert.equal(report.exitCode, 0);
  assert.equal(f.writes.length, 0);
  assert.equal(f.runs.length, 0);
  assert.equal(report.restartRequired, false);
});

// ------------------------------------------------------------------ the key

test("no key in agent mode: exit 2, nothing written, advice not to paste the key into a chat", async () => {
  const f = fake({ env: {} });
  const report = await runSetup(options(), f.deps);
  assert.equal(report.exitCode, 2);
  assert.equal(f.writes.length, 0);
  assert.match(step(report, "key")?.fix ?? "", /Do not paste the key into a chat/);
});

test("the deprecated CM_API_KEY in the environment still works, with a warning", async () => {
  const f = fake({ env: { CM_API_KEY: KEY } });
  const report = await runSetup(options(), f.deps);
  assert.equal(report.exitCode, 0);
  assert.equal(step(report, "key")?.status, "warn");
  assert.deepEqual(JSON.parse(f.files.get("/home/u/.cursor/mcp.json") as string).mcpServers.capmonster.env, {
    CAPMONSTER_API_KEY: KEY,
    CM_API_KEY: KEY,
  });
});

test("a malformed key is rejected before anything is written", async () => {
  const f = fake({ env: { CAPMONSTER_API_KEY: 'abc"; rm -rf ~' } });
  const report = await runSetup(options(), f.deps);
  assert.equal(report.exitCode, 2);
  assert.equal(f.writes.length, 0);
  assert.ok(!JSON.stringify(report).includes("rm -rf"));
});

test("interactive: the key is asked for when it is not in the environment", async () => {
  const f = fake({ env: {}, interactive: true });
  const report = await runSetup(options({ nonInteractive: false }), f.deps);
  assert.equal(report.exitCode, 0);
  assert.match(step(report, "key")?.message ?? "", /the prompt/);
});

test("the report never contains the key", async () => {
  const f = fake();
  const report = await runSetup(options({ skipVerify: false }), f.deps);
  assert.ok(!JSON.stringify(report).includes(KEY));
  assert.equal(maskKey(KEY), "cm-…ef");
  assert.equal(maskKey("short"), "***");
});

test("several clients without --agent: agent mode cannot choose", async () => {
  const f = fake({ files: { "/home/u/.cursor/mcp.json": "{}" }, have: ["npx", "claude"] });
  const report = await runSetup(options({ agent: undefined }), f.deps);
  assert.equal(report.exitCode, 2);
  assert.match(step(report, "client")?.message ?? "", /Several clients/);
});

// ------------------------------------------------------------------ checks

test("connection step: error, zero balance, ok", async () => {
  const bad = await runSetup(
    options({ skipVerify: false }),
    fake({ verify: { ok: false, message: "CapMonster rejected the API key." } }).deps,
  );
  assert.equal(bad.exitCode, 1);
  const zero = await runSetup(
    options({ skipVerify: false }),
    fake({ verify: { ok: true, balance: 0, message: "The key works, but the balance is zero." } }).deps,
  );
  assert.equal(zero.exitCode, 0);
  assert.equal(step(zero, "connection")?.status, "warn");
  const fine = await runSetup(options({ skipVerify: false }), fake().deps);
  assert.equal(step(fine, "connection")?.status, "ok");
});

test("connection step starts the servers with the commands written to the config", async () => {
  const f = fake();
  const report = await runSetup(options({ skipVerify: false, skipBrowser: false }), f.deps);
  assert.deepEqual(f.verified, [{ command: "npx", args: ["-y", "capmonster-mcp"] }]);
  assert.deepEqual(f.probed, [{ command: "npx", args: ["-y", "capmonster-mcp-patchright"] }]);
  assert.equal(step(report, "patchright-start")?.status, "ok");
});

test("connection step follows runtime, headless and Windows wrapping", async () => {
  const py = fake();
  await runSetup(options({ skipVerify: false, skipBrowser: false, runtime: "python", headless: true }), py.deps);
  assert.deepEqual(py.verified, [{ command: "uvx", args: ["capmonster-mcp"] }]);
  assert.deepEqual(py.probed, [{ command: "npx", args: ["-y", "capmonster-mcp-patchright", "--headless"] }]);
});

test("patchright start failure is a warning, skip-browser skips the probe", async () => {
  const bad = await runSetup(
    options({ skipVerify: false, skipBrowser: false }),
    fake({ probe: { ok: false, message: "did not start: timeout" } }).deps,
  );
  assert.equal(bad.exitCode, 0);
  assert.equal(step(bad, "patchright-start")?.status, "warn");
  const skipped = fake();
  await runSetup(options({ skipVerify: false, skipBrowser: true }), skipped.deps);
  assert.deepEqual(skipped.probed, []);
});

test("the key is written under both names while published capmonster-mcp reads only CM_API_KEY", async () => {
  const f = fake();
  const report = await runSetup(options(), f.deps);
  assert.match(step(report, "compat")?.message ?? "", /CM_API_KEY/);
  const project = fake();
  await runSetup(options({ scope: "project" }), project.deps);
  const content = project.files.get("/work/.cursor/mcp.json") as string;
  assert.ok(!content.includes(KEY));
  const env = JSON.parse(content).mcpServers.capmonster.env;
  assert.equal(env.CAPMONSTER_API_KEY, env.CM_API_KEY, "both names carry the same reference");
});

test("an entry with only CAPMONSTER_API_KEY is not 'already configured' while the compat name is needed", async () => {
  const old = JSON.stringify({
    mcpServers: {
      capmonster: { command: "npx", args: ["-y", "capmonster-mcp"], env: { CAPMONSTER_API_KEY: KEY } },
      patchright: { command: "npx", args: ["-y", "capmonster-mcp-patchright"] },
    },
  });
  const f = fake({ files: { "/home/u/.cursor/mcp.json": old } });
  const report = await runSetup(options(), f.deps);
  assert.notEqual(step(report, "capmonster")?.status, "skipped");
  const forced = fake({ files: { "/home/u/.cursor/mcp.json": old } });
  await runSetup(options({ force: true }), forced.deps);
  const env = JSON.parse(forced.files.get("/home/u/.cursor/mcp.json") as string).mcpServers.capmonster.env;
  assert.deepEqual(env, { CAPMONSTER_API_KEY: KEY, CM_API_KEY: KEY });
});

test("the final hint names tools, not the check_setup prompt (absent from the published package)", async () => {
  const report = await runSetup(options(), fake().deps);
  assert.ok(report.next.some((line) => /get_balance/.test(line)));
  assert.ok(!report.next.some((line) => /check_setup/.test(line)));
});

test("interpretBalance reads the tool answer", () => {
  assert.deepEqual(interpretBalance("Balance: 10.5", false), { ok: true, balance: 10.5, message: "The key works, balance 10.5." });
  assert.equal(interpretBalance("ERROR_KEY_DOES_NOT_EXIST", true).ok, false);
  assert.match(interpretBalance("ERROR_KEY_DOES_NOT_EXIST", true).fix ?? "", /dash\.capmonster\.cloud/);
  assert.equal(interpretBalance("boom", true).ok, false);
  assert.equal(interpretBalance("no numbers", false).ok, false);
});

test("browser check: Chrome missing, no display, headless silences the display warning", async () => {
  const none = fake({ env: {} });
  const results = await checkBrowser(none.deps, false);
  assert.deepEqual(results.map((r) => [r.step, r.status]), [["browser", "warn"], ["display", "warn"]]);
  assert.match(results[0].fix ?? "", /patchright install chrome/);
  assert.deepEqual((await checkBrowser(none.deps, true)).map((r) => r.step), ["browser"]);
  const installed = fake({ env: { DISPLAY: ":0" }, files: { "/opt/google/chrome/chrome": "bin" } });
  assert.deepEqual((await checkBrowser(installed.deps, false)).map((r) => [r.step, r.status]), [["browser", "ok"]]);
});

test("browser check is also reported when the key is missing", async () => {
  const f = fake({ env: {} });
  const report = await runSetup(options({ skipBrowser: false }), f.deps);
  assert.equal(report.exitCode, 2);
  assert.ok(step(report, "browser"));
});
