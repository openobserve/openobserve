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

import { computed, ref, shallowRef } from "vue";
import useStreams from "@/composables/useStreams";
import { queryClient } from "@/composables/query/queryClient";
import { gt, type I18nKey } from "@/types/i18n";
import { k8sKeys } from "@/services/kubernetes.querykeys";
import { k8sInstantQuery, k8sSqlQuery } from "@/services/kubernetes.queries";
import {
  CLUSTER_QUERIES,
  DETECTION_STREAMS,
  EVENTS_STREAM,
  KIND_INFO,
  MAP_ANCHOR,
  POD_ANCHOR,
  QUERY_STREAM,
  SPARSE_STREAMS,
  VIEW_ANCHORS,
  VIEW_QUERIES,
  DETAIL_WITH_PODS,
  detailQueries,
  escapeLabel,
  familyOf,
  mapQueries,
  queryText,
  type ClusterMatchers,
  type DetailKind,
  type QueryId,
  type View,
} from "./kubernetesQueries";
import {
  attachWarningEvents,
  buildInventory,
  clusterLabelOf,
  findRow,
  rowKey,
  type AnyRow,
  type QueryResults,
  type Series,
  type WarningEvent,
} from "./kubernetesModel";
import {
  clusterFallbackSql,
  detailEventsSql,
  eventsSql,
  parseEvents,
  parseWarnings,
  warningSql,
  type EventRow,
} from "./kubernetesEvents";
import {
  LIST_OBJECT_KINDS,
  joinObjects,
  objectDetailSql,
  objectListSql,
  parseObjects,
} from "./kubernetesObjects";
import type { K8sUrlState } from "./kubernetesUrlState";

export type Detection = "unknown" | "error" | "undetected" | "detected";

export interface K8sTime {
  start: number;
  end: number;
  relative: boolean;
}

export interface K8sBanner {
  id: string;
  key: I18nKey;
  params?: Record<string, string>;
  variant: "warning" | "info";
}

interface SqlRequest {
  name: string;
  sql: string;
  start: number;
  end: number;
  size?: number;
}

interface Settled {
  results: QueryResults;
  sql: Map<string, any[]>;
  failed: Map<string, number | null>;
  firstError: string | null;
  updatedAt: number;
}

const HOUR_US = 3_600_000_000;
const DAY_US = 24 * HOUR_US;
const W_SIZE = 20001;
const EVENTS_LIMIT = 1000;
const RECENT_EVENTS_LIMIT = 10;

const LIST_VIEW_KIND = Object.fromEntries(
  (Object.keys(KIND_INFO) as DetailKind[]).map((kind) => [KIND_INFO[kind].view, kind]),
) as Partial<Record<View, DetailKind>>;

const statusOf = (reason: any): number | null => reason?.response?.status ?? reason?.status ?? null;

export function useKubernetesInventory(
  state: () => K8sUrlState,
  time: () => K8sTime,
  orgId: () => string,
) {
  const { getStreams, getStream } = useStreams(gt);

  const metricStreams = ref<Set<string> | null>(null);
  const logStreams = ref<Set<string> | null>(null);
  const eventsScoped = ref(false);
  const streamsError = ref(false);
  const clusterResults = shallowRef<QueryResults>(new Map());
  const fallbackClusters = ref<string[]>([]);
  const results = shallowRef<QueryResults>(new Map());
  const sql = shallowRef<Map<string, any[]>>(new Map());
  const failed = shallowRef<Map<string, number | null>>(new Map());
  const pageError = ref<string | null>(null);
  const loading = ref(false);
  const loaded = ref(false);
  const detailLoading = ref(false);
  const lastUpdatedAt = ref<number | null>(null);
  const refreshNonce = ref(0);
  // What the last load was for, so derived values read the time and cluster their data belongs to.
  const loadedFor = shallowRef<{ cluster: string | null; end: number } | null>(null);

  // metrics_query and search take no AbortSignal, so superseded responses are dropped by generation.
  let generation = 0;
  let streamsGeneration = 0;

  const has = (stream: string) => metricStreams.value?.has(stream) ?? false;
  const hasEvents = computed(() => logStreams.value?.has(EVENTS_STREAM) ?? false);
  const metricsDetected = computed(() => DETECTION_STREAMS.some((s) => has(s)));

  const detection = computed<Detection>(() => {
    if (streamsError.value) return "error";
    if (!metricStreams.value || !logStreams.value) return "unknown";
    return metricsDetected.value || hasEvents.value ? "detected" : "undetected";
  });

  const metricClusters = computed(() => {
    const all = new Set<string>();
    for (const series of clusterResults.value.values()) {
      for (const s of series) {
        const c = s.metric.k8s_cluster || s.metric.k8s_cluster_name;
        if (c) all.add(c);
      }
    }
    return [...all].sort((a, b) => a.localeCompare(b));
  });

  const clusters = computed(() =>
    metricClusters.value.length ? metricClusters.value : fallbackClusters.value,
  );

  const effectiveCluster = computed(() => state().cluster ?? clusters.value[0] ?? null);

  // Without a cluster label an event's object may live in another cluster, unless only one exists.
  const eventLinksEnabled = computed(() => eventsScoped.value || metricClusters.value.length === 1);

  const gate = (id: QueryId): "send" | "empty" | "absent" => {
    if (/^P\d+$/.test(id) && !has(POD_ANCHOR)) return "absent";
    if (has(QUERY_STREAM[id])) return "send";
    return SPARSE_STREAMS.has(QUERY_STREAM[id]) ? "empty" : "absent";
  };

  const anchorMissing = (view: View): string | null => {
    if (view === "events") return hasEvents.value ? null : EVENTS_STREAM;
    const s = state();
    const anchors = view === "map" ? [MAP_ANCHOR[s.entity]] : VIEW_ANCHORS[view];
    if (!anchors || anchors.some((a) => has(a))) return null;
    return anchors[0];
  };

  const viewIds = (s: K8sUrlState): QueryId[] => {
    if (anchorMissing(s.view)) return [];
    return s.view === "map" ? mapQueries(s.entity, s.group) : [...VIEW_QUERIES[s.view]];
  };

  const neededIds = (s: K8sUrlState): QueryId[] => {
    const ids = new Set<QueryId>([...viewIds(s), "NS1"]);
    if (s.details) for (const id of detailQueries(s.details.kind)) ids.add(id);
    return [...ids];
  };

  const loadStreams = async ({ force = false }: { force?: boolean } = {}) => {
    const gen = ++streamsGeneration;
    try {
      const [metrics, logs]: any[] = await Promise.all([
        getStreams("metrics", false, false, force),
        getStreams("logs", false, false, force),
      ]);
      const logNames = new Set(((logs?.list ?? []) as Array<{ name: string }>).map((s) => s.name));
      let scoped = false;
      if (logNames.has(EVENTS_STREAM)) {
        const schema: any = await getStream(EVENTS_STREAM, "logs", true).catch(() => null);
        scoped = ((schema?.schema ?? []) as Array<{ name: string }>).some(
          (f) => f.name === "k8s_cluster",
        );
      }
      if (gen !== streamsGeneration) return;
      metricStreams.value = new Set(
        ((metrics?.list ?? []) as Array<{ name: string }>).map((s) => s.name),
      );
      logStreams.value = logNames;
      eventsScoped.value = scoped;
      streamsError.value = false;
    } catch {
      if (gen !== streamsGeneration) return;
      metricStreams.value = null;
      logStreams.value = null;
      streamsError.value = true;
    }
  };

  // An org switch must never query or render with the previous org's streams or rows.
  const reset = () => {
    generation++;
    streamsGeneration++;
    metricStreams.value = null;
    logStreams.value = null;
    eventsScoped.value = false;
    streamsError.value = false;
    clusterResults.value = new Map();
    fallbackClusters.value = [];
    results.value = new Map();
    sql.value = new Map();
    failed.value = new Map();
    pageError.value = null;
    loading.value = false;
    loaded.value = false;
    detailLoading.value = false;
    loadedFor.value = null;
  };

  const instant = (org: string, t: K8sTime, id: QueryId, matchers: ClusterMatchers | null) =>
    queryClient.fetchQuery(k8sInstantQuery(org, id, queryText(id, matchers), t.end, t.relative));

  const sqlRead = (org: string, t: K8sTime, r: SqlRequest) =>
    queryClient.fetchQuery(k8sSqlQuery(org, r.name, r.sql, r.start, r.end, t.relative, r.size));

  const settle = async (
    org: string,
    t: K8sTime,
    ids: QueryId[],
    matchers: ClusterMatchers | null,
    requests: SqlRequest[],
  ): Promise<Settled> => {
    const send = ids.filter((id) => gate(id) === "send");
    const settled = await Promise.allSettled([
      ...send.map((id) => instant(org, t, id, matchers)),
      ...requests.map((r) => sqlRead(org, t, r)),
    ]);
    const out: Settled = {
      results: new Map(),
      sql: new Map(),
      failed: new Map(),
      firstError: null,
      updatedAt: Date.now(),
    };
    for (const id of ids) if (gate(id) === "empty") out.results.set(id, []);
    settled.forEach((outcome, i) => {
      const name = i < send.length ? send[i] : requests[i - send.length].name;
      if (outcome.status === "rejected") {
        out.failed.set(name, statusOf(outcome.reason));
        out.firstError ??= outcome.reason?.message ?? String(outcome.reason);
      } else if (i < send.length) out.results.set(send[i], outcome.value as Series[]);
      else out.sql.set(name, outcome.value as any[]);
    });
    return out;
  };

  const matchersFor = (cluster: string | null, cl: QueryResults): ClusterMatchers => {
    const pick = (ids: QueryId[]) => {
      let label: string | null = null;
      for (const id of ids) {
        for (const s of cl.get(id) ?? []) {
          // An unlabelled family is fetched for every cluster and filtered here instead.
          if (!clusterLabelOf(s.metric)) return null;
          if ((s.metric.k8s_cluster || s.metric.k8s_cluster_name) === cluster) {
            label = label ?? clusterLabelOf(s.metric);
          }
        }
      }
      return label && cluster ? `${label}="${escapeLabel(cluster)}"` : null;
    };
    return { ksm: pick(["CL1N", "CL1P", "CL1D"]), kubelet: pick(["CL2N", "CL2P"]) };
  };

  const sqlRequests = (s: K8sUrlState, t: K8sTime, cluster: string | null): SqlRequest[] => {
    if (!hasEvents.value) return [];
    const out: SqlRequest[] = [];
    const window = { start: t.start, end: t.end };
    const hour = { start: t.end - HOUR_US, end: t.end };
    const day = { start: t.end - DAY_US, end: t.end };
    if (!eventsScoped.value) {
      if (s.view === "events") {
        out.push({
          name: "E",
          sql: eventsSql({ cluster: null, namespaces: s.namespaces }, EVENTS_LIMIT),
          ...window,
        });
      }
      return out;
    }
    if (!cluster) return out;
    const scope = { cluster, namespaces: s.namespaces };
    const warn = (kind: DetailKind | null) => {
      const info = kind ? KIND_INFO[kind] : null;
      out.push({
        name: `W:${info?.kind ?? "*"}`,
        sql: warningSql(scope, info?.kind ?? null, !!info?.namespaced),
        ...hour,
        size: W_SIZE,
      });
    };
    const objects = (kind: DetailKind) => {
      if (LIST_OBJECT_KINDS.includes(kind)) {
        out.push({ name: `O:${kind}`, sql: objectListSql(kind, cluster, s.namespaces), ...day });
      }
    };
    const viewKind = LIST_VIEW_KIND[s.view];
    if (!anchorMissing(s.view)) {
      if (s.view === "cluster") warn(null);
      if (s.view === "map") warn(s.entity === "nodes" ? "node" : "pod");
      if (viewKind) {
        warn(viewKind);
        objects(viewKind);
      }
    }
    if (s.view === "events") {
      out.push({ name: "E", sql: eventsSql(scope, EVENTS_LIMIT), ...window });
    }
    if (s.view === "workloads") {
      out.push({ name: "E", sql: eventsSql(scope, RECENT_EVENTS_LIMIT), ...window });
    }
    if (s.details) {
      const kind = s.details.kind;
      warn(kind);
      if (DETAIL_WITH_PODS.has(kind)) warn("pod");
    }
    return dedupe(out);
  };

  const detailRequests = (
    s: K8sUrlState,
    t: K8sTime,
    cluster: string | null,
    row: AnyRow | null,
    phase: "object" | "events",
  ): SqlRequest[] => {
    const d = s.details;
    if (!d || !hasEvents.value || !eventsScoped.value || !cluster) return [];
    if (phase === "object") {
      if (d.kind === "pod" && !row?.uid) return [];
      return [
        {
          name: "O1obj",
          sql: objectDetailSql(d.kind, cluster, { ...d, uid: row?.uid ?? null }),
          start: t.end - DAY_US,
          end: t.end,
        },
      ];
    }
    return [
      {
        name: "DE",
        sql: detailEventsSql(cluster, { ...d, uid: row?.uid ?? null }),
        start: t.start,
        end: t.end,
      },
    ];
  };

  const load = async ({ force = false }: { force?: boolean } = {}) => {
    if (detection.value !== "detected") return;
    const gen = ++generation;
    const org = orgId();
    const t = time();
    const s = state();
    loading.value = true;
    detailLoading.value = !!s.details;
    if (force) {
      await queryClient.invalidateQueries({ queryKey: k8sKeys.all(org), refetchType: "none" });
      refreshNonce.value++;
    }
    const cl = await settle(
      org,
      t,
      CLUSTER_QUERIES.filter((id) => has(QUERY_STREAM[id])),
      null,
      [],
    );
    if (gen !== generation) return;
    clusterResults.value = cl.results;
    const listed = metricClusters.value;
    if (!listed.length && hasEvents.value && eventsScoped.value) {
      const fb = await settle(org, t, [], null, [
        { name: "CLF", sql: clusterFallbackSql(), start: t.end - DAY_US, end: t.end },
      ]);
      if (gen !== generation) return;
      fallbackClusters.value = [
        ...new Set((fb.sql.get("CLF") ?? []).map((h: any) => String(h.c ?? "")).filter(Boolean)),
      ].sort((a, b) => a.localeCompare(b));
    }
    const cluster = s.cluster ?? clusters.value[0] ?? null;
    const main = await settle(
      org,
      t,
      neededIds(s),
      matchersFor(cluster, cl.results),
      sqlRequests(s, t, cluster),
    );
    if (gen !== generation) return;
    const sent = [...main.results.keys(), ...main.sql.keys(), ...main.failed.keys()];
    const allRejected = main.failed.size > 0 && main.failed.size === sent.length;
    if (allRejected) {
      pageError.value = main.firstError;
      results.value = new Map();
      sql.value = new Map();
      failed.value = new Map();
      loading.value = false;
      detailLoading.value = false;
      return;
    }
    commit(main, cluster, t);
    const detail = s.details;
    if (detail) {
      const row = findRow(
        inventory.value,
        detail.kind,
        rowKey(detail.kind, detail.cluster, detail.namespace, detail.name),
      );
      const obj = await settle(org, t, [], null, detailRequests(s, t, cluster, row, "object"));
      if (gen !== generation) return;
      mergeSql(obj);
      const enriched = findRow(
        inventory.value,
        detail.kind,
        rowKey(detail.kind, detail.cluster, detail.namespace, detail.name),
      );
      const events = await settle(
        org,
        t,
        [],
        null,
        detailRequests(s, t, cluster, enriched, "events"),
      );
      if (gen !== generation) return;
      mergeSql(events);
    }
    detailLoading.value = false;
  };

  const commit = (main: Settled, cluster: string | null, t: K8sTime) => {
    pageError.value = null;
    results.value = main.results;
    sql.value = main.sql;
    failed.value = main.failed;
    loadedFor.value = { cluster, end: t.end };
    lastUpdatedAt.value = main.updatedAt;
    loading.value = false;
    loaded.value = true;
  };

  const mergeSql = (extra: Settled) => {
    sql.value = new Map([...sql.value, ...extra.sql]);
    if (extra.failed.size) failed.value = new Map([...failed.value, ...extra.failed]);
  };

  const warnings = computed(() => {
    const cluster = loadedFor.value?.cluster ?? "";
    const end = loadedFor.value?.end ?? 0;
    const seen = new Map<string, WarningEvent>();
    let truncated = false;
    for (const [name, hits] of sql.value) {
      if (!name.startsWith("W:")) continue;
      const parsed = parseWarnings(hits, cluster);
      truncated ||= parsed.truncated;
      for (const row of parsed.rows) {
        // The hour is the window W asked for; anything older is not current trouble.
        if (row.lastSeen < end - HOUR_US) continue;
        seen.set(`${row.kind}|${row.namespace}|${row.name}|${row.uid}`, row);
      }
    }
    return { rows: [...seen.values()], truncated };
  });

  const inventory = computed(() => {
    const inv = buildInventory(results.value);
    const cluster = loadedFor.value?.cluster ?? "";
    for (const [name, hits] of sql.value) {
      if (name.startsWith("O:"))
        joinObjects(inv, name.slice(2) as DetailKind, cluster, parseObjects(hits));
    }
    const detail = state().details;
    const one = sql.value.get("O1obj");
    if (detail && one) joinObjects(inv, detail.kind, cluster, parseObjects(one));
    attachWarningEvents(inv, warnings.value.rows);
    return inv;
  });

  const events = computed<EventRow[]>(() => parseEvents(sql.value.get("E") ?? []));

  const eventsCapped = computed(() => (sql.value.get("E") ?? []).length >= EVENTS_LIMIT);

  const detailEvents = computed<EventRow[] | null>(() => {
    const hits = sql.value.get("DE");
    return hits ? parseEvents(hits) : null;
  });

  const detailObserved = computed(() => (sql.value.get("O1obj") ?? []).length > 0);

  const namespaceOptions = computed(() => {
    const names = new Set(state().namespaces);
    for (const row of inventory.value.namespaces) {
      if (row.cluster === effectiveCluster.value) names.add(row.name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  });

  const forbidden = computed(() => {
    const s = state();
    const anchors = s.view === "map" ? [MAP_ANCHOR[s.entity]] : (VIEW_ANCHORS[s.view] ?? []);
    for (const [name, status] of failed.value) {
      if (status !== 403) continue;
      if (name === "E" && s.view === "events") return true;
      if (anchors.includes(QUERY_STREAM[name as QueryId])) return true;
    }
    return false;
  });

  const banners = computed<K8sBanner[]>(() => {
    if (!metricStreams.value) return [];
    const s = state();
    const out: K8sBanner[] = [];
    for (const id of viewIds(s)) {
      if (familyOf(id) === "kubeletstats" && !has(QUERY_STREAM[id])) {
        out.push({
          id: `usage-${QUERY_STREAM[id]}`,
          key: "infra.k8s2.usageMissing",
          params: { stream: QUERY_STREAM[id] },
          variant: "warning",
        });
      }
    }
    for (const family of inventory.value.unlabelledFamilies) {
      out.push({
        id: `no-cluster-${family}`,
        key: "infra.k8s2.noClusterLabelScoped",
        params: { family },
        variant: "warning",
      });
    }
    if (failed.value.size > 0) {
      out.push({ id: "partial-failure", key: "infra.k8s2.partialFailure", variant: "warning" });
    }
    if (warnings.value.truncated) {
      out.push({
        id: "warnings-truncated",
        key: "infra.k8s2.warningsIncomplete",
        variant: "warning",
      });
    }
    const kind = LIST_VIEW_KIND[s.view];
    const objects = kind ? sql.value.get(`O:${kind}`) : undefined;
    if (objects && parseObjects(objects).every((r) => r.deleted)) {
      out.push({
        id: "objects-not-observed",
        key: "infra.k8s2.objectsNotObserved",
        variant: "info",
      });
    }
    return [...new Map(out.map((b) => [b.id, b])).values()];
  });

  return {
    detection,
    metricsDetected,
    hasEvents,
    eventsScoped,
    eventLinksEnabled,
    loading,
    loaded,
    detailLoading,
    pageError,
    lastUpdatedAt,
    refreshNonce,
    results,
    failed,
    forbidden,
    clusters,
    metricClusters,
    effectiveCluster,
    inventory,
    warnings,
    events,
    eventsCapped,
    detailEvents,
    detailObserved,
    namespaceOptions,
    banners,
    has,
    anchorMissing,
    loadStreams,
    load,
    reset,
  };
}

function dedupe(requests: SqlRequest[]): SqlRequest[] {
  return [...new Map(requests.map((r) => [r.name, r])).values()];
}
