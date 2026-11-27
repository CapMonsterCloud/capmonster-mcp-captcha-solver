import { posix, win32 } from "node:path";
import type { Deps, StepResult } from "./types.js";

export const CHROME_INSTALL_COMMAND = "npx patchright install chrome";

/** Where patchright looks for Google Chrome (`channel: "chrome"`). */
export function chromeCandidates(d: Pick<Deps, "platform" | "env" | "home">): string[] {
  if (d.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      posix.join(d.home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    ];
  }
  if (d.platform === "win32") {
    const roots = [d.env.LOCALAPPDATA, d.env.PROGRAMFILES, d.env["PROGRAMFILES(X86)"]];
    return roots
      .filter((root): root is string => Boolean(root))
      .map((root) => win32.join(root, "Google", "Chrome", "Application", "chrome.exe"));
  }
  return ["/opt/google/chrome/chrome"];
}

export function hasDisplay(d: Pick<Deps, "platform" | "env">): boolean {
  if (d.platform !== "linux") return true;
  return Boolean(d.env.DISPLAY || d.env.WAYLAND_DISPLAY);
}

export async function checkBrowser(d: Deps, headless: boolean): Promise<StepResult[]> {
  const results: StepResult[] = [];
  let found: string | undefined;
  for (const candidate of chromeCandidates(d)) {
    if (await d.exists(candidate)) {
      found = candidate;
      break;
    }
  }
  if (found) {
    results.push({ step: "browser", status: "ok", message: `Google Chrome found: ${found}` });
  } else {
    results.push({
      step: "browser",
      status: "warn",
      message:
        "Google Chrome was not found. The patchright server starts the installed Chrome, so page analysis will not work until it is installed.",
      fix:
        "Install Google Chrome, or run `" +
        CHROME_INSTALL_COMMAND +
        "` (it needs administrator rights). Skip this if you only integrate CapMonster into code.",
    });
  }
  if (!headless && !hasDisplay(d)) {
    results.push({
      step: "display",
      status: "warn",
      message: "No display found (DISPLAY and WAYLAND_DISPLAY are empty), but the browser opens a window by default.",
      fix: "Run setup again with --headless to start the browser without a window.",
    });
  }
  return results;
}

/** Turns a `get_balance` tool answer into a verdict. The text looks like "Balance: 10.5". */
export function interpretBalance(text: string, isError: boolean): { ok: boolean; balance?: number; message: string; fix?: string } {
  if (isError) {
    if (/KEY_DOES_NOT_EXIST|invalid|unauthor|wrong key/i.test(text)) {
      return {
        ok: false,
        message: "CapMonster rejected the API key.",
        fix: "Check the key on https://dash.capmonster.cloud and run setup again.",
      };
    }
    return { ok: false, message: `get_balance failed: ${text.slice(0, 200)}` };
  }
  const match = /(-?\d+(?:\.\d+)?)/.exec(text);
  if (!match) return { ok: false, message: `get_balance returned an unexpected answer: ${text.slice(0, 120)}` };
  const balance = Number(match[1]);
  if (balance <= 0) {
    return {
      ok: true,
      balance,
      message: "The key works, but the balance is zero.",
      fix: "Top up the balance in the CapMonster dashboard; a test balance is issued by support.",
    };
  }
  return { ok: true, balance, message: `The key works, balance ${balance}.` };
}
