# capmonster-mcp (TypeScript)

MCP server for solving captchas via [CapMonster Cloud](https://capmonster.cloud), published to
npm. This is a TypeScript port of the Python implementation in the repo root — same tools, same
behavior. It is the **solve brain**: it lists supported captcha types, serves CapMonster's docs,
and creates/polls solve tasks against the CapMonster Cloud REST API. It has **no browser of its
own** — pair it with a browser-driving MCP (e.g.
[`capmonster-mcp-patchright`](https://www.npmjs.com/package/capmonster-mcp-patchright)) that does
the page work (navigation, interaction, reading the live DOM/network, and injecting the solved
token back into the page).

## Quick start

```json
{
  "mcpServers": {
    "capmonster": {
      "command": "npx",
      "args": ["-y", "capmonster-mcp"],
      "env": { "CAPMONSTER_API_KEY": "YOUR_API_KEY" }
    }
  }
}
```

`npx` runs the published npm package with no local clone needed.

## One-command setup

```bash
npx -y capmonster-mcp setup
```

Registers the `capmonster` and `patchright` servers in your AI client, checks the API key
(`get_balance`) and looks for Google Chrome. It works for Python users too: it needs Node only
to run itself (`--runtime python` registers `uvx capmonster-mcp` instead of `npx`).

| Client | `--agent` | Scopes | How it is written |
|---|---|---|---|
| Claude Code | `claude-code` | `user`, `project` | `claude mcp add` (user); `.mcp.json` written directly (project) |
| Codex | `codex` | `user` | `codex mcp add` |
| Cursor | `cursor` | `user`, `project` | `~/.cursor/mcp.json`, `.cursor/mcp.json` |
| VS Code | `vscode` | `project` | `.vscode/mcp.json`, the key is asked for at start |
| Claude Desktop | `claude-desktop` | `user` | `claude_desktop_config.json` (macOS, Windows) |

- **VS Code and Claude Desktop.** For VS Code, setup writes only the project file `.vscode/mcp.json`;
  the per-user `mcp.json` (command "MCP: Open User Configuration") is not written, so `--scope user`
  is refused. Claude Desktop has no official Linux build; there setup stops with "not available on this system" (exit code 1).
- **The key.** Taken from `CAPMONSTER_API_KEY`, else from the existing entry, else asked for with
  hidden input. In the `user` scope it is stored in the client's own config; in the `project`
  scope (files you commit) only a reference such as `${CAPMONSTER_API_KEY}` is written. The key is
  never printed in full.
- **Safe to repeat.** Existing entries are shown and left alone unless you confirm or pass
  `--force`; files are backed up before they change; an entry that still uses the deprecated
  `CM_API_KEY` is moved to `CAPMONSTER_API_KEY`.
- **For an AI agent.** `npx -y capmonster-mcp setup --agent <id> --non-interactive --json` never
  asks anything, takes the key from the environment only and prints one JSON report. Exit codes:
  `0` success (warnings allowed), `1` a step failed, `2` missing input. If the key is missing the
  agent should stop and ask the user to set `CAPMONSTER_API_KEY` or to run setup in a terminal; it
  must not ask for the key in the chat.
- **Browser.** `patchright` starts the installed Google Chrome with a window. Setup warns when
  Chrome is missing (install it, or `npx patchright install chrome`, which needs administrator
  rights) or when there is no display (use `--headless`).
- **Dry run.** `--dry-run` shows what would change and writes nothing.

After setup, restart the client and run the `check_setup` prompt, or ask the agent to call `get_balance` and `get_supported_tasks`.

## Configuration

This server only runs over stdio (the transport MCP clients use to launch it as a subprocess), so
there are no HTTP headers to carry a per-request key — set `CAPMONSTER_API_KEY` in the client's `env`
block and every tool call in that session uses it. (The old name `CM_API_KEY` still works as a
deprecated fallback and logs a warning to stderr.)

## Tools

- `get_supported_tasks` — list captcha task types CapMonster supports (from the live OpenAPI spec).
- `get_task_parameters(task_type)` — required/optional fields, variant notes, and the solution schema for a task type.
- `get_docs(url, offset, limit, section)` — fetch a CapMonster doc page (`docs.capmonster.cloud`/`api.capmonster.cloud` only), with section-jump and pagination.
- `create_task(task)` — submit a captcha task, returns a `taskId`.
- `get_task_result(task_id)` — poll a task once.
- `get_task_result_wait(task_id, timeout_seconds, poll_interval_seconds)` — poll a task to completion (preferred over driving the loop yourself).
- `get_actual_user_agent()` — fetch a current Windows User-Agent to use as one consistent fingerprint across the browser and the solve task.
- `get_balance()` — CapMonster account balance.
- `get_skill()` — the full skill (step-by-step procedure for solving a captcha with this server); same text as the MCP resource `skill://capmonster-mcp/SKILL.md`, for clients that cannot read resources. Needs no API key.

Prompts (slash commands in clients that support them): `check_setup`, `solve_captcha` (`url`, optional `how_it_appears`, `hints`) and `integrate_into_project` (optional `language`, `module_path`). Their texts are in `capmonster_agent/prompts.json`, shared with the Python server. The old `analyze_and_solve` prompt was removed; use `solve_captcha`.

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
- `npm run build` also copies `../capmonster_agent/SKILL.md` and `INSTRUCTIONS.md` into `dist/agent/` (single source shared with the Python package; CI checks the copies with `scripts/verify_skill_sync.py`).
- `npm run typecheck` — `tsc --noEmit`.
- `npm run lint` — Biome lint.
