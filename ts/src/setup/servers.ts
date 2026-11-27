import type { LaunchSpec, Runtime } from "./types.js";

export const KEY_ENV = "CAPMONSTER_API_KEY";
export const LEGACY_KEY_ENV = "CM_API_KEY";
export const CAPMONSTER_NAME = "capmonster";
export const PATCHRIGHT_NAME = "patchright";

export function capmonsterLaunch(runtime: Runtime): LaunchSpec {
  return runtime === "python"
    ? { command: "uvx", args: ["capmonster-mcp"] }
    : { command: "npx", args: ["-y", "capmonster-mcp"] };
}

export function patchrightLaunch(headless: boolean): LaunchSpec {
  const args = ["-y", "capmonster-mcp-patchright"];
  if (headless) args.push("--headless");
  return { command: "npx", args };
}

/** Native Windows cannot start `npx` / `uvx` directly from most clients: they are .cmd shims. */
export function windowsWrap(spec: LaunchSpec): LaunchSpec {
  return { command: "cmd", args: ["/c", spec.command, ...spec.args] };
}

/** First 3 and last 2 characters only; short values are hidden completely. */
export function maskKey(key: string): string {
  return key.length <= 8 ? "***" : `${key.slice(0, 3)}…${key.slice(-2)}`;
}

/**
 * Keys are passed to child processes and, on Windows, through a shell: accept only a plain,
 * token-like alphabet. This also catches a pasted line break or a quoted value.
 */
export function isPlausibleKey(key: string): boolean {
  return /^[A-Za-z0-9._-]{8,128}$/.test(key);
}

export function sameLaunch(
  a: { command?: unknown; args?: unknown },
  b: LaunchSpec,
): boolean {
  return (
    a.command === b.command &&
    Array.isArray(a.args) &&
    a.args.length === b.args.length &&
    a.args.every((value, index) => value === b.args[index])
  );
}
