import { ToolError } from "./docs.js";

export const CAPMONSTER_API_URL = "https://api.capmonster.cloud";
export const USER_AGENT_URL = "https://capmonster.cloud/api/useragent/actual";

export async function apiPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${CAPMONSTER_API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  let data: any;
  try {
    data = await res.json();
  } catch {
    if (!res.ok) {
      throw new ToolError(`HTTP ${res.status} calling ${path}`);
    }
    throw new ToolError(`Invalid JSON response from ${path}`);
  }

  if (data && typeof data === "object" && (data.errorId ?? 0) !== 0) {
    const code = data.errorCode ?? "UNKNOWN";
    const desc = data.errorDescription ?? "No description.";
    throw new ToolError(`CapMonster error [${code}](HTTP ${res.status}): ${desc}`);
  }

  if (!res.ok) {
    throw new ToolError(`HTTP ${res.status} calling ${path}`);
  }

  return data;
}

export interface PollResult {
  status: "ready" | "processing";
  solution?: Record<string, unknown>;
  taskId?: number;
  message?: string;
  cost?: unknown;
  ip?: unknown;
  createTime?: unknown;
  endTime?: unknown;
  solveCount?: unknown;
}

const META_KEYS = ["cost", "ip", "createTime", "endTime", "solveCount"] as const;

/**
 * One /getTaskResult call, shaped into a PollResult.
 *
 * Returns {status: "ready", solution: {...}, ...} or {status: "processing", ...}.
 * Throws ToolError on a ready-but-empty solution or an unexpected status.
 */
export async function pollTaskResult(key: string, taskId: number): Promise<PollResult> {
  const data = await apiPost("/getTaskResult", { clientKey: key, taskId });

  const status = data.status;
  if (status === "ready") {
    const solution = data.solution ?? {};
    if (!solution || Object.keys(solution).length === 0) {
      throw new ToolError("Task completed but solution was empty.");
    }
    const result: PollResult = { status: "ready", solution };
    for (const metaKey of META_KEYS) {
      if (metaKey in data) {
        (result as any)[metaKey] = data[metaKey];
      }
    }
    return result;
  }

  if (status === "processing") {
    return {
      status: "processing",
      taskId,
      message: `task ${taskId} is not ready yet, try again in 2-3 seconds (poll no faster than once per 2 s).`,
    };
  }

  throw new ToolError(`Unexpected status '${status}' for task ${taskId}.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollTaskResultWait(
  key: string,
  taskId: number,
  timeoutSeconds = 120,
  pollIntervalSeconds = 3.0,
): Promise<PollResult> {
  const interval = Math.max(2.0, pollIntervalSeconds);
  const maxPolls = 120;
  const deadline = Date.now() + timeoutSeconds * 1000;

  let last: PollResult | null = null;
  for (let i = 0; i < maxPolls; i++) {
    last = await pollTaskResult(key, taskId);
    if (last.status === "ready") {
      return last;
    }
    if (Date.now() + interval * 1000 >= deadline) {
      break;
    }
    await sleep(interval * 1000);
  }

  throw new ToolError(
    `Task ${taskId} still processing after ${timeoutSeconds}s (polled every ${interval}s). ` +
      "Increase timeout_seconds, or verify the proxy/params and re-create the task.",
  );
}
