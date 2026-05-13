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
 * When the token is generic <*> and sampleValues are provided the function
 * infers the data type from the actual values and picks the colour
 * accordingly, matching the behaviour of wildcardLabel().
 *
 *  <*> + values   → colour based on inferred type
 *  <*> no values   → blue   (generic wildcard)
 *  <:IP*>          → green  (IP addresses)
 *  <:NUM*> etc.    → orange (numbers)
 *  <:TIMESTAMP*>   → purple (timestamps / dates)
 *  anything else   → grey
 */
export function wildcardChipColor(token: string, sampleValues?: any[]): string {
  // For generic <*>, infer type from values and pick the matching colour
  if (token === "<*>" && sampleValues && sampleValues.length > 0) {
    const label = inferTypeFromValues(sampleValues);
    return chipColorForLabel(label);
  }

  if (token === "<*>") return "bg-blue-2 text-blue-9";
  if (/^<:IP/.test(token)) return "bg-green-2 text-green-9";
  if (/^<:(?:NUM|INT|FLOAT|HEX)/.test(token)) return "bg-orange-2 text-orange-9";
  if (/^<:(?:TIMESTAMP|DATE|TIME)/.test(token)) return "bg-purple-2 text-purple-9";
  return "bg-grey-3 text-grey-8";
}

/**
 * Map a display label (as returned by wildcardLabel) to a fixed chip colour
 * class so every data type has a visually distinct, predictable appearance.
 *
 *  ip      → green        method  → red          url     → indigo
 *  num     → orange       float   → orange       hex     → amber
 *  ts      → purple       date    → purple       time    → purple
 *  id      → teal         email   → pink         str     → grey
 *  pattern → blue         default → grey
 */
export function chipColorForLabel(label: string): string {
  const colorMap: Record<string, string> = {
    ip: "bg-green-2 text-green-9",
    ipv4: "bg-green-2 text-green-9",
    ipv6: "bg-green-2 text-green-9",
    method: "bg-red-2 text-red-9",
    url: "bg-indigo-2 text-indigo-9",
    num: "bg-orange-2 text-orange-9",
    float: "bg-orange-2 text-orange-9",
    hex: "bg-amber-2 text-amber-9",
    ts: "bg-purple-2 text-purple-9",
    date: "bg-purple-2 text-purple-9",
    time: "bg-purple-2 text-purple-9",
    id: "bg-teal-2 text-teal-9",
    email: "bg-pink-2 text-pink-9",
    str: "bg-grey-3 text-grey-8",
    pattern: "bg-blue-2 text-blue-9",
  };
  return colorMap[label] ?? "bg-grey-3 text-grey-8";
}

/**
 * Map a wildcard token to a short, human-readable label.
 *
 * For typed tokens like <:IP>, <:NUM> etc. the mapping is static.
 * For generic <*>, when sampleValues are provided, the function inspects
 * the actual values to infer the most likely data type (ip, method, url,
 * num, ts, str). Falls back to "str" when no type matches, or "pattern" when
 * values contain template wildcards like <*>.
 *  <*> + values   → inferred type (ip, method, url, num, float, hex, ts, id, str), pattern if template-like
 *  <*> no values   → "<*>"
 *  <:IP>           → "ip"
 *  <:IPV4>         → "ipv4"
 *  <:IPV6>         → "ipv6"
 *  <:NUM>          → "num"
 *  <:INT>          → "num"
 *  <:FLOAT>        → "float"
 *  <:HEX>          → "hex"
 *  <:TIMESTAMP>    → "ts"
 *  <:DATE>         → "date"
 *  <:TIME>         → "time"
 *  <:STR>          → "str"
 *  <:URL>          → "url"
 *  <:METHOD>       → "method"
 *  <:IDENTIFIERS>  → "id"
 *  anything else   → token as-is
 */
export function wildcardLabel(token: string, sampleValues?: any[]): string {
  // For generic <*>, try to infer the type from actual values
  if (token === "<*>" && sampleValues && sampleValues.length > 0) {
    return inferTypeFromValues(sampleValues);
  }

  const labelMap: Record<string, string> = {
    "<*>": "<*>",
    "<:IP>": "ip",
    "<:IPV4>": "ipv4",
    "<:IPV6>": "ipv6",
    "<:NUM>": "num",
    "<:INT>": "num",
    "<:FLOAT>": "float",
    "<:HEX>": "hex",
    "<:TIMESTAMP>": "ts",
    "<:DATE>": "date",
    "<:TIME>": "time",
    "<:STR>": "str",
    "<:URL>": "url",
    "<:METHOD>": "method",
    "<:IDENTIFIERS>": "id",
  };
  return labelMap[token] ?? token;
}

/**
 * Normalize raw API values (strings or {value,count} objects) to a flat
 * string array suitable for pattern matching.
 */
function normalizeValueStrings(raw: any[]): string[] {
  return raw
    .map((item) => {
      if (typeof item === "string") return item;
      return item?.value ?? "";
    })
    .filter((v) => v !== "");
}

const HTTP_METHODS = new Set([
  "GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "CONNECT", "TRACE",
]);

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const IPV6_RE = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT_RE = /^-?\d+$/;
const FLOAT_RE = /^-?\d+\.\d+$/;
const HEX_RE = /^[0-9a-fA-F]+$/;
const TS_DATE_RE = /\d{4}-\d{2}-\d{2}/;
const TS_TIME_RE = /\d{2}:\d{2}:\d{2}/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Inspect sample values from a generic <*> wildcard position and infer the
 * most likely data type.
 *
 * Uses a majority-threshold approach: if at least 50% of non-empty values
 * match a recognised pattern the corresponding label is returned. If no
 * pattern reaches the threshold the function falls back to "Str".
 */
export function inferTypeFromValues(rawValues: any[]): string {
  const values = normalizeValueStrings(rawValues);
  if (values.length === 0) return "str";

  const threshold = Math.max(1, Math.floor(values.length * 0.5));

  let ip = 0, method = 0, url = 0, uuid = 0, ts = 0, email = 0;
  let int = 0, float = 0, hex = 0, pattern = 0;

  // Matches wildcard placeholders like <*>, <:NUM>, <:IP>, etc.
  const templateRe = /<(?:[*]|:[A-Z0-9_]+)>/;

  for (const v of values) {
    // Check if the value itself looks like a log pattern template
    if (templateRe.test(v)) { pattern++; continue; }
    // Timestamp — check before IP (time strings like 10:30:00 can match IPv6 regex)
    if (TS_DATE_RE.test(v) || TS_TIME_RE.test(v)) { ts++; continue; }
    // Structural patterns
    if (IPV4_RE.test(v) || IPV6_RE.test(v)) { ip++; continue; }
    if (HTTP_METHODS.has(v.toUpperCase())) { method++; continue; }
    if (UUID_RE.test(v)) { uuid++; continue; }
    if (EMAIL_RE.test(v)) { email++; continue; }
    if (/^https?:\/\//.test(v)) { url++; continue; }
    // Numeric — check float before int (float pattern is more specific)
    if (FLOAT_RE.test(v)) { float++; continue; }
    if (INT_RE.test(v)) { int++; continue; }
    if (HEX_RE.test(v) && v.length >= 4) { hex++; continue; }
  }

  if (pattern >= threshold) return "pattern";

  if (ip >= threshold) return "ip";
  if (method >= threshold) return "method";
  if (url >= threshold) return "url";
  if (uuid >= threshold) return "id";
  if (email >= threshold) return "email";
  if (ts >= threshold) return "ts";
  if (hex >= threshold) return "hex";
  // Check combined int+float first so mixed numeric values say "num"
  if (int + float >= threshold && int > 0) return "num";
  if (float >= threshold) return "float";
  if (int >= threshold) return "num";

  return "str";
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
