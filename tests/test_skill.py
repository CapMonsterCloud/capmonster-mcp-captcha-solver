from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastmcp import Client

from capmonster_mcp.middleware import KEYLESS_TOOLS, ApiKeyMiddleware
from capmonster_mcp.server import get_skill, mcp
from capmonster_mcp.skill import SKILL_URI, load_instructions, load_skill
from tests.test_tools import MINIMAL_SPEC

SOURCE = Path(__file__).resolve().parent.parent / "capmonster_agent"


@pytest.fixture(autouse=True)
def no_key(monkeypatch):
    monkeypatch.delenv("CAPMONSTER_API_KEY", raising=False)
    monkeypatch.delenv("CM_API_KEY", raising=False)


def test_skill_is_the_single_source_file():
    assert load_skill() == (SOURCE / "SKILL.md").read_text(encoding="utf-8")


def test_instructions_are_three_to_five_lines():
    lines = [ln for ln in load_instructions().splitlines() if ln.strip()]
    assert 3 <= len(lines) <= 5


def test_instructions_cover_the_required_points():
    text = load_instructions()
    assert SKILL_URI in text and "get_skill" in text
    assert "CAPMONSTER_API_KEY" in text
    assert "userAgent" in text
    assert "one-time" in text


def test_server_exposes_instructions():
    assert mcp.instructions == load_instructions()


async def test_skill_resource_is_listed_and_readable():
    async with Client(mcp) as client:
        resources = await client.list_resources()
        match = [r for r in resources if str(r.uri) == SKILL_URI]
        assert len(match) == 1
        wire = match[0].model_dump(by_alias=True)  # stable across SDK versions
        assert wire["mimeType"] == "text/markdown"
        contents = await client.read_resource(SKILL_URI)
        assert contents[0].text == load_skill()


async def test_get_skill_tool_matches_resource_and_needs_no_key():
    async with Client(mcp) as client:
        result = await client.call_tool("get_skill", {})
        assert result.content[0].text == load_skill()


async def test_get_skill_function_returns_skill():
    assert await get_skill() == load_skill()


async def test_middleware_lets_keyless_tool_through_without_key():
    ctx = MagicMock()
    ctx.message.name = "get_skill"
    call_next = AsyncMock(return_value="ok")
    assert await ApiKeyMiddleware().on_call_tool(ctx, call_next) == "ok"


# ─── which tools need the API key ────────────────────────────────────────────

KEYED = ["create_task", "get_task_result", "get_task_result_wait", "get_balance"]


def test_keyless_and_keyed_tools_cover_every_tool():
    import asyncio

    names = {t.name for t in asyncio.run(mcp.list_tools())}
    assert names == set(KEYLESS_TOOLS) | set(KEYED)


@pytest.mark.parametrize("name", sorted(KEYLESS_TOOLS))
async def test_middleware_keyless_tools_pass_without_key(name):
    ctx = MagicMock()
    ctx.message.name = name
    call_next = AsyncMock(return_value="ok")
    assert await ApiKeyMiddleware().on_call_tool(ctx, call_next) == "ok"


@pytest.mark.parametrize("name", KEYED)
async def test_middleware_keyed_tools_fail_without_key(name):
    from fastmcp.exceptions import ToolError

    ctx = MagicMock()
    ctx.message.name = name
    with pytest.raises(ToolError, match="CAPMONSTER_API_KEY"):
        await ApiKeyMiddleware().on_call_tool(ctx, AsyncMock())


async def test_docs_tool_works_end_to_end_without_key():
    with patch("capmonster_mcp.server._openapi_load_spec", return_value=MINIMAL_SPEC):
        async with Client(mcp) as client:
            result = await client.call_tool("get_supported_tasks", {})
    assert "RecaptchaV2Task" in str(result.content[0].text)


async def test_keyed_tool_fails_end_to_end_without_key():
    async with Client(mcp) as client:
        with pytest.raises(Exception, match="CAPMONSTER_API_KEY"):
            await client.call_tool("get_balance", {})
