# captcha-mcp-test (TypeScript)

MCP server for solving captchas via [CapMonster Cloud](https://capmonster.cloud), published to
npm. This is a TypeScript port of the Python implementation in the repo root — same tools, same
behavior. It is the **solve brain**: it lists supported captcha types, serves CapMonster's docs,
and creates/polls solve tasks against the CapMonster Cloud REST API. It has **no browser of its
own** — pair it with a browser-driving MCP (e.g.
[`mcp-patchright-mainworld`](https://www.npmjs.com/package/mcp-patchright-mainworld)) that does
the page work (navigation, interaction, reading the live DOM/network, and injecting the solved
token back into the page).

## Quick start

```json
{
  "mcpServers": {
    "capmonster": {
      "command": "npx",
      "args": ["-y", "captcha-mcp-test"],
      "env": { "CM_API_KEY": "YOUR_API_KEY" }
    }
  }
}
```

`npx` runs the published npm package with no local clone needed.

## Configuration

This server only runs over stdio (the transport MCP clients use to launch it as a subprocess), so
there are no HTTP headers to carry a per-request key — set `CM_API_KEY` in the client's `env`
block and every tool call in that session uses it.

## Tools

- `get_supported_tasks` — list captcha task types CapMonster supports (from the live OpenAPI spec).
- `get_task_parameters(task_type)` — required/optional fields, variant notes, and the solution schema for a task type.
- `get_docs(url, offset, limit, section)` — fetch a CapMonster doc page (`docs.capmonster.cloud`/`api.capmonster.cloud` only), with section-jump and pagination.
- `create_task(task)` — submit a captcha task, returns a `taskId`.
- `get_task_result(task_id)` — poll a task once.
- `get_task_result_wait(task_id, timeout_seconds, poll_interval_seconds)` — poll a task to completion (preferred over driving the loop yourself).
- `get_actual_user_agent()` — fetch a current Windows User-Agent to use as one consistent fingerprint across the browser and the solve task.
- `get_balance()` — CapMonster account balance.

## Workflow

See [`../capmonster_agent/SKILL.md`](../capmonster_agent/SKILL.md) for the step-by-step procedure
for analyzing a captcha-protected page and solving it with this server paired with a `patchright`
(or any stateful browser-automation) MCP.

## Development

```
npm install
npm run build
npm test
```

- `npm run dev` — run the server directly with `tsx` (no build step).
- `npm run typecheck` — `tsc --noEmit`.
- `npm run lint` — Biome lint.
