# CapMonster Cloud + Patchright — Setup and Verification

I want to detect and solve a captcha on a page using CapMonster Cloud and
Patchright, then verify that the page accepted the solution.

Do as much setup, troubleshooting, and validation yourself as your tools and
permissions allow. Do not ask me to perform steps you can perform yourself.
Do not claim a check passed unless you actually ran it successfully.

1. INSPECT THE ENVIRONMENT AND EXISTING MCP CONFIGURATION

Before making changes, inspect:
- currently available MCP tools;
- existing Claude Code MCP configuration and applicable overrides;
- the environment where the servers will actually run;
- Node.js and npx availability.

Reuse existing working servers and credentials. Do not create duplicate
entries, overwrite working API keys, or replace unrelated settings.

Prefer user-scoped configuration for new personal servers so they are
available across projects. Use `claude mcp add --scope user` when available,
or carefully update the appropriate entries in ~/.claude.json.

Do not confuse Claude Code MCP configuration with another application's
MCP configuration. Respect an existing working project-scoped setup.

Native Windows, WSL, SSH, and containers can have separate configuration,
environment variables, and installed runtimes. Perform setup and validation
in the environment that will execute the MCP servers.

2. CONFIGURE BOTH STDIO SERVERS

Use the published npm packages through npx. Do not clone repositories.

For new registrations, the commands are:

claude mcp add --scope user --transport stdio capmonster -- npx -y capmonster-mcp

claude mcp add --scope user --transport stdio patchright -- npx -y capmonster-mcp-patchright

Adapt command launching to the actual operating system and shell if needed.
Check the installed CLI's help rather than guessing unsupported options.

Check that Node.js is version 18 or newer and npx works. If Node.js is missing
or too old, install or update it yourself when permissions allow, then verify
the installed version.

If an existing CapMonster server uses the published PyPI package through
`uvx capmonster-mcp` and works, reuse it. Verify its required runtimes instead
of replacing it unnecessarily.

CapMonster requires CM_API_KEY:
- Reuse a usable key already configured in the server's environment.
- Otherwise, reuse CM_API_KEY from the actual Claude Code process environment.
- Do not assume a variable set in another terminal is available to this process.
- If no usable key exists, complete all setup and checks that do not depend
  on it, then ask me once for the key.
- If I supply the key directly, save it as CM_API_KEY in the CapMonster
  server's user-level env configuration.
- Never print or repeat the key, expose it in diagnostic output, or put it
  in a project file.
- Never save "..." or any other placeholder as though it were a real key.

3. LOAD AND CHECK THE MCP TOOLS

After configuration changes, first check whether the tools are already
available in the current session.

If a supported reload or reconnect mechanism is available through your tools,
use it and check again. Do not invent reload commands or assume opening
`/mcp` automatically loads new configuration.

`claude mcp list` and `/mcp` can help inspect configuration and connection
status, but a server appearing in a list does not prove its tools work.

If the servers are already loaded and callable, do not request a restart.

If a new conversation or client restart is necessary and you cannot perform
it yourself, give the smallest action appropriate to the current interface:
- start a new Claude Code conversation in the editor; or
- exit and relaunch Claude Code in the terminal.

Ask to reload the editor window only if that is actually needed.
Complete pending configuration changes before requesting a restart where
possible.

You may diagnose the published servers directly through MCP STDIO. Clearly
distinguish those diagnostic tests from tools being available in the current
Claude Code session.

4. FETCH THE WORKFLOW INSTRUCTIONS

Fetch and read:

https://raw.githubusercontent.com/CapMonsterCloud/capmonster-mcp-captcha-solver/main/capmonster_agent/SKILL.md

Use its numbered procedure for identifying, extracting, solving, injecting,
and verifying captchas.

For this request, complete setup and neutral-page validation before asking
for missing target details. Then follow the numbered solving steps in order.

In particular:
- Call get_supported_tasks before opening the target page.
- Match the live captcha against the current supported-task list.
- Read the captcha type's documentation before writing extraction code.

The finish line is a solution accepted by the target page, not merely a
token returned by CapMonster.

5. VALIDATE BEFORE OPENING THE TARGET PAGE

Run these checks yourself:
- capmonster.get_supported_tasks returns a task list;
- capmonster.get_balance succeeds;
- capmonster.get_docs fetches https://docs.capmonster.cloud/llms.txt;
- patchright.browser_navigate opens https://example.com successfully.

Use the actual tool names exposed by the servers; prefixes may vary.

If a check fails, diagnose the specific cause, fix it when possible, and
retry. If it still fails, stop before opening the target page and report
the exact blocker and which checks passed.

Do not silently substitute direct CapMonster REST calls for a failed
MCP setup.

Patchright auto-starts on browser_navigate. Call browser_start explicitly
only when non-default settings are needed, such as a proxy, user agent,
locale, headless mode, or separate browser profile.

If the default profile is already in use, use a separate profile instead
of terminating an unrelated browser session.

If no graphical display is available, use a supported headless configuration
and validate it.

6. ASK ONLY FOR MISSING TARGET DETAILS

Once validation succeeds, ask for only the details I have not already supplied:
- the URL containing the captcha;
- whether it appears immediately or requires a click, form submission,
  scroll, or login;
- access requirements, such as a proxy, extra headers, login, region,
  or user agent.

Ask for missing details together. Reuse information already provided.
Do not guess details that materially affect access or solving.

7. USE THE CURRENT CAPMONSTER DOCUMENTATION

Start with the index, fetched through capmonster.get_docs:

https://docs.capmonster.cloud/llms.txt

After identifying the captcha type, read its individual documentation page
for:
- required and optional task parameters;
- the extraction method;
- the solution's exact shape;
- the complete worked solving example.

Read all relevant sections. If the page is paginated, fetch the remaining
sections using the supported offset or section parameters.

Use get_task_parameters to cross-check the current schema before creating
a task. Resolve discrepancies before submitting it.

Do not fetch llms-full.txt as a routine shortcut.

If an exact parameter needs another check, consult the machine-readable
API specification:

https://api.capmonster.cloud/docs/swagger-ui/spec.js

8. SOLVE THROUGH THE TWO MCP SERVERS

Patchright performs all target-page navigation, interaction, live DOM and
network inspection, parameter extraction, and solution injection.

CapMonster performs documentation and task-schema lookup, task creation,
and solving.

Follow the fetched workflow and the current per-type documentation.
Run extraction on the live page and verify that every required parameter
is present and has the expected shape before creating a task.

Prefer get_task_result_wait over manually polling get_task_result.

browser_evaluate and browser_run_code_unsafe use an isolated world by
default. Pass world:"main" when reading required page globals or calling
a page-registered callback.

Apply the proxy, user-agent, and session consistency requirements documented
for the captcha type.

A proxy can be supplied through browser_start without changing MCP
configuration. However, changing launch settings on an already running
browser requires browser_close followed by browser_start with the new
settings. This creates a fresh browser context.

For challenges that bind the result to an IP address, follow the documented
requirements for using the same proxy with the browser and the solver.

9. VERIFY ACCEPTANCE AND REPORT

Apply the solution in the live Patchright session and perform the required
page interaction.

Verify whether the target page actually accepted it. Receiving a token,
populating a hidden field, or successfully invoking a callback alone is
not proof of acceptance.

Report concisely:
- whether both MCP servers are configured and available;
- which validation checks passed;
- the detected captcha type;
- whether solving succeeded;
- whether the target page accepted the solution;
- any remaining blocker.

If acceptance cannot be verified, say so explicitly.