import { readFileSync } from "node:fs";

// Agent-facing documents shipped with the package. Single source of truth is the
// repository's capmonster_agent/ directory: `npm run build` copies the files into
// dist/agent (scripts/copy-agent-docs.mjs), the Python wheel gets the same files via
// hatch force-include. When running from a source checkout (tsx) they are read from
// capmonster_agent/ directly.
export const SKILL_URI = "skill://capmonster-mcp/SKILL.md";

function read(name: string): string {
  const candidates = [
    new URL(`./agent/${name}`, import.meta.url),
    new URL(`../../capmonster_agent/${name}`, import.meta.url),
    new URL(`../capmonster_agent/${name}`, import.meta.url),
  ];
  for (const url of candidates) {
    try {
      return readFileSync(url, "utf-8");
    } catch {
      // try the next location
    }
  }
  throw new Error(`Packaged file ${name} not found`);
}

export function loadSkill(): string {
  return read("SKILL.md");
}

export function loadInstructions(): string {
  return read("INSTRUCTIONS.md").trim();
}

export interface PromptArgumentDef {
  name: string;
  description: string;
  required: boolean;
  default?: string;
}

export interface PromptDef {
  name: string;
  title: string;
  description: string;
  arguments: PromptArgumentDef[];
  template: string;
}

// Prompt definitions shared with the Python server (capmonster_agent/prompts.json).
export function loadPrompts(): PromptDef[] {
  return (JSON.parse(read("prompts.json")) as { prompts: PromptDef[] }).prompts;
}

// Fills the {argument} placeholders; an empty optional argument gets its default.
export function renderPrompt(def: PromptDef, values: Record<string, string | undefined>): string {
  let text = def.template;
  for (const arg of def.arguments) {
    const given = values[arg.name]?.trim();
    const value = given ? given : (arg.default ?? "");
    text = text.split(`{${arg.name}}`).join(value);
  }
  return text;
}
