import logging
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastmcp.exceptions import ToolError

from capmonster_mcp import config
from capmonster_mcp.config import AppSettings
from capmonster_mcp.middleware import ApiKeyMiddleware
from capmonster_mcp.server import mcp

# Must match ts/src/__tests__/server.test.ts
READ_ONLY = {
    "get_supported_tasks",
    "get_task_parameters",
    "get_docs",
    "get_task_result",
    "get_task_result_wait",
    "get_actual_user_agent",
    "get_balance",
    "get_skill",
}
PAID = {"create_task"}


# ─── M1: tool annotations ────────────────────────────────────────────────────


async def _wire_annotations(name):
    # Wire-format (camelCase) dict: stable across MCP SDK versions, unlike
    # attribute access (renamed to snake_case in SDK v2).
    ann = (await mcp.get_tool(name)).annotations
    return ann.model_dump(by_alias=True, exclude_none=True)


@pytest.mark.parametrize("name", sorted(READ_ONLY))
async def test_read_only_tools_are_annotated(name):
    ann = await _wire_annotations(name)
    assert ann["readOnlyHint"] is True
    assert ann["idempotentHint"] is True


async def test_create_task_is_paid_not_read_only_not_idempotent():
    ann = await _wire_annotations("create_task")
    assert ann["readOnlyHint"] is False
    assert ann["idempotentHint"] is False
    assert ann["destructiveHint"] is False


async def test_every_tool_is_classified():
    names = {t.name for t in await mcp.list_tools()}
    assert names == READ_ONLY | PAID


# ─── M12: CAPMONSTER_API_KEY with CM_API_KEY fallback ───────────────────────


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    monkeypatch.delenv("CAPMONSTER_API_KEY", raising=False)
    monkeypatch.delenv("CM_API_KEY", raising=False)
    monkeypatch.setattr(config, "_legacy_warning_emitted", False)


def test_new_name_is_read(monkeypatch):
    monkeypatch.setenv("CAPMONSTER_API_KEY", "new")
    s = AppSettings()
    assert s.api_key == "new"
    assert not s.uses_legacy_api_key


def test_legacy_name_is_fallback(monkeypatch):
    monkeypatch.setenv("CM_API_KEY", "old")
    s = AppSettings()
    assert s.api_key == "old"
    assert s.uses_legacy_api_key


def test_new_name_wins_when_both_set(monkeypatch):
    monkeypatch.setenv("CAPMONSTER_API_KEY", "new")
    monkeypatch.setenv("CM_API_KEY", "old")
    s = AppSettings()
    assert s.api_key == "new"
    assert not s.uses_legacy_api_key


def test_legacy_warning_is_logged_once(monkeypatch, caplog):
    monkeypatch.setenv("CM_API_KEY", "old")
    with caplog.at_level(logging.WARNING, logger="capmonster_mcp"):
        config.warn_if_legacy_api_key(AppSettings())
        config.warn_if_legacy_api_key(AppSettings())
    warnings = [r for r in caplog.records if "CM_API_KEY" in r.getMessage()]
    assert len(warnings) == 1
    assert "CAPMONSTER_API_KEY" in warnings[0].getMessage()


def test_no_warning_with_new_name(monkeypatch, caplog):
    monkeypatch.setenv("CAPMONSTER_API_KEY", "new")
    with caplog.at_level(logging.WARNING, logger="capmonster_mcp"):
        config.warn_if_legacy_api_key(AppSettings())
    assert not caplog.records


def _ctx():
    ctx = MagicMock()
    ctx.fastmcp_context.set_state = AsyncMock()
    return ctx


async def test_middleware_missing_key_names_new_variable():
    with pytest.raises(ToolError, match="CAPMONSTER_API_KEY"):
        await ApiKeyMiddleware().on_call_tool(_ctx(), AsyncMock())


async def test_middleware_legacy_key_still_works(monkeypatch):
    monkeypatch.setenv("CM_API_KEY", "old")
    ctx, call_next = _ctx(), AsyncMock(return_value="ok")
    assert await ApiKeyMiddleware().on_call_tool(ctx, call_next) == "ok"
    ctx.fastmcp_context.set_state.assert_awaited_once_with("cm_api_key", "old")


async def test_middleware_new_key_is_stored(monkeypatch):
    monkeypatch.setenv("CAPMONSTER_API_KEY", "new")
    ctx = _ctx()
    await ApiKeyMiddleware().on_call_tool(ctx, AsyncMock())
    ctx.fastmcp_context.set_state.assert_awaited_once_with("cm_api_key", "new")
