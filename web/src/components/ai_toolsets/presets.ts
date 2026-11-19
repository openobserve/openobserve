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

/** One `{name}` in a preset's URL template, filled in by the admin. */
export interface PresetParam {
  name: string;
  label: string;
  options?: string[];
  default?: string;
  placeholder?: string;
}

/** One preset from `GET /ai/toolsets/prebuilt`; the server's file is the only copy. */
export interface Preset {
  id: string;
  kind: "mcp" | "cli";
  label: string;
  revision: number;
  description?: string;
  url_template?: string;
  params?: PresetParam[];
  headers?: { name: string; placeholder?: string }[];
  help?: string;
  allowed_tools?: string[];
  write_tools?: string[];
  tool_classes?: unknown[];
  command?: string;
  allowed_subcommands?: string[];
  env?: string[];
  credential_files?: string[];
}

/** What a saved toolset remembers of the preset it came from; never the URL or its parts. */
export interface PresetRef {
  id: string;
  revision: number;
  /** Per skipped field, a hash of the shipped value the admin turned down. */
  skipped?: Record<string, string>;
}

/** The preset fields a review compares; credentials and limits are never among them. */
export type PresetField =
  | "url"
  | "description"
  | "allowed_tools"
  | "write_tools"
  | "tool_classes"
  | "command"
  | "allowed_subcommands";

export interface PresetDiff {
  field: PresetField;
  current: unknown;
  shipped: unknown;
}

export type PresetBadge = "updated" | "retired";

const DATA_FIELDS: PresetField[] = [
  "url",
  "allowed_tools",
  "write_tools",
  "tool_classes",
  "command",
  "allowed_subcommands",
];

export function renderUrl(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? "");
}

/** The template's values read back from a saved URL; `null` when the URL doesn't fit it. */
export function paramsFromUrl(template: string, url: string): Record<string, string> | null {
  const names: string[] = [];
  const pattern = template
    .split(/(\{\w+\})/)
    .map((part) => {
      const name = /^\{(\w+)\}$/.exec(part)?.[1];
      if (!name) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      names.push(name);
      return "(.+?)";
    })
    .join("");
  const match = new RegExp(`^${pattern}$`).exec(url);
  return match ? Object.fromEntries(names.map((n, i) => [n, match[i + 1]])) : null;
}

export function defaultParams(preset: Preset): Record<string, string> {
  return Object.fromEntries((preset.params ?? []).map((p) => [p.name, p.default ?? ""]));
}

/** The `data` a new MCP toolset gets from a preset, with `preset` remembered. */
export function presetData(preset: Preset, params: Record<string, string>): Record<string, any> {
  return {
    url: renderUrl(preset.url_template ?? "", params),
    allowed_tools: [...(preset.allowed_tools ?? [])],
    write_tools: [...(preset.write_tools ?? [])],
    tool_classes: preset.tool_classes ?? [],
    preset: { id: preset.id, revision: preset.revision },
  };
}

/** "updated" when the shipped preset is newer than the row's copy; "retired" when it's gone. */
export function presetBadge(
  data: Record<string, any> | null | undefined,
  presets: Preset[] | undefined,
): PresetBadge | null {
  const ref: PresetRef | undefined = data?.preset;
  if (!ref?.id || !presets) return null;
  const shipped = presets.find((p) => p.id === ref.id);
  if (!shipped) return "retired";
  return shipped.revision > (ref.revision ?? 0) ? "updated" : null;
}

// An absent value and an empty one say the same, so neither is offered as a change.
const blank = (v: unknown) => v ?? null;
const empty = (v: unknown) => v === null || v === "" || (Array.isArray(v) && !v.length);
const same = (a: unknown, b: unknown) =>
  (empty(blank(a)) && empty(blank(b))) || JSON.stringify(blank(a)) === JSON.stringify(blank(b));

/** A short, stable fingerprint of a shipped value, so a skip holds until that value changes. */
export function valueHash(value: unknown): string {
  const text = JSON.stringify(blank(value));
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

function shippedFields(
  row: { data: Record<string, any> },
  preset: Preset,
): Partial<Record<PresetField, unknown>> {
  if (preset.kind === "cli") {
    return {
      command: preset.command ?? "",
      allowed_subcommands: preset.allowed_subcommands ?? [],
      description: preset.description ?? "",
    };
  }
  const template = preset.url_template ?? "";
  const params = paramsFromUrl(template, row.data.url ?? "");
  return {
    // A URL that no longer fits the template can't be rebuilt, so it isn't offered.
    ...(params ? { url: renderUrl(template, params) } : {}),
    description: preset.description ?? "",
    allowed_tools: preset.allowed_tools ?? [],
    write_tools: preset.write_tools ?? [],
    tool_classes: preset.tool_classes ?? [],
  };
}

/** The fields the shipped preset changes, minus those whose shipped value was already skipped. */
export function presetDiff(
  row: { description?: string | null; data: Record<string, any> },
  preset: Preset,
): PresetDiff[] {
  const ref: PresetRef = row.data.preset ?? { id: preset.id, revision: 0 };
  const shipped = shippedFields(row, preset);
  const current = (field: PresetField) =>
    field === "description" ? (row.description ?? "") : row.data[field];
  return (Object.keys(shipped) as PresetField[])
    .filter((field) => ref.skipped?.[field] !== valueHash(shipped[field]))
    .filter((field) => !same(current(field), shipped[field]))
    .map((field) => ({ field, current: current(field), shipped: shipped[field] }));
}

/** The `PUT` body that applies `applied` and remembers the rest as skipped by value. */
export function reviewUpdate(
  row: { data: Record<string, any> },
  preset: Preset,
  diffs: PresetDiff[],
  applied: Set<PresetField>,
): { description?: string; data: Record<string, any> } {
  const ref: PresetRef = row.data.preset ?? { id: preset.id, revision: 0 };
  const skipped = { ...(ref.skipped ?? {}) };
  const data: Record<string, any> = {};
  let description: string | undefined;
  for (const diff of diffs) {
    if (!applied.has(diff.field)) {
      skipped[diff.field] = valueHash(diff.shipped);
      continue;
    }
    delete skipped[diff.field];
    if (diff.field === "description") description = diff.shipped as string;
    else if (DATA_FIELDS.includes(diff.field)) data[diff.field] = diff.shipped;
  }
  data.preset = { id: ref.id, revision: preset.revision, skipped };
  return description === undefined ? { data } : { description, data };
}
