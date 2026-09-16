export const DOCS_ALLOWED_HOSTS = ["docs.capmonster.cloud", "api.capmonster.cloud"];
export const DOCS_CHUNK_SIZE = 20_000;

export interface Heading {
  offset: number;
  level: number;
  title: string;
}

// Markdown ATX headings (##, ###, …) at the start of a line. Used to build a
// section outline so callers can jump straight to a section instead of paging.
const DOC_HEADING_RE = /^(#{2,6})[ \t]+(.+?)[ \t]*#*$/gm;

export function extractDocHeadings(text: string): Heading[] {
  const out: Heading[] = [];
  for (const m of text.matchAll(DOC_HEADING_RE)) {
    out.push({ offset: m.index ?? 0, level: m[1].length, title: m[2].trim() });
  }
  return out;
}

/** A compact 'jump to section' outline: title → offset for each heading. */
export function docOutline(text: string): string {
  const headings = extractDocHeadings(text);
  if (headings.length === 0) return "";
  const lines = headings.map(
    ({ level, title }) => `  ${"  ".repeat(level - 2)}${title}  → section="${title}"`,
  );
  return `Sections (jump with section="…"):\n${lines.join("\n")}`;
}

export class ToolError extends Error {}

export async function fetchDoc(url: string): Promise<string> {
  const host = (new URL(url).hostname || "").toLowerCase();
  if (!DOCS_ALLOWED_HOSTS.includes(host)) {
    throw new ToolError(
      `Refusing to fetch '${url}': only ${DOCS_ALLOWED_HOSTS.join(" and ")} URLs are allowed.`,
    );
  }
  const res = await fetch(url, { redirect: "follow" });
  if (res.status === 404) {
    throw new ToolError(`Doc not found: ${url}`);
  }
  if (!res.ok) {
    throw new ToolError(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return res.text();
}

export interface GetDocsOptions {
  offset?: number;
  limit?: number;
  section?: string;
}

export async function getDocs(url: string, options: GetDocsOptions = {}): Promise<string> {
  const { offset = 0, limit = DOCS_CHUNK_SIZE, section } = options;
  const text = await fetchDoc(url);
  const total = text.length;

  if (section !== undefined) {
    const headings = extractDocHeadings(text);
    if (headings.length === 0) {
      throw new ToolError(
        `'${url}' has no ##-style sections to select; re-fetch without \`section\` (optionally paginate with offset/limit).`,
      );
    }
    const needle = section.trim().toLowerCase();
    const matchIdx = headings.findIndex((h) => h.title.toLowerCase().includes(needle));
    if (matchIdx === -1) {
      const available = headings.map((h) => h.title).join("; ");
      throw new ToolError(`No section matching '${section}' in ${url}. Available sections: ${available}`);
    }
    const { offset: start, level, title } = headings[matchIdx];
    // End at the next heading of the same or higher level (shallower/equal
    // `level`), so a `##` section keeps its nested `###` subsections.
    let end = total;
    for (let i = matchIdx + 1; i < headings.length; i++) {
      if (headings[i].level <= level) {
        end = headings[i].offset;
        break;
      }
    }
    const body = text.slice(start, end).replace(/\s+$/, "");
    return `[section="${title}" from ${url}]\n\n${body}`;
  }

  if (offset === 0 && total <= limit) {
    return text;
  }

  const chunk = text.slice(offset, offset + limit);
  const nextOffset = offset + chunk.length;
  const remaining = total - nextOffset;
  const status =
    remaining > 0
      ? `, ${remaining} chars left — call again with offset=${nextOffset}]`
      : ", end of document]";
  let header = `[chars ${offset}-${nextOffset} of ${total}${status}\n`;
  // On the first chunk of a large page, show the section map so the caller can
  // jump straight to what it needs instead of paging through every chunk.
  if (offset === 0) {
    const outline = docOutline(text);
    if (outline) {
      header += `\n${outline}\n`;
    }
  }
  return `${header}\n${chunk}`;
}
