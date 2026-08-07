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
//
// ContentSpec: the JSON shape stored in a "content"-kind template's `body`
// field. The custom (raw payload) kind stores an arbitrary string in `body`;
// the content kind stores THIS shape, serialized with JSON.stringify(spec, null, 2)
// so it stays human-diffable if a user ever inspects/exports it.
//
// parseContentSpec is intentionally tolerant: it never throws. A non-JSON body
// (e.g. a legacy custom-kind body, or user typo) returns null so the caller can
// fall back to treating the template as custom/unparseable, rather than crashing
// the editor. A valid-JSON body missing keys is filled in from
// emptyContentSpec() defaults rather than rejected — this keeps the editor
// forward-compatible with older/partial specs. Unknown/extra keys on the parsed
// object are preserved as-is on the returned object (not stripped) so a
// round-trip through the editor doesn't silently drop fields a future version
// might add.

export interface ContentField {
  label: string;
  value: string;
  show_when?: { levels: string[] } | null;
}

export interface ContentLink {
  label: string;
  url: string;
  show_when?: { levels: string[] } | null;
}

export interface RowsSpec {
  enabled: boolean;
  max: number;
  columns?: string[] | null;
  format?: string | null;
}

export interface ContentSpec {
  title: string;
  title_overrides: Record<string, string>;
  body: string;
  fields: ContentField[];
  rows: RowsSpec;
  links: ContentLink[];
  chart: { enabled: boolean };
}

export function emptyContentSpec(): ContentSpec {
  return {
    title: "",
    title_overrides: {},
    body: "",
    fields: [],
    rows: { enabled: false, max: 5, columns: null, format: null },
    links: [],
    chart: { enabled: false },
  };
}

/**
 * Parse a template `body` string as a ContentSpec.
 *
 * Tolerant: JSON.parse failure returns null (never throws). Valid JSON that is
 * missing keys gets those keys filled in from emptyContentSpec() defaults.
 * Extra/unknown keys present on the parsed object are preserved on the result
 * (spread after the defaults so they survive), never stripped.
 */
export function parseContentSpec(body: string): ContentSpec | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const raw = parsed as Record<string, any>;
  const defaults = emptyContentSpec();

  const rowsRaw =
    typeof raw.rows === "object" && raw.rows !== null && !Array.isArray(raw.rows) ? raw.rows : {};
  const chartRaw =
    typeof raw.chart === "object" && raw.chart !== null && !Array.isArray(raw.chart)
      ? raw.chart
      : {};

  const spec: ContentSpec = {
    ...defaults,
    ...raw,
    title: typeof raw.title === "string" ? raw.title : defaults.title,
    title_overrides:
      typeof raw.title_overrides === "object" &&
      raw.title_overrides !== null &&
      !Array.isArray(raw.title_overrides)
        ? raw.title_overrides
        : defaults.title_overrides,
    body: typeof raw.body === "string" ? raw.body : defaults.body,
    fields: Array.isArray(raw.fields) ? raw.fields : defaults.fields,
    links: Array.isArray(raw.links) ? raw.links : defaults.links,
    rows: {
      ...defaults.rows,
      ...rowsRaw,
      enabled: typeof rowsRaw.enabled === "boolean" ? rowsRaw.enabled : defaults.rows.enabled,
      max: typeof rowsRaw.max === "number" ? rowsRaw.max : defaults.rows.max,
    },
    chart: {
      ...defaults.chart,
      ...chartRaw,
      enabled: typeof chartRaw.enabled === "boolean" ? chartRaw.enabled : defaults.chart.enabled,
    },
  };

  return spec;
}

/**
 * The seed for a NEW template. Unlike emptyContentSpec(), this renders a
 * complete, good-looking notification on first paint — the preview endpoint
 * ships synthetic rows (preview.rs:171-174), so this paints real Slack output
 * with no alert, no stream and no ingested data.
 *
 * Matched rows default ON: they are the log lines that fired the alert, and
 * the single most valuable thing in a notification.
 */
export function starterContentSpec(): ContentSpec {
  return {
    title: "{alert_name} · {stream_name}",
    title_overrides: {},
    body:
      "**{alert_name}** fired.\n\n" +
      "`{alert_operator} {alert_threshold}` — observed **{alert_agg_value}**.",
    fields: [
      { label: "Value", value: "{alert_agg_value}" },
      { label: "Threshold", value: "{alert_operator} {alert_threshold}" },
      { label: "Triggered", value: "{alert_trigger_time_str}" },
    ],
    rows: { enabled: true, max: 5, columns: null, format: null },
    links: [],
    chart: { enabled: false },
  };
}

/**
 * True if the given spec has any content in the sections tucked behind the
 * "Add to this template" disclosure (fields, links, matching rows, or channel
 * title overrides). Used to auto-open the disclosure so opening a saved
 * template never hides data the user already wrote.
 */
export function hasOptionalContent(spec: ContentSpec): boolean {
  return (
    spec.fields.length > 0 ||
    spec.links.length > 0 ||
    spec.rows.enabled ||
    spec.chart.enabled ||
    Object.keys(spec.title_overrides).length > 0
  );
}

export function serializeContentSpec(spec: ContentSpec): string {
  // Trim only the body's leading/trailing whitespace on save — not on every
  // keystroke or blur, so the live editor (blank lines, toolbar cursor
  // position) is never mutated out from under the user while composing.
  const trimmed: ContentSpec = { ...spec, body: spec.body.trim() };
  return JSON.stringify(trimmed, null, 2);
}
