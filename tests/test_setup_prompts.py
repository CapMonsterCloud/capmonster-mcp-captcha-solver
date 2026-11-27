"""The five setup prompts (PROMPT*.md) are written by hand for different clients.

They must not drift apart on the facts that decide how an agent behaves: where it reads the
skill, which source wins for field names, how it validates, and how it uses `setup`.
"""

from pathlib import Path

import pytest

AGENT_DIR = Path(__file__).resolve().parent.parent / "capmonster_agent"
PROMPTS = ["PROMPT.md", "PROMPT_JS.md", "PROMPT_GEMINI.md", "PROMPT_CLAUDE_CODE.md", "PROMPT_CODEX.md"]
# Clients that `capmonster-mcp setup --agent` can configure (ts/src/setup/types.ts CLIENT_IDS).
SETUP_AGENTS = {"claude-code", "codex", "cursor", "vscode", "claude-desktop"}
# Gemini CLI is not a setup target, so its prompt has no setup fast path.
WITH_SETUP = [name for name in PROMPTS if name != "PROMPT_GEMINI.md"]


def text(name: str) -> str:
    return " ".join((AGENT_DIR / name).read_text(encoding="utf-8").split())


@pytest.mark.parametrize("name", PROMPTS)
def test_skill_is_read_from_the_server_first(name):
    body = text(name)
    assert "skill://capmonster-mcp/SKILL.md" in body
    assert "get_skill" in body
    fallback = "raw.githubusercontent.com/CapMonsterCloud/capmonster-mcp-captcha-solver/main/capmonster_agent/SKILL.md"
    assert fallback in body
    # the server comes first, GitHub raw is only a fallback
    assert body.index("skill://capmonster-mcp/SKILL.md") < body.index(fallback)


@pytest.mark.parametrize("name", PROMPTS)
def test_docs_page_is_the_authority_for_field_names(name):
    body = text(name)
    assert "authority for field names" in body
    assert "get_task_parameters" in body
    assert "spec.js" in body  # the OpenAPI spec stays as the last fallback


@pytest.mark.parametrize("name", PROMPTS)
def test_validation_calls_the_same_tools(name):
    body = text(name)
    for tool in ("get_supported_tasks", "get_balance", "get_docs"):
        assert tool in body, f"{name}: {tool}"


@pytest.mark.parametrize("name", PROMPTS)
def test_no_stale_facts(name):
    body = text(name).lower()
    assert "hcaptcha" not in body
    assert "cm_api_key" not in body
    assert "analyze_and_solve" not in body


@pytest.mark.parametrize("name", PROMPTS)
def test_the_key_variable_is_capmonster_api_key(name):
    assert "CAPMONSTER_API_KEY" in text(name)


@pytest.mark.parametrize("name", WITH_SETUP)
def test_setup_fast_path_is_agent_safe(name):
    body = text(name)
    assert "capmonster-mcp setup" in body
    assert "--non-interactive" in body
    assert "do not ask me to paste the key" in body.lower().replace("don't", "do not")
    assert "Exit code 0" in body


def test_setup_agent_ids_in_prompts_exist():
    for name in WITH_SETUP:
        body = text(name)
        if "--agent <id>" in body:
            for agent in SETUP_AGENTS:
                assert agent in body, f"{name} does not list {agent}"
        else:
            used = {word for word in body.split() if word in SETUP_AGENTS}
            assert used, f"{name} names no setup agent"


def test_python_prompt_registers_uvx_and_says_so():
    body = text("PROMPT.md")
    assert "--runtime python" in body
    assert "--runtime python" not in text("PROMPT_JS.md")


def test_gemini_prompt_has_no_setup_fast_path():
    assert "capmonster-mcp setup" not in text("PROMPT_GEMINI.md")
