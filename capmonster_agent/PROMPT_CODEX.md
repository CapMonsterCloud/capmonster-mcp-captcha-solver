Set up Codex to detect and solve captchas using CapMonster Cloud and Patchright. This prompt applies to both Codex CLI and the Codex desktop app.

Do as much setup, troubleshooting, and validation yourself as your tools and permissions allow. Do not ask me to perform steps you can perform. Do not claim a check passed unless you actually ran it successfully.

1. INSPECT THE ENVIRONMENT AND CONFIGURE MCP

First inspect:
- the currently available MCP tools;
- the active Codex configuration, normally ~/.codex/config.toml;
- any relevant configuration overrides;
- Node.js and npx in the environment where the MCP servers will run.

If running in WSL, Docker, SSH, or another remote environment, perform these checks in that environment.

Reuse existing working servers. Do not create duplicate entries, replace working settings, or overwrite an existing API key.

Ensure these two STDIO servers are configured in TOML:

[mcp_servers.capmonster]
command = "npx"
args = ["-y", "capmonster-mcp"]

[mcp_servers.patchright]
command = "npx"
args = ["-y", "capmonster-mcp-patchright"]

Preserve unrelated configuration.

CapMonster requires CM_API_KEY:
- If a usable key already exists in the server's env, reuse it.
- If it is available in Codex's environment, prefer passing it through:

env_vars = ["CM_API_KEY"]

- Do not assume an environment variable set in another shell is available to the current Codex process.
- If no usable key exists, finish all setup and validation that does not require it, then ask me once for the key.
- If I supply the key directly, store the actual value as CM_API_KEY in the user-level [mcp_servers.capmonster.env] table.
- Never print the key, repeat it in a message, expose it in diagnostic output, or write a placeholder as though it were a real credential.

Check that Node.js is version 18 or newer and npx works. If necessary, install or update Node.js yourself when permissions allow, then verify it.

Use the published npm packages through npx. Do not clone their repositories.

2. LOAD THE SERVERS IN THE CURRENT CLIENT

After changing configuration, check whether the MCP tools are available without restarting.

If a supported reload mechanism is available through your tools, use it and check again. Do not invent reload commands or assume a reload succeeded.

If both servers are already loaded and callable, do not ask for a restart.

If a restart is necessary and you cannot perform it yourself:
- In the desktop app: ask me to use Settings → MCP servers → Restart, or fully quit and reopen the app.
- In Codex CLI: ask me to exit and relaunch Codex CLI, then resume this conversation.
- If the client cannot be identified, give the two short alternatives instead of guessing.

Complete pending configuration changes, including storing a supplied key, before requesting a restart where possible.

In CLI, `codex mcp list` can check configured servers, and `/mcp` can show active servers in the interactive interface. A server appearing in a list does not prove its tools work.

You may test the published servers directly through MCP STDIO to diagnose startup or tool failures. Clearly distinguish those diagnostic tests from successful tool availability in the current Codex session.

3. FETCH AND FOLLOW THE WORKFLOW

Fetch and read:

https://raw.githubusercontent.com/CapMonsterCloud/capmonster-mcp-captcha-solver/main/capmonster_agent/SKILL.md

Follow its numbered solving procedure in order once setup validation is complete and the target details are available.

For this request, perform setup and neutral-page validation before asking for missing target details.

The finish line is a solution accepted by the target page, not merely a token returned by CapMonster.

In particular:
- Call get_supported_tasks before opening the target page.
- Identify the captcha using the live page and the current supported-task list.
- Read the captcha type's documentation before writing extraction code.
- Do not assume hCaptcha is supported based on a marketing tagline. Trust the current get_supported_tasks response.

4. VALIDATE BEFORE OPENING THE TARGET PAGE

Run these checks yourself:
- capmonster.get_supported_tasks returns a task list;
- capmonster.get_balance succeeds;
- capmonster.get_docs fetches https://docs.capmonster.cloud/llms.txt;
- patchright.browser_navigate opens a neutral page such as https://example.com.

Use the actual tool names exposed by the servers; their prefixes may differ between clients.

If a check fails, diagnose the specific cause, fix it when possible, and retry. If it still fails, stop before opening the target page and report the exact blocker and which checks passed.

Do not silently replace a failed MCP setup with direct CapMonster REST API calls.

Patchright auto-starts on browser_navigate. Call browser_start explicitly only when non-default settings are needed, such as a proxy, user agent, locale, headless mode, or a separate browser profile.

If the default browser profile is in use, use a separate profile instead of terminating an unrelated browser session.

On an environment without a graphical display, use an appropriate supported headless configuration and validate it.

5. ASK ONLY FOR MISSING TARGET DETAILS

After validation succeeds, ask for only the details I have not already supplied:
- the URL containing the captcha;
- whether it appears immediately or requires a click, form submission, scroll, or login;
- access requirements, such as a proxy, extra headers, login, region, or user agent.

Ask for missing details together. Reuse information already provided. Do not guess details that affect access or the solving procedure.

6. ANALYZE AND SOLVE THROUGH THE TWO MCP SERVERS

Patchright performs all target-page navigation, interaction, live DOM and network inspection, parameter extraction, and solution injection.

CapMonster performs task-schema lookup, task creation, and solving.

After identifying the captcha:
- Use capmonster.get_docs to read its individual documentation page, selected from https://docs.capmonster.cloud/llms.txt.
- Read the exact task parameters, extraction method, solution shape, and complete worked example.
- If the page is paginated, fetch the remaining relevant sections.
- Use get_task_parameters to cross-check the current task schema.
- Do not fetch llms-full.txt as a routine shortcut.
- If an exact parameter still needs verification, consult:
  https://api.capmonster.cloud/docs/swagger-ui/spec.js

Follow the fetched workflow and the current per-type documentation. Validate extracted required fields before creating a task.

Prefer get_task_result_wait over manually polling get_task_result.

browser_evaluate and browser_run_code_unsafe use an isolated world by default. Pass world:"main" when reading required page globals or invoking a page-registered callback.

Apply any required proxy, user-agent, and session consistency rules from the captcha documentation. If launch settings must change, close the Patchright session and restart it with the required settings.

7. VERIFY AND REPORT

Inject the solution in the live Patchright session and perform the required page interaction.

Verify whether the target page actually accepted it. A returned token, populated hidden field, or successfully invoked callback alone is not proof of acceptance.

Report concisely:
- whether both MCP servers are configured and available;
- which validation checks passed;
- the detected captcha type;
- whether solving succeeded;
- whether the target page accepted the solution;
- any remaining blocker.

If acceptance cannot be verified, say so explicitly.