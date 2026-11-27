import { posix, win32 } from "node:path";
import { isPlausibleKey, KEY_ENV, LEGACY_KEY_ENV } from "./servers.js";
import type { ClientId, Deps, LaunchSpec, Scope } from "./types.js";

/** What setup found in the client's configuration for one server name. */
export interface Existing {
  exists: boolean;
  /** the client cannot show the entry's content (native CLI): only existence and the legacy key name are known */
  opaque: boolean;
  command?: unknown;
  args?: unknown;
  /** raw value of CAPMONSTER_API_KEY in the entry: a key or a reference like ${CAPMONSTER_API_KEY} */
  keyRaw?: string;
  /** a usable literal key found in the entry (CAPMONSTER_API_KEY or the legacy CM_API_KEY) */
  key?: string;
  /** entry still uses the deprecated CM_API_KEY name */
  legacyKey: boolean;
  /** an entry of this name exists, but in another scope than the one setup writes to */
  otherScope?: string;
}

export interface Item {
  name: string;
  launch: LaunchSpec;
  /** value for CAPMONSTER_API_KEY: only for the capmonster server */
  keyValue?: string;
  replace: boolean;
}

export interface ApplyResult {
  file?: string;
  backup?: string;
}

export interface ClientAdapter {
  id: ClientId;
  label: string;
  scopes: Scope[];
  /** native Windows needs `cmd /c npx ...` for this client */
  windowsCmdWrapper: boolean;
  restartHint: string;
  detect(d: Deps): Promise<boolean>;
  location(d: Deps, scope: Scope): string;
  /** a literal key for the user scope, a reference for a file that gets committed */
  keyValueFor(scope: Scope, key: string): string;
  inspect(d: Deps, scope: Scope, name: string): Promise<Existing>;
  apply(d: Deps, scope: Scope, items: Item[]): Promise<ApplyResult>;
}

const NO_ENTRY: Existing = { exists: false, opaque: false, legacyKey: false };

function pathFor(d: Deps) {
  return d.platform === "win32" ? win32 : posix;
}

function stamp(d: Deps): string {
  return d.now().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
}

// ---------------------------------------------------------------- native CLIs

function nativeCli(opts: {
  id: ClientId;
  label: string;
  binary: string;
  scopes: Scope[];
  windowsCmdWrapper: boolean;
  restartHint: string;
  addArgs(scope: Scope, item: Item): string[];
  removeArgs(scope: Scope, name: string): string[];
  keyValueFor(scope: Scope, key: string): string;
}): ClientAdapter {
  return {
    id: opts.id,
    label: opts.label,
    scopes: opts.scopes,
    windowsCmdWrapper: opts.windowsCmdWrapper,
    restartHint: opts.restartHint,
    keyValueFor: opts.keyValueFor,
    async detect(d) {
      return (await d.which(opts.binary)) !== null;
    },
    location(_d, scope) {
      return `${opts.label} (${scope} scope, managed by \`${opts.binary} mcp\`)`;
    },
    async inspect(d, scope, name) {
      const result = await d.run(opts.binary, ["mcp", "get", name]);
      if (result.code !== 0) return NO_ENTRY;
      const text = `${result.stdout}\n${result.stderr}`;
      // `claude mcp get` finds an entry in any scope and prints "Scope: User config ..."
      const found = /Scope:\s*(user|local|project)/i.exec(text)?.[1]?.toLowerCase();
      if (found && found !== scope) return { ...NO_ENTRY, otherScope: found };
      return {
        exists: true,
        opaque: true,
        legacyKey: text.includes(LEGACY_KEY_ENV) && !text.includes(KEY_ENV),
      };
    },
    async apply(d, scope, items) {
      for (const item of items) {
        if (item.replace) await d.run(opts.binary, opts.removeArgs(scope, item.name));
        const result = await d.run(opts.binary, opts.addArgs(scope, item));
        if (result.code !== 0) {
          const lines = (result.stderr || result.stdout)
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
          const reason = lines.find((line) => /^error/i.test(line)) ?? lines[lines.length - 1] ?? "";
          throw new Error(`\`${opts.binary} mcp add ${item.name}\` failed: ${reason.slice(0, 200)}`);
        }
      }
      return {};
    },
  };
}

// `--env` goes right after the name, before `--`: it takes several values and would swallow the name otherwise.
const claudeCodeNative = nativeCli({
  id: "claude-code",
  label: "Claude Code",
  binary: "claude",
  scopes: ["user"],
  windowsCmdWrapper: true,
  restartHint: "Restart Claude Code (or run /mcp to reconnect).",
  keyValueFor: (_scope, key) => key,
  addArgs: (scope, item) => [
    "mcp",
    "add",
    "--scope",
    scope,
    item.name,
    ...(item.keyValue === undefined ? [] : ["--env", `${KEY_ENV}=${item.keyValue}`]),
    "--",
    item.launch.command,
    ...item.launch.args,
  ],
  removeArgs: (scope, name) => ["mcp", "remove", name, "--scope", scope],
});

const codex = nativeCli({
  id: "codex",
  label: "Codex",
  binary: "codex",
  scopes: ["user"],
  windowsCmdWrapper: false,
  restartHint: "Restart Codex (CLI: exit and start it again; desktop app: Settings → MCP servers → Restart).",
  keyValueFor: (_scope, key) => key,
  addArgs: (_scope, item) => [
    "mcp",
    "add",
    item.name,
    ...(item.keyValue === undefined ? [] : ["--env", `${KEY_ENV}=${item.keyValue}`]),
    "--",
    item.launch.command,
    ...item.launch.args,
  ],
  removeArgs: (_scope, name) => ["mcp", "remove", name],
});

// ---------------------------------------------------------------- JSON files

interface JsonClientDef {
  id: ClientId;
  label: string;
  scopes: Scope[];
  windowsCmdWrapper: boolean;
  restartHint: string;
  rootKey: "mcpServers" | "servers";
  file(d: Deps, scope: Scope): string | null;
  keyRef: string;
  entry(launch: LaunchSpec, env: Record<string, string> | undefined): Record<string, unknown>;
  detect(d: Deps): Promise<boolean>;
  /** VS Code asks for the key at start through an input instead of reading an environment variable */
  inputs?: { id: string; description: string };
}

interface JsonFile {
  data: Record<string, unknown>;
  existed: boolean;
}

async function readJson(d: Deps, file: string): Promise<JsonFile> {
  if (!(await d.exists(file))) return { data: {}, existed: false };
  const text = await d.readFile(file);
  if (text.trim() === "") return { data: {}, existed: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `${file} is not valid JSON (comments or a trailing comma?). Setup did not touch it; edit it by hand or fix it and run setup again.`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${file} does not contain a JSON object. Setup did not touch it.`);
  }
  return { data: parsed as Record<string, unknown>, existed: true };
}

function jsonClient(def: JsonClientDef): ClientAdapter {
  const resolve = (d: Deps, scope: Scope): string => {
    const file = def.file(d, scope);
    if (!file) throw new Error(`${def.label} is not available on this system.`);
    return file;
  };
  return {
    id: def.id,
    label: def.label,
    scopes: def.scopes,
    windowsCmdWrapper: def.windowsCmdWrapper,
    restartHint: def.restartHint,
    keyValueFor: (scope, key) => (scope === "project" ? def.keyRef : key),
    detect: def.detect,
    location: (d, scope) => def.file(d, scope) ?? "not available on this system",
    async inspect(d, scope, name) {
      const { data } = await readJson(d, resolve(d, scope));
      const servers = data[def.rootKey];
      const entry =
        typeof servers === "object" && servers !== null
          ? ((servers as Record<string, unknown>)[name] as Record<string, unknown> | undefined)
          : undefined;
      if (!entry || typeof entry !== "object") return NO_ENTRY;
      const env = (entry.env ?? {}) as Record<string, unknown>;
      const primary = typeof env[KEY_ENV] === "string" ? (env[KEY_ENV] as string) : undefined;
      const legacy = typeof env[LEGACY_KEY_ENV] === "string" ? (env[LEGACY_KEY_ENV] as string) : undefined;
      const literal = [primary, legacy].find((value) => value !== undefined && isPlausibleKey(value));
      return {
        exists: true,
        opaque: false,
        command: entry.command,
        args: entry.args,
        keyRaw: primary,
        key: literal,
        legacyKey: legacy !== undefined && primary === undefined,
      };
    },
    async apply(d, scope, items) {
      const file = resolve(d, scope);
      const { data, existed } = await readJson(d, file);
      const current = data[def.rootKey];
      const servers: Record<string, unknown> =
        typeof current === "object" && current !== null && !Array.isArray(current)
          ? (current as Record<string, unknown>)
          : {};
      let literalKey = false;
      for (const item of items) {
        const env = item.keyValue === undefined ? undefined : { [KEY_ENV]: item.keyValue };
        if (item.keyValue !== undefined && scope === "user") literalKey = true;
        servers[item.name] = def.entry(item.launch, env);
      }
      data[def.rootKey] = servers;
      if (def.inputs && items.some((item) => item.keyValue !== undefined)) {
        const inputs = Array.isArray(data.inputs) ? (data.inputs as Record<string, unknown>[]) : [];
        if (!inputs.some((input) => input?.id === def.inputs?.id)) {
          inputs.push({ type: "promptString", id: def.inputs.id, description: def.inputs.description, password: true });
        }
        data.inputs = inputs;
      }
      let backup: string | undefined;
      if (existed) {
        backup = `${file}.bak-${stamp(d)}`;
        await d.copyFile(file, backup);
      }
      await d.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, literalKey);
      return { file, backup };
    },
  };
}

const cursor = jsonClient({
  id: "cursor",
  label: "Cursor",
  scopes: ["user", "project"],
  windowsCmdWrapper: false,
  restartHint: "Restart Cursor, or toggle the servers under Settings → MCP.",
  rootKey: "mcpServers",
  file: (d, scope) => pathFor(d).join(scope === "project" ? d.cwd : d.home, ".cursor", "mcp.json"),
  keyRef: `\${env:${KEY_ENV}}`,
  entry: (launch, env) => ({ command: launch.command, args: launch.args, ...(env ? { env } : {}) }),
  detect: (d) => d.exists(pathFor(d).join(d.home, ".cursor")),
});

const vscode = jsonClient({
  id: "vscode",
  label: "VS Code",
  scopes: ["project"],
  windowsCmdWrapper: false,
  restartHint: "In VS Code open .vscode/mcp.json and press Start above each server (or reload the window).",
  rootKey: "servers",
  file: (d, scope) => (scope === "project" ? pathFor(d).join(d.cwd, ".vscode", "mcp.json") : null),
  keyRef: `\${input:capmonster_api_key}`,
  inputs: { id: "capmonster_api_key", description: "CapMonster Cloud API key" },
  entry: (launch, env) => ({ type: "stdio", command: launch.command, args: launch.args, ...(env ? { env } : {}) }),
  detect: async (d) => (await d.exists(pathFor(d).join(d.cwd, ".vscode"))) || (await d.which("code")) !== null,
});

function claudeDesktopFile(d: Deps): string | null {
  if (d.platform === "darwin") {
    return posix.join(d.home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (d.platform === "win32") {
    const base = d.env.APPDATA ?? win32.join(d.home, "AppData", "Roaming");
    return win32.join(base, "Claude", "claude_desktop_config.json");
  }
  return null; // no official Claude Desktop for Linux
}

const claudeDesktop = jsonClient({
  id: "claude-desktop",
  label: "Claude Desktop",
  scopes: ["user"],
  windowsCmdWrapper: true,
  restartHint: "Quit Claude Desktop completely and start it again.",
  rootKey: "mcpServers",
  file: (d) => claudeDesktopFile(d),
  keyRef: `\${${KEY_ENV}}`,
  entry: (launch, env) => ({ command: launch.command, args: launch.args, ...(env ? { env } : {}) }),
  detect: async (d) => {
    const file = claudeDesktopFile(d);
    if (!file) return false;
    return d.exists(pathFor(d).dirname(file));
  },
});

// `claude mcp add --scope project` expands ${VAR} itself and writes the real key into .mcp.json,
// a file that gets committed. For the project scope the file is written directly, with a reference.
const claudeProjectFile = jsonClient({
  id: "claude-code",
  label: "Claude Code",
  scopes: ["project"],
  windowsCmdWrapper: true,
  restartHint: "Restart Claude Code (or run /mcp to reconnect); approve the project servers when asked.",
  rootKey: "mcpServers",
  file: (d, scope) => (scope === "project" ? pathFor(d).join(d.cwd, ".mcp.json") : null),
  keyRef: `\${${KEY_ENV}}`,
  entry: (launch, env) => ({ type: "stdio", command: launch.command, args: launch.args, ...(env ? { env } : {}) }),
  detect: async () => false,
});

const claudeCode: ClientAdapter = {
  ...claudeCodeNative,
  scopes: ["user", "project"],
  keyValueFor: (scope, key) => (scope === "project" ? claudeProjectFile : claudeCodeNative).keyValueFor(scope, key),
  location: (d, scope) => (scope === "project" ? claudeProjectFile : claudeCodeNative).location(d, scope),
  inspect: (d, scope, name) => (scope === "project" ? claudeProjectFile : claudeCodeNative).inspect(d, scope, name),
  apply: (d, scope, items) => (scope === "project" ? claudeProjectFile : claudeCodeNative).apply(d, scope, items),
};

export const ADAPTERS: ClientAdapter[] = [claudeCode, codex, cursor, vscode, claudeDesktop];

export function adapterFor(id: ClientId): ClientAdapter {
  const adapter = ADAPTERS.find((candidate) => candidate.id === id);
  if (!adapter) throw new Error(`unknown client: ${id}`);
  return adapter;
}
