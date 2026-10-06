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
import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import type { ProgressBarVariant } from "@/lib/data/ProgressBar/OProgressBar.types";
import { formatUnitValue, getUnitValue } from "@/utils/dashboard/convertDataIntoUnitValue";
import { utilizationTint } from "../useHostsList";
import { KIND_INFO, type DetailKind, type MetricFamily, type QueryId } from "./kubernetesQueries";
import { encodeCompound } from "./kubernetesUrlState";

export interface Series {
  metric: Record<string, string>;
  value: number;
}

// A missing key means the query is unavailable: not sent, absent, failed, or not loaded for this view.
export type QueryResults = Map<QueryId, Series[]>;

// "missing" = some container lacks the series, so no total is honest; null = unknown.
export type Amount = number | "missing" | null;

export type Phase = "Failed" | "Pending" | "Unknown" | "Running" | "Succeeded";

export type Readiness = "true" | "false" | "unknown";

export type Severity = "error" | "warning";

export type Tone = "success" | "error" | "warning" | "info" | "neutral";

export type ContainerState = "terminated" | "restarted" | "ready" | "waiting" | "unknown";

export type QosClass = "Guaranteed" | "Burstable" | "BestEffort";

// Kubernetes-provided phases and reasons stay raw `text`; labels this page synthesizes are i18n `key`s.
export interface StatusChip {
  text?: string;
  key?: I18nKey;
  variant: BadgeVariant;
}

export interface Owner {
  kind: string;
  name: string;
}

export interface Warning {
  key: I18nKey;
  params?: Record<string, string>;
  severity: Severity;
  // Event warnings only, in µs.
  lastSeen?: number;
}

// One W row: the latest Warning event per involved object over the last hour.
export interface WarningEvent {
  cluster: string;
  kind: string;
  name: string;
  namespace: string;
  uid: string;
  events: number;
  lastSeen: number;
  reason: string;
  note: string;
}

export interface K8sObject {
  uid: string | null;
  metadata: Record<string, any>;
  spec: Record<string, any>;
  status: Record<string, any>;
}

export interface ContainerRow {
  name: string;
  init: boolean;
  image: string | null;
  ready: boolean | null;
  state: ContainerState;
  running: boolean;
  waitingReason: string | null;
  terminatedReason: string | null;
  lastTerminatedReason: string | null;
  restarts: number | null;
  cpuRequest: number | null;
  cpuLimit: number | null;
  memoryRequest: number | null;
  memoryLimit: number | null;
}

export interface SeriesMatcher {
  clusterLabel: "k8s_cluster" | "k8s_cluster_name" | null;
  uid: string | null;
}

export interface RowBase {
  key: string;
  kind: DetailKind;
  cluster: string;
  namespace: string;
  name: string;
  uid: string | null;
  // µs; the KSM creation time, else the observed object's creationTimestamp.
  createdAt: number | null;
  warnings: Warning[];
  object: K8sObject | null;
}

export interface PodRow extends RowBase {
  kind: "pod";
  ambiguous: boolean;
  phase: Phase | null;
  ready: Readiness | null;
  waitingReason: string | null;
  lastTerminatedReason: string | null;
  statusReason: string | null;
  status: StatusChip | null;
  controller: Owner | null;
  workload: Owner | null;
  node: string | null;
  ip: string | null;
  priorityClass: string | null;
  restarts: number | null;
  containers: ContainerRow[];
  qos: { cls: QosClass; estimated: boolean } | null;
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
  // Each usage stream keeps its own matcher: the two can carry different labels for one pod.
  series: { cpu: SeriesMatcher | null; memory: SeriesMatcher | null };
}

export interface Taint {
  key: string;
  value: string;
  effect: string;
}

export interface NodeRow extends RowBase {
  kind: "node";
  ready: Readiness | null;
  conditions: Record<string, string>;
  status: StatusChip | null;
  pressures: string[];
  allocatable: Record<string, number>;
  cpuCores: number | null;
  memoryBytes: number | null;
  diskUsed: number | null;
  diskCapacity: number | null;
  cpuPct: number | null;
  memoryPct: number | null;
  diskPct: number | null;
  taints: Taint[] | null;
  info: Record<string, string> | null;
  roles: string[] | null;
  unschedulable: boolean;
  // The cluster label spelling the kubeletstats series carried, for chart matchers.
  clusterLabel: "k8s_cluster" | "k8s_cluster_name" | null;
}

export interface ConditionWord {
  text: string;
  variant: BadgeVariant;
}

export interface DeploymentRow extends RowBase {
  kind: "deployment";
  desired: number | null;
  available: number | null;
  replicas: number | null;
  updated: number | null;
  unavailable: number | null;
  conditions: ConditionWord[];
  conditionsDerived: boolean;
}

export interface DaemonSetRow extends RowBase {
  kind: "daemonset";
  desired: number | null;
  current: number | null;
  ready: number | null;
  nodeSelector: Record<string, string> | null;
}

export interface StatefulSetRow extends RowBase {
  kind: "statefulset";
  replicas: number | null;
  ready: number | null;
  current: number | null;
}

export interface ReplicaSetRow extends RowBase {
  kind: "replicaset";
  desired: number | null;
  current: number | null;
  ready: number | null;
  owner: Owner | null;
}

export interface JobRow extends RowBase {
  kind: "job";
  active: number | null;
  succeeded: number | null;
  failed: number | null;
  failedReasons: string[];
  completions: number | null;
  complete: boolean;
  owner: Owner | null;
}

export interface CronJobRow extends RowBase {
  kind: "cronjob";
  schedule: string | null;
  suspend: boolean | null;
  active: number | null;
  // µs; the object's status.lastScheduleTime, else the newest owned job's creation.
  lastSchedule: number | null;
  jobs: string[];
}

export interface PvcRow extends RowBase {
  kind: "pvc";
  phase: string | null;
  storageClass: string | null;
  size: number | null;
  pods: string[] | null;
}

export interface HpaRow extends RowBase {
  kind: "hpa";
  min: number | null;
  max: number | null;
  current: number | null;
  conditions: Array<{ condition: string; status: string }>;
  target: Owner | null;
}

export interface NamespaceRow extends RowBase {
  kind: "namespace";
  phase: string | null;
}

export type AnyRow =
  | PodRow
  | NodeRow
  | DeploymentRow
  | DaemonSetRow
  | StatefulSetRow
  | ReplicaSetRow
  | JobRow
  | CronJobRow
  | PvcRow
  | HpaRow
  | NamespaceRow;

export interface Inventory {
  pods: PodRow[];
  nodes: NodeRow[];
  deployments: DeploymentRow[];
  daemonsets: DaemonSetRow[];
  statefulsets: StatefulSetRow[];
  replicasets: ReplicaSetRow[];
  jobs: JobRow[];
  cronjobs: CronJobRow[];
  pvcs: PvcRow[];
  hpas: HpaRow[];
  namespaces: NamespaceRow[];
  unlabelledFamilies: MetricFamily[];
}

export type InventoryKey = Exclude<keyof Inventory, "unlabelledFamilies">;

export interface Scope {
  cluster: string | null;
  namespaces: string[];
}

interface PodAcc {
  phases: Set<string>;
  ready: Set<string>;
  waiting: Map<string, string>;
  lastTerminated: Map<string, string>;
  terminated: Map<string, string>;
  statusReasons: Set<string>;
  controller: Owner | null;
  node: string | null;
  ip: string | null;
  priorityClass: string | null;
  createdAt: number | null;
  restarts: Map<string, number>;
  containerReady: Map<string, number>;
  requests: Map<string, Map<string, number>>;
  limits: Map<string, Map<string, number>>;
  images: Map<string, string>;
}

interface UsageAcc {
  total: number;
  clusterLabel: "k8s_cluster" | "k8s_cluster_name" | null;
  uid: string | null;
}

export const INVENTORY_KEY: Record<DetailKind, InventoryKey> = {
  pod: "pods",
  node: "nodes",
  deployment: "deployments",
  daemonset: "daemonsets",
  statefulset: "statefulsets",
  replicaset: "replicasets",
  job: "jobs",
  cronjob: "cronjobs",
  pvc: "pvcs",
  hpa: "hpas",
  namespace: "namespaces",
};

// kubernetes.page.ts's container-error set; any other waiting reason is a transient warning.
export const ERROR_REASONS: ReadonlySet<string> = new Set([
  "CrashLoopBackOff",
  "ImagePullBackOff",
  "ErrImagePull",
  "ErrImageNeverPull",
  "CreateContainerConfigError",
]);

export const PRESSURE_CONDITIONS = ["MemoryPressure", "DiskPressure", "PIDPressure"];

export const TONE_TEXT_CLASS: Record<Tone, string> = {
  success: "text-status-success-text",
  error: "text-status-error-text",
  warning: "text-status-warning-text",
  info: "text-status-info-text",
  neutral: "text-text-secondary",
};

const VARIANT_TONE: Partial<Record<BadgeVariant, Tone>> = {
  "success-soft": "success",
  "error-soft": "error",
  "warning-soft": "warning",
  "amber-soft": "warning",
  "blue-soft": "info",
  "default-soft": "neutral",
};

const PHASE_ORDER: Phase[] = ["Failed", "Pending", "Unknown", "Running", "Succeeded"];

// Every pod-reading view sends these, so all of them agree on which uid is current.
const UID_QUERIES: QueryId[] = ["P1", "P2", "P11", "P12"];

const NEAR_LIMIT_PCT = 90;

const NODE_STATUS: Record<Readiness, StatusChip> = {
  true: { key: "infra.k8s2.nodeReady", variant: "success-soft" },
  false: { key: "infra.k8s2.nodeNotReady", variant: "error-soft" },
  unknown: { key: "infra.k8s2.nodeUnknown", variant: "amber-soft" },
};

const NODE_CONDITION_VARIANT: Record<string, BadgeVariant> = {
  Ready: "success-soft",
  MemoryPressure: "warning-soft",
  DiskPressure: "warning-soft",
  PIDPressure: "warning-soft",
  NetworkUnavailable: "error-soft",
};

const DEPLOYMENT_CONDITION_VARIANT: Record<string, BadgeVariant> = {
  Available: "success-soft",
  Progressing: "blue-soft",
  ReplicaFailure: "error-soft",
};

const clusterOf = (metric: Record<string, string>) =>
  metric.k8s_cluster || metric.k8s_cluster_name || "";

export const clusterLabelOf = (metric: Record<string, string>) =>
  metric.k8s_cluster ? "k8s_cluster" : metric.k8s_cluster_name ? "k8s_cluster_name" : null;

const ksmPodKey = (m: Record<string, string>) =>
  encodeCompound([clusterOf(m), m.namespace ?? "", m.pod ?? ""]);

const nsKey = (m: Record<string, string>, label: string) =>
  encodeCompound([clusterOf(m), m.namespace ?? "", m[label] ?? ""]);

const decodeKey = (key: string) => key.split("/").map((part) => decodeURIComponent(part));

const seconds = (value: number | null | undefined) => (value == null ? null : value * 1_000_000);

const pct = (used: number | null, of: Amount) =>
  used != null && typeof of === "number" && of > 0 ? (used / of) * 100 : null;

const isOwner = (kind: string | undefined, name: string | undefined) =>
  !!kind && !!name && kind !== "<none>" && name !== "<none>";

const ownerOf = (m: Record<string, string>): Owner | null =>
  isOwner(m.owner_kind, m.owner_name) ? { kind: m.owner_kind, name: m.owner_name } : null;

const newAcc = (): PodAcc => ({
  phases: new Set(),
  ready: new Set(),
  waiting: new Map(),
  lastTerminated: new Map(),
  terminated: new Map(),
  statusReasons: new Set(),
  controller: null,
  node: null,
  ip: null,
  priorityClass: null,
  createdAt: null,
  restarts: new Map(),
  containerReady: new Map(),
  requests: new Map(),
  limits: new Map(),
  images: new Map(),
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

const valueMap = (series: Series[] | undefined, key: (m: Record<string, string>) => string) => {
  const out = new Map<string, number>();
  for (const s of series ?? []) out.set(key(s.metric), s.value);
  return out;
};

const valueOf = (results: QueryResults, id: QueryId, map: Map<string, number>, key: string) =>
  results.has(id) ? (map.get(key) ?? null) : null;

const base = <K extends DetailKind>(
  kind: K,
  key: string,
  createdAt: number | null,
  namespaced = true,
) => {
  const parts = decodeKey(key);
  return {
    key,
    kind,
    cluster: parts[0],
    namespace: namespaced ? parts[1] : "",
    name: namespaced ? parts[2] : parts[1],
    uid: null as string | null,
    createdAt,
    warnings: [] as Warning[],
    object: null as K8sObject | null,
  };
};

export function parseVector(response: any): Series[] {
  const result: any[] = response?.data?.data?.result ?? [];
  const out: Series[] = [];
  for (const entry of result) {
    const value = Number(entry?.value?.[1]);
    if (Number.isFinite(value)) out.push({ metric: entry?.metric ?? {}, value });
  }
  return out;
}

export function buildInventory(
  results: QueryResults,
  warnings: WarningEvent[] | null = null,
): Inventory {
  const pods = buildPods(results);
  const inventory: Inventory = {
    pods,
    nodes: buildNodes(results),
    deployments: buildDeployments(results),
    daemonsets: buildDaemonSets(results),
    statefulsets: buildStatefulSets(results),
    replicasets: buildReplicaSets(results),
    jobs: buildJobs(results),
    cronjobs: buildCronJobs(results),
    pvcs: buildPvcs(results),
    hpas: buildHpas(results),
    namespaces: buildNamespaces(results),
    unlabelledFamilies: unlabelledFamilies(results),
  };
  if (warnings) attachWarningEvents(inventory, warnings);
  return inventory;
}

// Lens order: terminated, then ready-and-restarted, then ready, otherwise waiting.
export function containerState(c: {
  ready: boolean | null;
  restarts: number | null;
  waitingReason: string | null;
  terminatedReason: string | null;
}): ContainerState {
  if (c.terminatedReason) return "terminated";
  if (c.ready === true) return (c.restarts ?? 0) > 0 ? "restarted" : "ready";
  if (c.ready === false || c.waitingReason) return "waiting";
  return "unknown";
}

export function estimateQos(containers: ContainerRow[]): QosClass | null {
  if (containers.length === 0) return null;
  const values = containers.flatMap((c) => [
    c.cpuRequest,
    c.cpuLimit,
    c.memoryRequest,
    c.memoryLimit,
  ]);
  if (values.every((v) => v == null)) return "BestEffort";
  const guaranteed = containers.every(
    (c) =>
      c.cpuLimit != null &&
      c.memoryLimit != null &&
      (c.cpuRequest == null || c.cpuRequest === c.cpuLimit) &&
      (c.memoryRequest == null || c.memoryRequest === c.memoryLimit),
  );
  return guaranteed ? "Guaranteed" : "Burstable";
}

export function podWarnings(row: PodRow): Warning[] {
  const out: Warning[] = [];
  if (!row.status) return out;
  for (const c of row.containers) {
    if (c.waitingReason && ERROR_REASONS.has(c.waitingReason)) {
      out.push({
        key: "infra.k8s2.warnWaiting",
        params: { container: c.name, reason: c.waitingReason },
        severity: "error",
      });
    }
  }
  if (row.phase === "Failed") out.push({ key: "infra.k8s2.warnFailed", severity: "error" });
  if (row.statusReason === "Evicted") {
    out.push({ key: "infra.k8s2.warnEvicted", severity: "error" });
  }
  if (row.phase === "Pending" || row.phase === "Unknown") {
    out.push({ key: "infra.k8s2.warnPhase", params: { phase: row.phase }, severity: "warning" });
  }
  if (row.phase === "Running" && (row.ready === "false" || row.ready === "unknown")) {
    out.push({ key: "infra.k8s2.warnNotReady", severity: "warning" });
  }
  if (row.containers.some((c) => c.lastTerminatedReason === "OOMKilled")) {
    out.push({ key: "infra.k8s2.warnOomKilled", severity: "warning" });
  }
  if (row.memoryPctOfLimit != null && row.memoryPctOfLimit >= NEAR_LIMIT_PCT) {
    out.push({
      key: "infra.k8s2.warnNearMemoryLimit",
      params: { pct: formatPct(row.memoryPctOfLimit) },
      severity: "warning",
    });
  }
  return out;
}

export function nodeWarnings(row: NodeRow): Warning[] {
  const out: Warning[] = [];
  if (row.ready === "false") out.push({ key: "infra.k8s2.warnNodeNotReady", severity: "error" });
  if (row.ready === "unknown") {
    out.push({ key: "infra.k8s2.warnNodeUnknown", severity: "warning" });
  }
  for (const condition of row.pressures) {
    out.push({ key: "infra.k8s2.warnCondition", params: { condition }, severity: "warning" });
  }
  return out;
}

// Lens getStatus(): Evicted > Failed > Succeeded > Running (in good condition) > Pending.
export function lensPodStatus(
  row: PodRow,
): "running" | "pending" | "succeeded" | "failed" | "evicted" | "unknown" {
  if (row.statusReason === "Evicted") return "evicted";
  if (row.phase === "Failed") return "failed";
  if (row.phase === "Succeeded") return "succeeded";
  if (row.phase === "Unknown" || row.phase == null) return "unknown";
  if (row.phase === "Running") {
    if (row.ready == null) return "unknown";
    const initialized = row.object
      ? (row.object.status?.conditions ?? []).some(
          (c: any) => c?.type === "Initialized" && c?.status === "True",
        )
      : true;
    return row.ready === "true" && initialized ? "running" : "pending";
  }
  return "pending";
}

export function podStatusKnown(row: PodRow) {
  return row.phase != null && (row.phase !== "Running" || row.ready != null);
}

export function inScope(row: AnyRow, scope: Scope) {
  if (scope.cluster != null && row.cluster !== scope.cluster) return false;
  if (scope.namespaces.length === 0 || row.kind === "node" || row.kind === "namespace") return true;
  return scope.namespaces.includes(row.namespace);
}

// Lens searches the name plus a few text fields per kind (§4.0).
export function searchText(row: AnyRow): string {
  switch (row.kind) {
    case "pod":
      return [
        row.name,
        row.status?.text,
        row.phase,
        row.ready === "false" ? "NotReady" : "",
        row.node,
        row.ip,
      ].join(" ");
    case "node":
      return [
        row.name,
        ...(row.roles ?? []),
        row.info?.kubelet_version,
        ...nodeConditionWords(row).map((w) => w.text),
      ].join(" ");
    case "deployment":
      return [row.name, ...row.conditions.map((c) => c.text)].join(" ");
    case "cronjob":
      return [row.name, row.schedule].join(" ");
    default:
      return row.name;
  }
}

export function filterRows<T extends AnyRow>(rows: T[], scope: Scope, search: string): T[] {
  const needle = search.trim().toLowerCase();
  return rows.filter(
    (row) => inScope(row, scope) && (!needle || searchText(row).toLowerCase().includes(needle)),
  );
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

export function membersOf(pods: PodRow[], row: AnyRow): PodRow[] {
  const same = (p: PodRow) => p.cluster === row.cluster;
  switch (row.kind) {
    case "node":
      return pods.filter((p) => same(p) && p.node === row.name);
    case "namespace":
      return pods.filter((p) => same(p) && p.namespace === row.name);
    case "deployment":
      return pods.filter(
        (p) =>
          same(p) &&
          p.namespace === row.namespace &&
          p.workload?.kind === "Deployment" &&
          p.workload.name === row.name,
      );
    case "daemonset":
    case "statefulset":
    case "replicaset":
    case "job": {
      const kind = {
        daemonset: "DaemonSet",
        statefulset: "StatefulSet",
        replicaset: "ReplicaSet",
        job: "Job",
      }[row.kind];
      return pods.filter(
        (p) =>
          same(p) &&
          p.namespace === row.namespace &&
          p.controller?.kind === kind &&
          p.controller.name === row.name,
      );
    }
    default:
      return [];
  }
}

export function findRow(inventory: Inventory, kind: DetailKind, key: string): AnyRow | null {
  return (inventory[INVENTORY_KEY[kind]] as AnyRow[]).find((row) => row.key === key) ?? null;
}

export function rowKey(kind: DetailKind, cluster: string, namespace: string, name: string) {
  return kind === "node" || kind === "namespace"
    ? encodeCompound([cluster, name])
    : encodeCompound([cluster, namespace, name]);
}

export function formatAge(us: number | null): string {
  if (us == null || !Number.isFinite(us)) return "—";
  const s = Math.max(0, Math.floor(us / 1_000_000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
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

export const toneOf = (variant: BadgeVariant | undefined): Tone =>
  (variant && VARIANT_TONE[variant]) || "neutral";

export const chipLabel = (chip: StatusChip, t: TranslateFn): I18nText =>
  chip.key ? t(chip.key) : raw(chip.text ?? "");

export const warningLabel = (w: Warning, t: TranslateFn, endUs: number | null): I18nText => {
  if (w.lastSeen == null) return t(w.key, w.params ?? {});
  const count = Number(w.params?.count ?? 1);
  const age = formatAge(endUs == null ? null : endUs - w.lastSeen);
  return t(w.key, { ...w.params, age, count }, count);
};

export const severityOf = (warnings: Warning[]): Severity | null =>
  warnings.length === 0 ? null : warnings.some((w) => w.severity === "error") ? "error" : "warning";

// A uid-bearing event belongs only to the object with that uid; without one it matches by name.
export function attachWarningEvents(inventory: Inventory, events: WarningEvent[]) {
  const merged = new Map<AnyRow, WarningEvent>();
  const byName = new Map<string, AnyRow>();
  const byUid = new Map<string, AnyRow>();
  for (const key of Object.keys(INVENTORY_KEY) as DetailKind[]) {
    for (const row of inventory[INVENTORY_KEY[key]] as AnyRow[]) {
      byName.set(`${KIND_INFO[row.kind].kind}|${row.cluster}|${row.namespace}|${row.name}`, row);
      if (row.uid) byUid.set(`${KIND_INFO[row.kind].kind}|${row.uid}`, row);
    }
  }
  for (const event of events) {
    const target = matchEvent(event, byUid, byName);
    if (!target) continue;
    const prev = merged.get(target);
    merged.set(
      target,
      !prev
        ? event
        : {
            ...(event.lastSeen >= prev.lastSeen ? event : prev),
            events: prev.events + event.events,
          },
    );
  }
  for (const [row, event] of merged) {
    row.warnings = [
      ...row.warnings,
      {
        key: "infra.k8s2.warnEvents",
        params: { reason: event.reason, note: event.note, count: String(event.events) },
        severity: "warning",
        lastSeen: event.lastSeen,
      },
    ];
  }
}

export function nodeConditionWords(row: NodeRow): ConditionWord[] {
  const words: ConditionWord[] = Object.entries(row.conditions)
    .filter(([, status]) => status === "true")
    .map(([condition]) => ({
      text: condition,
      variant: NODE_CONDITION_VARIANT[condition] ?? "default-soft",
    }));
  if (row.unschedulable) words.push({ text: "SchedulingDisabled", variant: "warning-soft" });
  return words;
}

export function derivedDeploymentConditions(
  desired: number | null,
  available: number | null,
): ConditionWord[] {
  return desired != null && available != null && available >= desired
    ? [{ text: "Available", variant: "success-soft" }]
    : [];
}

export function observedDeploymentConditions(object: K8sObject): ConditionWord[] {
  const conditions: any[] = Array.isArray(object.status?.conditions)
    ? object.status.conditions
    : [];
  return conditions
    .filter((c) => c?.status === "True")
    .sort((a, b) => String(a.type).localeCompare(String(b.type)))
    .map((c) => ({
      text: String(c.type),
      variant: DEPLOYMENT_CONDITION_VARIANT[c.type] ?? "default-soft",
    }));
}

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
    // An unsampled uid could be the newest, so a partial set of creation times decides nothing.
    let best: string | null = null;
    let bestCreated = -Infinity;
    for (const uid of set) {
      const at = created.get(`${key}|${uid}`);
      if (at == null) {
        best = null;
        break;
      }
      if (at > bestCreated) {
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
  each("P14", (acc, m) => acc.terminated.set(m.container, m.reason));
  each("P15", (acc, m) => acc.statusReasons.add(m.reason));
  each("P4", (acc, m) => {
    if (m.owner_is_controller === "false") return;
    acc.controller = ownerOf(m);
  });
  each("P6", (acc, m) => {
    acc.node = m.node ?? null;
    acc.ip = m.pod_ip || null;
    acc.priorityClass = m.priority_class || null;
  });
  each("P7", (acc, m, v) => acc.restarts.set(m.container, v));
  each("P8", (acc, m, v) => setNested(acc.requests, m.container, m.resource, v));
  each("P9", (acc, m, v) => setNested(acc.limits, m.container, m.resource, v));
  each("P10", (acc, m) => acc.images.set(m.container, m.image ?? ""));
  each("P12", (acc, _m, v) => (acc.createdAt = seconds(v)));
  each("P13", (acc, m, v) => acc.containerReady.set(m.container, v));
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
  if (acc.statusReasons.has("Evicted")) return { text: "Evicted", variant: "error-soft" };
  const waiting = pickReason(acc.waiting);
  if (waiting) {
    return { text: waiting, variant: ERROR_REASONS.has(waiting) ? "error-soft" : "warning-soft" };
  }
  if (phase === "Failed") return { text: phase, variant: "error-soft" };
  if (phase === "Pending") return { text: phase, variant: "warning-soft" };
  if (phase === "Unknown") return { text: phase, variant: "amber-soft" };
  if (phase === "Running") {
    if (ready === "true") return { text: phase, variant: "success-soft" };
    if (ready) return { key: "infra.k8s2.podRunningNotReady", variant: "warning-soft" };
  }
  return { text: phase, variant: "default-soft" };
}

function buildContainers(results: QueryResults, acc: PodAcc | undefined): ContainerRow[] {
  if (!acc) return [];
  const names = new Set([
    ...acc.images.keys(),
    ...acc.requests.keys(),
    ...acc.containerReady.keys(),
    ...acc.waiting.keys(),
    ...acc.terminated.keys(),
    ...acc.lastTerminated.keys(),
    ...acc.restarts.keys(),
    ...acc.limits.keys(),
  ]);
  return [...names].sort().map((name) => {
    const readyValue = acc.containerReady.get(name);
    const restarts = results.has("P7") ? Math.round(acc.restarts.get(name) ?? 0) : null;
    const row = {
      name,
      init: false,
      image: acc.images.get(name) || null,
      ready: readyValue == null ? null : readyValue >= 1,
      waitingReason: acc.waiting.get(name) ?? null,
      terminatedReason: acc.terminated.get(name) ?? null,
      lastTerminatedReason: acc.lastTerminated.get(name) ?? null,
      restarts,
      cpuRequest: acc.requests.get(name)?.get("cpu") ?? null,
      cpuLimit: acc.limits.get(name)?.get("cpu") ?? null,
      memoryRequest: acc.requests.get(name)?.get("memory") ?? null,
      memoryLimit: acc.limits.get(name)?.get("memory") ?? null,
    };
    return {
      ...row,
      state: containerState(row),
      running: acc.images.has(name) && !row.waitingReason && !row.terminatedReason,
    };
  });
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
  const containerSet = new Set([...(acc?.images.keys() ?? []), ...(acc?.requests.keys() ?? [])]);
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
  const containers = buildContainers(results, acc);
  const qos =
    results.has("P8") && results.has("P9")
      ? estimateQos(containers.filter((c) => containerSet.has(c.name)))
      : null;
  const row: PodRow = {
    ...base("pod", key, acc?.createdAt ?? null),
    uid,
    ambiguous,
    phase,
    ready,
    waitingReason: acc ? pickReason(acc.waiting) : null,
    lastTerminatedReason: acc ? pickLastReason(acc.lastTerminated) : null,
    statusReason: acc ? ([...acc.statusReasons][0] ?? null) : null,
    status: podStatus(acc, phase, ready),
    controller: acc?.controller ?? null,
    workload: null,
    node: acc?.node ?? null,
    ip: acc?.ip ?? null,
    priorityClass: acc?.priorityClass ?? null,
    restarts: acc && results.has("P7") ? Math.round(restartTotal) : null,
    containers,
    qos: qos ? { cls: qos, estimated: true } : null,
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
    series: {
      cpu: cpu ? { clusterLabel: cpu.clusterLabel, uid: cpu.uid } : null,
      memory: memory ? { clusterLabel: memory.clusterLabel, uid: memory.uid } : null,
    },
  };
  row.warnings = podWarnings(row);
  return row;
}

function buildPods(results: QueryResults): PodRow[] {
  const current = selectUids(results);
  const accs = accumulatePods(results, current);
  const kubeletAmbiguous = new Set<string>();
  const cpu = accumulateUsage(results.get("K1"), current, kubeletAmbiguous);
  const memory = accumulateUsage(results.get("K2"), current, kubeletAmbiguous);
  const keys = new Set<string>([...cpu.keys(), ...memory.keys(), ...kubeletAmbiguous]);
  for (const s of results.get("P1") ?? []) keys.add(ksmPodKey(s.metric));
  const replicaSetOwner = new Map<string, Owner | null>();
  for (const s of results.get("P5") ?? []) {
    if (s.metric.owner_is_controller === "false") continue;
    replicaSetOwner.set(nsKey(s.metric, "replicaset"), ownerOf(s.metric));
  }
  return [...keys].map((key) => {
    const ambiguous = (current.has(key) && current.get(key) == null) || kubeletAmbiguous.has(key);
    const row = buildPodRow(
      key,
      results,
      accs.get(key),
      ambiguous,
      current.get(key) ?? null,
      kubeletAmbiguous.has(key) ? undefined : cpu.get(key),
      kubeletAmbiguous.has(key) ? undefined : memory.get(key),
    );
    const c = row.controller;
    const rsOwner =
      c?.kind === "ReplicaSet"
        ? replicaSetOwner.get(encodeCompound([row.cluster, row.namespace, c.name]))
        : null;
    row.workload = rsOwner ?? c;
    return row;
  });
}

function buildNodes(results: QueryResults): NodeRow[] {
  const nodeKey = (m: Record<string, string>) => encodeCompound([clusterOf(m), m.node ?? ""]);
  const kubeletKey = (m: Record<string, string>) =>
    encodeCompound([clusterOf(m), m.k8s_node_name ?? ""]);
  const conditions = new Map<string, Record<string, string>>();
  for (const s of results.get("N1") ?? []) {
    const key = nodeKey(s.metric);
    conditions.set(key, { ...conditions.get(key), [s.metric.condition]: s.metric.status });
  }
  const allocatable = new Map<string, Record<string, number>>();
  for (const s of results.get("N2") ?? []) {
    const key = nodeKey(s.metric);
    allocatable.set(key, { ...allocatable.get(key), [s.metric.resource]: s.value });
  }
  const taints = new Map<string, Taint[]>();
  for (const s of results.get("N4") ?? []) {
    const key = nodeKey(s.metric);
    const taint = { key: s.metric.key, value: s.metric.value ?? "", effect: s.metric.effect };
    taints.set(key, [...(taints.get(key) ?? []), taint]);
  }
  const info = new Map<string, Record<string, string>>();
  for (const s of results.get("N3") ?? []) info.set(nodeKey(s.metric), s.metric);
  const created = valueMap(results.get("N5"), nodeKey);
  const labels = new Map<string, "k8s_cluster" | "k8s_cluster_name" | null>();
  const usage = (id: QueryId) => {
    const out = new Map<string, number>();
    for (const s of results.get(id) ?? []) {
      const key = kubeletKey(s.metric);
      out.set(key, (out.get(key) ?? 0) + s.value);
      labels.set(key, clusterLabelOf(s.metric));
    }
    return out;
  };
  const cpu = usage("K3");
  const memory = usage("K4");
  const diskUsed = usage("K5");
  const diskCapacity = usage("K6");
  const keys = new Set([...conditions.keys(), ...cpu.keys(), ...memory.keys(), ...info.keys()]);
  return [...keys].map((key) => {
    const conds = conditions.get(key) ?? {};
    const ready = (conds.Ready as Readiness | undefined) ?? null;
    const status = ready && NODE_STATUS[ready] ? NODE_STATUS[ready] : null;
    const alloc = allocatable.get(key) ?? {};
    const used = (id: QueryId, map: Map<string, number>) => valueOf(results, id, map, key);
    const row: NodeRow = {
      ...base("node", key, seconds(created.get(key)), false),
      ready: status ? ready : null,
      conditions: conds,
      status,
      pressures: PRESSURE_CONDITIONS.filter((c) => conds[c] === "true"),
      allocatable: alloc,
      cpuCores: used("K3", cpu),
      memoryBytes: used("K4", memory),
      diskUsed: used("K5", diskUsed),
      diskCapacity: used("K6", diskCapacity),
      cpuPct: pct(used("K3", cpu), alloc.cpu ?? null),
      memoryPct: pct(used("K4", memory), alloc.memory ?? null),
      diskPct: pct(used("K5", diskUsed), used("K6", diskCapacity)),
      taints: results.has("N4") ? (taints.get(key) ?? []) : null,
      info: info.get(key) ?? null,
      roles: null,
      unschedulable: false,
      clusterLabel: labels.get(key) ?? null,
    };
    row.warnings = nodeWarnings(row);
    return row;
  });
}

function buildDeployments(results: QueryResults): DeploymentRow[] {
  const key = (m: Record<string, string>) => nsKey(m, "deployment");
  const [available, replicas, updated, unavailable, created] = (
    ["D2", "D3", "D4", "D6", "D5"] as QueryId[]
  ).map((id) => valueMap(results.get(id), key));
  return (results.get("D1") ?? []).map((s) => {
    const k = key(s.metric);
    const availableValue = valueOf(results, "D2", available, k);
    const row: DeploymentRow = {
      ...base("deployment", k, seconds(created.get(k))),
      desired: s.value,
      available: availableValue,
      replicas: valueOf(results, "D3", replicas, k),
      updated: valueOf(results, "D4", updated, k),
      unavailable: valueOf(results, "D6", unavailable, k),
      conditions: derivedDeploymentConditions(s.value, availableValue),
      conditionsDerived: true,
    };
    if (availableValue != null && availableValue < s.value) {
      row.warnings.push({
        key: "infra.k8s2.warnUnavailable",
        params: { available: String(availableValue), desired: String(s.value) },
        severity: availableValue === 0 ? "error" : "warning",
      });
    }
    return row;
  });
}

function replicaWarning(ready: number | null, desired: number | null): Warning[] {
  return ready != null && desired != null && ready < desired
    ? [
        {
          key: "infra.k8s2.warnNotAllReady",
          params: { ready: String(ready), desired: String(desired) },
          severity: "warning",
        },
      ]
    : [];
}

function buildDaemonSets(results: QueryResults): DaemonSetRow[] {
  const key = (m: Record<string, string>) => nsKey(m, "daemonset");
  const [created, current, ready] = (["DS2", "DS3", "DS5"] as QueryId[]).map((id) =>
    valueMap(results.get(id), key),
  );
  return (results.get("DS1") ?? []).map((s) => {
    const k = key(s.metric);
    const readyValue = valueOf(results, "DS5", ready, k);
    return {
      ...base("daemonset", k, seconds(created.get(k))),
      desired: s.value,
      current: valueOf(results, "DS3", current, k),
      ready: readyValue,
      nodeSelector: null,
      warnings: replicaWarning(readyValue, s.value),
    };
  });
}

function buildStatefulSets(results: QueryResults): StatefulSetRow[] {
  const key = (m: Record<string, string>) => nsKey(m, "statefulset");
  const [ready, current, created] = (["SS2", "SS3", "SS4"] as QueryId[]).map((id) =>
    valueMap(results.get(id), key),
  );
  return (results.get("SS1") ?? []).map((s) => {
    const k = key(s.metric);
    const readyValue = valueOf(results, "SS2", ready, k);
    return {
      ...base("statefulset", k, seconds(created.get(k))),
      replicas: s.value,
      ready: readyValue,
      current: valueOf(results, "SS3", current, k),
      warnings: replicaWarning(readyValue, s.value),
    };
  });
}

function buildReplicaSets(results: QueryResults): ReplicaSetRow[] {
  const key = (m: Record<string, string>) => nsKey(m, "replicaset");
  const [current, ready, created] = (["RS3", "RS4", "RS5"] as QueryId[]).map((id) =>
    valueMap(results.get(id), key),
  );
  const owners = new Map<string, Owner | null>();
  for (const s of results.get("P5") ?? []) {
    if (s.metric.owner_is_controller !== "false") owners.set(key(s.metric), ownerOf(s.metric));
  }
  return (results.get("RS2") ?? []).map((s) => {
    const k = key(s.metric);
    const readyValue = valueOf(results, "RS4", ready, k);
    return {
      ...base("replicaset", k, seconds(created.get(k))),
      desired: s.value,
      current: valueOf(results, "RS3", current, k),
      ready: readyValue,
      owner: owners.get(k) ?? null,
      warnings: replicaWarning(readyValue, s.value),
    };
  });
}

function buildJobs(results: QueryResults): JobRow[] {
  const key = (m: Record<string, string>) => nsKey(m, "job_name");
  const [active, succeeded, completions, complete, created] = (
    ["J1", "J2", "J4", "J5", "J6"] as QueryId[]
  ).map((id) => valueMap(results.get(id), key));
  const failed = new Map<string, { total: number; reasons: string[] }>();
  for (const s of results.get("J3") ?? []) {
    const k = key(s.metric);
    const entry = failed.get(k) ?? { total: 0, reasons: [] };
    entry.total += s.value;
    if (s.value > 0 && s.metric.reason) entry.reasons.push(s.metric.reason);
    failed.set(k, entry);
  }
  const owners = new Map<string, Owner | null>();
  for (const s of results.get("J7") ?? []) owners.set(key(s.metric), ownerOf(s.metric));
  const keys = new Set([...active.keys(), ...succeeded.keys(), ...failed.keys()]);
  return [...keys].map((k) => {
    const f = failed.get(k);
    const failedTotal = results.has("J3") ? (f?.total ?? 0) : null;
    return {
      ...base("job", k, seconds(created.get(k))),
      active: valueOf(results, "J1", active, k),
      succeeded: valueOf(results, "J2", succeeded, k),
      failed: failedTotal,
      failedReasons: [...new Set(f?.reasons ?? [])].sort(),
      completions: valueOf(results, "J4", completions, k),
      complete: (complete.get(k) ?? 0) >= 1,
      owner: owners.get(k) ?? null,
      warnings:
        failedTotal != null && failedTotal > 0
          ? [{ key: "infra.k8s2.warnJobFailed", severity: "error" } as Warning]
          : [],
    };
  });
}

function buildCronJobs(results: QueryResults): CronJobRow[] {
  const key = (m: Record<string, string>) => nsKey(m, "cronjob");
  const schedule = new Map<string, string>();
  for (const s of results.get("CJ1") ?? []) schedule.set(key(s.metric), s.metric.schedule ?? "");
  const [suspend, active, created] = (["CJ2", "CJ3", "CJ4"] as QueryId[]).map((id) =>
    valueMap(results.get(id), key),
  );
  const jobCreated = valueMap(results.get("J6"), (m) => nsKey(m, "job_name"));
  const jobs = new Map<string, string[]>();
  for (const s of results.get("J7") ?? []) {
    const owner = ownerOf(s.metric);
    if (owner?.kind !== "CronJob") continue;
    const k = encodeCompound([clusterOf(s.metric), s.metric.namespace ?? "", owner.name]);
    jobs.set(k, [...(jobs.get(k) ?? []), s.metric.job_name]);
  }
  const keys = new Set([...schedule.keys(), ...suspend.keys()]);
  return [...keys].map((k) => {
    const row = base("cronjob", k, seconds(created.get(k)));
    const owned = (jobs.get(k) ?? []).sort();
    const newest = owned
      .map((job) => jobCreated.get(encodeCompound([row.cluster, row.namespace, job])))
      .filter((v): v is number => v != null);
    const suspendValue = valueOf(results, "CJ2", suspend, k);
    return {
      ...row,
      schedule: schedule.get(k) ?? null,
      suspend: suspendValue == null ? null : suspendValue >= 1,
      active: valueOf(results, "CJ3", active, k),
      lastSchedule: newest.length ? seconds(Math.max(...newest)) : null,
      jobs: owned,
    };
  });
}

function buildPvcs(results: QueryResults): PvcRow[] {
  const key = (m: Record<string, string>) => nsKey(m, "persistentvolumeclaim");
  const phase = new Map<string, string>();
  for (const s of results.get("V1") ?? []) phase.set(key(s.metric), s.metric.phase);
  const storageClass = new Map<string, string>();
  for (const s of results.get("V2") ?? []) {
    storageClass.set(key(s.metric), s.metric.storageclass ?? "");
  }
  const [size, created] = (["V3", "V4"] as QueryId[]).map((id) => valueMap(results.get(id), key));
  const pods = new Map<string, string[]>();
  for (const s of results.get("K7") ?? []) {
    const m = s.metric;
    const k = encodeCompound([
      clusterOf(m),
      m.k8s_namespace_name ?? "",
      m.k8s_persistentvolumeclaim_name ?? "",
    ]);
    pods.set(k, [...new Set([...(pods.get(k) ?? []), m.k8s_pod_name])].sort());
  }
  return [...phase.keys()].map((k) => {
    const p = phase.get(k) ?? null;
    const warnings: Warning[] = [];
    if (p === "Pending") {
      warnings.push({ key: "infra.k8s2.warnPhase", params: { phase: p }, severity: "warning" });
    }
    if (p === "Lost") {
      warnings.push({ key: "infra.k8s2.warnPhase", params: { phase: p }, severity: "error" });
    }
    return {
      ...base("pvc", k, seconds(created.get(k))),
      phase: p,
      storageClass: results.has("V2") ? (storageClass.get(k) ?? null) : null,
      size: valueOf(results, "V3", size, k),
      pods: results.has("K7") ? (pods.get(k) ?? []) : null,
      warnings,
    };
  });
}

function buildHpas(results: QueryResults): HpaRow[] {
  const key = (m: Record<string, string>) => nsKey(m, "horizontalpodautoscaler");
  const [min, current, created] = (["H2", "H3", "H5"] as QueryId[]).map((id) =>
    valueMap(results.get(id), key),
  );
  const conditions = new Map<string, Array<{ condition: string; status: string }>>();
  for (const s of results.get("H4") ?? []) {
    const k = key(s.metric);
    conditions.set(k, [
      ...(conditions.get(k) ?? []),
      { condition: s.metric.condition, status: s.metric.status },
    ]);
  }
  const targets = new Map<string, Owner | null>();
  for (const s of results.get("H8") ?? []) {
    const m = s.metric;
    targets.set(
      key(m),
      m.scaletargetref_kind && m.scaletargetref_name
        ? { kind: m.scaletargetref_kind, name: m.scaletargetref_name }
        : null,
    );
  }
  return (results.get("H1") ?? []).map((s) => {
    const k = key(s.metric);
    const conds = conditions.get(k) ?? [];
    const has = (condition: string, status: string) =>
      conds.some((c) => c.condition === condition && c.status === status);
    const warnings: Warning[] = [];
    if (has("ScalingLimited", "true")) {
      warnings.push({ key: "infra.k8s2.warnScalingLimited", severity: "warning" });
    }
    if (has("AbleToScale", "false")) {
      warnings.push({ key: "infra.k8s2.warnUnableToScale", severity: "warning" });
    }
    return {
      ...base("hpa", k, seconds(created.get(k))),
      max: s.value,
      min: valueOf(results, "H2", min, k),
      current: valueOf(results, "H3", current, k),
      conditions: conds.filter((c) => c.status === "true"),
      target: targets.get(k) ?? null,
      warnings,
    };
  });
}

function buildNamespaces(results: QueryResults): NamespaceRow[] {
  const key = (m: Record<string, string>) => encodeCompound([clusterOf(m), m.namespace ?? ""]);
  const created = valueMap(results.get("NS2"), key);
  return (results.get("NS1") ?? []).map((s) => {
    const k = key(s.metric);
    const phase = s.metric.phase ?? null;
    return {
      ...base("namespace", k, seconds(created.get(k)), false),
      phase,
      warnings:
        phase === "Terminating"
          ? [{ key: "infra.k8s2.warnPhase", params: { phase }, severity: "warning" } as Warning]
          : [],
    };
  });
}

function unlabelledFamilies(results: QueryResults): MetricFamily[] {
  const seen = {
    ksm: { labelled: false, unlabelled: false },
    kubelet: { labelled: false, unlabelled: false },
  };
  for (const [id, series] of results) {
    if (id.startsWith("CL")) continue;
    const family = id.startsWith("K") || id === "O4" || id === "O5" ? seen.kubelet : seen.ksm;
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

function matchEvent(
  event: WarningEvent,
  byUid: Map<string, AnyRow>,
  byName: Map<string, AnyRow>,
): AnyRow | null {
  if (event.uid) {
    const exact = byUid.get(`${event.kind}|${event.uid}`);
    if (exact) return exact;
  }
  // A uid-bearing pod event belongs only to the pod with that uid; an ambiguous pod has none to match.
  if (event.uid && event.kind === "Pod") return null;
  const row = byName.get(`${event.kind}|${event.cluster}|${event.namespace}|${event.name}`);
  // A row whose uid is known and differs is a different generation of that name.
  return row && !(event.uid && row.uid) ? row : null;
}
