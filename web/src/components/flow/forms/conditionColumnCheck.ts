/* Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

// Mirrors backend resolve_column (core/alerts): exact key, else split on [._]
// and descend the {meta, data} envelope — so bare `severity` can NEVER match.

export interface UnresolvableColumn {
  column: string;
  /** Dotted display form of the closest known field, e.g. `meta.severity`. */
  suggestion: string | null;
}

interface FieldLike {
  value?: unknown;
}

const normalize = (col: string): string => col.replace(/\./g, "_");

const firstSegment = (col: string): string => col.split(/[._]/).find((s) => s.length > 0) ?? "";

// `meta_alert_name` renders as `meta.alert_name` — the form the trigger drawer shows.
const toDotted = (value: string): string => {
  const root = firstSegment(value);
  return value.startsWith(`${root}_`) ? `${root}.${value.slice(root.length + 1)}` : value;
};

const collectLeafColumns = (node: unknown, out: string[]): void => {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  if (n.filterType === "condition" && typeof n.column === "string" && n.column) {
    if (!out.includes(n.column)) out.push(n.column);
  }
  if (Array.isArray(n.conditions)) n.conditions.forEach((c) => collectLeafColumns(c, out));
};

const suggestFor = (normalized: string, fields: FieldLike[]): string | null => {
  const target = normalized.toLowerCase();
  let best: string | null = null;
  for (const f of fields) {
    const value = String(f?.value ?? "");
    if (!value) continue;
    const nv = normalize(value).toLowerCase();
    if (nv !== target && !nv.endsWith(`_${target}`)) continue;
    if (best === null || value.length < best.length) best = value;
  }
  return best === null ? null : toDotted(best);
};

/** Leaf columns the trigger's `{meta, data}` envelope can never resolve, with near-matches. */
export const findUnresolvableColumns = (
  group: unknown,
  fields: FieldLike[],
): UnresolvableColumn[] => {
  const knownValues = new Set<string>();
  // `data` is always a legitimate root: its row columns exist only at runtime.
  const roots = new Set<string>(["data"]);
  for (const f of fields) {
    const value = String(f?.value ?? "");
    if (!value) continue;
    knownValues.add(normalize(value));
    const root = firstSegment(normalize(value));
    if (root) roots.add(root);
  }
  const columns: string[] = [];
  collectLeafColumns(group, columns);
  const out: UnresolvableColumn[] = [];
  for (const column of columns) {
    const normalized = normalize(column);
    if (knownValues.has(normalized) || roots.has(firstSegment(normalized))) continue;
    out.push({ column, suggestion: suggestFor(normalized, fields) });
  }
  return out;
};
