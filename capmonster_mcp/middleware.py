from fastmcp.exceptions import ToolError
from fastmcp.server.middleware import Middleware, MiddlewareContext

from .config import API_KEY_ENV, AppSettings, warn_if_legacy_api_key

# Tools that never send the API key to CapMonster (docs, spec, UA, skill): they work
# before the key is configured. Keep in sync with the ts/ implementation, where only
# the tools below the line call requireApiKey(): create_task, get_task_result,
# get_task_result_wait, get_balance.
KEYLESS_TOOLS = frozenset(
    {
        "get_skill",
        "get_docs",
        "get_supported_tasks",
        "get_task_parameters",
        "get_actual_user_agent",
    }
)


class ApiKeyMiddleware(Middleware):
    """Reads the CapMonster API key from the CAPMONSTER_API_KEY env var (falling
    back to the deprecated CM_API_KEY, with a logged warning) and stores it in
    FastMCP context state.

    stdio is the only transport this server runs, so there are no HTTP
    headers to read a per-request key from — every client shares the one key
    set in its process environment (e.g. via the mcp.json `env` block).

    Only enforced on tool calls (on_call_tool), not on every request: clients
    like Glama's Inspector connect and call tools/list to score the server
    before any API key is configured, and requiring the key that early
    made the server fail initialize/list — before it ever reached a tool.
    """

    async def on_call_tool(self, context: MiddlewareContext, call_next):
        if getattr(context.message, "name", None) in KEYLESS_TOOLS:
            return await call_next(context)

        settings = AppSettings()
        key = settings.api_key

        if not key:
            raise ToolError(f"Missing {API_KEY_ENV} env var.")

        warn_if_legacy_api_key(settings)

        if context.fastmcp_context:
            await context.fastmcp_context.set_state("cm_api_key", key)

        return await call_next(context)
