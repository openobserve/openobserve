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
 * Shared utilities for rendering log pattern templates with coloured wildcard
 * chips and hover-tooltip value distributions.
 *
 * Mirrors Datadog's "Pattern Inspector" UX: each <*> / <:TYPE> token is a
 * clickable chip that shows the top-N actual values observed at that position
 * across the cluster's example logs, making visually similar patterns
 * immediately distinguishable.
 */

export interface WildcardValues {
  position: number;
  token: string;
  sample_values: string[];
  is_variable: boolean;
}

export type TemplateToken =
  | { kind: "text"; value: string }
  | { kind: "wildcard"; value: string; position: number; sampleValues: string[] };

// Matches <*>, <:IP>, <:IPV4>, <:TIMESTAMP>, <:IDENTIFIERS>, <:NUM>, etc.
// Must stay in sync with the Rust regex in pattern_extractor.rs:
//   r"<(?:[*]|:[A-Z0-9_]+)>"
const WILDCARD_RE = /<(?:[*]|:[A-Z0-9_]+)>/g;

/**
 * Split a pattern template string into alternating text / wildcard tokens.
 * Wildcard tokens are enriched with the sample values from `wildcardValues`
 * so the rendering layer can attach hover tooltips without extra computation.
 */
export function tokenizeTemplate(
  template: string,
  wildcardValues: WildcardValues[],
): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  let lastIndex = 0;
  let wildcardIndex = 0;

  // Reset lastIndex between calls (global regex shares state)
  WILDCARD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = WILDCARD_RE.exec(template)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: "text", value: template.slice(lastIndex, match.index) });
    }

    // Try to match by position first, fall back to array index
    let wv = wildcardValues.find((w) => w.position === wildcardIndex);
    if (!wv) {
      wv = wildcardValues[wildcardIndex];
    }
    // Handle both snake_case and camelCase from the API
    const rawValues: string[] =
      (wv as any)?.sample_values ??
      (wv as any)?.sampleValues ??
      (wv as any)?.top_values ??
      (wv as any)?.topValues ??
      (wv as any)?.values ??
      [];
    if (rawValues.length === 0 && wv) {
      // wildcard item present but values array is empty — API may not have
      // returned sample values for this position
    }
    tokens.push({
      kind: "wildcard",
      value: match[0],
      position: wildcardIndex,
      sampleValues: rawValues,
    });

    wildcardIndex++;
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < template.length) {
    tokens.push({ kind: "text", value: template.slice(lastIndex) });
  }

  return tokens;
}

/**
 * Return Tailwind/Quasar CSS classes for a wildcard chip based on the token
 * type so different data types are colour-coded at a glance.
 *
 *  <*>           → blue   (generic XDrain wildcard)
 *  <:IP*>        → green  (IP addresses)
 *  <:NUM*> etc.  → orange (numbers)
 *  <:TIMESTAMP*> → purple (timestamps / dates)
 *  anything else → grey
 */
export function wildcardChipColor(token: string): string {
  if (token === "<*>") return "bg-blue-2 text-blue-9";
  if (/^<:IP/.test(token)) return "bg-green-2 text-green-9";
  if (/^<:(?:NUM|INT|FLOAT|HEX)/.test(token)) return "bg-orange-2 text-orange-9";
  if (/^<:(?:TIMESTAMP|DATE|TIME)/.test(token)) return "bg-purple-2 text-purple-9";
  return "bg-grey-3 text-grey-8";
}

/**
 * Generate a human-readable explanation of why a pattern is flagged as an
 * anomaly, using the statistical fields the backend now provides.
 */
export function anomalyExplanation(
  pattern: {
    percentage?: number;
    frequency?: number;
    z_score?: number;
    avg_frequency?: number;
    anomaly_score?: number;
  },
  t: (key: string, params?: Record<string, unknown>) => string,
): string {
  const pct = pattern.percentage ?? 0;
  const freq = pattern.frequency ?? 0;
  const z = pattern.z_score ?? 0;
  const avg = pattern.avg_frequency ?? 0;

  if (pct > 0 && pct < 1.0) {
    const key = freq === 1 ? "search.patternAnomalyRare" : "search.patternAnomalyRarePlural";
    return t(key, { pct: pct.toFixed(2), freq: freq.toLocaleString() });
  }
  if (z < -1.5 && avg > 0) {
    const key = freq === 1 ? "search.patternAnomalyLowFreq" : "search.patternAnomalyLowFreqPlural";
    return t(key, { freq: freq.toLocaleString(), avg: Math.round(avg).toLocaleString(), z: z.toFixed(2) });
  }
  const score = pattern.anomaly_score ?? 0;
  return t("search.patternAnomalyScore", { score: (score * 100).toFixed(0) });
}
