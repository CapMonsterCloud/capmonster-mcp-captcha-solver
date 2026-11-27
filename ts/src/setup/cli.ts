import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parseArgs, SETUP_USAGE } from "./args.js";
import { interpretBalance } from "./checks.js";
import { keyEnv } from "./servers.js";
import { runSetup } from "./run.js";
import type { Deps, LaunchSpec, ProbeResult, Prompter, RunResult, SetupReport, VerifyResult } from "./types.js";

const VERIFY_TIMEOUT_MS = 45_000;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function which(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Promise<string | null> {
  const extensions = platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = join(dir, command + extension);
      try {
        const info = await stat(candidate);
        if (info.isFile()) return candidate;
      } catch {
        // not here
      }
    }
  }
  return null;
}

function run(command: string, args: string[], platform: NodeJS.Platform): Promise<RunResult> {
  return new Promise((resolve) => {
    // On Windows `claude`, `codex` and `npx` are .cmd shims and need a shell; arguments are
    // restricted to a safe alphabet there (the key is validated before it gets this far).
    const useShell = platform === "win32";
    const safe = (arg: string) => (useShell && /[\s"&|<>^%]/.test(arg) ? `"${arg.replace(/"/g, "")}"` : arg);
    const child = spawn(command, args.map(safe), { shell: useShell, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => resolve({ code: 127, stdout, stderr: stderr + String(error) }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * Starts a server with exactly the command that was written to the client config, so the check
 * covers the real launch path (and fills the npx / uvx cache: the first start downloads the package,
 * which a client's health check often does not wait for).
 */
async function withServer<T>(
  launch: LaunchSpec,
  env: Record<string, string>,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ name: "capmonster-setup", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    env: { ...(process.env as Record<string, string>), ...env },
    // A neutral directory: inside a project that has its own `bin` (this very package), `npx capmonster-mcp`
    // would start the local build instead of the package from the registry that the client will start.
    cwd: tmpdir(),
    stderr: "ignore",
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    const job = (async () => {
      await client.connect(transport);
      return work(client);
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), VERIFY_TIMEOUT_MS);
    });
    return await Promise.race([job, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    await client.close().catch(() => undefined);
  }
}

const timeoutText = () =>
  `The server did not answer within ${VERIFY_TIMEOUT_MS / 1000} s (the first start downloads the package).`;

/** Starts the capmonster server from its configured command and calls get_balance. The key never appears in the result. */
async function verify(launch: LaunchSpec, key: string): Promise<VerifyResult> {
  try {
    const result = (await withServer(launch, keyEnv(key), (client) =>
      client.callTool({ name: "get_balance", arguments: {} }),
    )) as { content?: { type: string; text?: string }[]; isError?: boolean };
    const text = (result.content ?? []).map((part) => part.text ?? "").join(" ");
    return interpretBalance(text, Boolean(result.isError));
  } catch (error) {
    const message = (error as Error).message;
    return {
      ok: false,
      message:
        message === "timeout"
          ? timeoutText()
          : `Could not start \`${launch.command} ${launch.args.join(" ")}\` and call get_balance: ${message.slice(0, 200)}`,
      fix: "Check your network connection (npm registry and https://api.capmonster.cloud) and try again.",
    };
  }
}

/** Starts a server from its configured command and lists its tools; used for servers that need no key. */
async function probe(launch: LaunchSpec): Promise<ProbeResult> {
  try {
    const { tools } = await withServer(launch, {}, (client) => client.listTools());
    return { ok: true, message: `started, ${tools.length} tools.` };
  } catch (error) {
    const message = (error as Error).message;
    return { ok: false, message: message === "timeout" ? timeoutText() : `did not start: ${message.slice(0, 200)}` };
  }
}

function askSecret(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error("no terminal to read the key from"));
      return;
    }
    process.stderr.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let buffer = "";
    const done = (action: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stderr.write("\n");
      action();
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return done(() => resolve(buffer));
        if (char === "\u0003") return done(() => reject(new Error("cancelled")));
        if (char === "\u007f" || char === "\b") buffer = buffer.slice(0, -1);
        else buffer += char;
      }
    };
    stdin.on("data", onData);
  });
}

const prompter: Prompter = {
  async confirm(question, defaultValue) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      const answer = (await rl.question(`${question} ${defaultValue ? "[Y/n]" : "[y/N]"} `)).trim().toLowerCase();
      return answer === "" ? defaultValue : answer.startsWith("y");
    } finally {
      rl.close();
    }
  },
  async choose(question, options) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      for (;;) {
        const lines = options.map((option, index) => `  ${index + 1}. ${option.label}`).join("\n");
        const answer = (await rl.question(`${question}\n${lines}\n> `)).trim();
        const picked = options[Number(answer) - 1];
        if (picked) return picked.value;
      }
    } finally {
      rl.close();
    }
  },
  secret: askSecret,
};

export function realDeps(interactive: boolean): Deps {
  const env = process.env;
  const platform = process.platform;
  return {
    env,
    platform,
    home: homedir(),
    cwd: process.cwd(),
    interactive,
    exists,
    readFile: (path) => readFile(path, "utf8"),
    async writeFile(path, content, secret) {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp-${process.pid}`;
      await writeFile(tmp, content, { mode: secret ? 0o600 : 0o644 });
      if (secret) await chmod(tmp, 0o600).catch(() => undefined);
      await rename(tmp, path);
    },
    copyFile: (from, to) => copyFile(from, to),
    which: (command) => which(command, env, platform),
    run: (command, args) => run(command, args, platform),
    verify,
    probe,
    prompt: prompter,
    now: () => new Date(),
  };
}

const MARK = { ok: "✓", skipped: "-", warn: "!", error: "✗" } as const;

export function formatReport(report: SetupReport): string {
  const lines: string[] = [report.dryRun ? "CapMonster setup (dry run)" : "CapMonster setup", ""];
  for (const step of report.steps) {
    lines.push(`${MARK[step.status]} ${step.step}: ${step.message}`);
    if (step.fix) lines.push(`    → ${step.fix}`);
  }
  lines.push("");
  if (report.ok) {
    lines.push("Done.");
    for (const line of report.next) lines.push(`  • ${line}`);
  } else {
    lines.push(report.exitCode === 2 ? "Setup needs more input (see above)." : "Setup did not finish (see above).");
    for (const line of report.next) lines.push(`  • ${line}`);
  }
  return lines.join("\n");
}

/** Entry point for `capmonster-mcp setup ...`; returns the process exit code. */
export async function runSetupCli(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.error || !parsed.options) {
    console.error(`${parsed.error}\n\n${SETUP_USAGE}`);
    return 2;
  }
  const options = parsed.options;
  if (options.help) {
    console.log(SETUP_USAGE);
    return 0;
  }
  const interactive = !options.nonInteractive && Boolean(process.stdin.isTTY);
  if (!interactive && !options.nonInteractive) {
    console.error("No terminal: setup will not ask questions (same as --non-interactive).");
  }
  let report: SetupReport;
  try {
    report = await runSetup(options, realDeps(interactive));
  } catch (error) {
    console.error(`Setup failed: ${(error as Error).message}`);
    return 1;
  }
  console.log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));
  return report.exitCode;
}
