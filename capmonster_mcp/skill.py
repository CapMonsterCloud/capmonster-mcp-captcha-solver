"""Agent-facing documents shipped with the package.

The single source of truth lives in the repository's ``capmonster_agent/``
directory. At build time hatch copies the files into the wheel as
``capmonster_mcp/agent/`` (see ``[tool.hatch.build.targets.wheel.force-include]``
in pyproject.toml); the TypeScript package copies the same files into
``dist/agent/``. In a source checkout they are read from ``capmonster_agent/``.
"""

import json
from importlib import resources
from pathlib import Path
from typing import Any

SKILL_URI = "skill://capmonster-mcp/SKILL.md"

_SOURCE_DIR = Path(__file__).resolve().parent.parent / "capmonster_agent"


def _read(name: str) -> str:
    packaged = resources.files("capmonster_mcp") / "agent" / name
    if packaged.is_file():
        return packaged.read_text(encoding="utf-8")
    return (_SOURCE_DIR / name).read_text(encoding="utf-8")


def load_skill() -> str:
    return _read("SKILL.md")


def load_instructions() -> str:
    return _read("INSTRUCTIONS.md").strip()


def load_prompts() -> list[dict[str, Any]]:
    """Prompt definitions (name, title, description, arguments, template)."""
    return json.loads(_read("prompts.json"))["prompts"]


def get_prompt_def(name: str) -> dict[str, Any]:
    for prompt in load_prompts():
        if prompt["name"] == name:
            return prompt
    raise KeyError(name)


def render_prompt(name: str, **values: str | None) -> str:
    """Fill ``{argument}`` placeholders; an empty optional argument gets its default."""
    prompt = get_prompt_def(name)
    text = prompt["template"]
    for arg in prompt["arguments"]:
        value = values.get(arg["name"])
        if value is None or not value.strip():
            value = arg.get("default", "")
        text = text.replace("{" + arg["name"] + "}", value.strip())
    return text
