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

import { computed, ref, shallowRef, watch, type ComputedRef, type Ref } from "vue";
import { queryClient } from "@/composables/query/queryClient";
import { k8sInstantQuery } from "@/services/kubernetes.queries";
import { raw } from "@/types/i18n";
import type { Series } from "./kubernetesModel";
import type { PaletteItem } from "./k8sPalette";
import type { DetailsRef } from "./kubernetesUrlState";

export const MAX_INDEX_ITEMS = 20000;

const QUERY_ID = "PAL";

const CLUSTER_LABELS = "k8s_cluster, k8s_cluster_name";

type IndexKind = "pod" | "node" | "deployment" | "daemonset" | "statefulset";

interface KindSource {
  kind: IndexKind;
  stream: string;
  labels: string;
  filter?: string;
}

const SOURCES: KindSource[] = [
  {
    kind: "pod",
    stream: "kube_pod_status_phase",
    labels: "namespace, pod, phase",
    filter: " == 1",
  },
  { kind: "node", stream: "kube_node_info", labels: "node" },
  { kind: "deployment", stream: "kube_deployment_spec_replicas", labels: "namespace, deployment" },
  { kind: "daemonset", stream: "kube_daemonset_created", labels: "namespace, daemonset" },
  { kind: "statefulset", stream: "kube_statefulset_created", labels: "namespace, statefulset" },
];

const HOT_PHASES = new Set(["Failed", "Pending"]);

const term = ({ kind, stream, labels, filter = "" }: KindSource) =>
  `label_replace(max by (${CLUSTER_LABELS}, ${labels}) (last_over_time(${stream}[10m])${filter}), "kind", "${kind}", "", "")`;

// Unscoped on purpose: a missing cluster label matches every series on some backends, so the cluster filter runs on the client.
export const paletteIndexQuery = (has: (stream: string) => boolean): string | null => {
  const terms = SOURCES.filter((s) => has(s.stream)).map(term);
  return terms.length ? terms.join(" or ") : null;
};

const clusterOf = (m: Record<string, string>) => m.k8s_cluster || m.k8s_cluster_name || "";

const itemFor = (m: Record<string, string>, kind: IndexKind): PaletteItem | null => {
  const name = m[kind];
  if (!name) return null;
  const cluster = clusterOf(m);
  const namespace = kind === "node" ? "" : (m.namespace ?? "");
  const details: DetailsRef = { kind, cluster, namespace, name };
  const id = `idx:${kind}:${[cluster, namespace, name].map(encodeURIComponent).join("/")}`;
  const target = { type: "details", details } as const;
  if (kind === "pod") {
    const hot = HOT_PHASES.has(m.phase);
    return {
      id,
      group: hot ? "attention" : "pods",
      label: raw(name),
      sub: raw(namespace),
      icon: "widgets",
      search: `${name} ${namespace} ${(m.phase ?? "").toLowerCase()}`,
      hot,
      target,
    };
  }
  if (kind === "node") {
    return {
      id,
      group: "nodes",
      label: raw(name),
      sub: raw(""),
      icon: "dns",
      search: name,
      hot: false,
      target,
    };
  }
  return {
    id,
    group: "workloads",
    label: raw(name),
    sub: raw(`${kind} · ${namespace}`),
    icon: "layers",
    search: `${name} ${kind} ${namespace}`,
    hot: false,
    target,
  };
};

export function indexItemsFromSeries(
  series: Series[],
  cluster: string | null,
  cap = MAX_INDEX_ITEMS,
): { items: PaletteItem[]; truncated: boolean } {
  const items: PaletteItem[] = [];
  for (const { metric } of series) {
    if (cluster != null && clusterOf(metric) !== cluster) continue;
    const kind = metric.kind as IndexKind;
    if (!SOURCES.some((s) => s.kind === kind)) continue;
    if (items.length >= cap) return { items, truncated: true };
    const item = itemFor(metric, kind);
    if (item) items.push(item);
  }
  return { items, truncated: false };
}

export interface PaletteIndexOptions {
  open: Ref<boolean>;
  cluster: Ref<string | null>;
  orgId: Ref<string>;
  refreshNonce: Ref<number>;
  has: (stream: string) => boolean;
}

export function usePaletteIndex(options: PaletteIndexOptions): {
  items: ComputedRef<PaletteItem[]>;
  loading: Ref<boolean>;
  failed: Ref<boolean>;
  truncated: ComputedRef<boolean>;
} {
  const series = shallowRef<Series[]>([]);
  const loading = ref(false);
  const failed = ref(false);
  let generation = 0;

  const built = computed(() => indexItemsFromSeries(series.value, options.cluster.value));
  const items = computed(() => built.value.items);
  const truncated = computed(() => built.value.truncated);

  const load = async () => {
    const gen = ++generation;
    const org = options.orgId.value;
    const text = paletteIndexQuery(options.has);
    if (!org || !text) {
      loading.value = false;
      return;
    }
    loading.value = true;
    failed.value = false;
    try {
      const end = Date.now() * 1000;
      const rows = await queryClient.fetchQuery(k8sInstantQuery(org, QUERY_ID, text, end, true));
      if (gen !== generation) return;
      series.value = rows;
    } catch {
      if (gen !== generation) return;
      failed.value = true;
    } finally {
      if (gen === generation) loading.value = false;
    }
  };

  watch(
    () => options.orgId.value,
    () => {
      series.value = [];
      failed.value = false;
    },
  );

  watch(
    [
      () => options.open.value,
      () => options.orgId.value,
      () => options.refreshNonce.value,
      () => paletteIndexQuery(options.has),
    ],
    ([open]) => {
      if (open) void load();
    },
    { immediate: true },
  );

  return { items, loading, failed, truncated };
}
