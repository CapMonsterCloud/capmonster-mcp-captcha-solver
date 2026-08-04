# CapMonster Cloud MCP Server (Model Context Protocol)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP Protocol](https://img.shields.io/badge/MCP-Supported-blue.svg)](https://modelcontextprotocol.io/)

The official **Model Context Protocol (MCP)** server for CapMonster Cloud. 

This server allows you to seamlessly integrate the fastest AI-powered CAPTCHA solving infrastructure into any MCP-compatible AI Assistant (like **Claude Desktop**, **Cursor IDE**, or your custom **AI Agents**). Equip your LLM with the ability to bypass web protections during autonomous web scraping and research.

**[👉 Get your Free API Key and Start Bypassing CAPTCHAs](https://dash.capmonster.cloud/Account/SignUp?utm_source=github&utm_medium=referral&utm_campaign=mcp_repo_readme)**

---

## ⚡ Supported CAPTCHAs

Your AI Agent will be able to automatically bypass:
- **reCAPTCHA** (v2, v2 Enterprise, v3, v3 Enterprise)
- **Cloudflare Turnstile** (Token, Managed Challenge)
- **FunCaptcha**
- **GeeTest** (V3 and V4)
- **Enterprise Anti-Bot Systems:** DataDome, Imperva, Binance, Prosopo, etc.
- **Image-to-Text & Complex Image Tasks**

## 📦 Installation

To use this MCP server, you need Node.js/Python (depending on your build) and a valid CapMonster API Key.

*Note: Installation instructions will be detailed here shortly upon the official release of the package.*

## 🔌 Using with Claude Desktop

To add CapMonster CAPTCHA solving capabilities to Claude Desktop, add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "capmonster": {
      "command": "npx",
      "args": [
        "-y",
        "capmonster-mcp-captcha-solver"
      ],
      "env": {
        "CAPMONSTER_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

## 🛠 Available MCP Tools

Once connected, your LLM will have access to the following tools:

- `solve_recaptcha`: Submits a target URL and sitekey to obtain a reCAPTCHA bypass token.
- `solve_turnstile`: Solves Cloudflare Turnstile challenges.
- `solve_image_captcha`: Sends a base64 encoded image to get the recognized text.
- `get_balance`: Checks your current CapMonster Cloud API balance.

*Example prompt for Claude: "Can you scrape this page? If you hit a Cloudflare Turnstile challenge, use the CapMonster tool to solve it, then proceed with extracting the data."*

## 📚 Official Documentation

- [CapMonster Cloud Main Documentation](https://docs.capmonster.cloud/)
- [Model Context Protocol (MCP) Docs](https://modelcontextprotocol.io/)

## 📄 License
[MIT](LICENSE)
