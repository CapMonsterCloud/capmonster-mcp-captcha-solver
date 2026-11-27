import json
import re
from pathlib import Path

import pytest
from fastmcp import Client

from capmonster_mcp.server import mcp
from capmonster_mcp.skill import load_prompts, load_skill, render_prompt

SOURCE = Path(__file__).resolve().parent.parent / "capmonster_agent"
# Must match ts/src/__tests__/prompts.test.ts
EXPECTED = ["check_setup", "solve_captcha", "integrate_into_project"]


def test_prompts_file_is_the_single_source():
    assert (
        load_prompts()
        == json.loads((SOURCE / "prompts.json").read_text(encoding="utf-8"))["prompts"]
    )


def test_placeholders_match_arguments():
    for prompt in load_prompts():
        placeholders = set(re.findall(r"\{(\w+)\}", prompt["template"]))
        assert placeholders == {a["name"] for a in prompt["arguments"]}, prompt["name"]
        for arg in prompt["arguments"]:
            assert arg["required"] or arg.get("default"), (
                f"{prompt['name']}.{arg['name']} needs a default"
            )


def test_texts_are_short_and_do_not_copy_the_skill():
    skill_lines = {
        ln.strip() for ln in load_skill().splitlines() if len(ln.strip()) > 40
    }
    for prompt in load_prompts():
        assert len(prompt["template"]) < 1500, prompt["name"]
        copied = [
            ln for ln in prompt["template"].splitlines() if ln.strip() in skill_lines
        ]
        assert not copied, f"{prompt['name']} copies skill lines: {copied}"


def test_step_references_exist_in_the_skill():
    headings = set(re.findall(r"^## Step (\d+)", load_skill(), re.MULTILINE))
    for prompt in load_prompts():
        for step in re.findall(r"Steps? (\d+)", prompt["template"]):
            assert step in headings, f"{prompt['name']} mentions Step {step}"


def test_render_uses_defaults_and_values():
    text = render_prompt(
        "solve_captcha", url="https://x.test", how_it_appears="  ", hints=None
    )
    assert "https://x.test" in text
    assert "none given" in text and "not specified" in text
    assert "{" not in text
    text = render_prompt(
        "solve_captcha", url="https://x.test", hints="proxy http://p:1"
    )
    assert "proxy http://p:1" in text and "none given" not in text
    assert "{" not in render_prompt("integrate_into_project")
    assert "{" not in render_prompt("check_setup")


@pytest.mark.asyncio
async def test_registered_prompts_match_the_definitions():
    async with Client(mcp) as client:
        prompts = {p.name: p for p in await client.list_prompts()}
    assert sorted(prompts) == sorted(EXPECTED)
    assert "analyze_and_solve" not in prompts
    for definition in load_prompts():
        registered = prompts[definition["name"]]
        assert registered.description == definition["description"]
        got = {
            a.name: (bool(a.required), a.description)
            for a in registered.arguments or []
        }
        want = {
            a["name"]: (a["required"], a["description"])
            for a in definition["arguments"]
        }
        assert got == want, definition["name"]


@pytest.mark.asyncio
async def test_prompt_renders_through_the_server():
    async with Client(mcp) as client:
        result = await client.get_prompt(
            "solve_captcha", {"url": "https://x.test", "hints": "eu proxy"}
        )
        text = result.messages[0].content.text
        assert text == render_prompt(
            "solve_captcha", url="https://x.test", hints="eu proxy"
        )
        result = await client.get_prompt("check_setup")
        assert "get_supported_tasks" in result.messages[0].content.text
