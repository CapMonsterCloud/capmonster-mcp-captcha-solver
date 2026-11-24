<p align="center">
  <img src="assets/logo.svg" alt="CapMonster Cloud" width="200">
</p>

# CapMonster Cloud MCP Server: Captcha Solver & Captcha Bypass for AI Agents (Model Context Protocol)

> **🔄 Using the CapSolver or 2Captcha MCP server?** CapMonster Cloud is a cost-effective **capsolver alternative** and **2captcha alternative** for AI agents: its MCP server covers reCAPTCHA, Cloudflare Turnstile, FunCaptcha, GeeTest, AWS WAF, DataDome and more, while reCAPTCHA v3 starts at **$0.90 per 1,000 solves**, which is **up to 38% cheaper than 2Captcha** and **10% cheaper than Capsolver**. Switching your MCP client takes one config change: see the **Migration example** below. Full comparison and disclaimer are in the comparison section below.

<p>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://modelcontextprotocol.io/"><img src="https://img.shields.io/badge/MCP-Supported-blue.svg" alt="MCP Protocol"></a>
  <a href="https://pypi.org/project/capmonster-mcp/"><img src="https://img.shields.io/pypi/v/capmonster-mcp" alt="PyPI"></a>
  <a href="https://www.npmjs.com/package/capmonster-mcp"><img src="https://img.shields.io/npm/v/capmonster-mcp" alt="npm"></a>
  <a href="https://glama.ai/mcp/servers/CapMonsterCloud/capmonster-mcp-captcha-solver"><img src="https://glama.ai/mcp/servers/CapMonsterCloud/capmonster-mcp-captcha-solver/badges/score.svg" alt="CapMonsterCloud/capmonster-mcp-captcha-solver MCP server"></a>
</p>

**Let your AI agent solve CAPTCHAs on its own.** A Model Context Protocol (MCP) server for
CapMonster Cloud, available as a Python package and as a TypeScript port ([`ts/`](ts)).
Works with Claude Desktop, Cursor and other MCP clients. As the official CapMonster MCP server, it is a cost-effective 2captcha alternative and capsolver alternative for captcha bypass in AI-agent web scraping and browser automation.

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

## 📊 CapMonster Cloud MCP vs CapSolver MCP vs 2Captcha mcp-captcha-solver

Looking for a capsolver alternative or a 2captcha alternative for AI agents? Compare the MCP servers and the underlying captcha solving services.

### MCP server coverage

| Parameter | CapMonster Cloud MCP | CapSolver MCP | 2Captcha mcp-captcha-solver |
| :--- | :--- | :--- | :--- |
| Captcha types available through MCP | **reCAPTCHA v2 / v2 Enterprise / v3, Cloudflare Turnstile and Challenge, FunCaptcha, GeeTest v3 / v4, AWS WAF, DataDome, Imperva, TSPD, Binance, Prosopo, Yidun, TenDI, Hunt, Altcha, Basilisk, image tasks** | reCAPTCHA v2, reCAPTCHA v3, Cloudflare Turnstile | reCAPTCHA v2 |
| Install | `uvx capmonster-mcp` (PyPI) or npm | `pip install capsolver-mcp` (PyPI) | Run from a cloned Python project |

*Disclaimer: CapSolver and 2Captcha are trademarks of their respective owners. CapMonster Cloud is not affiliated with these entities. MCP coverage of other services is based on their publicly available documentation and repositories as of 27.10.2026 and may change.*

### reCAPTCHA v3

| Parameter | CapMonster Cloud | 2Captcha | CapSolver | DeathByCaptcha |
| :--- | :---: | :---: | :---: | :---: |
| Price per 1,000 solves (from) | **$0.90** | $1.45 | $1.00 | $2.89 |
| API response time | **≤ 2 s** | ≤ 2 s | < 3 s | ≤ 3 s |
| Solving success rate | **up to 99%** | ~77–92% | ~95–98% | ~64–90% |

*Disclaimer: 2Captcha, CapSolver, and DeathByCaptcha are trademarks of their respective owners. CapMonster Cloud is not affiliated with these entities. Performance metrics and pricing comparisons are based on publicly available data and internal benchmarking conducted on 27.09.2026.*

### Cloudflare Turnstile

| Parameter | CapMonster Cloud | 2Captcha | Anti-Captcha | DeathByCaptcha |
| :--- | :---: | :---: | :---: | :---: |
| Price per 1,000 solves (from) | **$1.30** | $1.45 | $2.00 | $2.89 |
| Time to solve | **6.24 s\*** | 16.9 s | 20.33 s | ~13 s |
| Solving success rate | **99%\*** | 96% | 96% | 96% |

*Disclaimer: 2Captcha, Anti-Captcha, and DeathByCaptcha are trademarks of their respective owners. CapMonster Cloud is not affiliated with these entities. Performance metrics and pricing comparisons are based on publicly available data and internal benchmarking as of 12.10.2026.*

**What this means in practice:**

- **reCAPTCHA v3:** $0.90 versus $1.45 at 2Captcha is up to 38% cheaper, and $0.90 versus $1.00 at Capsolver is 10% cheaper.
- **Cloudflare Turnstile:** $1.30 versus $1.45 at 2Captcha is 10% cheaper, and a solving time of 6.24 s versus 16.9 s is more than 60% faster.

***

## ⚡ Supported CAPTCHAs: Captcha Bypass for AI Agents

Use this MCP captcha solver for captcha bypass in AI web scraping and browser automation: reCAPTCHA bypass, Cloudflare Turnstile solver, DataDome solver, FunCaptcha solver, AWS WAF bypass and GeeTest solver.

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

```text
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

## 🔄 Migrating from the CapSolver or 2Captcha MCP server

Already give your AI agent captcha solving through another MCP server? Replace only the server entry in your MCP client config and keep the rest of your agent setup unchanged.

### Before: CapSolver MCP

```json
{
  "mcpServers": {
    "capsolver": {
      "command": "capsolver-mcp",
      "env": {
        "CAPSOLVER_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

### After: CapMonster Cloud MCP

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

Get your key from the [CapMonster Cloud Dashboard](https://dash.capmonster.cloud/Account/SignUp?utm_source=github&utm_medium=referral&utm_campaign=mcp_repo_readme&utm_content=migration), restart your MCP client and your agent will see the CapMonster tools listed below.

If you use the 2Captcha `mcp-captcha-solver` project instead, remove its server entry from your client config and add the CapMonster entry above. Pair it with a browser MCP such as `capmonster-mcp-patchright` for the page work.

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

## ❓ FAQ

**Is CapMonster Cloud a CapSolver alternative for MCP?**
Yes. The CapMonster Cloud MCP server covers more captcha types than the CapSolver MCP server, which exposes reCAPTCHA v2, reCAPTCHA v3 and Cloudflare Turnstile. For reCAPTCHA v3 the CapMonster Cloud service is also 10% cheaper ($0.90 versus $1.00 per 1,000 solves) with an API response time of ≤ 2 s versus < 3 s. See the comparison tables above and their disclaimers.

**Is CapMonster Cloud a 2Captcha alternative for AI agents?**
Yes. The 2Captcha `mcp-captcha-solver` project focuses on reCAPTCHA v2, while this server covers many more task types. For reCAPTCHA v3 CapMonster Cloud starts at $0.90 per 1,000 solves versus $1.45 at 2Captcha, which is up to 38% cheaper.

**How do I switch from the CapSolver MCP server to CapMonster Cloud?**
Replace the `capsolver` entry in your MCP client config with the `capmonster` entry shown in the migration example, set `CM_API_KEY` and restart the client.

**How do I bypass reCAPTCHA or Cloudflare Turnstile with Claude or Cursor?**
Add this server and a browser MCP to your client, then ask the agent to open the protected page and solve it. The agent reads the page parameters, creates a task with `create_task`, waits with `get_task_result_wait` and injects the token through the browser server.

**Does it support hCaptcha?**
No. hCaptcha is not currently supported.

**How do I get an API key?**
Register on CapMonster Cloud and copy your API key. See the [Getting Started Guide](https://docs.capmonster.cloud/docs/getting-start/?utm_source=github&utm_medium=referral&utm_campaign=mcp_repo_readme&utm_content=faq).

## ⚖️ Responsible use

Use this server only on websites you own or have permission to automate, and in line with
the terms of service of those websites and applicable law.

## 📚 Official Documentation

- [CapMonster Cloud MCP page](https://capmonster.cloud/en/mcp/?utm_source=github&utm_medium=referral&utm_campaign=mcp_repo_readme&utm_content=mcp_page)
- [CapMonster Cloud Main Documentation](https://docs.capmonster.cloud/?utm_source=github&utm_medium=referral&utm_campaign=mcp_repo_readme&utm_content=docs)
- [Model Context Protocol (MCP) Docs](https://modelcontextprotocol.io/)

## 📄 License
[MIT](LICENSE)

<a href="https://devhunt.org/tool/capmonster-cloud-mcp" target="_blank" title="CapMonster Cloud MCP on DevHunt"><img src="https://devhunt.org/badge/capmonster-cloud-mcp.svg" alt="CapMonster Cloud MCP - Featured on DevHunt" width="220" height="54" /></a>
