import pytest
import respx
from httpx import Response
from unittest.mock import AsyncMock, patch

from fastmcp.exceptions import ToolError

from capmonster_mcp.server import (
    CAPMONSTER_API_URL,
    OPENAPI_URL,
    _api_post,
    _openapi_collect_properties,
    _openapi_load_spec,
    _openapi_resolve_ref,
    get_balance,
    get_docs,
    get_supported_tasks,
    get_task_parameters,
    get_task_result,
    get_task_result_wait,
)

FAKE_KEY = "test-api-key-123"

MINIMAL_SPEC = {
    "components": {
        "schemas": {
            "Task": {
                "discriminator": {
                    "mapping": {
                        "RecaptchaV2Task": "#/components/schemas/RecaptchaV2Task",
                        "TurnstileTask": "#/components/schemas/TurnstileTask",
                        "CustomTask": "#/components/schemas/CustomTask",
                    }
                }
            },
            "CustomTask": {
                "discriminator": {
                    "mapping": {
                        "DataDome": "#/components/schemas/DataDomeCustomTask",
                    }
                }
            },
            "RecaptchaV2Task": {
                "properties": {
                    "websiteURL": {"type": "string", "description": "Target page URL"},
                    "websiteKey": {"type": "string", "description": "Site key"},
                },
                "required": ["websiteURL", "websiteKey"],
            },
            "TurnstileTask": {
                "description": "Turnstile. The `cloudflareTaskType` field selects the variant.",
                "x-solution": "TurnstileSolution",
                "properties": {
                    "websiteURL": {"type": "string", "description": "Target page URL"},
                },
                "required": ["websiteURL"],
            },
            "DataDomeCustomTask": {
                "properties": {
                    "userAgent": {"type": "string", "description": "User agent"},
                },
                "required": [],
            },
        }
    }
}


@pytest.fixture(autouse=True)
def clear_openapi_cache():
    _openapi_load_spec.cache_clear()
    yield
    _openapi_load_spec.cache_clear()


# ─── _api_post ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_api_post_create_task_success():
    with respx.mock:
        respx.post(f"{CAPMONSTER_API_URL}/createTask").mock(
            return_value=Response(200, json={"errorId": 0, "taskId": 42})
        )
        data = await _api_post(
            "/createTask",
            {"clientKey": FAKE_KEY, "task": {"type": "ImageToTextTask"}},
        )
    assert data["taskId"] == 42


@pytest.mark.asyncio
async def test_api_post_capmonster_error_raises():
    with respx.mock:
        respx.post(f"{CAPMONSTER_API_URL}/createTask").mock(
            return_value=Response(
                200,
                json={
                    "errorId": 1,
                    "errorCode": "ERROR_KEY_DOES_NOT_EXIST",
                    "errorDescription": "Account authorization key not found.",
                },
            )
        )
        with pytest.raises(ToolError, match="ERROR_KEY_DOES_NOT_EXIST"):
            await _api_post("/createTask", {})


@pytest.mark.asyncio
async def test_api_post_get_task_result_ready():
    with respx.mock:
        respx.post(f"{CAPMONSTER_API_URL}/getTaskResult").mock(
            return_value=Response(
                200,
                json={"errorId": 0, "status": "ready", "solution": {"gRecaptchaResponse": "abc123"}},
            )
        )
        data = await _api_post("/getTaskResult", {"clientKey": FAKE_KEY, "taskId": 42})
    assert data["status"] == "ready"
    assert data["solution"]["gRecaptchaResponse"] == "abc123"


@pytest.mark.asyncio
async def test_api_post_get_task_result_processing():
    with respx.mock:
        respx.post(f"{CAPMONSTER_API_URL}/getTaskResult").mock(
            return_value=Response(200, json={"errorId": 0, "status": "processing"})
        )
        data = await _api_post("/getTaskResult", {"clientKey": FAKE_KEY, "taskId": 42})
    assert data["status"] == "processing"


# ─── _openapi_resolve_ref ─────────────────────────────────────────────────────

def test_openapi_resolve_ref_simple():
    spec = {"components": {"schemas": {"Foo": {"type": "object"}}}}
    result = _openapi_resolve_ref(spec, "#/components/schemas/Foo")
    assert result == {"type": "object"}


def test_openapi_resolve_ref_nested():
    spec = {"a": {"b": {"c": "value"}}}
    assert _openapi_resolve_ref(spec, "#/a/b/c") == "value"


# ─── _openapi_collect_properties ─────────────────────────────────────────────

def test_openapi_collect_properties_flat():
    spec = {}
    schema = {
        "properties": {
            "websiteURL": {"type": "string", "description": "URL"},
            "websiteKey": {"type": "string", "description": "Key"},
        },
        "required": ["websiteURL"],
    }
    props, required = _openapi_collect_properties(spec, schema)
    assert "websiteURL" in props
    assert "websiteKey" in props
    assert "websiteURL" in required
    assert "websiteKey" not in required


def test_openapi_collect_properties_allof():
    spec = {
        "components": {
            "schemas": {
                "Base": {
                    "properties": {"type": {"type": "string", "description": "task type"}},
                    "required": ["type"],
                }
            }
        }
    }
    schema = {
        "allOf": [{"$ref": "#/components/schemas/Base"}],
        "properties": {"websiteURL": {"type": "string", "description": "URL"}},
        "required": ["websiteURL"],
    }
    props, required = _openapi_collect_properties(spec, schema)
    assert "type" in props
    assert "websiteURL" in props
    assert "type" in required
    assert "websiteURL" in required


def test_openapi_collect_properties_nested_object():
    spec = {}
    schema = {
        "properties": {
            "metadata": {
                "type": "object",
                "description": "meta",
                "properties": {
                    "url": {"type": "string", "description": "page url"},
                },
                "required": ["url"],
            }
        }
    }
    props, _ = _openapi_collect_properties(spec, schema)
    assert props["metadata"]["type"] == "object"
    assert "url" in props["metadata"]["properties"]
    assert props["metadata"]["properties"]["url"]["required"] is True


# ─── get_supported_tasks ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_supported_tasks_returns_top_level_and_custom():
    with patch("capmonster_mcp.server._openapi_load_spec", return_value=MINIMAL_SPEC):
        tasks = await get_supported_tasks()
    assert "RecaptchaV2Task" in tasks
    assert "TurnstileTask" in tasks
    assert "DataDome" in tasks
    # CustomTask itself should be excluded (it's the discriminator base, not a real task)
    assert "CustomTask" not in tasks


# ─── get_task_parameters ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_task_parameters_top_level_type():
    with patch("capmonster_mcp.server._openapi_load_spec", return_value=MINIMAL_SPEC):
        result = await get_task_parameters("RecaptchaV2Task")
    assert "all_parameters" in result
    assert "required" in result
    assert "websiteURL" in result["all_parameters"]
    assert "websiteURL" in result["required"]
    assert "websiteKey" in result["required"]


@pytest.mark.asyncio
async def test_get_task_parameters_custom_type():
    with patch("capmonster_mcp.server._openapi_load_spec", return_value=MINIMAL_SPEC):
        result = await get_task_parameters("DataDome")
    assert "userAgent" in result["all_parameters"]


@pytest.mark.asyncio
async def test_get_task_parameters_surfaces_description_and_solution():
    # The spec's per-type note (where variants are documented) and the solution
    # schema name must flow through to the caller.
    with patch("capmonster_mcp.server._openapi_load_spec", return_value=MINIMAL_SPEC):
        result = await get_task_parameters("TurnstileTask")
    assert "cloudflareTaskType" in result["description"]
    assert result["solution"] == "TurnstileSolution"


@pytest.mark.asyncio
async def test_get_task_parameters_omits_absent_optional_fields():
    # A type without description/x-solution in the spec simply doesn't get those
    # keys (no empty placeholders).
    with patch("capmonster_mcp.server._openapi_load_spec", return_value=MINIMAL_SPEC):
        result = await get_task_parameters("RecaptchaV2Task")
    assert "description" not in result
    assert "solution" not in result


@pytest.mark.asyncio
async def test_get_task_parameters_unknown_type_raises():
    with patch("capmonster_mcp.server._openapi_load_spec", return_value=MINIMAL_SPEC):
        with pytest.raises(ValueError, match="Unknown task type 'FakeTask'"):
            await get_task_parameters("FakeTask")


# ─── get_docs ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_docs_returns_body_for_allowed_host():
    url = "https://docs.capmonster.cloud/docs/captchas/datadome.txt"
    with respx.mock:
        respx.get(url).mock(return_value=Response(200, text="DataDome docs body"))
        body = await get_docs(url)
    assert body == "DataDome docs body"


@pytest.mark.asyncio
async def test_get_docs_allows_api_host():
    with respx.mock:
        respx.get(OPENAPI_URL).mock(return_value=Response(200, text="spec"))
        body = await get_docs(OPENAPI_URL)
    assert body == "spec"


@pytest.mark.asyncio
async def test_get_docs_rejects_other_host():
    with pytest.raises(ToolError, match="only .* URLs are allowed"):
        await get_docs("https://example.com/evil.txt")


@pytest.mark.asyncio
async def test_get_docs_404_raises_not_found():
    url = "https://docs.capmonster.cloud/docs/captchas/missing.txt"
    with respx.mock:
        respx.get(url).mock(return_value=Response(404, text="nope"))
        with pytest.raises(ToolError, match="Doc not found"):
            await get_docs(url)


# ─── get_docs: section jump + outline ────────────────────────────────────────

_DOC_PAGE = (
    "# Title\n\nintro text\n\n"
    "## Request parameters\n\nfields here\n\n"
    "## Create task\n\n### Without proxy\n\nexample A\n\n### With proxy\n\nexample B\n\n"
    "## Examples of solving Foo\n\nthe worked recipe\n\n"
)
_DOC_URL = "https://docs.capmonster.cloud/docs/captchas/foo.txt"


@pytest.mark.asyncio
async def test_get_docs_section_returns_just_that_section():
    with respx.mock:
        respx.get(_DOC_URL).mock(return_value=Response(200, text=_DOC_PAGE))
        out = await get_docs(_DOC_URL, section="examples of solving")
    # Substring, case-insensitive match; returns only that section body.
    assert "the worked recipe" in out
    assert "## Examples of solving Foo" in out
    assert "fields here" not in out  # other sections excluded


@pytest.mark.asyncio
async def test_get_docs_section_keeps_nested_subsections():
    # A `##` section must keep its `###` children (down to the next `##`).
    with respx.mock:
        respx.get(_DOC_URL).mock(return_value=Response(200, text=_DOC_PAGE))
        out = await get_docs(_DOC_URL, section="Create task")
    assert "### Without proxy" in out
    assert "example A" in out
    assert "### With proxy" in out
    assert "example B" in out
    assert "Examples of solving" not in out  # stops at the next ## section


@pytest.mark.asyncio
async def test_get_docs_section_unknown_lists_available():
    with respx.mock:
        respx.get(_DOC_URL).mock(return_value=Response(200, text=_DOC_PAGE))
        with pytest.raises(ToolError, match="No section matching"):
            await get_docs(_DOC_URL, section="does-not-exist")


@pytest.mark.asyncio
async def test_get_docs_first_chunk_has_section_outline():
    big = _DOC_PAGE + ("x" * 25_000)  # force chunking
    with respx.mock:
        respx.get(_DOC_URL).mock(return_value=Response(200, text=big))
        out = await get_docs(_DOC_URL, offset=0)
    assert "Sections (jump with section=" in out
    assert 'section="Examples of solving Foo"' in out
    # still includes the paging header
    assert "call again with offset=" in out


# ─── get_task_result ─────────────────────────────────────────────────────────

def _mock_ctx(key=FAKE_KEY):
    ctx = AsyncMock()
    ctx.get_state = AsyncMock(return_value=key)
    return ctx


@pytest.mark.asyncio
async def test_get_task_result_ready_returns_full_solution_dict():
    # A nested solution (DataDome-style) must survive verbatim, not be
    # flattened into a str() repr — and task metadata must be preserved.
    solution = {"domains": {"example.com": {"cookies": {"datadome": "abc"}}}}
    api_data = {
        "errorId": 0,
        "status": "ready",
        "solution": solution,
        "cost": "0.001",
        "ip": "1.2.3.4",
    }
    with patch("capmonster_mcp.server._api_post", AsyncMock(return_value=api_data)):
        result = await get_task_result(_mock_ctx(), 42)

    assert isinstance(result, dict)
    assert result["status"] == "ready"
    # Nested structure preserved exactly (the old str() repr broke this).
    assert result["solution"] == solution
    assert result["solution"]["domains"]["example.com"]["cookies"]["datadome"] == "abc"
    assert result["cost"] == "0.001"
    assert result["ip"] == "1.2.3.4"


@pytest.mark.asyncio
async def test_get_task_result_preserves_solution_user_agent():
    # UA the token is bound to must not be dropped.
    api_data = {
        "errorId": 0,
        "status": "ready",
        "solution": {"token": "tok", "userAgent": "Mozilla/5.0 ..."},
    }
    with patch("capmonster_mcp.server._api_post", AsyncMock(return_value=api_data)):
        result = await get_task_result(_mock_ctx(), 1)
    assert result["solution"]["userAgent"] == "Mozilla/5.0 ..."


@pytest.mark.asyncio
async def test_get_task_result_processing_returns_dict():
    api_data = {"errorId": 0, "status": "processing"}
    with patch("capmonster_mcp.server._api_post", AsyncMock(return_value=api_data)):
        result = await get_task_result(_mock_ctx(), 7)
    assert result["status"] == "processing"
    assert result["taskId"] == 7


@pytest.mark.asyncio
async def test_get_task_result_empty_solution_raises():
    api_data = {"errorId": 0, "status": "ready", "solution": {}}
    with patch("capmonster_mcp.server._api_post", AsyncMock(return_value=api_data)):
        with pytest.raises(ToolError, match="solution was empty"):
            await get_task_result(_mock_ctx(), 9)


# ─── get_task_result_wait ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_task_result_wait_polls_until_ready():
    ready = {"status": "ready", "solution": {"token": "t"}}
    processing = {"status": "processing", "taskId": 5}
    poll = AsyncMock(side_effect=[processing, processing, ready])
    with patch("capmonster_mcp.server._poll_task_result", poll), \
         patch("capmonster_mcp.server.asyncio.sleep", AsyncMock()) as sleep:
        result = await get_task_result_wait(
            _mock_ctx(), 5, timeout_seconds=120, poll_interval_seconds=3
        )
    assert result == ready
    assert poll.await_count == 3
    # Slept between the polls, not after the ready one.
    assert sleep.await_count == 2


@pytest.mark.asyncio
async def test_get_task_result_wait_clamps_interval_to_2s():
    # Even if the caller asks for a sub-2s interval, we must not poll faster.
    poll = AsyncMock(return_value={"status": "processing", "taskId": 1})
    sleeps = []
    async def fake_sleep(secs):
        sleeps.append(secs)
    with patch("capmonster_mcp.server._poll_task_result", poll), \
         patch("capmonster_mcp.server.asyncio.sleep", fake_sleep):
        with pytest.raises(ToolError, match="still processing"):
            await get_task_result_wait(
                _mock_ctx(), 1, timeout_seconds=6, poll_interval_seconds=0.1
            )
    assert sleeps  # it did sleep
    assert all(s >= 2.0 for s in sleeps)


@pytest.mark.asyncio
async def test_get_task_result_wait_times_out():
    poll = AsyncMock(return_value={"status": "processing", "taskId": 2})
    with patch("capmonster_mcp.server._poll_task_result", poll), \
         patch("capmonster_mcp.server.asyncio.sleep", AsyncMock()):
        with pytest.raises(ToolError, match="still processing after"):
            await get_task_result_wait(_mock_ctx(), 2, timeout_seconds=10)


# ─── get_balance ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_balance_returns_formatted_balance():
    api_data = {"errorId": 0, "balance": 345.678}
    with patch("capmonster_mcp.server._api_post", AsyncMock(return_value=api_data)) as post:
        result = await get_balance(_mock_ctx())
    assert result == "Balance: 345.678"
    post.assert_awaited_once_with("/getBalance", {"clientKey": FAKE_KEY})


@pytest.mark.asyncio
async def test_get_balance_propagates_api_error():
    with patch(
        "capmonster_mcp.server._api_post",
        AsyncMock(side_effect=ToolError("CapMonster error [ERROR_KEY_DOES_NOT_EXIST]")),
    ):
        with pytest.raises(ToolError, match="ERROR_KEY_DOES_NOT_EXIST"):
            await get_balance(_mock_ctx())
