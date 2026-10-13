<p align="center">
  <img src="assets/logo.png" alt="CapMonster Cloud" width="200">
</p>

# CapMonster Cloud MCP Server (Model Context Protocol)

[
[
[

**Let your AI agent solve CAPTCHAs on its own.** A Model Context Protocol (MCP) server for
CapMonster Cloud, available as a Python package and as a TypeScript port ([`ts/`](ts)).
Works with Claude Desktop, Cursor and other MCP clients.

## What it does

- Lists the CAPTCHA types CapMonster Cloud supports.
- Serves CapMonster's live documentation to the agent.
- Creates solve tasks and polls them against the CapMonster Cloud REST API.

This server is the **solving part** of the workflow. It has **no browser of its own** — pair it
with a browser-driving MCP (e.g.
[`capmonster-mcp-patchright`](https://www.npmjs.com/package/capmonster-mcp-patchright),
[GitHub](https://github.com/CapMonsterCloud/capmonster-mcp-patchright-captcha-solver)) that does
the page work (navigation, interaction, reading the live DOM/network, and injecting the solved
token back into the page). See [`capmonster_agent/SKILL.md`](capmonster_agent/SKILL.md) for the
full step-by-step procedure for analyzing a captcha-protected page and solving it this way.

**[👉 Get your API Key and start solving CAPTCHAs](https://dash.capmonster.cloud/Account/SignUp?utm_source=github&utm_medium=referral&utm_campaign=mcp_repo_readme&utm_content=header_button)**

***

## ⚡ Supported CAPTCHAs

Your AI Agent will be able to automatically solve, among others:
- **reCAPTCHA** (v2, v2 Enterprise, v3)
- **Cloudflare Turnstile** and Cloudflare Challenge (managed challenge / `cf_clearance`)
- **FunCaptcha** (Arkose)
- **GeeTest** (v3 and v4)
- **Enterprise Anti-Bot Systems:** AWS WAF, DataDome, Imperva, TSPD, Binance, Prosopo, Yidun,
  TenDI, Hunt, Altcha, Basilisk, and more
- **Image-to-Text & Complex Image Tasks**

The authoritative, current list is served live from CapMonster's OpenAPI spec via the
`get_supported_tasks` tool. **hCaptcha is not currently supported.**

## 🚀 Quick start

1. [Get your API key](https://dash.capmonster.cloud/Account/SignUp?utm_source=github&utm_medium=referral&utm_campaign=mcp_repo_readme&utm_content=quick_start).
2. Add the server to your MCP client config (see below).
3. Ask your agent to open a captcha-protected page and solve it.

## 📦 Installation

Requires Python 3.11+ and a valid CapMonster API Key. Run it with `uvx` (no local clone needed):

```
uvx capmonster-mcp
```

Prefer TypeScript/Node? See [`ts/README.md`](ts/README.md) for the
[npm-published port](https://www.npmjs.com/package/capmonster-mcp) — same tools, same behavior.

## 🔌 Using with an MCP client (e.g. Claude Desktop)

Add the following to your MCP client's config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "capmonster": {
      "command": "uvx",
      "args": ["capmonster-mcp"],
      "env": {
        "CM_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

The server only runs over stdio, so there are no HTTP headers to carry a per-request key —
`CM_API_KEY` is read once from the environment and shared by every tool call in the session.

Pair it with a browser-automation MCP server (e.g.
[`capmonster-mcp-patchright`](https://www.npmjs.com/package/capmonster-mcp-patchright)) so your
agent can both see the page and solve what's on it — see [`mcp.example.json`](mcp.example.json)
for a config with both servers wired up together.

## 🛠 Available MCP Tools

Once connected, your LLM will have access to the following tools:

- `get_supported_tasks`: Lists captcha task types CapMonster supports, from the live OpenAPI spec.
- `get_task_parameters(task_type)`: Required/optional fields, variant notes, and the solution
  schema for a task type.
- `get_docs(url, offset, limit, section)`: Fetches a CapMonster documentation page
  (`docs.capmonster.cloud` / `api.capmonster.cloud` only), with section-jump and pagination.
- `create_task(task)`: Submits a captcha task and returns a `taskId`.
- `get_task_result(task_id)`: Polls a task once.
- `get_task_result_wait(task_id, timeout_seconds, poll_interval_seconds)`: Polls a task to
  completion (preferred over driving the poll loop yourself).
- `get_actual_user_agent()`: Fetches a current Windows User-Agent to use as one consistent
  fingerprint across the browser and the solve task.
- `get_balance()`: Checks your current CapMonster Cloud API balance.

## ⚖️ Responsible use

Use this server only on websites you own or have permission to automate, and in line with
the terms of service of those websites and applicable law.

## 📚 Official Documentation

- [CapMonster Cloud MCP page](https://capmonster.cloud/en/mcp/?utm_source=github&utm_medium=referral&utm_campaign=mcp_repo_readme&utm_content=mcp_page)
- [CapMonster Cloud Main Documentation](https://docs.capmonster.cloud/?utm_source=github&utm_medium=referral&utm_campaign=mcp_repo_readme&utm_content=docs)
- [Model Context Protocol (MCP) Docs](https://modelcontextprotocol.io/)

## 📄 License
[MIT](LICENSE)
