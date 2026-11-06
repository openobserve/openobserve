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

/**
 * Harness text (AIO-22): the wrapper a coding agent puts around its user's
 * request (`<system-reminder>`, `<job>`), hidden when sessions are read. Per
 * agent, from GenAI Agent Mapping. Mirrors `strip_harness` in
 * src/config/src/meta/gen_ai.rs, which hides it in the Sessions list; this copy
 * serves the turn previews, which are built from the spans in the browser.
 */

export interface HarnessPatternRule {
  agent: string;
  patterns: string[];
}

export interface HarnessStripped {
  text: string;
  hidden: number;
  /** Set when the text was only harness: what hid it (the tag). */
  only: string | null;
}

/** Tags known coding agents wrap requests in; "Apply defaults" fills these. */
export const DEFAULT_HARNESS_PATTERNS = [
  "tag system-reminder",
  "tag job",
  "tag command-message",
  "tag local-command-stdout",
];

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `tag <name>` or `regex <expr>`; anything else (or a bad regex) is null. */
export function compileHarnessPattern(pattern: string): { re: RegExp; label: string } | null {
  const p = pattern.trim();
  if (p.startsWith("tag ")) {
    const tag = p.slice(4).trim();
    if (!/^[\w.:-]+$/.test(tag)) return null;
    const t = escapeRegex(tag);
    return { re: new RegExp(`<${t}\\b[^>]*>[\\s\\S]*?</${t}\\s*>`, "g"), label: tag };
  }
  if (p.startsWith("regex ")) {
    try {
      return { re: new RegExp(p.slice(6).trim(), "g"), label: "regex" };
    } catch {
      return null;
    }
  }
  return null;
}

export function stripHarness(text: string, patterns: string[]): HarnessStripped {
  let out = text;
  let hidden = 0;
  let first: string | null = null;
  for (const compiled of patterns.map(compileHarnessPattern)) {
    if (!compiled) continue;
    const n = out.match(compiled.re)?.length ?? 0;
    if (n > 0) {
      hidden += n;
      first ??= compiled.label;
      out = out.replace(compiled.re, "");
    }
  }
  const trimmed = out.trim();
  return { text: trimmed, hidden, only: !trimmed && hidden > 0 ? first : null };
}

/** The patterns saved for one agent, or none. */
export function patternsForAgent(rules: HarnessPatternRule[] | undefined, agent: string | null) {
  return (agent && rules?.find((r) => r.agent === agent)?.patterns) || [];
}
