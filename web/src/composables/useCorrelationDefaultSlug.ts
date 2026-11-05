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

import { isCancelledError } from "@tanstack/vue-query";
import { loadIdentityConfig } from "@/utils/identityConfig";
import {
  clearSemanticGroupsCache,
  loadSemanticGroups,
  SEMANTIC_GROUPS_CACHE_TTL_MS,
} from "@/utils/semanticGroupsCache";
import { queryClient } from "@/composables/query/queryClient";
import { serviceStreamKeys } from "@/services/service_streams.querykeys";
import config from "@/aws-exports";

function isCorrelationAvailable(): boolean {
  return config.isEnterprise === "true" || config.isCloud === "true";
}

interface SemanticGroupsLookup {
  idToFields: Map<string, string[]>;
  cancelled: boolean;
}

interface FieldNamesEntry {
  fields: string[];
  cachedAt: number;
  sources: unknown[];
}

// ── Cache ────────────────────────────────────────────────────────────────────

const fieldNamesCache = new Map<string, FieldNamesEntry>();
const pendingGroupsLookups = new Map<string, Promise<SemanticGroupsLookup>>();
let lastSeenOrgId: string | null = null;

function evictOrgCacheIfSwitched(orgId: string): void {
  if (lastSeenOrgId !== null && lastSeenOrgId !== orgId) {
    for (const key of fieldNamesCache.keys()) {
      if (key.startsWith(`${lastSeenOrgId}/`)) fieldNamesCache.delete(key);
    }
    pendingGroupsLookups.delete(lastSeenOrgId);
  }
  lastSeenOrgId = orgId;
}

// Structural sharing keeps a reference across an unchanged refetch, so a new one means a settings save changed the input.
function sourceData(orgId: string): unknown[] {
  return [serviceStreamKeys.identityConfig(orgId), serviceStreamKeys.semanticGroups(orgId)].map(
    (key) => {
      const state = queryClient.getQueryState(key);
      return state && !state.isInvalidated ? state.data : undefined;
    },
  );
}

function isEntryFresh(entry: FieldNamesEntry, orgId: string): boolean {
  if (Date.now() - entry.cachedAt >= SEMANTIC_GROUPS_CACHE_TTL_MS) return false;
  const current = sourceData(orgId);
  return entry.sources.every((data, i) => data === current[i]);
}

// ── Field resolution ─────────────────────────────────────────────────────────

async function fetchSemanticGroupsLookup(orgId: string): Promise<SemanticGroupsLookup> {
  let cancelled = false;
  const semanticGroups = await loadSemanticGroups(orgId, (err) => {
    cancelled = isCancelledError(err);
  });
  const idToFields = new Map<string, string[]>();
  for (const group of semanticGroups) idToFields.set(group.id, group.fields);
  return { idToFields, cancelled };
}

// Every query watcher and streaming chunk lands here at once on a cold load; one shared lookup also logs a failure once.
function loadSemanticGroupsLookup(orgId: string): Promise<SemanticGroupsLookup> {
  const pending = pendingGroupsLookups.get(orgId);
  if (pending) return pending;
  const lookup: Promise<SemanticGroupsLookup> = fetchSemanticGroupsLookup(orgId).finally(() => {
    if (pendingGroupsLookups.get(orgId) === lookup) pendingGroupsLookups.delete(orgId);
  });
  pendingGroupsLookups.set(orgId, lookup);
  return lookup;
}

function matchTrackedFields(
  trackedIds: string[],
  idToFields: Map<string, string[]>,
  streamSchemaFields: { name: string }[],
): string[] {
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
  return matched;
}

export async function getCorrelationFieldNames(
  orgId: string,
  streamType: string,
  streamName: string,
  streamSchemaFields: { name: string }[],
): Promise<string[]> {
  if (!isCorrelationAvailable()) return [];
  evictOrgCacheIfSwitched(orgId);
  const key = `${orgId}/${streamType}/${streamName}`;
  const cached = fieldNamesCache.get(key);
  if (cached && isEntryFresh(cached, orgId)) return cached.fields;
  // Query watchers sync before the schema loads; caching that empty match would block every later save for the stream.
  if (!streamSchemaFields.length) return [];

  let identityConfig: any;
  try {
    identityConfig = await loadIdentityConfig(orgId);
  } catch {
    return [];
  }
  const trackedIds: string[] = identityConfig?.tracked_alias_ids ?? [];
  if (!trackedIds.length) return [];

  const { idToFields, cancelled } = await loadSemanticGroupsLookup(orgId);
  // A force-refresh elsewhere cancels the shared load; raw alias ids alone would make sync() clear saved alias filters.
  if (cancelled) return [];
  const matched = matchTrackedFields(trackedIds, idToFields, streamSchemaFields);
  // A lookup that finishes after an org switch must not repopulate the evicted org's entries.
  if (lastSeenOrgId === orgId) {
    fieldNamesCache.set(key, { fields: matched, cachedAt: Date.now(), sources: sourceData(orgId) });
  }
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
  let m: RegExpExecArray | null;
  while ((m = conditionRegex.exec(whereClause)) !== null) {
    const field = m[1];
    if (trackedSet.has(field)) {
      const value = m[2].replace(/''/g, "'");
      const existing = filters.findIndex((f) => f.field === field);
      if (existing >= 0) {
        filters[existing].value = value;
      } else {
        filters.push({ field, value });
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

  localStorage.setItem(storageKey(orgId, streamType, streamName), JSON.stringify(filters));
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
  return filters.map((f) => `${f.field} = '${f.value.replace(/'/g, "''")}'`).join(" AND ");
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
  pendingGroupsLookups.clear();
  clearSemanticGroupsCache();
  lastSeenOrgId = null;
}

// ── Generic composable ────────────────────────────────────────────────────────

import { watch, type WatchSource } from "vue";
import { useStore } from "vuex";
import { featureState } from "@/utils/featureGate";

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
  const store = useStore();
  // Tracks which (org, streamType, streamName) keys we've already attempted to
  // restore for in this session. Without this, every extractFields() call
  // (which happens after every query) would re-apply saved filters whenever
  // the query is empty — racing with user actions like deselecting all values
  // in the field sidebar and silently restoring filters the user just cleared.
  const restoredKeys = new Set<string>();

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

      // The identity config endpoint is tagged correlation; a locked license would 403 it.
      if (featureState(store?.state.zoConfig?.features, "correlation") === "locked") return;
      const trackedFields = await getCorrelationFieldNames(
        orgId,
        streamType,
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

      const key = `${orgId}|${streamType}|${streamName}`;
      if (restoredKeys.has(key)) return;
      restoredKeys.add(key);

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
