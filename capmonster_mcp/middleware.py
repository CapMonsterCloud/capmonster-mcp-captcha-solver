from fastmcp.exceptions import ToolError
from fastmcp.server.middleware import Middleware, MiddlewareContext

from .config import AppSettings


class ApiKeyMiddleware(Middleware):
    """Reads the CapMonster API key from the CM_API_KEY env var and stores it
    in FastMCP context state.

    stdio is the only transport this server runs, so there are no HTTP
    headers to read a per-request key from — every client shares the one key
    set in its process environment (e.g. via the mcp.json `env` block).
    """

    async def on_request(self, context: MiddlewareContext, call_next):
        key = AppSettings().cm_api_key

        if not key:
            raise ToolError("Missing CM_API_KEY env var.")

        if context.fastmcp_context:
            await context.fastmcp_context.set_state("cm_api_key", key)

        return await call_next(context)
