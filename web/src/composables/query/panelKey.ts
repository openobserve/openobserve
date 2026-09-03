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
 * The panel-result cache key.
 *
 * A panel's result depends on its schema and the variables it was run with, so
 * the identity of a cached result is that pair — not the panel id. Keying only
 * by panel id meant one variable combination evicted the next; the digest below
 * gives each combination its own entry.
 *
 * The panel schema is far too large to stringify into a key, so it is hashed to
 * a short digest — the `queryKeyHashFn` role in TanStack terms.
 */

import { omit } from "lodash-es";

/**
 * Schema paths that do not affect the query result. Bumping a version or
 * dragging a panel must not invalidate its data.
 */
export const PANEL_KEY_IGNORED_PATHS = [
  "panelSchema.version",
  "panelSchema.layout",
  "panelSchema.htmlContent",
  "panelSchema.markdownContent",
  "panelSchema.customChartResult",
];

/**
 * Keep only the variable fields the query actually depends on. `options`,
 * `isLoading` and friends are runtime state and change constantly.
 */
export const normalizeVariablesForCache = (variables: any[]): any[] => {
  if (!variables || !Array.isArray(variables)) return variables;
  return variables.map((v) => ({
    name: v.name,
    type: v.type,
    value: v.value,
    scope: v.scope,
    multiSelect: v.multiSelect,
    query_data: v.query_data,
  }));
};

/** The comparable form of a panel cache key: volatile paths and state removed. */
export const normalizePanelKey = (key: any): any => {
  const base = omit(key ?? {}, PANEL_KEY_IGNORED_PATHS) as any;
  return {
    ...base,
    variablesData: normalizeVariablesForCache(base.variablesData),
  };
};

/** Stable stringify — object key order must not change the digest. */
const canonical = (value: any): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
    .join(",")}}`;
};

/**
 * FNV-1a over the canonical form. Not cryptographic — it only has to separate
 * one panel's variable combinations from each other, and a collision is caught
 * by the caller's own key comparison before any data is used.
 */
export const panelKeyDigest = (key: any): string => {
  const input = canonical(normalizePanelKey(key));
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
};
