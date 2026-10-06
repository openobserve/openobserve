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

import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { ProgressBarVariant } from "@/lib/data/ProgressBar/OProgressBar.types";
import { formatUnitValue, getUnitValue } from "@/utils/dashboard/convertDataIntoUnitValue";
import { utilizationTint } from "../useHostsList";
import { ISSUE_KIND, type IssueKey, type K8sKind, type QueryId } from "./kubernetesQueries";
import { encodeCompound } from "./kubernetesUrlState";

export interface Series {
  metric: Record<string, string>;
  value: number;
}

// A missing key means the query is unavailable: not sent, absent, failed, or not loaded for this tab.
export type QueryResults = Map<QueryId, Series[]>;

// "missing" = some container lacks the series, so no total is honest; null = unknown.
export type Amount = number | "missing" | null;

export type Phase = "Failed" | "Pending" | "Unknown" | "Running" | "Succeeded";

export type Readiness = "true" | "false" | "unknown";

export interface StatusChip {
  text: string;
  variant: BadgeVariant;
}

export interface Owner {
  kind: string;
  name: string;
}

export interface ContainerRow {
  name: string;
  waitingReason: string | null;
  lastTerminatedReason: string | null;
  restarts: number | null;
  cpuRequest: number | null;
  cpuLimit: number | null;
  memoryRequest: number | null;
  memoryLimit: number | null;
}

export interface PodRow {
  key: string;
  cluster: string;
  namespace: string;
  name: string;
  uid: string | null;
  ambiguous: boolean;
  phase: Phase | null;
  ready: Readiness | null;
  waitingReason: string | null;
  lastTerminatedReason: string | null;
  status: StatusChip | null;
  owner: Owner | null;
  node: string | null;
  restarts: number | null;
  containers: ContainerRow[];
  cpuCores: number | null;
  cpuRequest: Amount;
  cpuLimit: Amount;
  cpuPctOfRequest: number | null;
  cpuPctOfLimit: number | null;
  memoryBytes: number | null;
  memoryRequest: Amount;
  memoryLimit: Amount;
  memoryPctOfRequest: number | null;
  memoryPctOfLimit: number | null;
  usage: { clusterLabel: "k8s_cluster" | "k8s_cluster_name" | null; uid: string | null } | null;
  issues: IssueKey[];
}

export interface NodeRow {
  key: string;
  cluster: string;
  name: string;
  ready: Readiness | null;
  status: StatusChip | null;
  pressures: string[];
  pods: number | null;
  cpuPct: number | null;
  memoryPct: number | null;
  issues: IssueKey[];
}

export type DeploymentState = "Available" | "Degraded" | "Unavailable" | "ScaledToZero";

export interface DeploymentRow {
  key: string;
  cluster: string;
  namespace: string;
  name: string;
  desired: number | null;
  available: number | null;
  status: { state: DeploymentState; variant: BadgeVariant } | null;
  pods: number | null;
  issues: IssueKey[];
}

export type MetricFamily = "kube-state-metrics" | "kubeletstats";

export interface Inventory {
  pods: PodRow[];
  nodes: NodeRow[];
  deployments: DeploymentRow[];
  unlabelledFamilies: MetricFamily[];
}

export interface Scope {
  cluster: string | null;
  namespace: string | null;
}

export interface ListFilter {
  scope: Scope;
  issue: IssueKey | null;
  name: string;
  onNode: [string, string] | null;
  workload: [string, string, string, string] | null;
}

type AnyRow = PodRow | NodeRow | DeploymentRow;

interface PodAcc {
  phases: Set<string>;
  ready: Set<string>;
  waiting: Map<string, string>;
  lastTerminated: Map<string, string>;
  owner: Owner | null;
  node: string | null;
  restarts: Map<string, number>;
  requests: Map<string, Map<string, number>>;
  limits: Map<string, Map<string, number>>;
  infoContainers: Set<string>;
}

interface UsageAcc {
  total: number;
  clusterLabel: "k8s_cluster" | "k8s_cluster_name" | null;
  uid: string | null;
}

const PHASE_ORDER: Phase[] = ["Failed", "Pending", "Unknown", "Running", "Succeeded"];

// kubernetes.page.ts's container-error set; any other waiting reason is a transient warning.
const ERROR_REASONS = new Set([
  "CrashLoopBackOff",
  "ImagePullBackOff",
  "ErrImagePull",
  "ErrImageNeverPull",
  "CreateContainerConfigError",
]);

const PRESSURE_CONDITIONS = ["MemoryPressure", "DiskPressure", "PIDPressure"];

// Only always-fetched current state names a uid: range or tab-only queries would make tiles differ per tab.
const UID_QUERIES: QueryId[] = ["P1", "P2", "P9", "P10", "P11", "P12"];

const NEAR_LIMIT_PCT = 90;

const clusterOf = (metric: Record<string, string>) =>
  metric.k8s_cluster || metric.k8s_cluster_name || "";

const clusterLabelOf = (metric: Record<string, string>) =>
  metric.k8s_cluster ? "k8s_cluster" : metric.k8s_cluster_name ? "k8s_cluster_name" : null;

const ksmPodKey = (m: Record<string, string>) =>
  encodeCompound([clusterOf(m), m.namespace ?? "", m.pod ?? ""]);

const newAcc = (): PodAcc => ({
  phases: new Set(),
  ready: new Set(),
  waiting: new Map(),
  lastTerminated: new Map(),
  owner: null,
  node: null,
  restarts: new Map(),
  requests: new Map(),
  limits: new Map(),
  infoContainers: new Set(),
});

const setNested = (
  map: Map<string, Map<string, number>>,
  outer: string,
  inner: string,
  value: number,
) => {
  let entry = map.get(outer);
  if (!entry) map.set(outer, (entry = new Map()));
  entry.set(inner, value);
};

const pct = (used: number | null, of: Amount) =>
  used != null && typeof of === "number" && of > 0 ? (used / of) * 100 : null;

const worstReadiness = (values: Set<string>): Readiness | null => {
  if (values.has("false")) return "false";
  if (values.has("unknown")) return "unknown";
  return values.has("true") ? "true" : null;
};

// A Completed sidecar or init container is routine, so it never hides a real termination.
const pickLastReason = (reasons: Map<string, string>) => {
  const all = [...reasons.values()];
  return (
    all.find((reason) => reason === "OOMKilled") ??
    all.find((reason) => reason !== "Completed") ??
    all[0] ??
    null
  );
};

const pickReason = (reasons: Map<string, string>) => {
  const all = [...reasons.values()];
  return all.find((reason) => ERROR_REASONS.has(reason)) ?? all[0] ?? null;
};

// Several uids under one name: the newest kube_pod_created wins, and without it nothing is guessed.
function selectUids(results: QueryResults): Map<string, string | null> {
  const uids = new Map<string, Set<string>>();
  for (const id of UID_QUERIES) {
    for (const s of results.get(id) ?? []) {
      const key = ksmPodKey(s.metric);
      let set = uids.get(key);
      if (!set) uids.set(key, (set = new Set()));
      set.add(s.metric.uid ?? "");
    }
  }
  const created = new Map<string, number>();
  for (const s of results.get("P12") ?? []) {
    created.set(`${ksmPodKey(s.metric)}|${s.metric.uid ?? ""}`, s.value);
  }
  const current = new Map<string, string | null>();
  for (const [key, set] of uids) {
    if (set.size === 1) {
      current.set(key, [...set][0]);
      continue;
    }
    let best: string | null = null;
    let bestCreated = -Infinity;
    for (const uid of set) {
      const at = created.get(`${key}|${uid}`);
      if (at != null && at > bestCreated) {
        best = uid;
        bestCreated = at;
      }
    }
    current.set(key, best);
  }
  return current;
}

function accumulatePods(results: QueryResults, current: Map<string, string | null>) {
  const accs = new Map<string, PodAcc>();
  const replicaSetOwner = new Map<string, Owner>();
  for (const s of results.get("P5") ?? []) {
    const m = s.metric;
    if (m.owner_is_controller === "false") continue;
    replicaSetOwner.set(encodeCompound([clusterOf(m), m.namespace ?? "", m.replicaset ?? ""]), {
      kind: m.owner_kind,
      name: m.owner_name,
    });
  }
  const each = (
    id: QueryId,
    apply: (acc: PodAcc, m: Record<string, string>, value: number) => void,
  ) => {
    for (const s of results.get(id) ?? []) {
      const key = ksmPodKey(s.metric);
      const uid = current.get(key);
      if (uid == null || (s.metric.uid ?? "") !== uid) continue;
      let acc = accs.get(key);
      if (!acc) accs.set(key, (acc = newAcc()));
      apply(acc, s.metric, s.value);
    }
  };
  each("P1", (acc, m) => acc.phases.add(m.phase));
  each("P11", (acc, m) => acc.ready.add(m.condition));
  each("P2", (acc, m) => acc.waiting.set(m.container, m.reason));
  each("P3", (acc, m) => acc.lastTerminated.set(m.container, m.reason));
  each("P4", (acc, m) => {
    if (m.owner_is_controller === "false") return;
    const rs =
      m.owner_kind === "ReplicaSet"
        ? replicaSetOwner.get(encodeCompound([clusterOf(m), m.namespace ?? "", m.owner_name]))
        : undefined;
    acc.owner = rs ?? { kind: m.owner_kind, name: m.owner_name };
  });
  each("P6", (acc, m) => (acc.node = m.node ?? null));
  each("P7", (acc, m, v) => acc.restarts.set(m.container, v));
  each("P8", (acc, m, v) => setNested(acc.requests, m.container, m.resource, v));
  each("P9", (acc, m, v) => setNested(acc.limits, m.container, m.resource, v));
  each("P10", (acc, m) => acc.infoContainers.add(m.container));
  return accs;
}

// A series without k8s_pod_uid joins by name; one with a uid joins only the current KSM uid.
function accumulateUsage(
  series: Series[] | undefined,
  current: Map<string, string | null>,
  ambiguous: Set<string>,
): Map<string, UsageAcc> {
  const out = new Map<string, UsageAcc>();
  const uidsWithoutKsm = new Map<string, Set<string>>();
  for (const s of series ?? []) {
    const m = s.metric;
    const key = encodeCompound([clusterOf(m), m.k8s_namespace_name ?? "", m.k8s_pod_name ?? ""]);
    const uid = m.k8s_pod_uid || null;
    const ksmUid = current.get(key);
    if (uid && current.has(key) && ksmUid !== "" && ksmUid !== uid) continue;
    if (uid && !current.has(key)) {
      const seen = uidsWithoutKsm.get(key) ?? new Set<string>();
      uidsWithoutKsm.set(key, seen.add(uid));
    }
    const acc = out.get(key);
    if (acc) acc.total += s.value;
    else out.set(key, { total: s.value, clusterLabel: clusterLabelOf(m), uid });
  }
  // Without KSM nothing says which instance is current, so several uids are never summed.
  for (const [key, uids] of uidsWithoutKsm) {
    if (uids.size > 1) {
      out.delete(key);
      ambiguous.add(key);
    }
  }
  return out;
}

function podStatus(
  acc: PodAcc | undefined,
  phase: Phase | null,
  ready: Readiness | null,
): StatusChip | null {
  if (!acc || !phase) return null;
  const waiting = pickReason(acc.waiting);
  if (waiting) {
    return { text: waiting, variant: ERROR_REASONS.has(waiting) ? "error-soft" : "warning-soft" };
  }
  if (phase === "Failed") return { text: phase, variant: "error-soft" };
  if (phase === "Pending") return { text: phase, variant: "warning-soft" };
  if (phase === "Unknown") return { text: phase, variant: "amber-soft" };
  if (phase === "Running") {
    if (ready === "true") return { text: phase, variant: "success-soft" };
    if (ready) return { text: "Running · NotReady", variant: "warning-soft" };
  }
  return { text: phase, variant: "default-soft" };
}

function podIssues(row: Omit<PodRow, "issues">, acc: PodAcc | undefined): IssueKey[] {
  if (!row.status || !acc) return [];
  const issues: IssueKey[] = [];
  const notReady = row.phase === "Running" && (row.ready === "false" || row.ready === "unknown");
  if (row.phase === "Pending" || row.phase === "Failed" || row.phase === "Unknown" || notReady) {
    issues.push("podsNotRunning");
  }
  if ([...acc.waiting.values()].some((reason) => ERROR_REASONS.has(reason))) {
    issues.push("podsContainerErrors");
  }
  const oom = [...acc.lastTerminated].some(
    ([container, reason]) =>
      reason === "OOMKilled" && Math.round(acc.restarts.get(container) ?? 0) >= 1,
  );
  if (oom) issues.push("podsOomKilled");
  if (row.restarts != null && row.restarts >= 1) issues.push("podsRestarting");
  if (row.memoryPctOfLimit != null && row.memoryPctOfLimit >= NEAR_LIMIT_PCT) {
    issues.push("podsNearMemoryLimit");
  }
  return issues;
}

function buildPodRow(
  key: string,
  results: QueryResults,
  acc: PodAcc | undefined,
  ambiguous: boolean,
  uid: string | null,
  cpu: UsageAcc | undefined,
  memory: UsageAcc | undefined,
): PodRow {
  const [cluster, namespace, name] = key.split("/").map((part) => decodeURIComponent(part));
  const containerSet = new Set([...(acc?.infoContainers ?? []), ...(acc?.requests.keys() ?? [])]);
  const total = (
    id: QueryId,
    map: Map<string, Map<string, number>> | undefined,
    resource: string,
  ): Amount => {
    if (!acc || !results.has(id) || containerSet.size === 0) return null;
    let sum = 0;
    for (const container of containerSet) {
      const value = map?.get(container)?.get(resource);
      if (value == null) return "missing";
      sum += value;
    }
    return sum;
  };
  const phase = acc ? (PHASE_ORDER.find((p) => acc.phases.has(p)) ?? null) : null;
  const ready = acc ? worstReadiness(acc.ready) : null;
  const restartTotal = [...(acc?.restarts.values() ?? [])].reduce((a, b) => a + b, 0);
  const cpuCores = results.has("K1") ? (cpu?.total ?? null) : null;
  const memoryBytes = results.has("K2") ? (memory?.total ?? null) : null;
  const cpuRequest = total("P8", acc?.requests, "cpu");
  const cpuLimit = total("P9", acc?.limits, "cpu");
  const memoryRequest = total("P8", acc?.requests, "memory");
  const memoryLimit = total("P9", acc?.limits, "memory");
  const names = new Set([
    ...containerSet,
    ...(acc?.waiting.keys() ?? []),
    ...(acc?.lastTerminated.keys() ?? []),
    ...(acc?.restarts.keys() ?? []),
    ...(acc?.limits.keys() ?? []),
  ]);
  const usageSeries = cpu ?? memory;
  const row: Omit<PodRow, "issues"> = {
    key,
    cluster,
    namespace,
    name,
    uid,
    ambiguous,
    phase,
    ready,
    waitingReason: acc ? pickReason(acc.waiting) : null,
    lastTerminatedReason: acc ? pickLastReason(acc.lastTerminated) : null,
    status: podStatus(acc, phase, ready),
    owner: acc?.owner ?? null,
    node: acc?.node ?? null,
    restarts: acc && results.has("P7") ? Math.round(restartTotal) : null,
    containers: [...names].sort().map((container) => ({
      name: container,
      waitingReason: acc?.waiting.get(container) ?? null,
      lastTerminatedReason: acc?.lastTerminated.get(container) ?? null,
      restarts: results.has("P7") ? Math.round(acc?.restarts.get(container) ?? 0) : null,
      cpuRequest: acc?.requests.get(container)?.get("cpu") ?? null,
      cpuLimit: acc?.limits.get(container)?.get("cpu") ?? null,
      memoryRequest: acc?.requests.get(container)?.get("memory") ?? null,
      memoryLimit: acc?.limits.get(container)?.get("memory") ?? null,
    })),
    cpuCores,
    cpuRequest,
    cpuLimit,
    cpuPctOfRequest: pct(cpuCores, cpuRequest),
    cpuPctOfLimit: pct(cpuCores, cpuLimit),
    memoryBytes,
    memoryRequest,
    memoryLimit,
    memoryPctOfRequest: pct(memoryBytes, memoryRequest),
    memoryPctOfLimit: pct(memoryBytes, memoryLimit),
    usage: usageSeries ? { clusterLabel: usageSeries.clusterLabel, uid: usageSeries.uid } : null,
  };
  return { ...row, issues: podIssues(row, acc) };
}

function buildPods(results: QueryResults): PodRow[] {
  const current = selectUids(results);
  const accs = accumulatePods(results, current);
  const kubeletAmbiguous = new Set<string>();
  const cpu = accumulateUsage(results.get("K1"), current, kubeletAmbiguous);
  const memory = accumulateUsage(results.get("K2"), current, kubeletAmbiguous);
  const keys = new Set<string>([...cpu.keys(), ...memory.keys(), ...kubeletAmbiguous]);
  for (const s of results.get("P1") ?? []) keys.add(ksmPodKey(s.metric));
  return [...keys].map((key) => {
    const ambiguous = (current.has(key) && current.get(key) == null) || kubeletAmbiguous.has(key);
    return buildPodRow(
      key,
      results,
      accs.get(key),
      ambiguous,
      current.get(key) ?? null,
      kubeletAmbiguous.has(key) ? undefined : cpu.get(key),
      kubeletAmbiguous.has(key) ? undefined : memory.get(key),
    );
  });
}

const sumByNode = (series: Series[] | undefined) => {
  const out = new Map<string, number>();
  for (const s of series ?? []) {
    const key = encodeCompound([clusterOf(s.metric), s.metric.k8s_node_name ?? ""]);
    out.set(key, (out.get(key) ?? 0) + s.value);
  }
  return out;
};

const NODE_STATUS: Record<Readiness, StatusChip> = {
  true: { text: "Ready", variant: "success-soft" },
  false: { text: "NotReady", variant: "error-soft" },
  unknown: { text: "Unknown", variant: "amber-soft" },
};

function buildNodes(results: QueryResults, pods: PodRow[]): NodeRow[] {
  const conditions = new Map<string, Map<string, string>>();
  for (const s of results.get("N1") ?? []) {
    const key = encodeCompound([clusterOf(s.metric), s.metric.node ?? ""]);
    let entry = conditions.get(key);
    if (!entry) conditions.set(key, (entry = new Map()));
    entry.set(s.metric.condition, s.metric.status);
  }
  const allocatable = new Map<string, Map<string, number>>();
  for (const s of results.get("N2") ?? []) {
    setNested(
      allocatable,
      encodeCompound([clusterOf(s.metric), s.metric.node ?? ""]),
      s.metric.resource,
      s.value,
    );
  }
  const cpu = sumByNode(results.get("K3"));
  const memory = sumByNode(results.get("K4"));
  const keys = new Set([...conditions.keys(), ...cpu.keys(), ...memory.keys()]);
  return [...keys].map((key) => {
    const [cluster, name] = key.split("/").map((part) => decodeURIComponent(part));
    const conds = conditions.get(key);
    const ready = (conds?.get("Ready") as Readiness | undefined) ?? null;
    const status = ready && NODE_STATUS[ready] ? NODE_STATUS[ready] : null;
    const pressures = PRESSURE_CONDITIONS.filter((c) => conds?.get(c) === "true");
    const issues: IssueKey[] = [];
    if (status && ready !== "true") issues.push("nodesNotReady");
    if (pressures.length) issues.push("nodesPressure");
    return {
      key,
      cluster,
      name,
      ready: status ? ready : null,
      status,
      pressures,
      pods: results.has("P6")
        ? pods.filter((p) => p.cluster === cluster && p.node === name).length
        : null,
      cpuPct: pct(
        results.has("K3") ? (cpu.get(key) ?? null) : null,
        allocatable.get(key)?.get("cpu") ?? null,
      ),
      memoryPct: pct(
        results.has("K4") ? (memory.get(key) ?? null) : null,
        allocatable.get(key)?.get("memory") ?? null,
      ),
      issues,
    };
  });
}

function deploymentStatus(
  desired: number | null,
  available: number | null,
): DeploymentRow["status"] {
  if (desired == null || available == null) return null;
  if (desired === 0) return { state: "ScaledToZero", variant: "default-soft" };
  if (available >= desired) return { state: "Available", variant: "success-soft" };
  if (available === 0) return { state: "Unavailable", variant: "error-soft" };
  return { state: "Degraded", variant: "warning-soft" };
}

function buildDeployments(results: QueryResults, pods: PodRow[]): DeploymentRow[] {
  const keyOf = (m: Record<string, string>) =>
    encodeCompound([clusterOf(m), m.namespace ?? "", m.deployment ?? ""]);
  const available = new Map<string, number>();
  for (const s of results.get("D2") ?? []) available.set(keyOf(s.metric), s.value);
  return (results.get("D1") ?? []).map((s) => {
    const key = keyOf(s.metric);
    const [cluster, namespace, name] = key.split("/").map((part) => decodeURIComponent(part));
    const status = deploymentStatus(s.value, available.get(key) ?? null);
    const unhealthy = status?.state === "Degraded" || status?.state === "Unavailable";
    return {
      key,
      cluster,
      namespace,
      name,
      desired: s.value,
      available: available.get(key) ?? null,
      status,
      pods:
        results.has("P4") && results.has("P5")
          ? pods.filter(
              (p) =>
                p.cluster === cluster &&
                p.namespace === namespace &&
                p.owner?.kind === "Deployment" &&
                p.owner.name === name,
            ).length
          : null,
      issues: unhealthy ? ["deploymentsUnavailable"] : [],
    };
  });
}

function unlabelledFamilies(results: QueryResults): MetricFamily[] {
  const seen = {
    ksm: { labelled: false, unlabelled: false },
    kubelet: { labelled: false, unlabelled: false },
  };
  for (const [id, series] of results) {
    const family = id.startsWith("K") ? seen.kubelet : seen.ksm;
    for (const s of series) {
      if (clusterOf(s.metric)) family.labelled = true;
      else family.unlabelled = true;
    }
  }
  const out: MetricFamily[] = [];
  if (seen.ksm.unlabelled && seen.kubelet.labelled) out.push("kube-state-metrics");
  if (seen.kubelet.unlabelled && seen.ksm.labelled) out.push("kubeletstats");
  return out;
}

// Prometheus emits "NaN" for 0/0; a non-finite sample must blank the cell, not render "NaN%".
export function parseVector(response: any): Series[] {
  const result: any[] = response?.data?.data?.result ?? [];
  const out: Series[] = [];
  for (const entry of result) {
    const value = Number(entry?.value?.[1]);
    if (Number.isFinite(value)) out.push({ metric: entry?.metric ?? {}, value });
  }
  return out;
}

export function buildInventory(results: QueryResults): Inventory {
  const pods = buildPods(results);
  return {
    pods,
    nodes: buildNodes(results, pods),
    deployments: buildDeployments(results, pods),
    unlabelledFamilies: unlabelledFamilies(results),
  };
}

export function inScope(kind: K8sKind, row: AnyRow, scope: Scope) {
  if (scope.cluster != null && row.cluster !== scope.cluster) return false;
  // Nodes have no namespace.
  if (kind !== "nodes" && scope.namespace != null && "namespace" in row) {
    return row.namespace === scope.namespace;
  }
  return true;
}

export function issueCounts(
  inventory: Inventory,
  scope: Scope,
  visible: (key: IssueKey) => boolean,
): Record<IssueKey, number | null> {
  const lists: Record<K8sKind, AnyRow[]> = {
    pods: inventory.pods,
    nodes: inventory.nodes,
    deployments: inventory.deployments,
  };
  const out = {} as Record<IssueKey, number | null>;
  for (const key of Object.keys(ISSUE_KIND) as IssueKey[]) {
    const kind = ISSUE_KIND[key];
    out[key] = visible(key)
      ? lists[kind].filter((row) => inScope(kind, row, scope) && row.issues.includes(key)).length
      : null;
  }
  return out;
}

export function filterRows<T extends AnyRow>(kind: K8sKind, rows: T[], filter: ListFilter): T[] {
  const name = filter.name.toLowerCase();
  const issue = filter.issue && ISSUE_KIND[filter.issue] === kind ? filter.issue : null;
  return rows.filter((row) => {
    if (!inScope(kind, row, filter.scope)) return false;
    if (issue && !row.issues.includes(issue)) return false;
    if (name && !row.name.toLowerCase().includes(name)) return false;
    if (kind !== "pods") return true;
    const pod = row as PodRow;
    if (filter.onNode && (pod.cluster !== filter.onNode[0] || pod.node !== filter.onNode[1])) {
      return false;
    }
    if (filter.workload) {
      const [cluster, namespace, ownerKind, ownerName] = filter.workload;
      const owner = pod.owner;
      if (
        pod.cluster !== cluster ||
        pod.namespace !== namespace ||
        owner?.kind !== ownerKind ||
        owner?.name !== ownerName
      ) {
        return false;
      }
    }
    return true;
  });
}

export function sortRows<T>(
  rows: T[],
  value: (row: T) => string | number | null,
  desc: boolean,
): T[] {
  const dir = desc ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}

export const formatPct = (value: number | null) => (value == null ? "—" : `${Math.round(value)}%`);

export const formatBytes = (value: number | null) =>
  value == null ? "—" : formatUnitValue(getUnitValue(value, "bytes", "", 1));

// Kubernetes writes sub-core CPU in millicores.
export const formatCores = (value: number | null) => {
  if (value == null) return "—";
  return value < 1 ? `${Math.round(value * 1000)}m` : value.toFixed(2);
};

export const usageBarVariant = (pctValue: number | null): ProgressBarVariant => {
  const tint = utilizationTint(pctValue);
  return tint === "critical" ? "danger" : tint === "warn" ? "warning" : "default";
};
