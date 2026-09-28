# CapMonster Cloud + Patchright — Setup and Verification

Detect and solve a captcha on a page using CapMonster Cloud and Patchright,
then verify the page actually accepted the solution.

Do as much setup/troubleshooting/validation yourself as your tools allow.
Don't ask me to do steps you can do. Don't claim a check passed unless it
actually ran.

1. INSPECT THE ENVIRONMENT

Check: available MCP tools, existing MCP config, the environment the
servers will run in (Windows/WSL/SSH/containers may differ), Node.js/npx.

Reuse existing working servers/credentials. Don't duplicate entries,
overwrite working keys, or touch unrelated settings. Prefer user-scoped
config for new servers (`claude mcp add --scope user`).

2. CONFIGURE BOTH STDIO SERVERS

Use the published npm packages via npx, don't clone repos:

claude mcp add --scope user --transport stdio capmonster -- npx -y capmonster-mcp
claude mcp add --scope user --transport stdio patchright -- npx -y capmonster-mcp-patchright

Adapt to the actual OS/shell. Confirm Node.js >=18 and npx work.

If a CapMonster server already works via `uvx capmonster-mcp` (PyPI), reuse it.

CapMonster requires CM_API_KEY. Reuse a key already configured or in the
process env. If none exists, finish everything that doesn't need it, then
ask me once. If given a key, save it in the CapMonster server's user-level
env — never print/log it, put it in a project file, or save "..." as real.

3. LOAD AND CHECK THE MCP TOOLS

Check if the tools are already available first. If a supported
reload/reconnect exists, use it and recheck. `claude mcp list`/`/mcp` show
config/connection status, not proof the tools work. Don't restart if
servers are already callable; if a restart is truly needed and you can't do
it, ask for the smallest fitting action, after finishing everything else.

4. FETCH THE WORKFLOW INSTRUCTIONS

Fetch and read:
https://raw.githubusercontent.com/CapMonsterCloud/capmonster-mcp-captcha-solver/main/capmonster_agent/SKILL.md

Follow its numbered procedure for identifying, extracting, solving,
injecting, verifying. Finish setup/validation before asking for target
details. Call get_supported_tasks before opening the target page and match
the live captcha against it; read that type's docs before extraction code.
Finish line: the target page accepts the solution, not just a token back.

5. VALIDATE BEFORE OPENING THE TARGET PAGE

Run yourself: capmonster.get_supported_tasks, capmonster.get_balance,
capmonster.get_docs (https://docs.capmonster.cloud/llms.txt), and
patchright.browser_navigate to https://example.com.

On failure, diagnose/retry; if still failing, stop before the target page
and report the blocker plus which checks passed. Don't fall back to raw
CapMonster REST calls in place of a broken MCP setup.

Patchright auto-starts on browser_navigate; call browser_start only for
non-default settings (proxy, UA, locale, headless, profile). Use a separate
profile rather than killing an unrelated default-profile session. No
display → use a validated headless config.

6. ASK ONLY FOR MISSING TARGET DETAILS

Once validation passes, ask together for whatever I haven't given: the
target URL; whether the captcha needs a click/submit/scroll/login; access
requirements (proxy, headers, login, region, UA). Don't guess details that
affect access or solving.

7. USE CURRENT CAPMONSTER DOCS

Start at the index via capmonster.get_docs: https://docs.capmonster.cloud/llms.txt
Then read that captcha type's page for required/optional params, extraction
method, exact solution shape, and a worked example. Cross-check the schema
with get_task_parameters before creating a task; resolve discrepancies
first. Don't fetch llms-full.txt as a routine shortcut.

8. SOLVE THROUGH THE TWO MCP SERVERS

Patchright: target-page navigation, interaction, DOM/network inspection,
extraction, solution injection. CapMonster: doc/schema lookup, task
creation, solving.

Follow the fetched workflow and current per-type docs. Extract on the live
page and confirm every required parameter is present/correctly shaped
before creating a task. Prefer get_task_result_wait over manual polling.

browser_evaluate/browser_run_code_unsafe default to an isolated world — pass
world:"main" for page globals or callbacks.

Apply the documented proxy/UA/session-consistency requirements. Changing
settings on an already-running browser needs browser_close then
browser_start (fresh context). For IP-bound challenges, keep browser and
solver on the same proxy.

9. VERIFY ACCEPTANCE AND REPORT

Apply the solution in the live Patchright session and do the required page
interaction. Confirm the target page actually accepted it — a returned
token, a populated hidden field, or a successful callback call alone is not
proof.

Report concisely: MCP servers configured/available, checks passed, detected
captcha type, whether solving succeeded, whether the page accepted it, and
any remaining blocker. If acceptance can't be verified, say so explicitly.
