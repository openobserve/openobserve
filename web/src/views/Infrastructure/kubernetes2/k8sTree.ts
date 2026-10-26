// Copyright 2026 OpenObserve Inc.

import type { I18nKey } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import {
  clusterLabelOf,
  isProblemPod,
  type AnyRow,
  type Inventory,
  type NodeRow,
  type QueryResults,
} from "./kubernetesModel";
import { CLUSTER_QUERIES, type ClusterStat, type View } from "./kubernetesQueries";

export type ClusterStats = Partial<Record<ClusterStat, number>>;

export interface TreeItem {
  view: View;
  label: I18nKey;
  icon: IconName;
  // null while nothing is known, so the tree shows nothing rather than a false 0.
  count: number | null;
  bad: number;
}

export interface TreeGroup {
  id: "cluster" | "workloads" | "storage" | "autoscaling";
  label: I18nKey;
  items: TreeItem[];
}

export const VIEW_ICON: Record<View, IconName> = {
  cluster: "dashboard",
  map: "hub",
  nodes: "dns",
  namespaces: "folder-outline",
  events: "event",
  workloads: "dashboard",
  pods: "widgets",
  deployments: "layers",
  daemonsets: "workspaces",
  statefulsets: "database",
  replicasets: "list",
  jobs: "bolt",
  cronjobs: "schedule",
  pvcs: "storage",
  hpas: "speed",
};

export interface TreeSource {
  inventory: Inventory;
  cluster: string | null;
  // Event rows are loaded only by their own views, so the caller says how many it knows of.
  events: { total: number | null; warnings: number };
  stats?: ClusterStats | null;
}

const inCluster = <T extends { cluster: string }>(rows: T[], cluster: string | null) =>
  cluster == null ? rows : rows.filter((row) => row.cluster === cluster);

const nodeIsBad = (node: NodeRow) => node.ready !== "true";

// Judged from the object's own counts: a controller's pods are not loaded outside the pod views.
export function rowIsBad(row: AnyRow): boolean {
  switch (row.kind) {
    case "pod":
      return isProblemPod(row);
    case "node":
      return nodeIsBad(row);
    case "deployment":
      return (
        (row.unavailable ?? 0) > 0 || (row.desired != null && (row.available ?? 0) < row.desired)
      );
    case "daemonset":
    case "replicaset":
      return (row.desired ?? 0) > 0 && (row.ready ?? 0) < (row.desired ?? 0);
    case "statefulset":
      return (row.replicas ?? 0) > 0 && (row.ready ?? 0) < (row.replicas ?? 0);
    case "job":
      return !row.complete && (row.failed ?? 0) > 0;
    case "pvc":
      return row.phase != null && row.phase !== "Bound";
    case "hpa":
      return row.conditions.some((c) => c.condition === "ScalingLimited" && c.status === "True");
    case "namespace":
      return row.phase != null && row.phase !== "Active";
    default:
      return false;
  }
}

// Series of the CST query: one per cluster and stat, labelled with `stat`.
export function clusterStatsOf(results: QueryResults, cluster: string | null): ClusterStats | null {
  const out: ClusterStats = {};
  let found = false;
  for (const series of results.get("CST") ?? []) {
    const label = clusterLabelOf(series.metric);
    if (cluster != null && (label ? series.metric[label] : "") !== cluster) continue;
    const stat = series.metric.stat as ClusterStat | undefined;
    if (!stat) continue;
    out[stat] = (out[stat] ?? 0) + series.value;
    found = true;
  }
  return found ? out : null;
}

// True for a null cluster; otherwise whether any cross-cluster series names it, whatever the label spelling.
export function clusterSeen(results: QueryResults, cluster: string | null): boolean {
  if (cluster == null) return true;
  for (const id of CLUSTER_QUERIES) {
    for (const series of results.get(id) ?? []) {
      const label = clusterLabelOf(series.metric);
      if (label && series.metric[label] === cluster) return true;
    }
  }
  return false;
}

type CountedKey = Exclude<keyof Inventory, "unlabelledFamilies">;

const STAT_OF: Partial<Record<CountedKey, ClusterStat>> = {
  nodes: "nodes",
  pods: "pods",
  namespaces: "namespaces",
  deployments: "deployments",
  daemonsets: "daemonsets",
  statefulsets: "statefulsets",
  replicasets: "replicasets",
  jobs: "jobs",
  cronjobs: "cronjobs",
  pvcs: "pvcs",
  hpas: "hpas",
};

const BAD_STAT_OF: Partial<Record<CountedKey, ClusterStat>> = {
  nodes: "nodesBad",
  pods: "podsBad",
  deployments: "deploymentsBad",
  daemonsets: "daemonsetsBad",
  statefulsets: "statefulsetsBad",
  replicasets: "replicasetsBad",
  jobs: "jobsBad",
  pvcs: "pvcsBad",
  hpas: "hpasBad",
};

export function buildTree({ inventory, cluster, events, stats }: TreeSource): TreeGroup[] {
  const item = (view: View, label: I18nKey, key: CountedKey | null): TreeItem => {
    const icon = VIEW_ICON[view];
    if (key == null) return { view, label, icon, count: null, bad: 0 };
    const rows = inCluster(inventory[key] as AnyRow[], cluster);
    const total = STAT_OF[key] ? stats?.[STAT_OF[key]!] : undefined;
    const badStat = BAD_STAT_OF[key] ? stats?.[BAD_STAT_OF[key]!] : undefined;
    // CST emits no series for an empty kind, so a missing stat beside present stats is a real 0.
    const known = stats != null && STAT_OF[key] != null;
    return {
      view,
      label,
      icon,
      count: total ?? (known ? rows.length : rows.length || null),
      bad: badStat ?? rows.filter(rowIsBad).length,
    };
  };

  return [
    {
      id: "cluster",
      label: "infra.k8s2.groupCluster",
      items: [
        item("cluster", "infra.k8s2.treeOverview", null),
        item("map", "infra.k8s2.viewMap", null),
        item("nodes", "infra.k8s2.viewNodes", "nodes"),
        item("namespaces", "infra.k8s2.viewNamespaces", "namespaces"),
        {
          view: "events",
          label: "infra.k8s2.viewEvents",
          icon: VIEW_ICON.events,
          count: events.total,
          bad: events.warnings,
        },
      ],
    },
    {
      id: "workloads",
      label: "infra.k8s2.groupWorkloads",
      items: [
        item("workloads", "infra.k8s2.treeWorkloadsOverview", null),
        item("pods", "infra.k8s2.viewPods", "pods"),
        item("deployments", "infra.k8s2.viewDeployments", "deployments"),
        item("daemonsets", "infra.k8s2.viewDaemonSets", "daemonsets"),
        item("statefulsets", "infra.k8s2.viewStatefulSets", "statefulsets"),
        item("replicasets", "infra.k8s2.viewReplicaSets", "replicasets"),
        item("jobs", "infra.k8s2.viewJobs", "jobs"),
        item("cronjobs", "infra.k8s2.viewCronJobs", "cronjobs"),
      ],
    },
    {
      id: "storage",
      label: "infra.k8s2.groupStorage",
      items: [item("pvcs", "infra.k8s2.viewPvcs", "pvcs")],
    },
    {
      id: "autoscaling",
      label: "infra.k8s2.groupAutoscaling",
      items: [item("hpas", "infra.k8s2.viewHpas", "hpas")],
    },
  ];
}

// Case-insensitive match against the translated label, keeping groups that still have items.
export function filterTree(groups: TreeGroup[], query: string, labelOf: (key: I18nKey) => string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups;
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((i) => labelOf(i.label).toLowerCase().includes(needle)),
    }))
    .filter((group) => group.items.length > 0);
}

export type ClusterTone = "success" | "warning" | "error" | "neutral";

// A cluster that reports no nodes or pods has nothing to judge, so it reads neutral, not healthy.
export function clusterTone(stats: ClusterStats | null): ClusterTone {
  if (!stats || (!stats.nodes && !stats.pods)) return "neutral";
  if ((stats.nodesBad ?? 0) > 0) return "error";
  if ((stats.podsBad ?? 0) > 0 || (stats.deploymentsBad ?? 0) > 0) return "warning";
  return "success";
}

// Spreads clusters over a few tints; the name alone decides, so a cluster keeps its colour.
export function clusterHue(name: string, hues = 4): number {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % hues;
}

// Tile codes that never repeat: leading segment initials, then first and last, then numbered.
export function clusterCodes(names: string[]): Record<string, string> {
  const taken = new Set<string>();
  const codes: Record<string, string> = {};
  for (const name of names) {
    const parts = name.split(/[^a-z0-9]+/i).filter(Boolean);
    const first = parts[0] ?? name;
    const candidates = [
      parts.length > 1 ? first[0] + parts[1][0] : first.slice(0, 2),
      parts.length > 1 ? first[0] + parts[parts.length - 1][0] : first.slice(0, 2),
      first.slice(0, 2),
    ].map((c) => c.toUpperCase());
    let code = candidates.find((c) => c && !taken.has(c));
    for (let n = 1; !code; n++) {
      const numbered = `${first[0] ?? "C"}${n}`.toUpperCase();
      if (!taken.has(numbered)) code = numbered;
    }
    taken.add(code);
    codes[name] = code;
  }
  return codes;
}

export interface NodeSummary {
  total: number;
  ready: number;
  provider: string | null;
  region: string | null;
  version: string | null;
}

const PROVIDER_OF_SCHEME: Record<string, string> = {
  aws: "AWS",
  gce: "GCP",
  azure: "Azure",
  openstack: "OpenStack",
  digitalocean: "DigitalOcean",
};

const REGION_LABELS = ["topology.kubernetes.io/region", "failure-domain.beta.kubernetes.io/region"];

// Totals come from the cluster-wide stats; provider, region and version appear once nodes are loaded.
export function nodeSummary(
  inventory: Inventory,
  cluster: string | null,
  stats: ClusterStats | null = null,
): NodeSummary | null {
  const nodes = inCluster(inventory.nodes, cluster);
  const total = stats?.nodes ?? nodes.length;
  if (!total) return null;
  const notReady = stats?.nodesBad ?? nodes.filter(nodeIsBad).length;
  const scheme = nodes
    .map((n) => String(n.object?.spec?.providerID ?? "").split("://")[0])
    .find(Boolean);
  const labels = nodes.map((n) => n.object?.metadata?.labels ?? {});
  const region = labels.map((l) => REGION_LABELS.map((k) => l[k]).find(Boolean)).find(Boolean);
  return {
    total,
    ready: Math.max(total - notReady, 0),
    provider: (scheme && PROVIDER_OF_SCHEME[scheme]) || null,
    region: region ? String(region) : null,
    version: nodes.find((n) => n.info?.kubelet_version)?.info?.kubelet_version ?? null,
  };
}
