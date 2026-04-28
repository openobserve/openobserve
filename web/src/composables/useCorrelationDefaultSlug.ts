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

import { loadIdentityConfig } from "@/utils/identityConfig";
import serviceStreamsApi from "@/services/service_streams";
import type { FieldAlias } from "@/services/service_streams";

// ── Cache ────────────────────────────────────────────────────────────────────

const fieldNamesCache = new Map<string, string[]>();
const semanticGroupsCache = new Map<string, FieldAlias[]>();
let lastSeenOrgId: string | null = null;

function evictOrgCacheIfSwitched(orgId: string): void {
  if (lastSeenOrgId !== null && lastSeenOrgId !== orgId) {
    // Org switched — remove all cached entries for the previous org so stale
    // identity config and semantic groups are not reused.
    for (const key of fieldNamesCache.keys()) {
      if (key.startsWith(`${lastSeenOrgId}/`)) fieldNamesCache.delete(key);
    }
    semanticGroupsCache.delete(lastSeenOrgId);
  }
  lastSeenOrgId = orgId;
}

async function loadSemanticGroups(orgId: string): Promise<FieldAlias[]> {
  if (semanticGroupsCache.has(orgId)) return semanticGroupsCache.get(orgId)!;
  try {
    const response = await serviceStreamsApi.getSemanticGroups(orgId);
    const groups: FieldAlias[] = response.data ?? [];
    semanticGroupsCache.set(orgId, groups);
    return groups;
  } catch {
    return [];
  }
}

// ── Field resolution ─────────────────────────────────────────────────────────

export async function getCorrelationFieldNames(
  orgId: string,
  streamName: string,
  streamSchemaFields: { name: string }[],
): Promise<string[]> {
  evictOrgCacheIfSwitched(orgId);
  const key = `${orgId}/${streamName}`;
  if (fieldNamesCache.has(key)) return fieldNamesCache.get(key)!;

  let identityConfig: any;
  try {
    identityConfig = await loadIdentityConfig(orgId);
  } catch {
    return [];
  }

  const trackedIds: string[] = identityConfig?.tracked_alias_ids;
  if (!trackedIds?.length) return [];

  const semanticGroups = await loadSemanticGroups(orgId);
  const idToFields = new Map<string, string[]>();
  for (const group of semanticGroups) idToFields.set(group.id, group.fields);

  const schemaFieldNames = new Set(streamSchemaFields.map((f) => f.name));
  const matched: string[] = [];
  for (const aliasId of trackedIds) {
    const fieldNames = idToFields.get(aliasId);
    if (fieldNames) {
      for (const fieldName of fieldNames) {
        if (schemaFieldNames.has(fieldName)) matched.push(fieldName);
      }
    } else if (schemaFieldNames.has(aliasId)) {
      matched.push(aliasId);
    }
  }

  fieldNamesCache.set(key, matched);
  return matched;
}

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = "oo_correlation_filters";

function storageKey(orgId: string, streamType: string, streamName: string): string {
  return `${STORAGE_PREFIX}_${orgId}_${streamType}_${streamName}`;
}

export interface SavedFilter {
  field: string;
  value: string;
}

export function extractCorrelationFilters(
  queryStr: string,
  trackedFieldNames: string[],
): SavedFilter[] {
  if (!queryStr || !trackedFieldNames.length) return [];

  const trackedSet = new Set(trackedFieldNames);
  const filters: SavedFilter[] = [];

  // Strip SELECT ... FROM "stream" WHERE prefix for SQL mode queries
  let whereClause = queryStr;
  const whereIdx = queryStr.search(/WHERE\s+/i);
  if (whereIdx !== -1) {
    whereClause = queryStr.slice(whereIdx).replace(/^WHERE\s+/i, "");
  }

  // Match field = 'value' where value may contain SQL-escaped single quotes ('')
  const conditionRegex = /(\w+)\s*=\s*'((?:[^']|'')*)'/gi;
  let m;
  while ((m = conditionRegex.exec(whereClause)) !== null) {
    if (trackedSet.has(m[1])) {
      const value = m[2].replace(/''/g, "'");
      const existing = filters.findIndex((f) => f.field === m[1]);
      if (existing >= 0) {
        filters[existing].value = value;
      } else {
        filters.push({ field: m[1], value });
      }
    }
  }

  return filters;
}

export function saveCorrelationFilters(
  orgId: string,
  streamType: string,
  streamName: string,
  filters: SavedFilter[],
): void {
  if (!orgId || !streamType || !streamName || !filters.length) return;

  localStorage.setItem(
    storageKey(orgId, streamType, streamName),
    JSON.stringify(filters),
  );
}

export function loadCorrelationFilters(
  orgId: string,
  streamType: string,
  streamName: string,
): SavedFilter[] {
  try {
    const raw = localStorage.getItem(storageKey(orgId, streamType, streamName));
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function buildCorrelationWhereClause(filters: SavedFilter[]): string {
  if (!filters.length) return "";
  return filters
    .map((f) => `${f.field} = '${f.value.replace(/'/g, "''")}'`)
    .join(" AND ");
}

export function clearCorrelationFilters(
  orgId: string,
  streamType: string,
  streamName: string,
): void {
  localStorage.removeItem(storageKey(orgId, streamType, streamName));
}

export function clearCorrelationCache(): void {
  fieldNamesCache.clear();
  semanticGroupsCache.clear();
  lastSeenOrgId = null;
}

// ── Generic composable ────────────────────────────────────────────────────────

import { watch, type WatchSource } from "vue";

export interface CorrelationFiltersOptions {
  orgId: () => string;
  streamType: () => string;
  streamName: () => string;
  streamSchemaFields: () => { name: string }[];
  getQuery: () => string;
  setQuery: (whereClause: string) => void;
  /** Reactive source to watch for query changes (e.g. () => searchObj.data.query) */
  querySource?: WatchSource<string>;
}

export function useCorrelationFilters(opts: CorrelationFiltersOptions) {
  const sync = async (queryStr: string): Promise<void> => {
    try {
      const orgId = opts.orgId();
      const streamType = opts.streamType();
      const streamName = opts.streamName();
      if (!orgId || !streamType || !streamName) return;

      if (!queryStr) {
        clearCorrelationFilters(orgId, streamType, streamName);
        return;
      }

      const trackedFields = await getCorrelationFieldNames(
        orgId,
        streamName,
        opts.streamSchemaFields(),
      );
      if (!trackedFields.length) return;

      const filters = extractCorrelationFilters(queryStr, trackedFields);
      if (filters.length) {
        saveCorrelationFilters(orgId, streamType, streamName, filters);
      } else {
        clearCorrelationFilters(orgId, streamType, streamName);
      }
    } catch (e) {
      console.error("[correlation:sync] error:", e);
    }
  };

  const save = (): Promise<void> => sync(opts.getQuery());

  const restore = (): void => {
    try {
      const orgId = opts.orgId();
      const streamType = opts.streamType();
      const streamName = opts.streamName();
      if (!orgId || !streamType || !streamName) return;

      if (opts.getQuery()) return;

      const saved = loadCorrelationFilters(orgId, streamType, streamName);
      if (!saved.length) return;

      const whereClause = buildCorrelationWhereClause(saved);
      if (!whereClause) return;

      opts.setQuery(whereClause);
    } catch (e) {
      console.error("[correlation:restore] error:", e);
    }
  };

  // Sets up a watcher so localStorage stays in sync as user edits the query bar.
  // Debounced to avoid firing on every keystroke.
  const watchQuery = (): void => {
    if (!opts.querySource) return;
    let timer: ReturnType<typeof setTimeout>;
    watch(opts.querySource, (newQuery: string) => {
      clearTimeout(timer);
      timer = setTimeout(() => sync(newQuery), 600);
    });
  };

  return { save, restore, watchQuery };
}
