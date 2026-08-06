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
 * The single source of query keys.
 *
 * Rules this file exists to enforce:
 *  1. Every key starts `["org", orgId]`, so an org switch is one
 *     `removeQueries({ queryKey: ["org", prev] })` plus a storage prefix scan.
 *  2. Only *server-applied* parameters belong in a key. Client-side filters,
 *     sorts and page indexes of `pagination="client"` tables never do.
 *  3. Keys are produced only here — never an inline array literal in a
 *     component. That is what makes prefix invalidation safe and greppable.
 *
 * Global (org-independent) reads still sit under an org root, using
 * `GLOBAL_SCOPE` as the org segment, so one purge path covers everything.
 */

export const GLOBAL_SCOPE = "__global__";

export type OrgId = string;

/**
 * Build a filter object with a stable field order. TanStack hashes keys with a
 * deterministic stringify, so ordering does not affect correctness — it keeps
 * DevTools readable and stops key shapes drifting between call sites.
 */
export const stableFilters = <T extends Record<string, unknown>>(filters: T): T => {
  const out = {} as Record<string, unknown>;
  for (const key of Object.keys(filters).sort()) {
    const value = filters[key];
    if (value === undefined || value === "" || value === null) continue;
    out[key] = value;
  }
  return out as T;
};

/**
 * Round a relative time range to a bucket so it can be part of a cache key.
 *
 * A range computed from `Date.now()` is different on every mount, so a key
 * containing the raw timestamps can never hit — which is what made tab switches
 * on the Home page re-request everything. Bucketing to 60s means remounting
 * inside that minute reuses the key, while a real range change still forks it.
 *
 * The request still carries the caller's exact timestamps; only the key is
 * rounded.
 */
export const quantizeRange = (
  startTime: number,
  endTime: number,
  bucketMs = 60_000,
): { start: number; end: number } => {
  // Micro-second epochs are the norm in this app; detect and scale the bucket.
  const bucket = String(Math.trunc(endTime)).length > 14 ? bucketMs * 1000 : bucketMs;
  return {
    start: Math.floor(startTime / bucket) * bucket,
    end: Math.floor(endTime / bucket) * bucket,
  };
};

export interface ServerTableParams {
  page: number;
  pageSize: number;
  filter?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  [extra: string]: unknown;
}

const org = (orgId: OrgId) => ["org", orgId] as const;

export const qk = {
  org,
  /** Root for reads that are not org-scoped (app config, build info). */
  global: () => org(GLOBAL_SCOPE),

  config: {
    root: () => [...org(GLOBAL_SCOPE), "config"] as const,
    get: () => [...org(GLOBAL_SCOPE), "config", "get"] as const,
  },

  streams: {
    root: (o: OrgId) => [...org(o), "streams"] as const,
    nameList: (o: OrgId, type: string) => [...org(o), "streams", "nameList", type] as const,
    page: (o: OrgId, type: string, p: ServerTableParams) =>
      [...org(o), "streams", "page", type, p] as const,
    schema: (o: OrgId, type: string, name: string) =>
      [...org(o), "streams", "schema", type, name] as const,
    fieldValues: (o: OrgId, type: string, name: string, field: string, range: unknown) =>
      [...org(o), "streams", "fieldValues", type, name, field, range] as const,
  },

  folders: {
    root: (o: OrgId) => [...org(o), "folders"] as const,
    byType: (o: OrgId, type: string) => [...org(o), "folders", type] as const,
  },

  organizations: {
    root: (o: OrgId) => [...org(o), "organizations"] as const,
    list: (o: OrgId) => [...org(o), "organizations", "list"] as const,
    page: (o: OrgId, p: ServerTableParams) => [...org(o), "organizations", "page", p] as const,
    settings: (o: OrgId) => [...org(o), "organizations", "settings"] as const,
    cleanupTasks: (o: OrgId) => [...org(o), "organizations", "cleanupTasks"] as const,
  },

  functions: {
    root: (o: OrgId) => [...org(o), "functions"] as const,
    list: (o: OrgId) => [...org(o), "functions", "list"] as const,
    enrichmentTables: (o: OrgId) => [...org(o), "functions", "enrichmentTables"] as const,
  },

  actions: {
    root: (o: OrgId) => [...org(o), "actions"] as const,
    list: (o: OrgId) => [...org(o), "actions", "list"] as const,
  },

  alerts: {
    root: (o: OrgId) => [...org(o), "alerts"] as const,
    listByFolder: (o: OrgId, folderId: string) => [...org(o), "alerts", "list", folderId] as const,
    search: (o: OrgId, folderId: string, f: Record<string, unknown>) =>
      [...org(o), "alerts", "search", folderId, stableFilters(f)] as const,
    detail: (o: OrgId, alertId: string) => [...org(o), "alerts", "detail", alertId] as const,
    history: (o: OrgId, alertId: string, p: ServerTableParams) =>
      [...org(o), "alerts", "history", alertId, p] as const,
    destinations: (o: OrgId, module?: string) =>
      [...org(o), "alerts", "destinations", module ?? "all"] as const,
    templates: (o: OrgId) => [...org(o), "alerts", "templates"] as const,
    sources: (o: OrgId) => [...org(o), "alerts", "sources"] as const,
  },

  incidents: {
    root: (o: OrgId) => [...org(o), "incidents"] as const,
    list: (o: OrgId, f: Record<string, unknown>) =>
      [...org(o), "incidents", "list", stableFilters(f)] as const,
    detail: (o: OrgId, id: string) => [...org(o), "incidents", "detail", id] as const,
    rca: (o: OrgId, id: string) => [...org(o), "incidents", "rca", id] as const,
    stats: (o: OrgId, range: unknown) => [...org(o), "incidents", "stats", range] as const,
  },

  dashboards: {
    root: (o: OrgId) => [...org(o), "dashboards"] as const,
    list: (o: OrgId, folderId: string) => [...org(o), "dashboards", "list", folderId] as const,
    detail: (o: OrgId, folderId: string, dashboardId: string) =>
      [...org(o), "dashboards", "detail", folderId, dashboardId] as const,
    annotations: (o: OrgId, dashboardId: string, range: unknown) =>
      [...org(o), "dashboards", "annotations", dashboardId, range] as const,
    favorites: (o: OrgId) => [...org(o), "dashboards", "favorites"] as const,
  },

  panels: {
    root: (o: OrgId) => [...org(o), "panels"] as const,
    result: (o: OrgId, folderId: string, dashboardId: string, panelId: string, digest: string) =>
      [...org(o), "panels", "result", folderId, dashboardId, panelId, digest] as const,
  },

  reports: {
    root: (o: OrgId) => [...org(o), "reports"] as const,
    listByFolder: (o: OrgId, folderId: string) => [...org(o), "reports", "list", folderId] as const,
    detail: (o: OrgId, name: string) => [...org(o), "reports", "detail", name] as const,
  },

  pipelines: {
    root: (o: OrgId) => [...org(o), "pipelines"] as const,
    list: (o: OrgId) => [...org(o), "pipelines", "list"] as const,
    detail: (o: OrgId, id: string) => [...org(o), "pipelines", "detail", id] as const,
    history: (o: OrgId, id: string, p: ServerTableParams) =>
      [...org(o), "pipelines", "history", id, p] as const,
  },

  slos: {
    root: (o: OrgId) => [...org(o), "slos"] as const,
    list: (o: OrgId, groupId?: string) => [...org(o), "slos", "list", groupId ?? "all"] as const,
    detail: (o: OrgId, id: string) => [...org(o), "slos", "detail", id] as const,
  },

  synthetics: {
    root: (o: OrgId) => [...org(o), "synthetics"] as const,
    monitors: (o: OrgId, folderId?: string) =>
      [...org(o), "synthetics", "monitors", folderId ?? "all"] as const,
    locations: (o: OrgId) => [...org(o), "synthetics", "locations"] as const,
    runs: (o: OrgId, monitorId: string, p: ServerTableParams) =>
      [...org(o), "synthetics", "runs", monitorId, p] as const,
  },

  workflows: {
    root: (o: OrgId) => [...org(o), "workflows"] as const,
    list: (o: OrgId) => [...org(o), "workflows", "list"] as const,
    runs: (o: OrgId, workflowId: string, p: ServerTableParams) =>
      [...org(o), "workflows", "runs", workflowId, p] as const,
  },

  backfill: {
    root: (o: OrgId) => [...org(o), "backfill"] as const,
    jobs: (o: OrgId) => [...org(o), "backfill", "jobs"] as const,
  },

  iam: {
    root: (o: OrgId) => [...org(o), "iam"] as const,
    users: (o: OrgId) => [...org(o), "iam", "users"] as const,
    invitations: (o: OrgId) => [...org(o), "iam", "invitations"] as const,
    groups: (o: OrgId) => [...org(o), "iam", "groups"] as const,
    roles: (o: OrgId) => [...org(o), "iam", "roles"] as const,
    serviceAccounts: (o: OrgId) => [...org(o), "iam", "serviceAccounts"] as const,
    quota: (o: OrgId) => [...org(o), "iam", "quota"] as const,
  },

  settings: {
    root: (o: OrgId) => [...org(o), "settings"] as const,
    /**
     * One resolved setting. `userId` is part of the key because user-scoped
     * settings (favorites) resolve differently per user, and two users share a
     * browser profile.
     */
    setting: (o: OrgId, key: string, userId?: string) =>
      [...org(o), "settings", "setting", key, userId ?? "__org__"] as const,
    nodes: (o: OrgId) => [...org(o), "settings", "nodes"] as const,
    cipherKeys: (o: OrgId) => [...org(o), "settings", "cipherKeys"] as const,
    regexPatterns: (o: OrgId) => [...org(o), "settings", "regexPatterns"] as const,
    // Org-scoped even though the payload ships with the release: the endpoints are.
    builtInRegexPatterns: (o: OrgId) => [...org(o), "settings", "builtInRegexPatterns"] as const,
    modelPricingBuiltIn: (o: OrgId) => [...org(o), "settings", "modelPricingBuiltIn"] as const,
    modelPricing: (o: OrgId) => [...org(o), "settings", "modelPricing"] as const,
    aiToolsets: (o: OrgId) => [...org(o), "settings", "aiToolsets"] as const,
    domainManagement: (o: OrgId) => [...org(o), "settings", "domainManagement"] as const,
    storage: (o: OrgId) => [...org(o), "settings", "storage"] as const,
  },

  search: {
    root: (o: OrgId) => [...org(o), "search"] as const,
    savedViews: (o: OrgId) => [...org(o), "search", "savedViews"] as const,
    runningQueries: (o: OrgId) => [...org(o), "search", "runningQueries"] as const,
    history: (o: OrgId, p: ServerTableParams) => [...org(o), "search", "history", p] as const,
    promqlSeries: (o: OrgId, range: unknown) =>
      [...org(o), "search", "promqlSeries", range] as const,
  },

  traces: {
    root: (o: OrgId) => [...org(o), "traces"] as const,
    dag: (o: OrgId, traceId: string) => [...org(o), "traces", "dag", traceId] as const,
  },

  sessions: {
    root: (o: OrgId) => [...org(o), "sessions"] as const,
    page: (o: OrgId, p: ServerTableParams) => [...org(o), "sessions", "page", p] as const,
  },
} as const;

export default qk;
