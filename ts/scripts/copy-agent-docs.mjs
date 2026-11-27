// Copies the single-source agent documents from ../capmonster_agent into dist/agent
// so they ship inside the npm package. The Python wheel gets the same files via
// hatch force-include (see ../pyproject.toml). Run as part of `npm run build`.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "..", "capmonster_agent");
const target = join(root, "dist", "agent");
const FILES = ["SKILL.md", "INSTRUCTIONS.md", "prompts.json"];

mkdirSync(target, { recursive: true });
for (const name of FILES) {
  const from = join(source, name);
  if (!existsSync(from)) {
    console.error(`copy-agent-docs: missing source file ${from}`);
    process.exit(1);
  }
  copyFileSync(from, join(target, name));
}
console.log(`copy-agent-docs: copied ${FILES.join(", ")} to dist/agent`);
