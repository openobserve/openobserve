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

const KEYWORDS = new Set([
  "by",
  "without",
  "on",
  "ignoring",
  "group_left",
  "group_right",
  "bool",
  "and",
  "or",
  "unless",
  "offset",
  "atan2",
  "inf",
  "nan",
]);
// These create labels the metric's schema never had, so a `by` on them is legitimate.
const LABEL_MAKERS = /\b(?:label_replace|label_join|count_values)\s*\(/i;

export interface MissingByLabel {
  label: string;
  metric: string;
  /** The metric's own labels, internal fields left out. */
  labels: string[];
}

const withoutStrings = (query: string): string =>
  query.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/g, '""');

/** Every label a PromQL query aggregates `by`, across all its `by (...)` clauses. */
export function promqlByLabels(query: string): string[] {
  const labels = new Set<string>();
  for (const match of withoutStrings(query ?? "").matchAll(/\bby\s*\(([^)]*)\)/gi)) {
    match[1]
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean)
      .forEach((label) => labels.add(label));
  }
  return [...labels];
}

/** The metric names a PromQL query reads, in order of first use. */
export function promqlMetricNames(query: string): string[] {
  const source = query ?? "";
  const names = new Set<string>();
  for (const m of source.matchAll(/__name__\s*=\s*"([^"]+)"/g)) names.add(m[1]);
  const bare = withoutStrings(source)
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(?:by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)/gi, " ");
  for (const m of bare.matchAll(/(?<![\w.:])([a-zA-Z_:][\w:]*)(?![\w:])(?!\s*\()/g)) {
    if (!KEYWORDS.has(m[1].toLowerCase())) names.add(m[1]);
  }
  return [...names];
}

/** The first `by` label no metric of the query has; null when all are known or a label is made by the query. */
export function missingByLabel(
  query: string,
  labelsOf: (metric: string) => readonly string[] | undefined,
): MissingByLabel | null {
  if (LABEL_MAKERS.test(query ?? "")) return null;
  const metrics = promqlMetricNames(query);
  const known = metrics.map(labelsOf);
  if (!metrics.length || known.some((labels) => !labels)) return null;
  const label = promqlByLabels(query).find(
    (name) => !known.some((labels) => labels!.includes(name)),
  );
  if (!label) return null;
  return {
    label,
    metric: metrics[0],
    labels: known[0]!.filter((name) => !name.startsWith("_") && name !== "value"),
  };
}
