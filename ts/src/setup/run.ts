import { checkBrowser } from "./checks.js";
import { ADAPTERS, adapterFor, type ClientAdapter, type Existing, type Item } from "./clients.js";
import {
  CAPMONSTER_NAME,
  capmonsterLaunch,
  isPlausibleKey,
  KEY_ENV,
  LEGACY_KEY_COMPAT,
  LEGACY_KEY_ENV,
  maskKey,
  PATCHRIGHT_NAME,
  patchrightLaunch,
  sameLaunch,
  windowsWrap,
} from "./servers.js";
import type {
  ClientId,
  Deps,
  LaunchSpec,
  Scope,
  SetupOptions,
  SetupReport,
  StepResult,
} from "./types.js";

// The published capmonster-mcp (0.1.14 and older) has no check_setup prompt, so the hint names tools only.
const CHECK_HINT = "Check the connection: ask the agent to call get_balance and get_supported_tasks.";

interface Wanted {
  name: string;
  launch: LaunchSpec;
  withKey: boolean;
}

/** Runs the whole setup. Never throws for expected problems: they become steps in the report. */
export async function runSetup(options: SetupOptions, d: Deps): Promise<SetupReport> {
  const steps: StepResult[] = [];
  let needsInput = false;
  let failed = false;
  let changed = false;

  const add = (step: StepResult, kind?: "input" | "fail"): void => {
    steps.push(step);
    if (kind === "input") needsInput = true;
    if (kind === "fail") failed = true;
  };
  const finish = (agent?: ClientId, scope?: Scope): SetupReport => {
    const exitCode = needsInput ? 2 : failed ? 1 : 0;
    const next: string[] = [];
    if (exitCode === 0 || changed) {
      const adapter = agent ? adapterFor(agent) : undefined;
      if (adapter && changed) next.push(adapter.restartHint);
      if (agent && exitCode === 0) next.push(CHECK_HINT);
    }
    return {
      ok: exitCode === 0,
      exitCode,
      agent,
      scope,
      runtime: options.runtime,
      dryRun: options.dryRun,
      steps,
      restartRequired: changed,
      next,
    };
  };

  // 1. tools the servers are started with
  if (options.runtime === "python") {
    if ((await d.which("uvx")) === null) {
      add(
        {
          step: "runtime",
          status: "error",
          message: "`uvx` was not found; the python runtime starts the server with it.",
          fix: "Install uv (https://docs.astral.sh/uv/) or run setup without --runtime python.",
        },
        "fail",
      );
    } else add({ step: "runtime", status: "ok", message: "uvx found (python runtime)." });
  } else if ((await d.which("npx")) === null) {
    add(
      {
        step: "runtime",
        status: "error",
        message: "`npx` was not found; the clients start both servers with it.",
        fix: "Install Node.js 18 or newer from https://nodejs.org and run setup again.",
      },
      "fail",
    );
  } else add({ step: "runtime", status: "ok", message: `Node ${process.versions.node} and npx found.` });

  // 2. client
  const adapter = await pickClient(options, d, add);
  if (!adapter) {
    if (!options.skipBrowser) for (const result of await checkBrowser(d, options.headless)) add(result);
    return finish();
  }
  const scope: Scope = options.scope ?? (adapter.scopes.includes("user") ? "user" : adapter.scopes[0]);
  if (!adapter.scopes.includes(scope)) {
    add(
      {
        step: "scope",
        status: "error",
        message: `${adapter.label} supports only: ${adapter.scopes.join(", ")}; --scope ${scope} is not available.`,
        fix: `Run setup with --scope ${adapter.scopes[0]}.`,
      },
      "input",
    );
    return finish(adapter.id);
  }
  let location: string;
  try {
    location = adapter.location(d, scope);
  } catch (error) {
    add({ step: "client", status: "error", message: (error as Error).message }, "fail");
    return finish(adapter.id, scope);
  }
  add({ step: "client", status: "ok", message: `${adapter.label}, ${scope} scope: ${location}` });

  // 3. what to register
  const wanted: Wanted[] = [
    { name: CAPMONSTER_NAME, launch: capmonsterLaunch(options.runtime), withKey: true },
    { name: PATCHRIGHT_NAME, launch: patchrightLaunch(options.headless), withKey: false },
  ].map((w) => ({
    ...w,
    launch: adapter.windowsCmdWrapper && d.platform === "win32" ? windowsWrap(w.launch) : w.launch,
  }));

  // 4. existing entries
  const existing = new Map<string, Existing>();
  try {
    for (const w of wanted) existing.set(w.name, await adapter.inspect(d, scope, w.name));
  } catch (error) {
    add({ step: "config", status: "error", message: (error as Error).message }, "fail");
    return finish(adapter.id, scope);
  }

  // 5. key
  const key = await resolveKey(options, d, existing.get(CAPMONSTER_NAME), add);
  if (key === undefined) {
    if (!options.skipBrowser) for (const result of await checkBrowser(d, options.headless)) add(result);
    return finish(adapter.id, scope);
  }
  const keyValue = adapter.keyValueFor(scope, key);
  if (scope === "project") {
    add({
      step: "key",
      status: "warn",
      message: `The project file will contain a reference to ${KEY_ENV}, not the key itself.`,
      fix: `Set ${KEY_ENV} in the environment of the person who opens the project.`,
    });
  }

  // 6. register
  const items: Item[] = [];
  for (const w of wanted) {
    const current = existing.get(w.name) as Existing;
    if (current.otherScope) {
      add({
        step: w.name,
        status: "warn",
        message: `an entry named ${w.name} also exists in the ${current.otherScope} scope (Claude Code prefers local over project over user).`,
        fix: `If that is not intended, remove it with \`claude mcp remove ${w.name} --scope ${current.otherScope}\`.`,
      });
    }
    const want = w.withKey ? keyValue : undefined;
    const decision = await decide(w, current, want, options, d, adapter);
    add({ step: w.name, status: decision.status, message: decision.message, fix: decision.fix });
    if (decision.write) items.push({ name: w.name, launch: w.launch, keyValue: want, replace: current.exists });
  }
  if (items.length > 0 && !options.dryRun) {
    try {
      const result = await adapter.apply(d, scope, items);
      changed = true;
      add({
        step: "write",
        status: "ok",
        message: `Registered ${items.map((item) => item.name).join(", ")}${result.file ? ` in ${result.file}` : ""}.${result.backup ? ` Backup: ${result.backup}.` : ""}`,
      });
    } catch (error) {
      add({ step: "write", status: "error", message: (error as Error).message }, "fail");
      return finish(adapter.id, scope);
    }
    if (LEGACY_KEY_COMPAT && items.some((item) => item.keyValue !== undefined)) {
      add({
        step: "compat",
        status: "ok",
        message: `The key is also written as ${LEGACY_KEY_ENV}: the published capmonster-mcp (0.1.14 and older) reads only that name.`,
      });
    }
  } else if (items.length > 0) {
    add({ step: "write", status: "skipped", message: `Dry run: would register ${items.map((item) => item.name).join(", ")}.` });
  }

  // 7. browser
  if (!options.skipBrowser) for (const result of await checkBrowser(d, options.headless)) add(result);

  // 8. connection: start the servers with the commands that were written to the config
  if (!options.skipVerify && !failed) {
    const capmonster = wanted.find((w) => w.name === CAPMONSTER_NAME) as Wanted;
    const verdict = await d.verify(capmonster.launch, key);
    if (verdict.ok) {
      const parsed = verdict.balance !== undefined && verdict.balance <= 0;
      add({ step: "connection", status: parsed ? "warn" : "ok", message: verdict.message, fix: verdict.fix });
    } else {
      add({ step: "connection", status: "error", message: verdict.message, fix: verdict.fix }, "fail");
    }
    const patchright = wanted.find((w) => w.name === PATCHRIGHT_NAME) as Wanted;
    if (!options.skipBrowser) {
      const started = await d.probe(patchright.launch);
      add({
        step: "patchright-start",
        status: started.ok ? "ok" : "warn",
        message: `${PATCHRIGHT_NAME} ${started.message}`,
        fix: started.ok ? undefined : "Page analysis will not work until the server starts; the CapMonster tools are not affected.",
      });
    }
  }

  return finish(adapter.id, scope);
}

async function pickClient(
  options: SetupOptions,
  d: Deps,
  add: (step: StepResult, kind?: "input" | "fail") => void,
): Promise<ClientAdapter | undefined> {
  if (options.agent) return adapterFor(options.agent);
  const found: ClientAdapter[] = [];
  for (const adapter of ADAPTERS) if (await adapter.detect(d)) found.push(adapter);
  const ids = ADAPTERS.map((adapter) => adapter.id).join(", ");
  if (found.length === 0) {
    add(
      {
        step: "client",
        status: "error",
        message: "No supported AI client was found.",
        fix: `Run setup with --agent <${ids.split(", ").join("|")}>.`,
      },
      "input",
    );
    return undefined;
  }
  if (found.length === 1) return found[0];
  if (!d.interactive) {
    add(
      {
        step: "client",
        status: "error",
        message: `Several clients were found (${found.map((a) => a.id).join(", ")}) and setup cannot ask.`,
        fix: "Run setup with --agent <id>.",
      },
      "input",
    );
    return undefined;
  }
  const id = await d.prompt.choose(
    "Which client should get CapMonster?",
    found.map((adapter) => ({ value: adapter.id, label: adapter.label })),
  );
  return adapterFor(id);
}

async function resolveKey(
  options: SetupOptions,
  d: Deps,
  current: Existing | undefined,
  add: (step: StepResult, kind?: "input" | "fail") => void,
): Promise<string | undefined> {
  let key: string | undefined;
  let source = "";
  const fromEnv = d.env[KEY_ENV];
  const legacy = d.env[LEGACY_KEY_ENV];
  if (options.apiKey) {
    key = options.apiKey;
    source = "the --api-key flag";
  } else if (fromEnv) {
    key = fromEnv;
    source = `the ${KEY_ENV} environment variable`;
  } else if (legacy) {
    key = legacy;
    source = `the deprecated ${LEGACY_KEY_ENV} environment variable`;
  } else if (current?.key) {
    key = current.key;
    source = "the existing entry in the client configuration";
  } else if (d.interactive) {
    key = (await d.prompt.secret("CapMonster API key (input is hidden): ")).trim();
    source = "the prompt";
  }

  if (key === undefined || key === "") {
    add(
      {
        step: "key",
        status: "error",
        message: `No API key: ${KEY_ENV} is not set.`,
        fix: `Set ${KEY_ENV} in the environment and run setup again, or run \`npx -y capmonster-mcp setup\` yourself in a terminal. Do not paste the key into a chat.`,
      },
      "input",
    );
    return undefined;
  }
  if (!isPlausibleKey(key)) {
    add(
      {
        step: "key",
        status: "error",
        message: `The key from ${source} does not look like a CapMonster key (letters, digits, dot, dash, underscore; 8 to 128 characters).`,
        fix: "Copy the key from https://dash.capmonster.cloud again without quotes or spaces.",
      },
      "input",
    );
    return undefined;
  }
  add({
    step: "key",
    status: source.includes("deprecated") ? "warn" : "ok",
    message: `Key ${maskKey(key)} taken from ${source}.`,
    fix: source.includes("deprecated") ? `Rename ${LEGACY_KEY_ENV} to ${KEY_ENV}; setup writes the new name.` : undefined,
  });
  return key;
}

async function decide(
  w: Wanted,
  current: Existing,
  wantKey: string | undefined,
  options: SetupOptions,
  d: Deps,
  adapter: ClientAdapter,
): Promise<{ status: StepResult["status"]; message: string; fix?: string; write: boolean }> {
  if (!current.exists) {
    return { status: "ok", message: "not configured yet.", write: true };
  }
  const identical =
    !current.opaque &&
    sameLaunch(current, w.launch) &&
    (wantKey === undefined || current.keyRaw === wantKey) &&
    (wantKey === undefined || !LEGACY_KEY_COMPAT || current.compatKey === wantKey) &&
    !current.legacyKey;
  if (identical) return { status: "skipped", message: "already configured, nothing to change.", write: false };
  if (current.opaque && !current.legacyKey && options.force) {
    return { status: "ok", message: "the old entry will be replaced.", write: true };
  }
  if (current.opaque && !current.legacyKey) {
    return {
      status: "skipped",
      message: `already registered in ${adapter.label}; the client does not show its content, so it was left as is.`,
      fix: "Run setup with --force to register it again.",
      write: false,
    };
  }
  const why = current.legacyKey ? `uses the deprecated ${LEGACY_KEY_ENV} name` : "differs from what setup would write";
  if (options.force) return { status: "ok", message: `the old entry ${why}; it will be replaced.`, write: true };
  if (d.interactive && !options.dryRun) {
    const yes = await d.prompt.confirm(`The ${w.name} entry already exists and ${why}. Replace it?`, current.legacyKey);
    return yes
      ? { status: "ok", message: "the old entry will be replaced.", write: true }
      : { status: "skipped", message: "kept as is.", write: false };
  }
  return {
    status: "warn",
    message: `already exists and ${why}; left as is.`,
    fix: "Run setup with --force to replace it.",
    write: false,
  };
}

