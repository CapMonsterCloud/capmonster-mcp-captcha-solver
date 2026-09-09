#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { apiPost, pollTaskResult, pollTaskResultWait, USER_AGENT_URL } from "./capmonster.js";
import { loadSettings } from "./config.js";
import { DOCS_ALLOWED_HOSTS, DOCS_CHUNK_SIZE, getDocs, ToolError } from "./docs.js";
import { getSupportedTasks, getTaskParameters } from "./tasks.js";

const settings = loadSettings();

function textResult(text: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text }] };
}

function jsonResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return textResult(JSON.stringify(value));
}

function errorResult(error: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  const text = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text }], isError: true };
}

function requireApiKey(): string {
  if (!settings.cmApiKey) {
    throw new ToolError("Missing CM_API_KEY env var.");
  }
  return settings.cmApiKey;
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: settings.mcpServerName,
    version: "0.1.0",
  });

  server.registerPrompt(
    "analyze_and_solve",
    {
      title: "Analyze and solve a captcha",
      description: "Generate a full solve workflow for a page containing a captcha.",
      argsSchema: {
        url: z.string(),
        language: z.string().optional(),
      },
    },
    ({ url, language }) => {
      const lang = language ?? "python";
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `I need to solve the task on this page using capmonster: ${url}
Please:

1. Open the page in the patchright MCP browser (browser_navigate) and read the
   live DOM/network (browser_snapshot, browser_evaluate, browser_network_requests)
   to identify the captcha vendor. If the challenge is gated behind a click,
   form submit, scroll, or login, perform that interaction first — the whole
   flow stays in the patchright browser, which is stateful across tool calls.
2. Analyze what you found and write a ${lang} detect() function that extracts the necessary parameters — then show me what it would return for this page
3. Use create_task with the detected parameters to solve it via CapMonster, then poll with get_task_result until ready.
4. Write a ${lang} inject(data) function based on the page and detected callback that injects the solution data and fires the callback (apply it in-session with browser_evaluate / browser_click to verify it works)
5. Show me the final detect() and inject() functions together as a reusable Playwright script that allows me to solve the challenge on this page again if I would want to. Use capmonster API to get the solution. Do not use capmonster SDK, since the SDK may not be up to date. In the script make sure to use page.goto(url, timeout=60000) and page.wait_for_timeout(2000) after that, since some pages may intentionally keep the network busy.`,
            },
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_actual_user_agent",
    {
      title: "Get actual User-Agent",
      description: `Fetch a current, real-world (Windows) User-Agent string from CapMonster's
UA service.

Use ONE User-Agent as a single fingerprint thread across the whole solve —
they must all match or the solved token is likely to be rejected:

  1. set it as the patchright browser context's UA (browser-launch flag /
     device emulation), so the page is loaded with it;
  2. pass the SAME string as the \`userAgent\` field of any CapMonster task
     that accepts one (reCAPTCHA, Turnstile/Cloudflare, FunCaptcha, AWS WAF,
     DataDome, Imperva, Yidun, TenDI, …);
  3. when the solution comes back with its own \`userAgent\` (or
     \`headers["User-Agent"]\`), the token is bound to THAT value — reuse it
     for the injection and any follow-up requests instead of your original.

CapMonster requires a current Windows-OS UA; a stale/invalid one fails with
ERROR_WRONG_USERAGENT, so re-fetch here rather than reusing an old one.`,
      inputSchema: {},
    },
    async () => {
      try {
        const res = await fetch(USER_AGENT_URL);
        if (!res.ok) throw new ToolError(`HTTP ${res.status} fetching User-Agent`);
        const text = await res.text();
        return textResult(text.trim());
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "create_task",
    {
      title: "Create captcha task",
      description: `Submit a captcha task; returns taskId. Poll with get_task_result.

task must include 'type' and all required fields. Always look up
required params at https://docs.capmonster.cloud/docs/captchas/ —
do not rely on training data.

For a task holding one or more large base64 blobs (ComplexImageTask with
several images, htmlPageBase64 for Cloudflare cf_clearance/wait_room, or
any other opaque field/combined payload too big to type safely) pass
\`task_file\` instead of \`task\`: the path to a JSON file, on this machine's
filesystem, containing the exact task object. Write that file with a
script or a browser-side save (never by hand-typing a long base64 literal
into this tool call's own arguments — a single dropped/unclosed quote in
a multi-KB string silently merges what should be separate array elements
into one, which is why this exists: a 9-image ComplexImageTask sent
inline this way became "Image count: 1, but the task supports: 9" even
though the array had 9 entries when written). Provide exactly one of
\`task\` or \`task_file\`.`,
      inputSchema: { task: z.record(z.any()).optional(), task_file: z.string().optional() },
    },
    async ({ task, task_file }) => {
      try {
        if ((task === undefined) === (task_file === undefined)) {
          throw new ToolError("Provide exactly one of task or task_file.");
        }
        if (task_file !== undefined) {
          let raw: string;
          try {
            raw = await readFile(task_file, "utf-8");
          } catch {
            throw new ToolError(`task_file not found: ${task_file}`);
          }
          try {
            task = JSON.parse(raw);
          } catch (e) {
            throw new ToolError(`task_file is not valid JSON: ${e instanceof Error ? e.message : e}`);
          }
          if (typeof task !== "object" || task === null || Array.isArray(task)) {
            throw new ToolError("task_file must contain a JSON object (the task itself), not an array or scalar.");
          }
        }
        const key = requireApiKey();
        const data = await apiPost("/createTask", { clientKey: key, task });
        const taskId = data.taskId;
        if (!taskId) {
          throw new ToolError("No taskId returned from createTask.");
        }
        return textResult(String(taskId));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_task_result",
    {
      title: "Get task result (single poll)",
      description: `Fetch a task result ONCE (a single poll).

Prefer \`get_task_result_wait\`, which polls for you. Use this only if you
want to drive the poll loop yourself.

Returns a dict:
  - while solving:  {"status": "processing", ...} — retry after 2-3 s.
    Poll no faster than once per 2 s (max 120 polls per task), and fetch
    the result promptly: the task is stored for only ~5 min before it
    expires with ERROR_NO_SUCH_CAPCHA_ID.
  - when ready:     {"status": "ready", "solution": {...}, "cost": ..., ...}

The \`solution\` object is CapMonster's raw solution, returned verbatim — its
shape differs per captcha type. Extract fields by the shape documented for
that type (get_docs), e.g. \`gRecaptchaResponse\`/\`token\` for
reCAPTCHA/Turnstile, nested \`domains[host].cookies.*\` for DataDome/Imperva,
\`data.randstr\` + \`data.ticket\` for TenDI, etc.

IMPORTANT: several types return a \`userAgent\` (or \`headers["User-Agent"]\`)
inside the solution — the solved token is bound to it, so reuse that exact
UA in the browser / subsequent requests when injecting (Cloudflare
Challenge, FunCaptcha, AWS WAF, Binance, TenDI, Basilisk).`,
      inputSchema: { task_id: z.number() },
    },
    async ({ task_id }) => {
      try {
        const key = requireApiKey();
        const result = await pollTaskResult(key, task_id);
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_task_result_wait",
    {
      title: "Get task result (poll to completion)",
      description: `Poll a task to completion and return its solution (the usual way to
collect a result after create_task).

Blocks, polling /getTaskResult every \`poll_interval_seconds\` until the task
is ready or \`timeout_seconds\` elapses. This respects CapMonster's limits for
you — the interval is clamped to a minimum of 2 s (the API rejects faster
polling with ERROR_TOO_MUCH_REQUESTS) and the number of polls is capped at
120 per task.

Returns the same ready dict as get_task_result:
  {"status": "ready", "solution": {...}, "cost": ..., ...}
The \`solution\` is CapMonster's raw solution, verbatim — its shape differs
per captcha type (see get_task_result / get_docs).

IMPORTANT: several types return a \`userAgent\` (or \`headers["User-Agent"]\`)
inside the solution — the token is bound to it, so reuse that exact UA when
injecting (Cloudflare Challenge, FunCaptcha, AWS WAF, Binance, TenDI,
Basilisk).

Raises an error on solve error (e.g. ERROR_RECAPTCHA_TIMEOUT — often a slow
proxy) or if the task is still processing when \`timeout_seconds\` is reached
(increase the timeout, or check the proxy/params and re-create the task).`,
      inputSchema: {
        task_id: z.number(),
        timeout_seconds: z.number().optional(),
        poll_interval_seconds: z.number().optional(),
      },
    },
    async ({ task_id, timeout_seconds, poll_interval_seconds }) => {
      try {
        const key = requireApiKey();
        const result = await pollTaskResultWait(
          key,
          task_id,
          timeout_seconds ?? 120,
          poll_interval_seconds ?? 3.0,
        );
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_balance",
    {
      title: "Get CapMonster balance",
      description: "Get CapMonster account balance.",
      inputSchema: {},
    },
    async () => {
      try {
        const key = requireApiKey();
        const data = await apiPost("/getBalance", { clientKey: key });
        return textResult(`Balance: ${data.balance}`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_supported_tasks",
    {
      title: "List supported captcha task types",
      description: "List captcha task types supported by CapMonster, sourced from the OpenAPI spec.",
      inputSchema: {},
    },
    async () => {
      try {
        const tasks = await getSupportedTasks();
        return jsonResult(tasks);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_task_parameters",
    {
      title: "Get task type parameters",
      description: `Return the parameters for a CapMonster task type, from the live OpenAPI spec.

Use after get_supported_tasks() to look up what fields a task needs.
Pass either a top-level type name (e.g. 'RecaptchaV2Task', 'TurnstileTask')
or a CustomTask class name (e.g. 'DataDome', 'altcha', 'HUNT').

Returns:
  - all_parameters: every field with its type/description (nested objects
    like \`metadata\` are expanded).
  - required: the fields the spec marks required.
  - description: the type's own spec note. READ IT — for several types it is
    where the spec records that the type has mutually-exclusive VARIANTS and
    which fields each needs (e.g. Turnstile's \`cloudflareTaskType\`, AWS WAF's
    challenge/captcha/cookie option-sets). The flat \`required\` list CANNOT
    express those variants, so it under-reports what a given variant needs.
  - solution: the name of the solution schema this type returns.

⚠️ The flat field list is a starting point, not the whole contract. When
\`description\` mentions variants/options/modes — or whenever you are unsure —
confirm the exact per-variant field set and the solution shape against the
worked examples via get_docs before building the task.`,
      inputSchema: { task_type: z.string() },
    },
    async ({ task_type }) => {
      try {
        const result = await getTaskParameters(task_type);
        return jsonResult(result);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_docs",
    {
      title: "Fetch CapMonster documentation",
      description: `Fetch a CapMonster documentation page by its URL and return its text.

Use this to read a captcha type's docs (exact task parameters, how to extract
them from a live page, and worked createTask/getTaskResult examples). Pick the
URL from the llms.txt index (https://docs.capmonster.cloud/llms.txt) — it lists
every doc page. Also accepts llms-full.txt and the OpenAPI spec URL.

Only URLs on ${DOCS_ALLOWED_HOSTS.join(" or ")} are allowed.

Jumping to a section (preferred on big pages — avoids paging by hand):
  - Pass \`section="<heading>"\` to return just that \`##\`/\`###\` section (from its
    heading down to the next same-or-higher-level heading). Matching is
    case-insensitive and substring-based, so \`section="Examples of solving"\`
    or even \`section="examples"\` works. Great for going straight to
    "Create task", "Get task result", or "Examples of solving …".
  - When a page is returned in chunks, the first chunk is prefixed with a
    section outline (each heading and the exact \`section="…"\` to jump to it),
    so you can pick the section you need in one follow-up call.

Paging (when you want the raw text, no section):
  Pages that don't fit in \`limit\` characters are returned one chunk at a time,
  starting at \`offset\`. The chunk is prefixed with a header showing the range,
  the total length, and (if there's more) the \`offset\` to pass on the next
  call — keep calling with that offset until the header says end of document.`,
      inputSchema: {
        url: z.string(),
        offset: z.number().optional(),
        limit: z.number().optional(),
        section: z.string().optional(),
      },
    },
    async ({ url, offset, limit, section }) => {
      try {
        const text = await getDocs(url, {
          offset: offset ?? 0,
          limit: limit ?? DOCS_CHUNK_SIZE,
          section,
        });
        return textResult(text);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
