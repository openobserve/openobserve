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

import { boundedFindings, type FindingsData } from "./evidence";

/** A verdict block larger than this is left in the narrative unparsed. */
export const MAX_VERDICT_CHARS = 64_000;

const INCONCLUSIVE_WORDS: ReadonlySet<string> = new Set([
  "inconclusive",
  "unknown",
  "undetermined",
  "none",
]);

/** The report's closing fenced JSON verdict, if it has one. */
const VERDICT_FENCE = /^```json[^\n]*\n([\s\S]*?)```\s*$/i;

/** Splits a finished report into its Findings and the narrative before them; an unusable verdict leaves the report whole. */
export function splitReportFindings(report: string): {
  findings: FindingsData | null;
  narrative: string;
} {
  const start = report.toLowerCase().lastIndexOf("```json");
  const match = start === -1 ? null : VERDICT_FENCE.exec(report.slice(start));
  if (!match || match[1].length > MAX_VERDICT_CHARS) return { findings: null, narrative: report };
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return { findings: null, narrative: report };
  }
  const findings = boundedFindings(asFindingsFrame(parsed));
  if (!findings) return { findings: null, narrative: report };
  return { findings, narrative: report.slice(0, start).trimEnd() };
}

// Today's agent names some fields its own way; each is read only if it has the expected type.
function asFindingsFrame(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const cause = firstString(source.likely_cause, source.root_cause, source.cause, source.summary);
  const confidence = confidenceOf(source.confidence, cause);
  if (!confidence) return null;
  return {
    likely_cause: cause ?? "",
    confidence,
    evidence: listOf(source.evidence).map((item) =>
      typeof item === "string"
        ? { text: item, kind: "inferred" }
        : {
            text: firstString(item.text, item.description, item.summary) ?? "",
            kind: item.kind === "verified" || item.query ? "verified" : "inferred",
          },
    ),
    ruled_out: strings(source.ruled_out),
    unknowns: strings(source.unknowns ?? source.open_questions),
    next_steps: strings(source.next_steps ?? source.recommendations),
  };
}

// A verdict with a cause but no stated confidence gets none invented: it is dropped as unusable.
function confidenceOf(value: unknown, cause: string | null): string | null {
  const level = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (level === "high" || level === "medium" || level === "low") return level;
  if (!cause || INCONCLUSIVE_WORDS.has(level)) return "inconclusive";
  return null;
}

function firstString(...values: unknown[]): string | null {
  const found = values.find((value) => typeof value === "string" && value.trim());
  return typeof found === "string" ? found.trim() : null;
}

function listOf(value: unknown): (string | Record<string, unknown>)[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string | Record<string, unknown> =>
      typeof item === "string" || (!!item && typeof item === "object" && !Array.isArray(item)),
  );
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
