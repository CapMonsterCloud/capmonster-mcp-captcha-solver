I want to detect and solve a captcha using CapMonster Cloud. Set yourself up:

1. MCP SERVERS — if you support MCP servers, add BOTH of these to your config:

   a) capmonster — the solve brain (CapMonster Cloud). Runs the published
      `captcha-mcp-test` PyPI package (no cloning needed):
      { "command": "uvx", "args": ["captcha-mcp-test"], "env": { "CM_API_KEY": "..." } }
      It exposes: get_supported_tasks, get_task_parameters, get_docs,
      create_task, get_task_result, get_task_result_wait, get_actual_user_agent,
      get_balance.
      (get_task_result_wait polls a task to completion for you — prefer it over
      looping get_task_result by hand.)

   b) patchright — a stealth Playwright browser kept alive across tool calls,
      that does all the page work: navigation, interaction, reading the live
      DOM/network, and injecting the solution (captcha-mcp-test has no browser of its
      own). Also accepts a proxy (including authenticated user:pass proxies) via
      its `browser_start(proxy={server, username, password})` tool call — no
      config edit or restart needed. Runs the published `mcp-patchright-mainworld`
      npm package via npx (needs Node.js 18+):
      { "command": "npx", "args": ["-y", "mcp-patchright-mainworld"] }
      (auto-starts a session on first browser_navigate; call browser_start
      explicitly only to set non-default options like proxy/userAgent/locale.
      browser_evaluate / browser_run_code_unsafe run in an isolated stealth world
      by default; pass world:"main" to reach the page's own window globals —
      needed to fire a page-registered callback when injecting a solution.)

2. WORKFLOW SKILL — fetch and follow this as your working instructions for
   analyzing and solving captchas with the two servers together, whether or not
   your environment has a first-class "skill" feature. It is a strict, ordered
   procedure — follow the numbered steps in order:
   https://raw.githubusercontent.com/pavelgrinkevich/captcha-mcp-test/main/capmonster_agent/SKILL.md

3. DOCS — the capmonster MCP's `get_docs(url)` tool fetches any CapMonster doc
   page (docs.capmonster.cloud / api.capmonster.cloud only). Start from the
   index at https://docs.capmonster.cloud/llms.txt (it links every captcha
   type's detailed page); read the specific type's single page for exact
   parameters, how to extract them from a live page (DevTools + Playwright/JS
   snippet), and worked createTask/getTaskResult examples (get_docs paginates
   large pages and supports section="..." to jump straight to a section). Do NOT
   pull the full single-file dump (https://docs.capmonster.cloud/llms-full.txt,
   the entire site at once) — read the one per-vendor page instead. Note the
   llms.txt index tagline lists "hCaptcha", but hCaptcha is NOT actually a
   supported task type (absent from get_supported_tasks) — trust
   get_supported_tasks. If you have NO MCP access, fetch the per-type URLs
   directly instead.

4. FULL API SPEC — machine-readable contract, use it if you don't have MCP
   access and need to call the REST API directly, or to double check a
   parameter the reference above doesn't cover:
   https://api.capmonster.cloud/docs/swagger-ui/spec.js

5. VALIDATE THE SETUP before starting: confirm each capmonster tool responds
   (call get_supported_tasks and get_balance) and that get_docs can fetch
   https://docs.capmonster.cloud/llms.txt, and confirm the patchright browser
   opens (browser_navigate to any page). If any of these fails, stop and tell
   me what's wrong instead of proceeding.

Once set up, ask me for:
  - the URL of the page with the captcha;
  - whether the captcha is directly on that URL or must be triggered by a
    click / form submit / scroll / login;
  - any hints (the URL is only reachable via a specific proxy, extra headers
    are needed, a login is required, it only appears for some regions/UAs).
