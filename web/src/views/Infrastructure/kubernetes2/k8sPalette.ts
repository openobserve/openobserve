// Copyright 2026 OpenObserve Inc.

import { raw, type I18nKey, type I18nText } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { Inventory, PodRow } from "./kubernetesModel";
import { lensPodStatus } from "./kubernetesModel";
import type { DetailsRef } from "./kubernetesUrlState";
import type { View } from "./kubernetesQueries";
import { VIEW_ICON } from "./k8sTree";

export type PaletteGroup = "goTo" | "attention" | "workloads" | "pods" | "nodes" | "clusters";

export type PaletteTarget =
  | { type: "view"; view: View }
  | { type: "cluster"; cluster: string }
  | { type: "details"; details: DetailsRef };

export interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: I18nText;
  sub: I18nText;
  icon: IconName;
  // Plain text the query is matched against; label and sub may be translated text.
  search: string;
  hot: boolean;
  target: PaletteTarget;
}

export const PALETTE_LIMIT = 12;
const EMPTY_QUERY_GO_TO = 6;

// Result order once a query is typed; matches the prototype.
const GROUP_ORDER: PaletteGroup[] = ["goTo", "attention", "workloads", "pods", "nodes", "clusters"];

const VIEW_ENTRIES: { view: View; label: I18nKey }[] = [
  { view: "cluster", label: "infra.k8s2.paletteClusterOverview" },
  { view: "map", label: "infra.k8s2.viewMap" },
  { view: "nodes", label: "infra.k8s2.viewNodes" },
  { view: "namespaces", label: "infra.k8s2.viewNamespaces" },
  { view: "events", label: "infra.k8s2.viewEvents" },
  { view: "workloads", label: "infra.k8s2.paletteWorkloadsOverview" },
  { view: "pods", label: "infra.k8s2.viewPods" },
  { view: "deployments", label: "infra.k8s2.viewDeployments" },
  { view: "daemonsets", label: "infra.k8s2.viewDaemonSets" },
  { view: "statefulsets", label: "infra.k8s2.viewStatefulSets" },
  { view: "replicasets", label: "infra.k8s2.viewReplicaSets" },
  { view: "jobs", label: "infra.k8s2.viewJobs" },
  { view: "cronjobs", label: "infra.k8s2.viewCronJobs" },
  { view: "pvcs", label: "infra.k8s2.viewPvcs" },
  { view: "hpas", label: "infra.k8s2.viewHpas" },
];

export interface PaletteSource {
  inventory: Inventory;
  clusters: string[];
  activeCluster: string | null;
  t: (key: I18nKey) => I18nText;
}

const isProblemPod = (pod: PodRow) => {
  const status = lensPodStatus(pod);
  return status === "failed" || status === "evicted" || status === "pending";
};

export function buildPaletteItems({
  inventory,
  clusters,
  activeCluster,
  t,
}: PaletteSource): PaletteItem[] {
  const items: PaletteItem[] = [];
  const inCluster = <T extends { cluster: string }>(rows: T[]) =>
    activeCluster == null ? rows : rows.filter((r) => r.cluster === activeCluster);

  for (const entry of VIEW_ENTRIES) {
    const label = t(entry.label);
    items.push({
      id: `view:${entry.view}`,
      group: "goTo",
      label,
      sub: raw(""),
      icon: VIEW_ICON[entry.view],
      search: `${label} ${entry.view}`,
      hot: false,
      target: { type: "view", view: entry.view },
    });
  }

  for (const cluster of clusters) {
    items.push({
      id: `cluster:${cluster}`,
      group: "clusters",
      label: raw(cluster),
      sub: raw(""),
      icon: "cloud",
      search: `switch ${cluster}`,
      hot: false,
      target: { type: "cluster", cluster },
    });
  }

  for (const pod of inCluster(inventory.pods)) {
    const hot = isProblemPod(pod);
    items.push({
      id: pod.key,
      group: hot ? "attention" : "pods",
      label: raw(pod.name),
      sub: raw(pod.namespace),
      icon: "widgets",
      search: `${pod.name} ${pod.namespace} ${lensPodStatus(pod)}`,
      hot,
      target: { type: "details", details: detailsOf(pod) },
    });
  }

  const workloads = [...inventory.deployments, ...inventory.daemonsets, ...inventory.statefulsets];
  for (const workload of inCluster(workloads)) {
    items.push({
      id: workload.key,
      group: "workloads",
      label: raw(workload.name),
      sub: raw(`${workload.kind} · ${workload.namespace}`),
      icon: "layers",
      search: `${workload.name} ${workload.kind} ${workload.namespace}`,
      hot: false,
      target: { type: "details", details: detailsOf(workload) },
    });
  }

  for (const node of inCluster(inventory.nodes)) {
    items.push({
      id: node.key,
      group: "nodes",
      label: raw(node.name),
      sub: raw(""),
      icon: "dns",
      search: node.name,
      hot: false,
      target: { type: "details", details: detailsOf(node) },
    });
  }

  return items;
}

const detailsOf = (row: {
  kind: DetailsRef["kind"];
  cluster: string;
  namespace: string;
  name: string;
}): DetailsRef => ({
  kind: row.kind,
  cluster: row.cluster,
  namespace: row.namespace,
  name: row.name,
});

const identityOf = (item: PaletteItem) => {
  const target = item.target;
  if (target.type !== "details") return item.id;
  const { kind, cluster, namespace, name } = target.details;
  return `${kind}/${cluster}/${namespace}/${name}`;
};

// Primary items win over extras with the same resource identity; extras fill in the rest.
export function mergePaletteItems(primary: PaletteItem[], extra: PaletteItem[]): PaletteItem[] {
  if (!extra.length) return primary;
  const seen = new Set(primary.map(identityOf));
  const out = [...primary];
  for (const item of extra) {
    const identity = identityOf(item);
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push(item);
  }
  return out;
}

// Every whitespace-separated token must appear somewhere in the item's text.
export function searchPalette(
  items: PaletteItem[],
  query: string,
  limit = PALETTE_LIMIT,
): { items: PaletteItem[]; total: number } {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) {
    const goTo = items.filter((i) => i.group === "goTo").slice(0, EMPTY_QUERY_GO_TO);
    const all = [...items.filter((i) => i.hot), ...goTo];
    return { items: all.slice(0, limit), total: all.length };
  }
  const matches = items.filter((item) => {
    const text = `${item.search} ${item.group}`.toLowerCase();
    return tokens.every((token) => text.includes(token));
  });
  // Array.sort is stable, so the inventory order is kept inside a group.
  matches.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  return { items: matches.slice(0, limit), total: matches.length };
}
