export const CLIENT_IDS = ["claude-code", "codex", "cursor", "vscode", "claude-desktop"] as const;
export type ClientId = (typeof CLIENT_IDS)[number];
export type Scope = "user" | "project";
export type Runtime = "node" | "python";

export interface SetupOptions {
  agent?: ClientId;
  runtime: Runtime;
  scope?: Scope;
  nonInteractive: boolean;
  json: boolean;
  force: boolean;
  apiKey?: string;
  headless: boolean;
  dryRun: boolean;
  skipVerify: boolean;
  skipBrowser: boolean;
  help: boolean;
}

/** How a client starts an MCP server process (stdio). */
export interface LaunchSpec {
  command: string;
  args: string[];
}

export type StepStatus = "ok" | "skipped" | "warn" | "error";

export interface StepResult {
  step: string;
  status: StepStatus;
  message: string;
  /** what the user (or the agent) should do about a warn/error */
  fix?: string;
}

export interface SetupReport {
  ok: boolean;
  /** 0 success (warnings allowed), 1 a step failed, 2 missing input or bad usage */
  exitCode: 0 | 1 | 2;
  agent?: ClientId;
  scope?: Scope;
  runtime: Runtime;
  dryRun: boolean;
  steps: StepResult[];
  restartRequired: boolean;
  next: string[];
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface VerifyResult {
  ok: boolean;
  /** balance in USD when the call worked */
  balance?: number;
  /** short human message, never contains the key */
  message: string;
  fix?: string;
}

export interface ProbeResult {
  ok: boolean;
  message: string;
}

export interface Prompter {
  confirm(question: string, defaultValue: boolean): Promise<boolean>;
  choose<T extends string>(question: string, options: { value: T; label: string }[]): Promise<T>;
  secret(question: string): Promise<string>;
}

/** Everything setup needs from the outside world; tests replace it. */
export interface Deps {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  home: string;
  cwd: string;
  interactive: boolean;
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  /** atomic write; `secret` makes the file readable by the owner only */
  writeFile(path: string, content: string, secret: boolean): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  which(command: string): Promise<string | null>;
  run(command: string, args: string[]): Promise<RunResult>;
  /** Starts the capmonster server from its configured launch command and calls get_balance. */
  verify(launch: LaunchSpec, key: string): Promise<VerifyResult>;
  /** Starts a server that needs no key from its configured launch command and lists its tools. */
  probe(launch: LaunchSpec): Promise<ProbeResult>;
  prompt: Prompter;
  now(): Date;
}
