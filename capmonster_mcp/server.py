import asyncio
import json
import re
from functools import lru_cache
from urllib.parse import urlparse

import httpx
from fastmcp import Context, FastMCP
from fastmcp.exceptions import ToolError

from .config import AppSettings
from .middleware import ApiKeyMiddleware

OPENAPI_URL = "https://api.capmonster.cloud/docs/swagger-ui/spec.js"
USER_AGENT_URL = "https://capmonster.cloud/api/useragent/actual"

DOCS_ALLOWED_HOSTS = ("docs.capmonster.cloud", "api.capmonster.cloud")

_OPENAPI_SPEC_JS_RE = re.compile(r"window\.openApiSpec\s*=\s*(\{.*\});?\s*$", re.DOTALL)


@lru_cache(maxsize=1)
def _openapi_load_spec() -> dict:
    response = httpx.get(OPENAPI_URL)
    match = _OPENAPI_SPEC_JS_RE.search(response.text)
    if not match:
        raise ValueError(f"Could not find openApiSpec assignment in {OPENAPI_URL}")
    return json.loads(match.group(1))


def _openapi_resolve_ref(spec: dict, ref: str) -> dict:
    """Follow a $ref like '#/components/schemas/Foo'"""
    parts = ref.lstrip("#/").split("/")
    node = spec
    for part in parts:
        node = node[part]
    return node


def _openapi_collect_properties(
    spec: dict, schema: dict, visited: set = None
) -> tuple[dict, set]:
    """Recursively merge properties from allOf/oneOf, resolving $refs."""
    if visited is None:
        visited = set()

    properties = {}
    required = set()

    if "$ref" in schema:
        ref = schema["$ref"]
        if ref in visited:
            return properties, required
        visited.add(ref)
        schema = _openapi_resolve_ref(spec, ref)

    for sub in schema.get("allOf", []):
        sub_props, sub_req = _openapi_collect_properties(spec, sub, visited)
        properties.update(sub_props)
        required.update(sub_req)

    for name, prop_schema in schema.get("properties", {}).items():
        if "$ref" in prop_schema:
            prop_schema = _openapi_resolve_ref(spec, prop_schema["$ref"])

        if prop_schema.get("type") == "object" and "properties" in prop_schema:
            nested_props = {}
            nested_required = set(prop_schema.get("required", []))
            for nested_name, nested_schema in prop_schema["properties"].items():
                if "$ref" in nested_schema:
                    nested_schema = _openapi_resolve_ref(spec, nested_schema["$ref"])
                nested_props[nested_name] = {
                    "description": nested_schema.get("description", ""),
                    "type": nested_schema.get("type", ""),
                    "required": nested_name in nested_required,
                }
            properties[name] = {
                "description": prop_schema.get("description", ""),
                "type": "object",
                "properties": nested_props,
            }
        else:
            properties[name] = {
                "description": prop_schema.get("description", ""),
                "type": prop_schema.get("type", ""),
            }

    required.update(schema.get("required", []))

    return properties, required


CAPMONSTER_API_URL = "https://api.capmonster.cloud"

settings = AppSettings()
mcp = FastMCP(settings.mcp_server_name)


async def _api_post(path: str, body: dict) -> dict:
    async with httpx.AsyncClient() as client:
        res = await client.post(
            f"{CAPMONSTER_API_URL}{path}",
            json=body,
            timeout=15.0,
        )

        try:
            data = res.json()
        except ValueError:
            res.raise_for_status()

    if isinstance(data, dict) and data.get("errorId", 0) != 0:
        code = data.get("errorCode", "UNKNOWN")
        desc = data.get("errorDescription", "No description.")
        raise ToolError(f"CapMonster error [{code}](HTTP {res.status_code}): {desc}")

    res.raise_for_status()
    return data


@mcp.prompt()
def analyze_and_solve(url: str, language: str = "python") -> str:
    """Generate a full solve workflow for a page containing a captcha.

    Args:
        url: target page URL
        language: language for generated Playwright scripts (default: python)
    """
    return f""""
    I need to solve the task on this page using capmonster: {url}
    Please:

    1. Open the page in the patchright MCP browser (browser_navigate) and read the
       live DOM/network (browser_snapshot, browser_evaluate, browser_network_requests)
       to identify the captcha vendor. If the challenge is gated behind a click,
       form submit, scroll, or login, perform that interaction first — the whole
       flow stays in the patchright browser, which is stateful across tool calls.
    2. Analyze what you found and write a {language} detect() function that extracts the necessary parameters — then show me what it would return for this page
    3. Use create_task with the detected parameters to solve it via CapMonster, then poll with get_task_result until ready.
    4. Write a {language} inject(data) function based on the page and detected callback that injects the solution data and fires the callback (apply it in-session with browser_evaluate / browser_click to verify it works)
    5. Show me the final detect() and inject() functions together as a reusable Playwright script that allows me to solve the challenge on this page again if I would want to. Use capmonster API to get the solution. Do not use capmonster SDK, since the SDK may not be up to date. In the script make sure to use page.goto(url, timeout=60000) and page.wait_for_timeout(2000) after that, since some pages may intentionally keep the network busy.
    """


@mcp.tool()
async def get_actual_user_agent() -> str:
    """Fetch a current, real-world (Windows) User-Agent string from CapMonster's
    UA service.

    Use ONE User-Agent as a single fingerprint thread across the whole solve —
    they must all match or the solved token is likely to be rejected:

      1. set it as the patchright browser context's UA (browser-launch flag /
         device emulation), so the page is loaded with it;
      2. pass the SAME string as the `userAgent` field of any CapMonster task
         that accepts one (reCAPTCHA, Turnstile/Cloudflare, FunCaptcha, AWS WAF,
         DataDome, Imperva, Yidun, TenDI, …);
      3. when the solution comes back with its own `userAgent` (or
         `headers["User-Agent"]`), the token is bound to THAT value — reuse it
         for the injection and any follow-up requests instead of your original.

    CapMonster requires a current Windows-OS UA; a stale/invalid one fails with
    ERROR_WRONG_USERAGENT, so re-fetch here rather than reusing an old one.
    """
    async with httpx.AsyncClient() as client:
        response = await client.get(USER_AGENT_URL)
        response.raise_for_status()
    return response.text.strip()


@mcp.tool()
async def create_task(ctx: Context, task: dict | None = None, task_file: str | None = None) -> str:
    """Submit a captcha task; returns taskId. Poll with get_task_result.

    task must include 'type' and all required fields. Always look up
    required params at https://docs.capmonster.cloud/docs/captchas/ —
    do not rely on training data.

    For a task holding one or more large base64 blobs (ComplexImageTask with
    several images, htmlPageBase64 for Cloudflare cf_clearance/wait_room, or
    any other opaque field/combined payload too big to type safely) pass
    `task_file` instead of `task`: the path to a JSON file, on this machine's
    filesystem, containing the exact task object. Write that file with a
    script or a browser-side save (never by hand-typing a long base64 literal
    into this tool call's own arguments — a single dropped/unclosed quote in
    a multi-KB string silently merges what should be separate array elements
    into one, which is why this exists: a 9-image ComplexImageTask sent
    inline this way became "Image count: 1, but the task supports: 9" even
    though the array had 9 entries when written). Provide exactly one of
    `task` or `task_file`.
    """
    if (task is None) == (task_file is None):
        raise ToolError("Provide exactly one of task or task_file.")
    if task_file is not None:
        try:
            with open(task_file, "r", encoding="utf-8") as f:
                task = json.load(f)
        except FileNotFoundError:
            raise ToolError(f"task_file not found: {task_file}")
        except json.JSONDecodeError as e:
            raise ToolError(f"task_file is not valid JSON: {e}")
        if not isinstance(task, dict):
            raise ToolError("task_file must contain a JSON object (the task itself), not an array or scalar.")
    key = await ctx.get_state("cm_api_key")
    data = await _api_post(
        "/createTask",
        {"clientKey": key, "task": task},
    )
    task_id = data.get("taskId")
    if not task_id:
        raise ToolError("No taskId returned from createTask.")
    return str(task_id)


async def _poll_task_result(key: str, task_id: int) -> dict:
    """One /getTaskResult call, shaped into a dict.

    Returns {"status": "ready", "solution": {...}, ...} or
    {"status": "processing", ...}. Raises ToolError on a ready-but-empty
    solution or an unexpected status. Shared by get_task_result (single poll)
    and get_task_result_wait (poll loop)."""
    data = await _api_post(
        "/getTaskResult",
        {"clientKey": key, "taskId": task_id},
    )

    status = data.get("status")
    if status == "ready":
        solution = data.get("solution", {})
        if not solution:
            raise ToolError("Task completed but solution was empty.")
        # Return the full solution verbatim (not a stringified repr) plus any
        # task metadata CapMonster includes, so nothing the caller may need
        # (e.g. a UA the token is bound to) is dropped or made unparseable.
        result = {"status": "ready", "solution": solution}
        for meta_key in ("cost", "ip", "createTime", "endTime", "solveCount"):
            if meta_key in data:
                result[meta_key] = data[meta_key]
        return result

    if status == "processing":
        return {
            "status": "processing",
            "taskId": task_id,
            "message": (
                f"task {task_id} is not ready yet, try again in 2-3 seconds "
                "(poll no faster than once per 2 s)."
            ),
        }

    raise ToolError(f"Unexpected status '{status}' for task {task_id}.")


@mcp.tool()
async def get_task_result(ctx: Context, task_id: int) -> dict:
    """Fetch a task result ONCE (a single poll).

    Prefer `get_task_result_wait`, which polls for you. Use this only if you
    want to drive the poll loop yourself.

    Returns a dict:
      - while solving:  {"status": "processing", ...} — retry after 2-3 s.
        Poll no faster than once per 2 s (max 120 polls per task), and fetch
        the result promptly: the task is stored for only ~5 min before it
        expires with ERROR_NO_SUCH_CAPCHA_ID.
      - when ready:     {"status": "ready", "solution": {...}, "cost": ..., ...}

    The `solution` object is CapMonster's raw solution, returned verbatim — its
    shape differs per captcha type. Extract fields by the shape documented for
    that type (get_docs), e.g. `gRecaptchaResponse`/`token` for
    reCAPTCHA/Turnstile, nested `domains[host].cookies.*` for DataDome/Imperva,
    `data.randstr` + `data.ticket` for TenDI, etc.

    IMPORTANT: several types return a `userAgent` (or `headers["User-Agent"]`)
    inside the solution — the solved token is bound to it, so reuse that exact
    UA in the browser / subsequent requests when injecting (Cloudflare
    Challenge, FunCaptcha, AWS WAF, Binance, TenDI, Basilisk)."""
    key = await ctx.get_state("cm_api_key")
    return await _poll_task_result(key, task_id)


@mcp.tool()
async def get_task_result_wait(
    ctx: Context,
    task_id: int,
    timeout_seconds: int = 120,
    poll_interval_seconds: float = 3.0,
) -> dict:
    """Poll a task to completion and return its solution (the usual way to
    collect a result after create_task).

    Blocks, polling /getTaskResult every `poll_interval_seconds` until the task
    is ready or `timeout_seconds` elapses. This respects CapMonster's limits for
    you — the interval is clamped to a minimum of 2 s (the API rejects faster
    polling with ERROR_TOO_MUCH_REQUESTS) and the number of polls is capped at
    120 per task.

    Returns the same ready dict as get_task_result:
      {"status": "ready", "solution": {...}, "cost": ..., ...}
    The `solution` is CapMonster's raw solution, verbatim — its shape differs
    per captcha type (see get_task_result / get_docs).

    IMPORTANT: several types return a `userAgent` (or `headers["User-Agent"]`)
    inside the solution — the token is bound to it, so reuse that exact UA when
    injecting (Cloudflare Challenge, FunCaptcha, AWS WAF, Binance, TenDI,
    Basilisk).

    Raises ToolError on solve error (e.g. ERROR_RECAPTCHA_TIMEOUT — often a slow
    proxy) or if the task is still processing when `timeout_seconds` is reached
    (increase the timeout, or check the proxy/params and re-create the task)."""
    key = await ctx.get_state("cm_api_key")
    interval = max(2.0, poll_interval_seconds)
    max_polls = 120
    deadline = asyncio.get_event_loop().time() + timeout_seconds

    last = None
    for _ in range(max_polls):
        last = await _poll_task_result(key, task_id)
        if last["status"] == "ready":
            return last
        if asyncio.get_event_loop().time() + interval >= deadline:
            break
        await asyncio.sleep(interval)

    raise ToolError(
        f"Task {task_id} still processing after {timeout_seconds}s "
        f"(polled every {interval:g}s). Increase timeout_seconds, or verify the "
        "proxy/params and re-create the task."
    )


@mcp.tool()
async def get_balance(ctx: Context) -> str:
    """Get CapMonster account balance."""
    key = await ctx.get_state("cm_api_key")
    data = await _api_post("/getBalance", {"clientKey": key})
    return f"Balance: {data['balance']}"


@mcp.tool()
async def get_supported_tasks() -> list[str]:
    """List captcha task types supported by CapMonster, sourced from the OpenAPI spec.
    """
    spec = _openapi_load_spec()
    schemas = spec["components"]["schemas"]

    task_mapping = schemas["Task"]["discriminator"]["mapping"]
    custom_mapping = schemas["CustomTask"]["discriminator"]["mapping"]

    top_level = [t for t in task_mapping.keys() if t != "CustomTask"]
    custom = list(custom_mapping.keys())

    return top_level + custom


@mcp.tool()
async def get_task_parameters(task_type: str) -> dict:
    """Return the parameters for a CapMonster task type, from the live OpenAPI spec.

    Use after get_supported_tasks() to look up what fields a task needs.
    Pass either a top-level type name (e.g. 'RecaptchaV2Task', 'TurnstileTask')
    or a CustomTask class name (e.g. 'DataDome', 'altcha', 'HUNT').

    Returns:
      - all_parameters: every field with its type/description (nested objects
        like `metadata` are expanded).
      - required: the fields the spec marks required.
      - description: the type's own spec note. READ IT — for several types it is
        where the spec records that the type has mutually-exclusive VARIANTS and
        which fields each needs (e.g. Turnstile's `cloudflareTaskType`, AWS WAF's
        challenge/captcha/cookie option-sets). The flat `required` list CANNOT
        express those variants, so it under-reports what a given variant needs.
      - solution: the name of the solution schema this type returns.

    ⚠️ The flat field list is a starting point, not the whole contract. When
    `description` mentions variants/options/modes — or whenever you are unsure —
    confirm the exact per-variant field set and the solution shape against the
    worked examples via get_docs before building the task."""
    spec = _openapi_load_spec()
    schemas = spec["components"]["schemas"]

    task_mapping = schemas["Task"].get("discriminator", {}).get("mapping", {})
    custom_mapping = schemas["CustomTask"].get("discriminator", {}).get("mapping", {})

    if task_type in task_mapping:
        ref = task_mapping[task_type]
        schema = _openapi_resolve_ref(spec, ref)
    elif task_type in custom_mapping:
        ref = custom_mapping[task_type]
        schema = _openapi_resolve_ref(spec, ref)
    else:
        available = list(task_mapping.keys()) + list(custom_mapping.keys())
        raise ValueError(
            f"Unknown task type '{task_type}'. "
            f"Available: {', '.join(sorted(available))}"
        )

    all_props, required_fields = _openapi_collect_properties(spec, schema)
    result = {"all_parameters": all_props, "required": sorted(required_fields)}
    # Surface the spec's own per-type note and solution-schema name (both live
    # from the OpenAPI spec, so they never go stale): `description` is where the
    # spec documents mutually-exclusive variants that the flat `required` list
    # can't represent.
    if schema.get("description"):
        result["description"] = schema["description"]
    if schema.get("x-solution"):
        result["solution"] = schema["x-solution"]
    return result


DOCS_CHUNK_SIZE = 20_000

# Markdown ATX headings (##, ###, …) at the start of a line. Used to build a
# section outline so callers can jump straight to a section instead of paging.
_DOC_HEADING_RE = re.compile(r"^(#{2,6})[ \t]+(.+?)[ \t]*#*$", re.MULTILINE)


def _extract_doc_headings(text: str) -> list[tuple[int, int, str]]:
    """Return [(char_offset, level, title), …] for every ##..###### heading."""
    out = []
    for m in _DOC_HEADING_RE.finditer(text):
        out.append((m.start(), len(m.group(1)), m.group(2).strip()))
    return out


def _doc_outline(text: str) -> str:
    """A compact 'jump to section' outline: title → offset for each heading."""
    headings = _extract_doc_headings(text)
    if not headings:
        return ""
    lines = [
        f"  {'  ' * (lvl - 2)}{title}  → section=\"{title}\""
        for _off, lvl, title in headings
    ]
    return "Sections (jump with section=\"…\"):\n" + "\n".join(lines)


async def _fetch_doc(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    if host not in DOCS_ALLOWED_HOSTS:
        raise ToolError(
            f"Refusing to fetch '{url}': only "
            f"{' and '.join(DOCS_ALLOWED_HOSTS)} URLs are allowed."
        )
    async with httpx.AsyncClient() as client:
        res = await client.get(url, timeout=15.0, follow_redirects=True)
    if res.status_code == 404:
        raise ToolError(f"Doc not found: {url}")
    res.raise_for_status()
    return res.text


@mcp.tool()
async def get_docs(
    url: str,
    offset: int = 0,
    limit: int = DOCS_CHUNK_SIZE,
    section: str | None = None,
) -> str:
    """Fetch a CapMonster documentation page by its URL and return its text.

    Use this to read a captcha type's docs (exact task parameters, how to extract
    them from a live page, and worked createTask/getTaskResult examples). Pick the
    URL from the llms.txt index (https://docs.capmonster.cloud/llms.txt) — it lists
    every doc page. Also accepts llms-full.txt and the OpenAPI spec URL.

    Only URLs on docs.capmonster.cloud or api.capmonster.cloud are allowed.

    Jumping to a section (preferred on big pages — avoids paging by hand):
      - Pass `section="<heading>"` to return just that `##`/`###` section (from its
        heading down to the next same-or-higher-level heading). Matching is
        case-insensitive and substring-based, so `section="Examples of solving"`
        or even `section="examples"` works. Great for going straight to
        "Create task", "Get task result", or "Examples of solving …".
      - When a page is returned in chunks, the first chunk is prefixed with a
        section outline (each heading and the exact `section="…"` to jump to it),
        so you can pick the section you need in one follow-up call.

    Paging (when you want the raw text, no section):
      Pages that don't fit in `limit` characters are returned one chunk at a time,
      starting at `offset`. The chunk is prefixed with a header showing the range,
      the total length, and (if there's more) the `offset` to pass on the next
      call — keep calling with that offset until the header says end of document.
    """
    text = await _fetch_doc(url)
    total = len(text)

    if section is not None:
        headings = _extract_doc_headings(text)
        if not headings:
            raise ToolError(
                f"'{url}' has no ##-style sections to select; re-fetch without "
                "`section` (optionally paginate with offset/limit)."
            )
        needle = section.strip().lower()
        match_idx = next(
            (i for i, (_o, _l, title) in enumerate(headings)
             if needle in title.lower()),
            None,
        )
        if match_idx is None:
            available = "; ".join(t for _o, _l, t in headings)
            raise ToolError(
                f"No section matching '{section}' in {url}. "
                f"Available sections: {available}"
            )
        start, level, title = headings[match_idx]
        # End at the next heading of the same or higher level (shallower/equal
        # `level`), so a `##` section keeps its nested `###` subsections.
        end = total
        for off, lvl, _t in headings[match_idx + 1:]:
            if lvl <= level:
                end = off
                break
        body = text[start:end].rstrip()
        return f'[section="{title}" from {url}]\n\n{body}'

    if offset == 0 and total <= limit:
        return text

    chunk = text[offset : offset + limit]
    next_offset = offset + len(chunk)
    remaining = total - next_offset
    if remaining > 0:
        status = f", {remaining} chars left — call again with offset={next_offset}]"
    else:
        status = ", end of document]"
    header = f"[chars {offset}-{next_offset} of {total}{status}\n"
    # On the first chunk of a large page, show the section map so the caller can
    # jump straight to what it needs instead of paging through every chunk.
    if offset == 0:
        outline = _doc_outline(text)
        if outline:
            header += "\n" + outline + "\n"
    return header + "\n" + chunk


mcp.add_middleware(ApiKeyMiddleware())


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
