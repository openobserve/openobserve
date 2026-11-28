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

import type { PackBinding, PackBindingTier } from "./types";

export interface FieldGroup {
  id: string;
  fields: string[];
}

export interface BindingSources {
  /** Org semantic groups, empty on OSS. */
  groups: FieldGroup[];
  aliases: string[][];
}

interface FieldMatch {
  to: string;
  tier: PackBindingTier;
  group?: string;
}

/** Holds the metric name, so grouping or filtering on it is never a field binding. */
export const RESERVED_FIELD = "__name__";

const inColumns = (name: string, columns: Set<string>): string | undefined => {
  const lower = name.toLowerCase();
  return [...columns].find((column) => column.toLowerCase() === lower && column !== RESERVED_FIELD);
};

const firstSpelling = (field: string, spellings: string[], columns: Set<string>) => {
  if (!spellings.some((name) => name.toLowerCase() === field.toLowerCase())) return undefined;
  for (const name of spellings) {
    const found = inColumns(name, columns);
    if (found) return found;
  }
  return undefined;
};

/** Exact name, then the org's groups in their order, then the pack's alias lists. */
export const matchField = (
  field: string,
  columns: Set<string>,
  { groups, aliases }: BindingSources,
): FieldMatch | null => {
  if (columns.has(field)) return { to: field, tier: "exact" };
  for (const { id, fields } of groups) {
    const to = firstSpelling(field, fields, columns);
    if (to) return { to, tier: "semantic", group: id };
  }
  for (const list of aliases) {
    const to = firstSpelling(field, list, columns);
    if (to) return { to, tier: "alias", group: list[0] };
  }
  return null;
};

/** The renames a stream needs; a field already spelled right binds to nothing. */
export const bindStream = (
  stream: string,
  fields: Iterable<string>,
  columns: Set<string>,
  sources: BindingSources,
  chosen: Record<string, string> = {},
): PackBinding[] =>
  [...new Set(fields)].flatMap((from): PackBinding[] => {
    const picked = chosen[`${stream}/${from}`];
    if (picked && picked !== RESERVED_FIELD) {
      return picked === from ? [] : [{ stream, from, to: picked, tier: "chosen" }];
    }
    const match = matchField(from, columns, sources);
    return match && match.to !== from ? [{ stream, from, ...match }] : [];
  });
