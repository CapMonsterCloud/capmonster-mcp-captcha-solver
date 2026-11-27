import { CLIENT_IDS, type ClientId, type Runtime, type Scope, type SetupOptions } from "./types.js";

export const SETUP_USAGE = `Usage: npx -y capmonster-mcp setup [options]

Registers the capmonster and patchright MCP servers in an AI client, checks the
API key and the browser, and tells you what to do next.

Options:
  --agent <id>        claude-code | codex | cursor | vscode | claude-desktop
  --scope <scope>     user (default) or project
  --runtime <name>    node (default, npx) or python (uvx capmonster-mcp)
  --force             overwrite existing entries without asking
  --headless          start the browser server without a window
  --dry-run           show what would change, write nothing
  --skip-verify       do not call get_balance
  --skip-browser      do not look for Google Chrome
  --non-interactive   never ask; needs --agent; the key comes from CAPMONSTER_API_KEY only
  --json              print one machine-readable report
  --api-key <key>     the key (prefer the CAPMONSTER_API_KEY environment variable:
                      a flag ends up in shell history and in the process list)
  -h, --help          this text

Exit codes: 0 success (warnings allowed), 1 a step failed, 2 missing input or bad usage.`;

export interface ParsedArgs {
  options?: SetupOptions;
  error?: string;
}

const VALUE_FLAGS = new Set(["--agent", "--scope", "--runtime", "--api-key"]);
const BOOL_FLAGS = new Set([
  "--force",
  "--headless",
  "--dry-run",
  "--skip-verify",
  "--skip-browser",
  "--non-interactive",
  "--json",
  "--help",
  "-h",
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const bools = new Set<string>();
  const values = new Map<string, string>();

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    const eq = raw.startsWith("--") ? raw.indexOf("=") : -1;
    const flag = eq > 0 ? raw.slice(0, eq) : raw;
    if (BOOL_FLAGS.has(flag)) {
      if (eq > 0) return { error: `${flag} does not take a value` };
      bools.add(flag);
    } else if (VALUE_FLAGS.has(flag)) {
      const value = eq > 0 ? raw.slice(eq + 1) : argv[++i];
      if (!value || value.startsWith("--")) return { error: `${flag} needs a value` };
      values.set(flag, value);
    } else {
      return { error: `unknown option: ${raw}` };
    }
  }

  const agent = values.get("--agent");
  if (agent !== undefined && !(CLIENT_IDS as readonly string[]).includes(agent)) {
    return { error: `--agent must be one of: ${CLIENT_IDS.join(", ")}` };
  }
  const scope = values.get("--scope");
  if (scope !== undefined && scope !== "user" && scope !== "project") {
    return { error: "--scope must be user or project" };
  }
  const runtime = values.get("--runtime") ?? "node";
  if (runtime !== "node" && runtime !== "python") {
    return { error: "--runtime must be node or python" };
  }

  const options: SetupOptions = {
    agent: agent as ClientId | undefined,
    runtime: runtime as Runtime,
    scope: scope as Scope | undefined,
    nonInteractive: bools.has("--non-interactive"),
    json: bools.has("--json"),
    force: bools.has("--force"),
    apiKey: values.get("--api-key"),
    headless: bools.has("--headless"),
    dryRun: bools.has("--dry-run"),
    skipVerify: bools.has("--skip-verify"),
    skipBrowser: bools.has("--skip-browser"),
    help: bools.has("--help") || bools.has("-h"),
  };

  if (options.nonInteractive && !options.help) {
    if (!options.agent) return { error: "--non-interactive needs --agent" };
    if (options.apiKey !== undefined) {
      return {
        error:
          "--non-interactive takes the key from the CAPMONSTER_API_KEY environment variable only, not from --api-key",
      };
    }
  }
  return { options };
}
