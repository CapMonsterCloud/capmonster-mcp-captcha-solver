<p align="center">
  <img src="[PATH_TO_LOGO]" alt="CapMonster Cloud" width="200">
</p>

# CapMonster Cloud MCP Server (Model Context Protocol)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP Protocol](https://img.shields.io/badge/MCP-Supported-blue.svg)](https://modelcontextprotocol.io/)
[![PyPI](https://img.shields.io/pypi/v/capmonster-mcp)](https://pypi.org/project/capmonster-mcp/)

**Let your AI agent solve CAPTCHAs on its own.** A Model Context Protocol (MCP) server for
CapMonster Cloud, available as a Python package and as a TypeScript port ([`ts/`](ts)).
Works with Claude Desktop, Cursor and other MCP clients.

<p align="center">
  <img src="[PATH_TO_DEMO_GIF]" alt="Agent solving a CAPTCHA with CapMonster Cloud MCP" width="700">
</p>

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

**[👉 Get your API Key and start solving CAPTCHAs](https://dash.capmonster.cloud/Account/SignUp?utm_source=github&utm_medium=referral&utm_campaign=mcp_repo_readme)**

---

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

1. [Get your API key](https://dash.capmonster.cloud/Account/SignUp?utm_source=github&utm_medium=referral&utm_campaign=mcp_repo_readme).
2. Add the server to your MCP client config (see below).
3. Ask your agent to open a captcha-protected page and solve it.

## 📦 Installation

Requires Python 3.11+ and a valid CapMonster API Key. Run it with `uvx` (no local clone needed):
