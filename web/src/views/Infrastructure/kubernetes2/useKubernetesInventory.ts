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
import searchService from "@/services/search";
import useStreams from "@/composables/useStreams";
import { gt, type I18nKey } from "@/types/i18n";
import {
  ALWAYS_QUERIES,
  DETECTION_STREAMS,
  ISSUE_INPUTS,
  KSM_ANCHOR,
  OPTIONAL_STREAMS,
  QUERY_FAMILY,
  QUERY_STREAM,
  SPARSE_STREAMS,
  TAB_QUERIES,
  queryText,
  rangeSeconds,
  type K8sKind,
  type QueryId,
} from "./kubernetesQueries";
import {
  buildInventory,
  filterRows,
  inScope,
  issueCounts,
  parseVector,
  sortRows,
  type DeploymentRow,
  type NodeRow,
  type PodRow,
  type QueryResults,
} from "./kubernetesModel";
import type { K8sListState } from "./kubernetesUrlState";

export type Detection = "unknown" | "error" | "undetected" | "detected";

export interface K8sBanner {
  id: string;
  // null = shown on every tab.
  kind: K8sKind | null;
  key: I18nKey;
  params?: Record<string, string>;
}

export interface K8sRefreshArgs {
  orgId: string;
  start: number;
  end: number;
  kind: K8sKind;
}

export interface FacetValue {
  value: string;
  count: number;
}

type AnyRow = PodRow | NodeRow | DeploymentRow;

type SortValue = (row: any) => string | number | null;

const PAGE_SIZE = 50;

const USAGE_QUERY_KIND: Partial<Record<QueryId, K8sKind>> = {
  K1: "pods",
  K2: "pods",
  K3: "nodes",
  K4: "nodes",
};

const SORT_VALUES: Record<K8sKind, Record<string, SortValue>> = {
  pods: {
    name: (r: PodRow) => r.name,
    namespace: (r: PodRow) => r.namespace,
    cluster: (r: PodRow) => r.cluster,
    status: (r: PodRow) => r.status?.text ?? null,
    owner: (r: PodRow) => (r.owner ? `${r.owner.kind}/${r.owner.name}` : null),
    node: (r: PodRow) => r.node,
    restarts: (r: PodRow) => r.restarts,
    cpu: (r: PodRow) => r.cpuPctOfRequest,
    memory: (r: PodRow) => r.memoryPctOfLimit,
  },
  nodes: {
    name: (r: NodeRow) => r.name,
    cluster: (r: NodeRow) => r.cluster,
    status: (r: NodeRow) => r.status?.text ?? null,
    pods: (r: NodeRow) => r.pods,
    cpu: (r: NodeRow) => r.cpuPct,
    memory: (r: NodeRow) => r.memoryPct,
  },
  deployments: {
    name: (r: DeploymentRow) => r.name,
    namespace: (r: DeploymentRow) => r.namespace,
    cluster: (r: DeploymentRow) => r.cluster,
    available: (r: DeploymentRow) => r.available,
    status: (r: DeploymentRow) => r.status?.state ?? null,
    pods: (r: DeploymentRow) => r.pods,
  },
};

const countBy = (rows: AnyRow[], value: (row: AnyRow) => string): FacetValue[] => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = value(row);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([v, count]) => ({ value: v, count }));
};

export function useKubernetesInventory(listState: () => K8sListState) {
  const { getStreams } = useStreams(gt);

  const streams = ref<Set<string> | null>(null);
  const streamsError = ref(false);
  const results = shallowRef<QueryResults>(new Map());
  const failed = shallowRef<Set<QueryId>>(new Set());
  const pageError = ref<string | null>(null);
  const loading = ref(false);

  // metrics_query takes no AbortSignal, so superseded responses are dropped by generation.
  let generation = 0;

  const loadStreams = async ({ force = false }: { force?: boolean } = {}) => {
    try {
      const res: any = await getStreams("metrics", false, false, force);
      streams.value = new Set(((res?.list ?? []) as Array<{ name: string }>).map((s) => s.name));
      streamsError.value = false;
    } catch {
      streams.value = null;
      streamsError.value = true;
    }
  };

  const detection = computed<Detection>(() => {
    if (streamsError.value) return "error";
    if (!streams.value) return "unknown";
    const names = streams.value;
    return DETECTION_STREAMS.some((s) => names.has(s)) ? "detected" : "undetected";
  });

  const has = (stream: string) => streams.value?.has(stream) ?? false;

  // "send" = query it; "empty" = a sparse stream absent under its anchor; "absent" = leave unavailable.
  const gate = (id: QueryId): "send" | "empty" | "absent" => {
    const family = QUERY_FAMILY[id];
    if (family && !has(KSM_ANCHOR[family])) return "absent";
    if (has(QUERY_STREAM[id])) return "send";
    return SPARSE_STREAMS.has(QUERY_STREAM[id]) ? "empty" : "absent";
  };

  const refresh = async ({ orgId, start, end, kind }: K8sRefreshArgs) => {
    const gen = ++generation;
    const ids = [...new Set([...ALWAYS_QUERIES, ...TAB_QUERIES[kind]])];
    const send = ids.filter((id) => gate(id) === "send");
    const seconds = rangeSeconds(start, end);
    loading.value = true;
    const settled = await Promise.allSettled(
      send.map((id) =>
        searchService.metrics_query({
          org_identifier: orgId,
          // metrics_query interpolates the query raw into the URL.
          query: encodeURIComponent(queryText(id, seconds)),
          end_time: end,
        }),
      ),
    );
    if (gen !== generation) return;
    loading.value = false;
    const next: QueryResults = new Map();
    for (const id of ids) if (gate(id) === "empty") next.set(id, []);
    const rejected = new Set<QueryId>();
    settled.forEach((outcome, i) => {
      if (outcome.status === "fulfilled") next.set(send[i], parseVector(outcome.value));
      else rejected.add(send[i]);
    });
    if (send.length > 0 && rejected.size === send.length) {
      const reason = (settled[0] as PromiseRejectedResult).reason;
      pageError.value = reason?.message ?? String(reason);
      results.value = new Map();
      failed.value = new Set();
      return;
    }
    pageError.value = null;
    results.value = next;
    failed.value = rejected;
  };

  const inventory = computed(() => buildInventory(results.value));

  const clusters = computed(() => {
    const all = new Set<string>();
    const { pods, nodes, deployments } = inventory.value;
    for (const row of [...pods, ...nodes, ...deployments]) if (row.cluster) all.add(row.cluster);
    return [...all].sort((a, b) => a.localeCompare(b));
  });

  // The cluster the facets filter on; null = every cluster.
  const effectiveCluster = computed(() => {
    const param = listState().cluster;
    if (param === "*") return null;
    if (param) return param;
    return clusters.value.length > 1 ? clusters.value[0] : null;
  });

  // What the header chip names: a lone cluster is still a single-cluster scope.
  const scopeCluster = computed(
    () =>
      effectiveCluster.value ??
      (listState().cluster !== "*" && clusters.value.length === 1 ? clusters.value[0] : null),
  );

  const scope = computed(() => ({
    cluster: effectiveCluster.value,
    namespace: listState().namespace,
  }));

  const issueVisible = (key: keyof typeof ISSUE_INPUTS) =>
    ISSUE_INPUTS[key].every((id) => results.value.has(id));

  const counts = computed(() => issueCounts(inventory.value, scope.value, issueVisible));

  const kindRows = computed<AnyRow[]>(() => inventory.value[listState().kind]);

  const scopedCount = computed(
    () => kindRows.value.filter((row) => inScope(listState().kind, row, scope.value)).length,
  );

  const clusterFacet = computed(() => countBy(kindRows.value, (row) => row.cluster));

  const namespaceFacet = computed(() => {
    const kind = listState().kind;
    if (kind === "nodes") return [];
    const scoped = kindRows.value.filter((row) =>
      inScope(kind, row, { cluster: effectiveCluster.value, namespace: null }),
    );
    return countBy(scoped, (row) => (row as PodRow | DeploymentRow).namespace);
  });

  const rows = computed<AnyRow[]>(() => {
    const state = listState();
    const filtered = filterRows(state.kind, kindRows.value, {
      scope: scope.value,
      issue: state.issue,
      name: state.name,
      onNode: state.onNode,
      workload: state.workload,
    });
    const value = SORT_VALUES[state.kind][state.sort ?? "name"] ?? SORT_VALUES[state.kind].name;
    return sortRows(filtered, value, state.desc);
  });

  const page = computed(() =>
    Math.min(listState().page, Math.max(1, Math.ceil(rows.value.length / PAGE_SIZE))),
  );

  const pagedRows = computed(() =>
    rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
  );

  const banners = computed<K8sBanner[]>(() => {
    if (!streams.value) return [];
    const out: K8sBanner[] = [];
    for (const kind of Object.keys(KSM_ANCHOR) as K8sKind[]) {
      if (!has(KSM_ANCHOR[kind])) {
        out.push({
          id: `anchor-${kind}`,
          kind,
          key: "infra.k8s2.anchorMissing",
          params: { stream: KSM_ANCHOR[kind] },
        });
      }
    }
    for (const [id, kind] of Object.entries(USAGE_QUERY_KIND) as [QueryId, K8sKind][]) {
      if (!has(QUERY_STREAM[id])) {
        out.push({
          id: `usage-${id}`,
          kind,
          key: "infra.k8s2.usageMissing",
          params: { stream: QUERY_STREAM[id] },
        });
      }
    }
    const [optional] = [...OPTIONAL_STREAMS];
    if (has(KSM_ANCHOR.pods) && !has(optional)) {
      out.push({
        id: "oom-stream",
        kind: "pods",
        key: "infra.k8s2.oomNeedsStream",
        params: { stream: optional },
      });
    }
    for (const family of inventory.value.unlabelledFamilies) {
      out.push({
        id: `no-cluster-${family}`,
        kind: null,
        key: "infra.k8s2.noClusterLabel",
        params: { family },
      });
    }
    if (failed.value.size > 0) {
      out.push({ id: "partial-failure", kind: null, key: "infra.k8s2.partialFailure" });
    }
    return out;
  });

  const podByKey = (key: string) => inventory.value.pods.find((pod) => pod.key === key) ?? null;

  const podUsageStreams = computed(() => ({
    cpu: has(QUERY_STREAM.K1),
    memory: has(QUERY_STREAM.K2),
  }));

  return {
    detection,
    loading,
    pageError,
    inventory,
    clusters,
    effectiveCluster,
    scopeCluster,
    scopedCount,
    counts,
    clusterFacet,
    namespaceFacet,
    rows,
    page,
    pagedRows,
    banners,
    podByKey,
    podUsageStreams,
    loadStreams,
    refresh,
  };
}
