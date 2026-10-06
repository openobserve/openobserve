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
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import { KIND_INFO, type DetailKind, type View } from "./kubernetesQueries";
import {
  chipLabel,
  formatBytes,
  formatCores,
  formatPct,
  nodeConditionWords,
  toneOf,
  type AnyRow,
  type CronJobRow,
  type DaemonSetRow,
  type DeploymentRow,
  type HpaRow,
  type JobRow,
  type NamespaceRow,
  type NodeRow,
  type PodRow,
  type PvcRow,
  type ReplicaSetRow,
  type StatefulSetRow,
  type Tone,
} from "./kubernetesModel";
import { labelsOf } from "./kubernetesObjects";
import { detailKindOf, type EventRow } from "./kubernetesEvents";
import type { DetailsRef } from "./kubernetesUrlState";

export type CellRender =
  | "text"
  | "name"
  | "warn"
  | "namespace"
  | "link"
  | "age"
  | "status"
  | "bar"
  | "badges"
  | "conditions"
  | "containers";

export interface CellLink {
  label: I18nText;
  target: DetailsRef | null;
  tip?: I18nText;
}

export interface CellWord {
  text: I18nText;
  tone: Tone;
}

export interface CellBadge {
  text: I18nText;
  variant: BadgeVariant;
}

export interface K8sCellMeta {
  render: CellRender;
  cellClass: string;
  text?: (row: any) => I18nText;
  tone?: (row: any) => Tone | null;
  tip?: (row: any) => I18nText | null;
  links?: (row: any) => CellLink[];
  bar?: (row: any) => { pct: number | null; tip: I18nText };
  words?: (row: any) => CellWord[];
  badges?: (row: any) => CellBadge[] | null;
  at?: (row: any) => number | null;
  [key: string]: unknown;
}

export type K8sColumn = OTableColumnDef<any> & { meta: K8sCellMeta };

export interface ColumnContext {
  t: TranslateFn;
  endUs: number;
  // Events link their involved object only when its cluster is known (§3.2).
  eventLinks: boolean;
  cluster: string | null;
}

const DASH = raw("—");

const QOS_ORDER = { Guaranteed: 0, Burstable: 1, BestEffort: 2 } as const;

const STATUS_TONE: Record<string, Tone> = {
  Bound: "success",
  Pending: "warning",
  Lost: "error",
  Active: "success",
  Terminating: "error",
};

const HPA_VARIANT: Record<string, BadgeVariant> = {
  AbleToScale: "success-soft",
  ScalingActive: "blue-soft",
  ScalingLimited: "error-soft",
};

// Hidden by default per §4.0; every other hideable column starts visible.
export const HIDDEN_BY_DEFAULT: Partial<Record<View, string[]>> = {
  pods: ["ip", "cpuReq", "cpuLim", "memReq", "memLim"],
};

const num = (value: number | null) => (value == null ? DASH : raw(String(Math.round(value))));

const ratio = (a: number | null, b: number | null) => raw(`${a ?? "—"}/${b ?? "—"}`);

// Accessors return undefined for null so OTable's sortUndefined keeps them last both ways.
const sortable = (value: unknown) => (value == null ? undefined : value);

const ageOf = (ctx: ColumnContext, at: number | null) => (at == null ? undefined : ctx.endUs - at);

// A pod whose containers are all known but none sets the amount has no request (or limit) at all.
const noAmount = (amount: unknown) => amount === "missing" || amount === 0;

export function defaultSort(view: View): { sort: string; desc: boolean } {
  return view === "events" ? { sort: "lastSeen", desc: true } : { sort: "name", desc: false };
}

export function columnsFor(view: View, ctx: ColumnContext): K8sColumn[] {
  switch (view) {
    case "pods":
      return podColumns(ctx);
    case "nodes":
      return nodeColumns(ctx);
    case "deployments":
      return deploymentColumns(ctx);
    case "daemonsets":
      return daemonSetColumns(ctx);
    case "statefulsets":
      return statefulSetColumns(ctx);
    case "replicasets":
      return replicaSetColumns(ctx);
    case "jobs":
      return jobColumns(ctx);
    case "cronjobs":
      return cronJobColumns(ctx);
    case "pvcs":
      return pvcColumns(ctx);
    case "hpas":
      return hpaColumns(ctx);
    case "namespaces":
      return namespaceColumns(ctx);
    case "events":
      return eventColumns(ctx);
    default:
      return [];
  }
}

export function detailsOf(row: AnyRow): DetailsRef {
  return { kind: row.kind, cluster: row.cluster, namespace: row.namespace, name: row.name };
}

function col(
  id: string,
  header: I18nText,
  meta: Omit<K8sCellMeta, "cellClass">,
  opts: Partial<OTableColumnDef<any>> = {},
): K8sColumn {
  return {
    id,
    header,
    sortable: true,
    sortUndefined: "last",
    size: 120,
    ...opts,
    meta: { ...opts.meta, ...meta, cellClass: "text-compact" } as K8sCellMeta,
  };
}

function nameCol(ctx: ColumnContext): K8sColumn {
  return col(
    "name",
    ctx.t("infra.k8s2.columnName"),
    { render: "name", text: (r: AnyRow) => raw(r.name) },
    { accessorFn: (r: AnyRow) => r.name, size: 260, minSize: 160, meta: { isName: true } },
  );
}

function warnCol(): K8sColumn {
  return col(
    "warnings",
    raw(""),
    { render: "warn" },
    { accessorFn: (r: AnyRow) => r.warnings.length, size: 40 },
  );
}

function namespaceCol(ctx: ColumnContext): K8sColumn {
  return col(
    "namespace",
    ctx.t("infra.k8s2.columnNamespace"),
    { render: "namespace" },
    { accessorFn: (r: AnyRow) => r.namespace, size: 130 },
  );
}

// Age sorts on the duration; a "last seen" time sorts on the time itself, so descending is newest first.
function ageCol(
  ctx: ColumnContext,
  id = "age",
  header?: I18nText,
  at?: (r: any) => number | null,
  byTime = false,
) {
  const pick = at ?? ((r: AnyRow) => r.createdAt);
  return col(
    id,
    header ?? ctx.t("infra.k8s2.columnAge"),
    { render: "age", at: pick },
    { accessorFn: (r: any) => (byTime ? sortable(pick(r)) : ageOf(ctx, pick(r))), size: 80 },
  );
}

function ownerLink(row: AnyRow, owner: { kind: string; name: string } | null) {
  if (!owner) return [];
  const kind = detailKindOf(owner.kind);
  return [
    {
      label: raw(owner.kind),
      tip: raw(owner.name),
      target: kind
        ? {
            kind,
            cluster: row.cluster,
            namespace: KIND_INFO[kind].namespaced ? row.namespace : "",
            name: owner.name,
          }
        : null,
    },
  ];
}

function pctCol(
  id: string,
  header: I18nText,
  pick: (r: PodRow) => number | null,
  missing: (r: PodRow) => boolean,
  missingText: I18nText,
) {
  return col(
    id,
    header,
    {
      render: "text",
      text: (r: PodRow) =>
        pick(r) != null ? raw(formatPct(pick(r))) : missing(r) ? missingText : DASH,
    },
    { accessorFn: (r: PodRow) => sortable(pick(r)), hideable: true, size: 100 },
  );
}

function usageTip(
  ctx: ColumnContext,
  ofRequest: number | null,
  ofLimit: number | null,
  request: unknown,
) {
  if (ofRequest == null && ofLimit == null) {
    return request === "missing" || request == null ? ctx.t("infra.k8s2.noRequest") : null;
  }
  return ctx.t("infra.k8s2.usageTip", { request: formatPct(ofRequest), limit: formatPct(ofLimit) });
}

function podColumns(ctx: ColumnContext): K8sColumn[] {
  const t = ctx.t;
  return [
    nameCol(ctx),
    warnCol(),
    namespaceCol(ctx),
    col(
      "containers",
      t("infra.k8s2.columnContainers"),
      { render: "containers" },
      {
        accessorFn: (r: PodRow) => r.containers.length,
        size: 110,
      },
    ),
    col(
      "cpu",
      t("infra.k8s2.columnCpu"),
      {
        render: "text",
        text: (r: PodRow) => raw(formatCores(r.cpuCores)),
        tip: (r: PodRow) => usageTip(ctx, r.cpuPctOfRequest, r.cpuPctOfLimit, r.cpuRequest),
      },
      { accessorFn: (r: PodRow) => sortable(r.cpuCores), size: 80 },
    ),
    col(
      "memory",
      t("infra.k8s2.columnMemory"),
      {
        render: "text",
        text: (r: PodRow) => raw(formatBytes(r.memoryBytes)),
        tip: (r: PodRow) =>
          usageTip(ctx, r.memoryPctOfRequest, r.memoryPctOfLimit, r.memoryRequest),
      },
      { accessorFn: (r: PodRow) => sortable(r.memoryBytes), size: 90 },
    ),
    col(
      "restarts",
      t("infra.k8s2.columnRestarts"),
      { render: "text", text: (r: PodRow) => num(r.restarts) },
      { accessorFn: (r: PodRow) => sortable(r.restarts), size: 80 },
    ),
    col(
      "controller",
      t("infra.k8s2.columnControlledBy"),
      { render: "link", links: (r: PodRow) => ownerLink(r, r.controller) },
      {
        accessorFn: (r: PodRow) =>
          r.controller ? `${r.controller.kind}/${r.controller.name}` : undefined,
        size: 120,
      },
    ),
    col(
      "node",
      t("infra.k8s2.columnNode"),
      {
        render: "link",
        links: (r: PodRow) =>
          r.node
            ? [
                {
                  label: raw(r.node),
                  target: { kind: "node", cluster: r.cluster, namespace: "", name: r.node },
                },
              ]
            : [],
      },
      { accessorFn: (r: PodRow) => r.node || undefined, size: 200 },
    ),
    col(
      "qos",
      t("infra.k8s2.columnQos"),
      {
        render: "text",
        text: (r: PodRow) =>
          !r.qos
            ? DASH
            : r.qos.estimated
              ? t("infra.k8s2.qosEstimated", { cls: raw(r.qos.cls) })
              : raw(r.qos.cls),
        tip: (r: PodRow) => (r.qos?.estimated ? t("infra.k8s2.qosEstimatedTip") : null),
      },
      {
        accessorFn: (r: PodRow) => (r.qos ? QOS_ORDER[r.qos.cls] : undefined),
        hideable: true,
        size: 110,
      },
    ),
    ageCol(ctx),
    col(
      "status",
      t("infra.k8s2.columnStatus"),
      {
        render: "status",
        text: (r: PodRow) => (r.status ? chipLabel(r.status, t) : DASH),
        tone: (r: PodRow) => (r.status ? toneOf(r.status.variant) : null),
        tip: (r: PodRow) => (r.ambiguous ? t("infra.k8s2.ambiguous") : null),
      },
      { accessorFn: (r: PodRow) => r.status?.text ?? r.status?.key ?? undefined, size: 150 },
    ),
    col(
      "ip",
      t("infra.k8s2.columnIp"),
      { render: "text", text: (r: PodRow) => (r.ip ? raw(r.ip) : DASH) },
      { accessorFn: (r: PodRow) => r.ip ?? undefined, hideable: true, size: 120 },
    ),
    pctCol(
      "cpuReq",
      t("infra.k8s2.columnCpuReq"),
      (r) => r.cpuPctOfRequest,
      (r) => noAmount(r.cpuRequest),
      t("infra.k8s2.noRequest"),
    ),
    pctCol(
      "cpuLim",
      t("infra.k8s2.columnCpuLim"),
      (r) => r.cpuPctOfLimit,
      (r) => noAmount(r.cpuLimit),
      t("infra.k8s2.noLimit"),
    ),
    pctCol(
      "memReq",
      t("infra.k8s2.columnMemReq"),
      (r) => r.memoryPctOfRequest,
      (r) => noAmount(r.memoryRequest),
      t("infra.k8s2.noRequest"),
    ),
    pctCol(
      "memLim",
      t("infra.k8s2.columnMemLim"),
      (r) => r.memoryPctOfLimit,
      (r) => noAmount(r.memoryLimit),
      t("infra.k8s2.noLimit"),
    ),
  ];
}

function nodeBar(
  id: string,
  header: I18nText,
  pick: (r: NodeRow) => number | null,
  tip: (r: NodeRow) => I18nText,
) {
  return col(
    id,
    header,
    { render: "bar", bar: (r: NodeRow) => ({ pct: pick(r), tip: tip(r) }) },
    { accessorFn: (r: NodeRow) => sortable(pick(r)), size: 130 },
  );
}

function nodeColumns(ctx: ColumnContext): K8sColumn[] {
  const t = ctx.t;
  return [
    nameCol(ctx),
    warnCol(),
    nodeBar(
      "cpu",
      t("infra.k8s2.columnCpu"),
      (r) => r.cpuPct,
      (r) =>
        t("infra.k8s2.nodeCpuTip", {
          pct: formatPct(r.cpuPct),
          cores: formatCores(r.allocatable.cpu ?? null),
        }),
    ),
    nodeBar(
      "memory",
      t("infra.k8s2.columnMemory"),
      (r) => r.memoryPct,
      (r) =>
        t("infra.k8s2.nodeMemoryTip", {
          pct: formatPct(r.memoryPct),
          bytes: formatBytes(r.memoryBytes),
        }),
    ),
    nodeBar(
      "disk",
      t("infra.k8s2.columnDisk"),
      (r) => r.diskPct,
      (r) =>
        t("infra.k8s2.nodeDiskTip", {
          pct: formatPct(r.diskPct),
          used: formatBytes(r.diskUsed),
          capacity: formatBytes(r.diskCapacity),
        }),
    ),
    col(
      "taints",
      t("infra.k8s2.columnTaints"),
      {
        render: "text",
        text: (r: NodeRow) => (r.taints ? raw(String(r.taints.length)) : DASH),
        tip: (r: NodeRow) =>
          r.taints?.length
            ? raw(
                r.taints
                  .map((x) => `${x.key}${x.value ? `=${x.value}` : ""}:${x.effect}`)
                  .join("\n"),
              )
            : null,
      },
      { accessorFn: (r: NodeRow) => r.taints?.length, hideable: true, size: 80 },
    ),
    col(
      "roles",
      t("infra.k8s2.columnRoles"),
      { render: "text", text: (r: NodeRow) => (r.roles?.length ? raw(r.roles.join(", ")) : DASH) },
      { accessorFn: (r: NodeRow) => (r.roles?.length ? r.roles.join(",") : undefined), size: 120 },
    ),
    col(
      "version",
      t("infra.k8s2.columnVersion"),
      {
        render: "text",
        text: (r: NodeRow) => (r.info?.kubelet_version ? raw(r.info.kubelet_version) : DASH),
      },
      { accessorFn: (r: NodeRow) => r.info?.kubelet_version || undefined, size: 110 },
    ),
    ageCol(ctx),
    col(
      "conditions",
      t("infra.k8s2.columnConditions"),
      {
        render: "conditions",
        words: (r: NodeRow) =>
          nodeConditionWords(r).map((w) => ({ text: raw(w.text), tone: toneOf(w.variant) })),
        tip: (r: NodeRow) =>
          Object.keys(r.conditions).length
            ? raw(
                Object.entries(r.conditions)
                  .map(([c, s]) => `${c}: ${s}`)
                  .join("\n"),
              )
            : null,
      },
      {
        accessorFn: (r: NodeRow) =>
          nodeConditionWords(r)
            .map((w) => w.text)
            .join(" ") || undefined,
        size: 200,
      },
    ),
  ];
}

function deploymentColumns(ctx: ColumnContext): K8sColumn[] {
  const t = ctx.t;
  return [
    nameCol(ctx),
    warnCol(),
    namespaceCol(ctx),
    col(
      "pods",
      t("infra.k8s2.columnPods"),
      { render: "text", text: (r: DeploymentRow) => ratio(r.available, r.replicas) },
      { sortable: false, size: 80 },
    ),
    col(
      "replicas",
      t("infra.k8s2.columnReplicas"),
      { render: "text", text: (r: DeploymentRow) => num(r.desired) },
      { accessorFn: (r: DeploymentRow) => sortable(r.desired), hideable: true, size: 90 },
    ),
    ageCol(ctx),
    col(
      "conditions",
      t("infra.k8s2.columnConditions"),
      {
        render: "conditions",
        words: (r: DeploymentRow) =>
          r.conditions.map((c) => ({ text: raw(c.text), tone: toneOf(c.variant) })),
        tip: (r: DeploymentRow) => (r.conditionsDerived ? t("infra.k8s2.derivedConditions") : null),
      },
      {
        accessorFn: (r: DeploymentRow) => r.conditions.map((c) => c.text).join(" ") || undefined,
        size: 180,
      },
    ),
  ];
}

function daemonSetColumns(ctx: ColumnContext): K8sColumn[] {
  const t = ctx.t;
  return [
    nameCol(ctx),
    namespaceCol(ctx),
    col(
      "pods",
      t("infra.k8s2.columnPods"),
      { render: "text", text: (r: DaemonSetRow) => num(r.current) },
      { accessorFn: (r: DaemonSetRow) => sortable(r.current), size: 80 },
    ),
    warnCol(),
    col(
      "nodeSelector",
      t("infra.k8s2.columnNodeSelector"),
      {
        render: "badges",
        badges: (r: DaemonSetRow) =>
          r.nodeSelector
            ? Object.entries(r.nodeSelector).map(([k, v]) => ({
                text: raw(`${k}: ${v}`),
                variant: "default-soft",
              }))
            : null,
      },
      {
        accessorFn: (r: DaemonSetRow) =>
          r.nodeSelector ? Object.keys(r.nodeSelector).join(",") : undefined,
        hideable: true,
        size: 200,
      },
    ),
    ageCol(ctx),
  ];
}

function statefulSetColumns(ctx: ColumnContext): K8sColumn[] {
  const t = ctx.t;
  return [
    nameCol(ctx),
    namespaceCol(ctx),
    col(
      "pods",
      t("infra.k8s2.columnPods"),
      { render: "text", text: (r: StatefulSetRow) => ratio(r.ready, r.current) },
      { accessorFn: (r: StatefulSetRow) => sortable(r.ready), size: 80 },
    ),
    col(
      "replicas",
      t("infra.k8s2.columnReplicas"),
      { render: "text", text: (r: StatefulSetRow) => num(r.replicas) },
      { accessorFn: (r: StatefulSetRow) => sortable(r.replicas), hideable: true, size: 90 },
    ),
    warnCol(),
    ageCol(ctx),
  ];
}

function replicaSetColumns(ctx: ColumnContext): K8sColumn[] {
  const t = ctx.t;
  const count = (
    id: string,
    header: I18nText,
    pick: (r: ReplicaSetRow) => number | null,
    hideable = false,
  ) =>
    col(
      id,
      header,
      { render: "text", text: (r: ReplicaSetRow) => num(pick(r)) },
      {
        accessorFn: (r: ReplicaSetRow) => sortable(pick(r)),
        hideable,
        size: 80,
      },
    );
  return [
    nameCol(ctx),
    warnCol(),
    namespaceCol(ctx),
    count("desired", t("infra.k8s2.columnDesired"), (r) => r.desired),
    count("current", t("infra.k8s2.columnCurrent"), (r) => r.current, true),
    count("ready", t("infra.k8s2.columnReady"), (r) => r.ready),
    ageCol(ctx),
  ];
}

export function jobConditionWords(r: JobRow): CellWord[] {
  const words: CellWord[] = [];
  if (r.complete) words.push({ text: raw("Complete"), tone: "success" });
  if ((r.failed ?? 0) > 0) words.push({ text: raw("Failed"), tone: "error" });
  return words;
}

function jobColumns(ctx: ColumnContext): K8sColumn[] {
  const t = ctx.t;
  return [
    nameCol(ctx),
    namespaceCol(ctx),
    col(
      "completions",
      t("infra.k8s2.columnCompletions"),
      { render: "text", text: (r: JobRow) => ratio(r.succeeded, r.completions) },
      { accessorFn: (r: JobRow) => sortable(r.succeeded), hideable: true, size: 110 },
    ),
    warnCol(),
    ageCol(ctx),
    col(
      "conditions",
      t("infra.k8s2.columnConditions"),
      {
        render: "conditions",
        words: (r: JobRow) => jobConditionWords(r),
        tip: (r: JobRow) => (r.failedReasons.length ? raw(r.failedReasons.join(", ")) : null),
      },
      {
        accessorFn: (r: JobRow) =>
          jobConditionWords(r)
            .map((w) => w.text)
            .join(" ") || undefined,
        size: 140,
      },
    ),
  ];
}

function cronJobColumns(ctx: ColumnContext): K8sColumn[] {
  const t = ctx.t;
  return [
    nameCol(ctx),
    warnCol(),
    namespaceCol(ctx),
    col(
      "schedule",
      t("infra.k8s2.columnSchedule"),
      { render: "text", text: (r: CronJobRow) => (r.schedule ? raw(r.schedule) : DASH) },
      { accessorFn: (r: CronJobRow) => r.schedule ?? undefined, size: 120 },
    ),
    col(
      "suspend",
      t("infra.k8s2.columnSuspend"),
      {
        render: "text",
        text: (r: CronJobRow) => (r.suspend == null ? DASH : raw(String(r.suspend))),
      },
      {
        accessorFn: (r: CronJobRow) => (r.suspend == null ? undefined : String(r.suspend)),
        size: 90,
      },
    ),
    col(
      "active",
      t("infra.k8s2.columnActive"),
      { render: "text", text: (r: CronJobRow) => num(r.active) },
      { accessorFn: (r: CronJobRow) => sortable(r.active), size: 80 },
    ),
    {
      ...ageCol(
        ctx,
        "lastSchedule",
        t("infra.k8s2.columnLastSchedule"),
        (r: CronJobRow) => r.lastSchedule,
      ),
      hideable: true,
      size: 120,
    },
    ageCol(ctx),
  ];
}

function pvcColumns(ctx: ColumnContext): K8sColumn[] {
  const t = ctx.t;
  return [
    nameCol(ctx),
    warnCol(),
    namespaceCol(ctx),
    col(
      "storageClass",
      t("infra.k8s2.columnStorageClass"),
      { render: "text", text: (r: PvcRow) => (r.storageClass ? raw(r.storageClass) : DASH) },
      { accessorFn: (r: PvcRow) => r.storageClass || undefined, hideable: true, size: 120 },
    ),
    col(
      "size",
      t("infra.k8s2.columnSize"),
      { render: "text", text: (r: PvcRow) => raw(formatBytes(r.size)) },
      { accessorFn: (r: PvcRow) => sortable(r.size), size: 90 },
    ),
    col(
      "pods",
      t("infra.k8s2.columnPods"),
      {
        render: "link",
        links: (r: PvcRow) =>
          (r.pods ?? []).map((pod) => ({
            label: raw(pod),
            target: {
              kind: "pod" as DetailKind,
              cluster: r.cluster,
              namespace: r.namespace,
              name: pod,
            },
          })),
      },
      { accessorFn: (r: PvcRow) => (r.pods?.length ? r.pods.join(",") : undefined), size: 200 },
    ),
    ageCol(ctx),
    col(
      "status",
      t("infra.k8s2.columnStatus"),
      {
        render: "status",
        text: (r: PvcRow) => (r.phase ? raw(r.phase) : DASH),
        tone: (r: PvcRow) => (r.phase ? (STATUS_TONE[r.phase] ?? "neutral") : null),
      },
      { accessorFn: (r: PvcRow) => r.phase ?? undefined, size: 100 },
    ),
  ];
}

function hpaColumns(ctx: ColumnContext): K8sColumn[] {
  const t = ctx.t;
  const count = (
    id: string,
    header: I18nText,
    pick: (r: HpaRow) => number | null,
    hideable = false,
  ) =>
    col(
      id,
      header,
      { render: "text", text: (r: HpaRow) => num(pick(r)) },
      {
        accessorFn: (r: HpaRow) => sortable(pick(r)),
        hideable,
        size: 90,
      },
    );
  return [
    nameCol(ctx),
    warnCol(),
    namespaceCol(ctx),
    count("min", t("infra.k8s2.columnMinPods"), (r) => r.min, true),
    count("max", t("infra.k8s2.columnMaxPods"), (r) => r.max),
    count("replicas", t("infra.k8s2.columnReplicas"), (r) => r.current),
    ageCol(ctx),
    col(
      "status",
      t("infra.k8s2.columnStatus"),
      {
        render: "badges",
        badges: (r: HpaRow) =>
          r.conditions.map((c) => ({
            text: raw(c.condition),
            variant: HPA_VARIANT[c.condition] ?? "default-soft",
          })),
      },
      {
        accessorFn: (r: HpaRow) => r.conditions.map((c) => c.condition).join(" ") || undefined,
        size: 220,
      },
    ),
  ];
}

function namespaceColumns(ctx: ColumnContext): K8sColumn[] {
  const t = ctx.t;
  return [
    nameCol(ctx),
    warnCol(),
    col(
      "labels",
      t("infra.k8s2.columnLabels"),
      {
        render: "badges",
        badges: (r: NamespaceRow) => {
          const labels = labelsOf(r.object);
          return labels
            ? Object.entries(labels).map(([k, v]) => ({
                text: raw(`${k}=${v}`),
                variant: "default-soft",
              }))
            : null;
        },
      },
      { sortable: false, hideable: true, size: 300 },
    ),
    ageCol(ctx),
    col(
      "status",
      t("infra.k8s2.columnStatus"),
      {
        render: "status",
        text: (r: NamespaceRow) => (r.phase ? raw(r.phase) : DASH),
        tone: (r: NamespaceRow) => (r.phase ? (STATUS_TONE[r.phase] ?? "neutral") : null),
      },
      { accessorFn: (r: NamespaceRow) => r.phase ?? undefined, size: 110 },
    ),
  ];
}

export function eventTarget(
  e: EventRow,
  ctx: Pick<ColumnContext, "eventLinks" | "cluster">,
): DetailsRef | null {
  const kind = detailKindOf(e.object.kind);
  if (!kind || !ctx.eventLinks || !ctx.cluster || !e.object.name) return null;
  return {
    kind,
    cluster: ctx.cluster,
    namespace: KIND_INFO[kind].namespaced ? e.object.namespace : "",
    name: e.object.name,
  };
}

function eventColumns(ctx: ColumnContext): K8sColumn[] {
  const t = ctx.t;
  return [
    col(
      "type",
      t("infra.k8s2.columnType"),
      { render: "text", text: (e: EventRow) => raw(e.type) },
      { accessorFn: (e: EventRow) => e.type || undefined, size: 90 },
    ),
    col(
      "message",
      t("infra.k8s2.columnMessage"),
      {
        render: "status",
        text: (e: EventRow) => raw(e.note),
        tone: (e: EventRow) => (e.type === "Warning" ? "error" : null),
        tip: (e: EventRow) => (e.note ? raw(e.note) : null),
      },
      {
        accessorFn: (e: EventRow) => e.note || undefined,
        size: 360,
        meta: { autoWidth: true } as any,
      },
    ),
    col(
      "namespace",
      t("infra.k8s2.columnNamespace"),
      { render: "namespace" },
      { accessorFn: (e: EventRow) => e.object.namespace || undefined, size: 130 },
    ),
    col(
      "involved",
      t("infra.k8s2.columnInvolvedObject"),
      {
        render: "link",
        links: (e: EventRow) => [
          {
            label: raw(`${e.object.kind}: ${e.object.name}`),
            target: eventTarget(e, ctx),
            tip:
              !ctx.eventLinks && detailKindOf(e.object.kind)
                ? t("infra.k8s2.eventClusterUnknown")
                : undefined,
          },
        ],
      },
      { accessorFn: (e: EventRow) => `${e.object.kind}/${e.object.name}`, size: 260 },
    ),
    col(
      "source",
      t("infra.k8s2.columnSource"),
      { render: "text", text: (e: EventRow) => (e.source ? raw(e.source) : DASH) },
      { accessorFn: (e: EventRow) => e.source || undefined, hideable: true, size: 200 },
    ),
    col(
      "count",
      t("infra.k8s2.columnCount"),
      { render: "text", text: (e: EventRow) => num(e.count) },
      { accessorFn: (e: EventRow) => sortable(e.count), size: 70 },
    ),
    ageCol(ctx, "age", t("infra.k8s2.columnAge"), (e: EventRow) => e.firstSeen),
    ageCol(ctx, "lastSeen", t("infra.k8s2.columnLastSeen"), (e: EventRow) => e.lastSeen, true),
  ];
}
