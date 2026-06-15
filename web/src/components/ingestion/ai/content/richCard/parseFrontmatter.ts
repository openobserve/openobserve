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

// Splits leading `--- ... ---` YAML frontmatter from a markdown document.
// Rich AI cards put their whole structured definition in this frontmatter (see
// buildFromMarkdown.ts); plain cards have none and parse as an empty object.

import yaml from "js-yaml";

export interface ParsedFrontmatter {
  /** Parsed YAML frontmatter (empty object when absent or invalid). */
  data: Record<string, any>;
  /** The markdown body after the frontmatter block. */
  body: string;
}

const FRONTMATTER_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(md: string): ParsedFrontmatter {
  const match = FRONTMATTER_RE.exec(md);
  if (!match) return { data: {}, body: md };
  let data: Record<string, any> = {};
  try {
    // JSON_SCHEMA restricts parsing to plain JSON-compatible types — no custom
    // tags, dates, or other non-JSON YAML constructs — since this content can
    // come from an external repo. (js-yaml v4's `load` is already free of the
    // code-execution sinks that older `!!js/*` tags allowed.)
    const loaded = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
    if (loaded && typeof loaded === "object") data = loaded as Record<string, any>;
  } catch {
    // Malformed frontmatter → treat as no structured data (plain card).
    data = {};
  }
  return { data, body: md.slice(match[0].length) };
}
