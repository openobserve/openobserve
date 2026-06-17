// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Parses an o2-datasource `data-source-ui.md` card into structured parts the
// AIIntegrationCard wizard renders. The cards do NOT share a fixed set of
// sections (framework cards = Install/Paste/Verify/Troubleshooting; CLI-agent
// cards = Install/Verify/Capture/Limitations), so we parse generically:
// pull the "Card metadata" table into chrome, surface ⚠ callouts as banners,
// and treat every other `##` heading as a collapsible section. Internal-only
// sections ("Panel implementation notes", "Reference") are dropped.

export interface CardMetadata {
  /** Card title (from the metadata table, or the H1 as a fallback). */
  displayName?: string;
  /**
   * The card's self-declared category BADGE (e.g. "AI / Providers"), shown next
   * to the title. Display-only — tab placement is a separate concern driven by
   * the manifest's `category` in data.ts, NOT this value.
   */
  category?: string;
  /** One-line tagline under the title. */
  tagline?: string;
  /** Runtime/prereqs badge (from "Supported runtime" or "Prerequisites"). */
  runtime?: string;
}

export interface CardSection {
  /** Heading with any "Section N — " prefix stripped, e.g. "Install". */
  title: string;
  /** Raw markdown body of the section. */
  body: string;
}

export interface ParsedCard {
  metadata: CardMetadata;
  warnings: string[];
  sections: CardSection[];
}

// Section headings that are notes to the frontend team / docs, not end users.
const EXCLUDED_TITLES = new Set([
  "card metadata",
  "panel implementation notes",
  "reference link",
  "reference",
]);

interface RawSection {
  title: string;
  lines: string[];
}

/** Split markdown into `##` sections, ignoring `##` that appear inside ``` fences. */
function splitSections(md: string): { preamble: string[]; sections: RawSection[] } {
  const lines = md.split("\n");
  const preamble: string[] = [];
  const sections: RawSection[] = [];
  let current: RawSection | null = null;
  let inFence = false;

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) inFence = !inFence;

    const heading = !inFence ? /^##\s+(.*)$/.exec(line) : null;
    if (heading) {
      current = { title: heading[1].trim(), lines: [] };
      sections.push(current);
      continue;
    }

    if (current) current.lines.push(line);
    else preamble.push(line);
  }

  return { preamble, sections };
}

/** Parse a "| key | value |" markdown table into a lowercased key→value map. */
function parseMetadataTable(lines: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of lines) {
    const cells = line.match(/^\s*\|(.+)\|\s*$/);
    if (!cells) continue;
    const parts = cells[1].split("|").map((c) => c.trim());
    if (parts.length !== 2) continue;
    const key = parts[0].toLowerCase();
    // skip the header row and the |---|---| separator
    if (key === "field" || /^-+$/.test(parts[0].replace(/\s/g, ""))) continue;
    map[key] = parts[1];
  }
  return map;
}

/** Strip surrounding backticks / bold markers from a short metadata value. */
function cleanValue(v: string | undefined): string | undefined {
  if (v == null) return undefined;
  return v.replace(/`/g, "").replace(/\*\*/g, "").trim() || undefined;
}

/** Extract ⚠-flagged blockquotes from the preamble as banner text. */
function extractWarnings(preamble: string[]): string[] {
  const warnings: string[] = [];
  let buf: string[] = [];

  const flush = () => {
    if (!buf.length) return;
    const text = buf.join(" ");
    if (/⚠/.test(text)) {
      const clean = text
        .replace(/⚠️?/g, "")
        .replace(/\*\*/g, "")
        .replace(/\s+/g, " ")
        .replace(/^[\s—–-]*Important[\s—–:-]*/i, "")
        .trim();
      if (clean) warnings.push(clean);
    }
    buf = [];
  };

  for (const line of preamble) {
    const bq = /^>\s?(.*)$/.exec(line);
    if (bq) buf.push(bq[1]);
    else flush();
  }
  flush();
  return warnings;
}

export function parseCard(md: string): ParsedCard {
  const { preamble, sections } = splitSections(md);

  const metaSection = sections.find(
    (s) => s.title.toLowerCase() === "card metadata",
  );
  const table = metaSection ? parseMetadataTable(metaSection.lines) : {};

  // Fall back to the H1 ("# Name — Data Sources UI panel content") for the name.
  const h1 = preamble.find((l) => /^#\s+/.test(l));
  const h1Name = h1
    ? h1
        .replace(/^#\s+/, "")
        .replace(/—\s*Data Sources UI.*$/i, "")
        .trim()
    : undefined;

  const metadata: CardMetadata = {
    displayName: cleanValue(table["display name"]) || h1Name,
    category: cleanValue(table["category"]),
    tagline: cleanValue(table["tagline"]),
    runtime:
      cleanValue(table["supported runtime"]) ||
      cleanValue(table["prerequisites"]),
  };

  const displaySections: CardSection[] = sections
    .filter((s) => !EXCLUDED_TITLES.has(s.title.toLowerCase()))
    .map((s) => ({
      title: s.title.replace(/^Section\s+\d+\s*[—–-]\s*/i, "").trim(),
      body: s.lines.join("\n").trim(),
    }))
    .filter((s) => s.body.length > 0);

  return {
    metadata,
    warnings: extractWarnings(preamble),
    sections: displaySections,
  };
}
