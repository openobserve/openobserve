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

// The curated engine's pure passes (design §5.2-§5.5). No Vue, no store, no
// network — the dictionary arrives as a FieldAlias[] argument and the timezone
// as a buildDashboard option, so every rung is assertable off fixtures.

import { describe, it, expect } from "vitest";
import type { FieldAlias } from "@/services/service_streams";
import defaultSemanticGroups from "./packs/__fixtures__/semanticGroups.default.json";
import {
  resolveManifest,
  buildDashboard,
  lintManifest,
  promEscape,
  sqlEscape,
  STALE_GRACE_US,
} from "./resolve";
import { b64DecodeUnicodeSafe } from "@/utils/formatters";
import { useVariablesManager } from "@/composables/dashboard/useVariablesManager";
import { buildScopedDependencyGraph } from "@/utils/dashboard/variables/variablesDependencyUtils";
import hostMetricsDashboard from "@/assets/dashboards/host_metrics.dashboard.json";
import { GROUP, STALENESS_24H_US } from "./types";
import { kubernetesPage } from "./packs/kubernetes.page";
import { hostsPage } from "./packs/hosts.page";

// ── Fixture helpers ────────────────────────────────────────────────────────
// doc_time_max is a MICROSECOND epoch (§3.2). Every literal below is raw µs so
// a unit slip in the resolver is visible in the fixture, not hidden by a helper.

const NOW_US = 1_800_000_000_000_000;
const HOUR_US = 60 * 60 * 1_000_000;
const DAY_US = 24 * HOUR_US;

/** The 3h page range the packs default to, in µs. */
const RANGE = { start: NOW_US - 3 * HOUR_US, end: NOW_US };

interface StreamFixture {
  name: string;
  docTimeMax?: number;
  docNum?: number;
  createdAt?: number;
  schema?: string[];
}

/** A cached stream-list entry in the shape useStreams serves (§3.2). */
const streamEntry = (f: StreamFixture) => ({
  name: f.name,
  stats: {
    created_at: f.createdAt ?? 0,
    doc_time_min: 0,
    doc_time_max: f.docTimeMax ?? NOW_US - 60 * 1_000_000,
    doc_num: f.docNum ?? 1,
    file_num: 1,
    storage_size: 1,
    compressed_size: 1,
    index_size: 0,
  },
  schema: (f.schema ?? []).map((name) => ({ name, type: "Utf8" })),
});

const streamLists = (metrics: StreamFixture[], logs: StreamFixture[] = []) => ({
  metrics: metrics.map(streamEntry),
  logs: logs.map(streamEntry),
  traces: [],
});

const groups = defaultSemanticGroups as FieldAlias[];

const groupById = (id: string): FieldAlias => {
  const found = groups.find((g) => g.id === id);
  if (!found) throw new Error(`fixture group ${id} missing from the committed snapshot`);
  return found;
};

/** The dictionary slice a case needs, sliced from the committed snapshot. */
const dictionary = (...ids: string[]): FieldAlias[] => ids.map(groupById);

const K8S_FULL_DICT = dictionary(
  GROUP.namespace,
  GROUP.pod,
  GROUP.node,
  GROUP.cluster,
  GROUP.container,
  GROUP.host,
);

// Schema sets measured on the live enterprise org (dry run findings 5, 12).
// The node fixture keeps the k8s_cluster_name spelling deliberately: it is the
// drift case that proves the cluster token resolves per PANEL STREAM rather than
// once per pack, and the substitution tests below assert both spellings appear.
const KUBELET_NODE_SCHEMA = ["k8s_node_name", "k8s_cluster_name", "_timestamp", "value"];
// Re-measured 2026-09-05: every kubeletstats POD stream carries a cluster field,
// so the Workloads panels can scope by cluster — they were simply never asked to.
const KUBELET_POD_SCHEMA = [
  "k8s_namespace_name",
  "k8s_pod_name",
  "k8s_cluster",
  "_timestamp",
  "value",
];
// kube-state carries the UNSUFFIXED k8s_cluster where kubeletstats carries
// k8s_cluster_name — measured on the live org, and the reason the cluster token
// must resolve per panel stream rather than once per pack.
const KUBE_POD_PHASE_SCHEMA = ["namespace", "pod", "phase", "k8s_cluster", "_timestamp", "value"];
const KUBE_NODE_COND_SCHEMA = ["node", "condition", "status", "k8s_cluster", "_timestamp", "value"];

// Live schema, fetched 2026-09-04: capacity is a NODE property, so there is no
// `namespace` here — a namespace matcher on it is silently dropped and returns
// the whole fleet (addendum §2.7c).
const KUBE_NODE_ALLOC_SCHEMA = ["node", "resource", "k8s_cluster", "_timestamp", "value"];

// Live schemas, fetched 2026-09-05: the kube_pod_container_status_* families carry a
// `container` label the phase family does not, and the controller families are keyed
// by their own kind rather than by pod.
const KUBE_CONTAINER_SCHEMA = [
  "namespace",
  "pod",
  "container",
  "reason",
  "k8s_cluster",
  "_timestamp",
  "value",
];
const kubeKindSchema = (kind: string) => ["namespace", kind, "k8s_cluster", "_timestamp", "value"];

/** A full, live k8s org: every pack stream present and fresh. */
const fullK8sStreams = () =>
  streamLists([
    { name: "k8s_node_cpu_usage", schema: KUBELET_NODE_SCHEMA },
    { name: "k8s_node_memory_usage", schema: KUBELET_NODE_SCHEMA },
    { name: "k8s_node_memory_rss", schema: KUBELET_NODE_SCHEMA },
    { name: "k8s_node_network_io", schema: KUBELET_NODE_SCHEMA },
    { name: "k8s_pod_cpu_usage", schema: KUBELET_POD_SCHEMA },
    { name: "k8s_pod_memory_usage", schema: KUBELET_POD_SCHEMA },
    { name: "k8s_pod_memory_limit_utilization", schema: KUBELET_POD_SCHEMA },
    { name: "k8s_pod_network_io", schema: KUBELET_POD_SCHEMA },
    { name: "k8s_pod_filesystem_usage", schema: KUBELET_POD_SCHEMA },
    { name: "k8s_pod_filesystem_capacity", schema: KUBELET_POD_SCHEMA },
    { name: "kube_pod_status_phase", schema: KUBE_POD_PHASE_SCHEMA },
    { name: "kube_node_status_condition", schema: KUBE_NODE_COND_SCHEMA },
    { name: "kube_node_status_allocatable", schema: KUBE_NODE_ALLOC_SCHEMA },
    { name: "kube_pod_container_resource_requests", schema: KUBE_POD_PHASE_SCHEMA },
    { name: "kube_pod_container_resource_limits", schema: KUBE_POD_PHASE_SCHEMA },
    { name: "k8s_pod_cpu_request_utilization", schema: KUBELET_POD_SCHEMA },
    { name: "k8s_pod_memory_request_utilization", schema: KUBELET_POD_SCHEMA },
    { name: "kube_pod_container_status_restarts_total", schema: KUBE_POD_PHASE_SCHEMA },
    { name: "kube_pod_container_status_waiting_reason", schema: KUBE_CONTAINER_SCHEMA },
    { name: "kube_pod_container_status_terminated_reason", schema: KUBE_CONTAINER_SCHEMA },
    { name: "kube_deployment_spec_replicas", schema: kubeKindSchema("deployment") },
    { name: "kube_deployment_status_replicas_ready", schema: kubeKindSchema("deployment") },
    { name: "kube_statefulset_replicas", schema: kubeKindSchema("statefulset") },
    { name: "kube_statefulset_status_replicas_ready", schema: kubeKindSchema("statefulset") },
    { name: "kube_daemonset_status_number_unavailable", schema: kubeKindSchema("daemonset") },
    { name: "kube_job_status_failed", schema: kubeKindSchema("job_name") },
    {
      name: "kube_persistentvolumeclaim_status_phase",
      schema: [...kubeKindSchema("persistentvolumeclaim"), "phase"],
    },
    {
      name: "kube_horizontalpodautoscaler_status_condition",
      schema: [...kubeKindSchema("horizontalpodautoscaler"), "condition", "status"],
    },
  ]);

const HOST_SCHEMA = ["host_name", "state", "device", "mountpoint", "direction"];

const fullHostsStreams = () =>
  streamLists([
    { name: "system_cpu_time", schema: HOST_SCHEMA },
    { name: "system_memory_usage", schema: HOST_SCHEMA },
    { name: "system_cpu_load_average_1m", schema: HOST_SCHEMA },
    { name: "system_cpu_load_average_5m", schema: HOST_SCHEMA },
    { name: "system_cpu_load_average_15m", schema: HOST_SCHEMA },
    { name: "system_disk_io", schema: HOST_SCHEMA },
    { name: "system_filesystem_usage", schema: HOST_SCHEMA },
    { name: "system_network_io", schema: HOST_SCHEMA },
  ]);

/** The one call every case makes — named args so a signature change fails loudly. */
const resolve = (args: {
  manifest?: any;
  streams?: ReturnType<typeof streamLists>;
  dict?: FieldAlias[];
  range?: { start: number; end: number };
  now?: number;
  pins?: Record<string, string>;
  lastSeenUs?: number;
}) =>
  resolveManifest({
    manifest: args.manifest ?? kubernetesPage,
    streams: args.streams ?? fullK8sStreams(),
    semanticGroups: args.dict ?? K8S_FULL_DICT,
    range: args.range ?? RANGE,
    now: args.now ?? NOW_US,
    pins: args.pins,
    lastSeenUs: args.lastSeenUs,
  });

const build = (resolution: any, opts: { pins?: Record<string, string> } = {}) =>
  buildDashboard(kubernetesPage, resolution, opts.pins ?? {}, {
    timezone: "UTC",
    nowUs: NOW_US,
  });

const allQueries = (dashboard: any): string[] =>
  (dashboard.tabs ?? []).flatMap((tab: any) =>
    (tab.panels ?? []).flatMap((p: any) => (p.queries ?? []).map((q: any) => q.query as string)),
  );

const allLegends = (dashboard: any): string[] =>
  (dashboard.tabs ?? []).flatMap((tab: any) =>
    (tab.panels ?? []).flatMap((p: any) =>
      (p.queries ?? []).map((q: any) => (q.config?.promql_legend ?? "") as string),
    ),
  );

const panelById = (resolution: any, id: string) => resolution.panels.find((p: any) => p.id === id);

const hiddenFor = (resolution: any, groupId: string) =>
  resolution.hiddenGroups.find((h: any) => h.group.id === groupId);

// ── Concept resolution — the §5.4 ladder against the semantic JSON ─────────

describe("§5.4 concept resolution — rung by rung", () => {
  it("rung 1: fieldOverrides wins even when the group's own first field IS on the schema", () => {
    // kube-state overrides k8s-namespace → "namespace". The k8s-namespace group's
    // declaration order is `k8s_namespace, namespace, …`, so a schema carrying BOTH
    // spellings proves the override beat the group rather than agreeing with it.
    const streams = fullK8sStreams();
    const phase = streams.metrics.find((s: any) => s.name === "kube_pod_status_phase")!;
    phase.schema = ["k8s_namespace", "namespace", "pod", "phase"].map((name) => ({
      name,
      type: "Utf8",
    }));

    const resolution = resolve({ streams });
    const nonRunning = panelById(resolution, "k8s_wl_nonrunning_by_ns");
    expect(nonRunning.hidden).toBe(false);
    expect(nonRunning.resolvedFields[GROUP.namespace]).toBe("namespace");
    expect(nonRunning.resolvedFields[GROUP.namespace]).not.toBe("k8s_namespace");
  });

  it("rung 1: an overridden group needs no schema at all — resolution requests none", () => {
    // The drawer guarantee at the pure level: strip every schema off the list and
    // the overridden concepts still resolve (§7.3, pass-4 finding 17).
    const streams = fullHostsStreams();
    for (const entry of streams.metrics) entry.schema = [];

    const resolution = resolveManifest({
      manifest: hostsPage,
      streams,
      semanticGroups: [],
      range: RANGE,
      now: NOW_US,
      pins: { [GROUP.host]: "host-1" },
    });
    expect(resolution.schemasNeeded).toEqual([]);
    const cpu = resolution.panels.find((p: any) => p.id === "hd_cpu_busy");
    expect(cpu.hidden).toBe(false);
    expect(cpu.resolvedFields[GROUP.host]).toBe("host_name");
  });

  it("rung 2: the group's fields are walked in DECLARATION order, first schema-present wins", () => {
    // Discriminating fixture: a schema carrying BOTH `namespace` and
    // `k8s_namespace_name` must resolve to `namespace`, which is the defaults'
    // declared order (§3.3 fact 2). A "sort canonical-first" refactor fails here.
    //
    // kubelet-pod declares no override for NAMESPACE, so rung 1 cannot fire for the
    // concept this fixture exercises and the pack is used as authored — stripping an
    // override it does not have would be a no-op that only made the fixture look
    // like it was doing something. (It does pin k8s-cluster at rung 1, which is a
    // different concept and deliberately unrelated to this ladder test.)
    expect(
      kubernetesPage.groups.find((g: any) => g.id === "kubelet-pod").fieldOverrides?.[
        GROUP.namespace
      ],
    ).toBeUndefined();
    const streams = fullK8sStreams();
    const podMem = streams.metrics.find((s: any) => s.name === "k8s_pod_memory_usage")!;
    podMem.schema = ["namespace", "k8s_namespace_name", "k8s_pod_name"].map((name) => ({
      name,
      type: "Utf8",
    }));

    const resolution = resolve({ streams });
    const podMemTop = panelById(resolution, "k8s_wl_pod_mem_top");
    expect(podMemTop.resolvedFields[GROUP.namespace]).toBe("namespace");
  });

  it("rung 3: group present but NO member on the schema ⇒ panel hidden, field-unresolved", () => {
    const noOverrides = {
      ...kubernetesPage,
      groups: kubernetesPage.groups.map((g: any) => ({ ...g, fieldOverrides: undefined })),
    };
    const streams = fullK8sStreams();
    const podMem = streams.metrics.find((s: any) => s.name === "k8s_pod_memory_usage")!;
    // A schema carrying no spelling of k8s-namespace or k8s-pod-name at all.
    podMem.schema = ["value", "_timestamp"].map((name) => ({ name, type: "Utf8" }));

    const resolution = resolve({ manifest: noOverrides, streams });
    const podMemTop = panelById(resolution, "k8s_wl_pod_mem_top");
    expect(podMemTop.hidden).toBe(true);
    const hidden = hiddenFor(resolution, "kubelet-pod");
    expect(hidden.reason).toBe("field-unresolved");
    expect(hidden.unresolvedConcepts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ groupId: GROUP.namespace, display: "K8s Namespace" }),
      ]),
    );
    expect(resolution.warnings.map((w: any) => w.kind)).toContain("field-unresolved");
  });

  it("rung 4a: group ABSENT from the dictionary + probeFields ⇒ resolves, groups-missing warning", () => {
    // kubelet-node declares probeFields for k8s-node-name and k8s-cluster.
    const dictWithoutNode = dictionary(GROUP.namespace, GROUP.pod, GROUP.cluster, GROUP.host);
    const resolution = resolve({ dict: dictWithoutNode });
    const nodeCpu = panelById(resolution, "k8s_nd_cpu");
    expect(nodeCpu.hidden).toBe(false);
    expect(nodeCpu.resolvedFields[GROUP.node]).toBe("k8s_node_name");
    const warning = resolution.warnings.find((w: any) => w.kind === "groups-missing");
    expect(warning).toBeDefined();
    expect(warning.message).toContain(GROUP.node);
  });

  it("rung 4b: group absent and NO probeFields for it ⇒ falls to rung 5, panel hidden", () => {
    const noProbeFields = {
      ...kubernetesPage,
      groups: kubernetesPage.groups.map((g: any) => ({
        ...g,
        fieldOverrides: undefined,
        probeFields: undefined,
      })),
    };
    const dictWithoutNode = dictionary(GROUP.namespace, GROUP.pod, GROUP.cluster, GROUP.host);
    const resolution = resolve({ manifest: noProbeFields, dict: dictWithoutNode });
    expect(panelById(resolution, "k8s_nd_cpu").hidden).toBe(true);
  });

  it("rung 4a is pinned against the OBSERVED lossy override — 62-ish groups, one default dropped", () => {
    // Dry run finding 13: the live enterprise org saved an override, which REPLACES
    // rather than extends. This is the shape, so a future "nobody hits rung 4, delete
    // probeFields" cleanup fails here.
    const lossy: FieldAlias[] = [
      ...groups.filter((g) => g.id !== GROUP.node),
      {
        id: "common-prabhat-env",
        display: "Prabhat Env",
        group: "Common",
        fields: ["prabhat-cluster", "prabhat-ns"],
      },
    ];
    const resolution = resolve({ dict: lossy });
    expect(panelById(resolution, "k8s_nd_cpu").hidden).toBe(false);
    const missing = resolution.warnings.filter((w: any) => w.kind === "groups-missing");
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain(GROUP.node);
  });

  it("rung 5 (O-1 interim): an EMPTY dictionary hides token panels, renders overridden ones, invents nothing", () => {
    const resolution = resolve({ dict: [] });

    // kube-state overrides namespace/pod/node — rung 1 is dictionary-independent.
    expect(panelById(resolution, "k8s_wl_nonrunning_by_ns").hidden).toBe(false);
    expect(panelById(resolution, "k8s_nd_conditions").hidden).toBe(false);

    // kubelet groups have probeFields (rung 4a), so their tokens still resolve;
    // what must NEVER happen is an unsubstituted token or a guessed spelling.
    const dashboard = build(resolution);
    for (const query of allQueries(dashboard)) {
      expect(query).not.toContain("${f:");
      expect(query).not.toContain("${scope:");
    }
    for (const legend of allLegends(dashboard)) {
      expect(legend).not.toContain("${f:");
    }

    // Pickers whose group cannot resolve are omitted, and their tokens collapse
    // cleanly — no empty matcher, no dangling comma.
    for (const query of allQueries(dashboard)) {
      expect(query).not.toContain("{}");
      expect(query).not.toMatch(/\{\s*,/);
      expect(query).not.toMatch(/,\s*\}/);
      expect(query).not.toMatch(/,\s*,/);
    }
  });

  it("resolution is PER PANEL-QUERY STREAM, not per group anchor (dry run finding 5)", () => {
    // kube_pod_status_phase's schema has NO node field; kube_node_status_condition's
    // does. With kube-state's overrides stripped, a group-anchor resolver hides both
    // node panels. The per-panel rule renders them.
    const noKubeStateOverrides = {
      ...kubernetesPage,
      groups: kubernetesPage.groups.map((g: any) =>
        g.id === "kube-state" ? { ...g, fieldOverrides: undefined } : g,
      ),
    };
    const resolution = resolve({ manifest: noKubeStateOverrides });

    expect(panelById(resolution, "k8s_nd_conditions").hidden).toBe(false);
    expect(panelById(resolution, "k8s_nd_not_ready").hidden).toBe(false);
    expect(panelById(resolution, "k8s_nd_conditions").resolvedFields[GROUP.node]).toBe("node");
  });

  it("two panels in ONE group resolve the same concept to DIFFERENT spellings", () => {
    const noKubeStateOverrides = {
      ...kubernetesPage,
      groups: kubernetesPage.groups.map((g: any) =>
        g.id === "kube-state" ? { ...g, fieldOverrides: undefined } : g,
      ),
    };
    const streams = fullK8sStreams();
    // Same group, two streams, two legitimate spellings of k8s-namespace.
    streams.metrics.find((s: any) => s.name === "kube_pod_status_phase")!.schema = [
      "namespace",
      "pod",
      "phase",
    ].map((name) => ({ name, type: "Utf8" }));
    streams.metrics.find((s: any) => s.name === "kube_pod_container_resource_requests")!.schema = [
      "k8s_namespace_name",
      "resource",
    ].map((name) => ({ name, type: "Utf8" }));

    const resolution = resolve({ manifest: noKubeStateOverrides, streams });
    expect(panelById(resolution, "k8s_wl_nonrunning_by_ns").resolvedFields[GROUP.namespace]).toBe(
      "namespace",
    );
    expect(panelById(resolution, "k8s_wl_cpu_requests").resolvedFields[GROUP.namespace]).toBe(
      "k8s_namespace_name",
    );
  });

  it("a panel whose own schema is UNAVAILABLE falls back to the anchor, then to the group's first field — and RENDERS", () => {
    // A transport failure is not evidence of a missing field (§5.4 error paths).
    const noKubeStateOverrides = {
      ...kubernetesPage,
      groups: kubernetesPage.groups.map((g: any) =>
        g.id === "kube-state" ? { ...g, fieldOverrides: undefined, anchorStream: undefined } : g,
      ),
    };
    const streams = fullK8sStreams();
    // `undefined` schema = never fetched / fetch failed, distinct from an empty [].
    streams.metrics.find((s: any) => s.name === "kube_pod_status_phase")!.schema = undefined as any;

    const resolution = resolve({ manifest: noKubeStateOverrides, streams });
    const panel = panelById(resolution, "k8s_wl_nonrunning_by_ns");
    expect(panel.hidden).toBe(false);
    expect(panel.resolvedFields[GROUP.namespace]).toBe(groupById(GROUP.namespace).fields[0]);
    expect(resolution.warnings.map((w: any) => w.kind)).toContain("schema");
  });
});

describe("§3.3.1 id pinning — the packs name real groups", () => {
  it("every id the packs name exists in the committed defaults snapshot", () => {
    for (const id of [GROUP.namespace, GROUP.pod, GROUP.node, GROUP.cluster, GROUP.host]) {
      expect(groups.some((g) => g.id === id)).toBe(true);
    }
  });

  it("the '-name' suffixing is the JSON's, not a convention — a shorthand id is NOT a group", () => {
    for (const wrong of ["k8s-pod", "k8s-node", "host-name", "pod", "namespace"]) {
      expect(groups.some((g) => g.id === wrong)).toBe(false);
    }
  });

  it("each pinned group's fields array matches the snapshot exactly and in order", () => {
    expect(groupById(GROUP.namespace).fields.slice(0, 3)).toEqual([
      "k8s_namespace",
      "namespace",
      "k8s_ns",
    ]);
    expect(groupById(GROUP.host).fields.slice(0, 5)).toEqual([
      "host",
      "hostname",
      "node",
      "node_name",
      "host_name",
    ]);
  });
});

// ── Token substitution ─────────────────────────────────────────────────────

describe("token substitution", () => {
  it("${f:<gid>} resolves per requirement group and legends resolve too", () => {
    const dashboard = build(resolve({}));
    // Only the queries that CARRY the token can show its resolution. The pack's
    // fleet-wide scalars (k8s_ov_cpu_used, `sum(...)` with no by()) author no
    // ${f:} token at all (§4.2), so a blanket "every query naming the stream
    // contains the field" would demand a token the manifest never wrote.
    const nodeQueries = allQueries(dashboard).filter(
      (q) => q.includes("k8s_node_cpu_usage") && q.includes("by ("),
    );
    expect(nodeQueries.length).toBeGreaterThan(0);
    for (const q of nodeQueries) expect(q).toContain("k8s_node_name");
    // …and the untokenized scalar is still built, so this is not a silent skip.
    expect(
      allQueries(dashboard).some((q) =>
        q.startsWith('sum(k8s_node_cpu_usage{k8s_cluster_name=~"$cluster"})'),
      ),
    ).toBe(true);
    expect(allLegends(dashboard).some((l) => l.includes("{k8s_node_name}"))).toBe(true);
  });

  it('${scope:x} inside a matcher emits field=~"$x"', () => {
    const dashboard = build(resolve({}));
    const podCpu = allQueries(dashboard).find((q) => q.includes("k8s_pod_cpu_usage"))!;
    // The FIELD is whatever §5.4 resolved for the picker's group on this panel —
    // k8s_wl_pod_cpu_top sits in kubelet-pod, which authors no fieldOverrides, so
    // rung 2 walks each group's declaration order against KUBELET_POD_SCHEMA and
    // lands on the only member present. The bare kube-state spellings are rung-1
    // output and unreachable here; what this pins is the =~"$<picker>" SHAPE.
    expect(podCpu).toContain('k8s_namespace_name=~"$namespace"');
    expect(podCpu).toContain('k8s_pod_name=~"$pod"');
    // The same token under a group that DOES override resolves to the bare
    // spelling — so the field really is RESOLVED per group, not hardcoded once.
    const nonRunning = allQueries(dashboard).find(
      (q) => q.includes("kube_pod_status_phase") && q.includes('=~"$namespace"'),
    )!;
    expect(nonRunning).toContain('namespace=~"$namespace"');
    expect(nonRunning).not.toContain('k8s_namespace_name=~"$namespace"');
    // …and the two really are different spellings of the ONE picker, which is
    // what makes the pair discriminating rather than two readings of one rung.
    expect(podCpu).not.toContain('{namespace=~"$namespace"');
  });

  it("a bare-adjacent ${scope:x} expands to a whole {matcher} block", () => {
    const dashboard = build(resolve({}));
    // Must be the SCOPED reader: the summary's fleet-total panel sums the same metric
    // deliberately unscoped, and a bare metric-name match would find that one instead.
    const fleetCpu = allQueries(dashboard).find(
      (q) => q.includes("sum(k8s_node_cpu_usage") && q.includes("$cluster"),
    )!;
    expect(fleetCpu).toContain('k8s_node_cpu_usage{k8s_cluster_name=~"$cluster"}');
  });

  it("under PINS a ${scope:} token becomes an escaped literal matcher, not a variable", () => {
    const resolution = resolveManifest({
      manifest: hostsPage,
      streams: fullHostsStreams(),
      semanticGroups: dictionary(GROUP.host),
      range: RANGE,
      now: NOW_US,
      pins: { [GROUP.host]: 'he"llo' },
    });
    const dashboard = buildDashboard(
      hostsPage,
      resolution,
      { [GROUP.host]: 'he"llo' },
      { timezone: "UTC", nowUs: NOW_US },
    );
    const queries = allQueries(dashboard);
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      expect(q).toContain('host_name="he\\"llo"');
      expect(q).not.toContain("$host");
    }
  });

  it("an omitted picker leaves no empty {} and no dangling comma", () => {
    // No cluster field anywhere ⇒ the cluster picker is dropped and every
    // ${scope:cluster} token must collapse cleanly.
    //
    // BOTH nets have to be cut for the concept to go genuinely unresolved: stripping
    // the schemas closes rung 2, and dropping kubelet-node's probeFields[k8s-cluster]
    // — which the pack really does declare — closes rung 4a. Cut only one and the
    // picker survives, so this fixture tests the collapse, not the ladder.
    const streams = fullK8sStreams();
    for (const entry of streams.metrics) {
      entry.schema = (entry.schema ?? []).filter((f: any) => !f.name.includes("cluster"));
    }
    expect(
      kubernetesPage.groups.find((g: any) => g.id === "kubelet-node").probeFields[GROUP.cluster],
    ).toBeDefined();
    const noClusterProbe = {
      ...kubernetesPage,
      groups: kubernetesPage.groups.map((g: any) =>
        g.id === "kubelet-node"
          ? { ...g, probeFields: { ...(g.probeFields ?? {}), [GROUP.cluster]: undefined } }
          : g,
      ),
    };
    const resolution = resolve({ manifest: noClusterProbe, streams });
    const dashboard = buildDashboard(
      noClusterProbe,
      resolution,
      {},
      { timezone: "UTC", nowUs: NOW_US },
    );

    expect((dashboard.variables?.list ?? []).some((v: any) => v.name === "cluster")).toBe(false);
    for (const q of allQueries(dashboard)) {
      expect(q).not.toContain("{}");
      expect(q).not.toMatch(/\{\s*,/);
      expect(q).not.toMatch(/,\s*\}/);
      expect(q).not.toContain("$cluster");
    }

    // THE PANELS MUST STILL RENDER. Asserting only over allQueries(dashboard) was
    // vacuous: it walks surviving panels, so five panels silently vanishing from
    // the page passed it. An unresolvable OPTIONAL ${scope:} collapses its matcher
    // — a cluster-less org is a normal org, and its node charts are fleet-wide,
    // not missing.
    const scopeOnly = [
      "k8s_ov_cpu_used",
      "k8s_ov_node_cpu_top",
      "k8s_nd_cpu",
      "k8s_nd_memory",
      "k8s_nd_network",
    ];
    for (const id of scopeOnly) {
      const panel = resolution.panels.find((p: any) => p.id === id);
      expect(panel, `${id} must exist in the manifest`).toBeDefined();
      expect(panel!.hidden, `${id} must not hide over an optional cluster scope`).toBe(false);
    }
    const builtIds = (dashboard.tabs as any[]).flatMap((tab) =>
      tab.panels.map((panel: any) => panel.id),
    );
    for (const id of scopeOnly) expect(builtIds).toContain(id);

    // ...and it is not reported as a problem either — one normal org, three warnings.
    expect(resolution.warnings.filter((w: any) => w.kind === "field-unresolved")).toEqual([]);
  });
});

describe("escaping helpers", () => {
  it("promEscape backslash-escapes a backslash and a double quote, in that order", () => {
    expect(promEscape('he"llo')).toBe('he\\"llo');
    expect(promEscape("corp\\web-01")).toBe("corp\\\\web-01");
    expect(promEscape('a\\b"c')).toBe('a\\\\b\\"c');
  });

  it("sqlEscape doubles a single quote", () => {
    expect(sqlEscape("o'brien")).toBe("o''brien");
  });
});

// ── Variant selection & presence (§5.2) ────────────────────────────────────

describe("§5.2 variant satisfiability — presence AND liveness", () => {
  it("selects the FIRST satisfiable variant and applies its unit override", () => {
    // Only the utilization family present ⇒ variant 1 on the node-CPU panels.
    const streams = streamLists([
      { name: "k8s_node_cpu_utilization", schema: KUBELET_NODE_SCHEMA },
    ]);
    const resolution = resolve({ streams });
    const nodeCpu = panelById(resolution, "k8s_nd_cpu");
    expect(nodeCpu.hidden).toBe(false);
    expect(nodeCpu.selectedVariant.requiresStreams).toEqual(["k8s_node_cpu_utilization"]);
    expect(nodeCpu.unit).toBe("percent-1");
  });

  it("DRY-RUN (a): a 177-day-dead variant 1 beside a live variant 2 ⇒ variant 2 wins, group NOT stale", () => {
    // The headline measured case. Presence-only selection rendered four blank
    // hero panels inside a group nothing badged.
    const streams = streamLists([
      {
        name: "k8s_node_cpu_utilization",
        docTimeMax: NOW_US - 177 * DAY_US,
        schema: KUBELET_NODE_SCHEMA,
      },
      {
        name: "k8s_node_cpu_usage",
        docTimeMax: NOW_US - 6 * 60 * 1_000_000,
        schema: KUBELET_NODE_SCHEMA,
      },
      { name: "k8s_node_memory_usage", schema: KUBELET_NODE_SCHEMA },
    ]);
    const resolution = resolve({ streams });

    for (const id of ["k8s_ov_cpu_used", "k8s_ov_node_cpu_top", "k8s_nd_cpu"]) {
      const panel = panelById(resolution, id);
      expect(panel.hidden, id).toBe(false);
      expect(panel.selectedVariant.requiresStreams, id).toEqual(["k8s_node_cpu_usage"]);
    }
    // Variant 2 carries `unit: "numbers"` (cores in use, not a ratio).
    expect(panelById(resolution, "k8s_nd_cpu").unit).toBe("numbers");
    // No allocatable stream here, so the ratio variant is unsatisfiable and the
    // tile falls to bare cores rather than a percentage of a missing denominator.
    expect(panelById(resolution, "k8s_ov_cpu_used").unit).toBe("numbers");

    expect(hiddenFor(resolution, "kubelet-node")).toBeUndefined();
    expect(resolution.staleGroups.some((s: any) => s.group.id === "kubelet-node")).toBe(false);
  });

  it("DRY-RUN (b): the inverse — utilization fresh, usage absent ⇒ variant 1, not an inverted preference", () => {
    const streams = streamLists([
      { name: "k8s_node_cpu_utilization", schema: KUBELET_NODE_SCHEMA },
      { name: "k8s_node_memory_usage", schema: KUBELET_NODE_SCHEMA },
    ]);
    const resolution = resolve({ streams });
    expect(panelById(resolution, "k8s_nd_cpu").selectedVariant.requiresStreams).toEqual([
      "k8s_node_cpu_utilization",
    ]);
  });

  it("DRY-RUN (c): ALL variants present but DEAD ⇒ group hidden, every missingStreams tagged state:'stale'", () => {
    const dead = NOW_US - 177 * DAY_US;
    const streams = streamLists([
      { name: "k8s_node_cpu_utilization", docTimeMax: dead, schema: KUBELET_NODE_SCHEMA },
      { name: "k8s_node_cpu_usage", docTimeMax: dead, schema: KUBELET_NODE_SCHEMA },
      { name: "k8s_node_memory_usage", docTimeMax: dead, schema: KUBELET_NODE_SCHEMA },
      { name: "k8s_node_memory_rss", docTimeMax: dead, schema: KUBELET_NODE_SCHEMA },
      { name: "k8s_node_network_io", docTimeMax: dead, schema: KUBELET_NODE_SCHEMA },
    ]);
    const resolution = resolve({ streams });
    const hidden = hiddenFor(resolution, "kubelet-node");
    expect(hidden).toBeDefined();
    expect(hidden.reason).toBe("streams-missing");
    expect(hidden.missingStreams.length).toBeGreaterThan(0);
    // "not found" sends the user to install a collector; "stopped reporting"
    // sends them to restart one. The tag is what keeps those apart — asserted
    // per stream, since a group can legitimately mix the two (the CPU tile's
    // ratio variant wants an allocatable stream this fixture never lists).
    const listed = new Set([
      "k8s_node_cpu_utilization",
      "k8s_node_cpu_usage",
      "k8s_node_memory_usage",
      "k8s_node_memory_rss",
      "k8s_node_network_io",
    ]);
    const deadEntries = hidden.missingStreams.filter((entry: any) => listed.has(entry.name));
    expect(deadEntries.length).toBeGreaterThan(0);
    for (const entry of deadEntries) {
      expect(entry.state, entry.name).toBe("stale");
      expect(entry.state, entry.name).not.toBe("absent");
      expect(entry.lastSeenUs, entry.name).toBe(dead);
    }
    // A stream that was never listed stays "absent" — the two are never merged.
    for (const entry of hidden.missingStreams.filter((e: any) => !listed.has(e.name))) {
      expect(entry.state, entry.name).toBe("absent");
      expect(entry.lastSeenUs, entry.name).toBeUndefined();
    }
  });

  it("an ABSENT stream is tagged state:'absent', never 'stale'", () => {
    const streams = streamLists([{ name: "kube_pod_status_phase", schema: KUBE_POD_PHASE_SCHEMA }]);
    const resolution = resolve({ streams });
    const hidden = hiddenFor(resolution, "kubelet-node");
    expect(hidden.missingStreams.every((m: any) => m.state === "absent")).toBe(true);
    expect(hidden.missingStreams.every((m: any) => m.lastSeenUs === undefined)).toBe(true);
  });

  it("DRY-RUN (d): the liveness boundary is min(range.start, now − 24h), inclusive", () => {
    const boundary = Math.min(RANGE.start, NOW_US - STALENESS_24H_US);
    const atBoundary = streamLists([
      { name: "k8s_node_cpu_usage", docTimeMax: boundary, schema: KUBELET_NODE_SCHEMA },
    ]);
    expect(panelById(resolve({ streams: atBoundary }), "k8s_nd_cpu").hidden).toBe(false);

    const belowBoundary = streamLists([
      { name: "k8s_node_cpu_usage", docTimeMax: boundary - 1, schema: KUBELET_NODE_SCHEMA },
    ]);
    expect(panelById(resolve({ streams: belowBoundary }), "k8s_nd_cpu").hidden).toBe(true);
  });

  it("DRY-RUN (d): STALE_GRACE_US is NOT applied to the liveness gate", () => {
    // Grace exists to stop a healthy stream being BADGED over a flush-window lag;
    // it has no business widening a liveness gate. This fixture sits in the exact
    // 10-minute window the two rules would disagree about: it is BELOW the correct
    // boundary (so the gate must reject it) but ABOVE boundary − STALE_GRACE_US
    // (so a leaked grace term would accept it). Only the correct rule hides here.
    const boundary = Math.min(RANGE.start, NOW_US - STALENESS_24H_US);
    const insideGraceButPastBoundary = boundary - STALE_GRACE_US / 2;
    expect(insideGraceButPastBoundary).toBeLessThan(boundary);
    expect(insideGraceButPastBoundary).toBeGreaterThan(boundary - STALE_GRACE_US);

    const streams = streamLists([
      {
        name: "k8s_node_cpu_usage",
        docTimeMax: insideGraceButPastBoundary,
        schema: KUBELET_NODE_SCHEMA,
      },
    ]);
    expect(panelById(resolve({ streams }), "k8s_nd_cpu").hidden).toBe(true);
    expect(STALE_GRACE_US).toBe(10 * 60 * 1_000_000);
  });

  it("a variant requiring SEVERAL streams needs all of them present and live", () => {
    // k8s_wl_pod_fs requires usage AND capacity.
    const missingCapacity = streamLists([
      { name: "k8s_pod_filesystem_usage", schema: KUBELET_POD_SCHEMA },
      { name: "k8s_pod_memory_usage", schema: KUBELET_POD_SCHEMA },
    ]);
    expect(panelById(resolve({ streams: missingCapacity }), "k8s_wl_pod_fs").hidden).toBe(true);
  });

  it("presence is DERIVED: a drift-only fixture still lights kubelet-node", () => {
    const driftOnly = streamLists([
      { name: "k8s_node_cpu_usage", schema: KUBELET_NODE_SCHEMA },
      { name: "k8s_node_memory_rss", schema: KUBELET_NODE_SCHEMA },
    ]);
    const resolution = resolve({ streams: driftOnly });
    expect(hiddenFor(resolution, "kubelet-node")).toBeUndefined();
    expect(panelById(resolution, "k8s_nd_memory").selectedVariant.requiresStreams).toEqual([
      "k8s_node_memory_rss",
    ]);
  });

  it("presence matches EXACTLY, per stream type — a logs stream of the same name does not count", () => {
    const wrongType = streamLists(
      [],
      [{ name: "k8s_node_cpu_usage", schema: KUBELET_NODE_SCHEMA }],
    );
    expect(hiddenFor(resolve({ streams: wrongType }), "kubelet-node")).toBeDefined();
  });

  it("zero satisfiable panels ⇒ the group is hidden with its first-variant spellings listed", () => {
    const resolution = resolve({ streams: streamLists([]) });
    const hidden = hiddenFor(resolution, "kubelet-node");
    expect(hidden.reason).toBe("streams-missing");
    expect(hidden.missingStreams.map((m: any) => m.name)).toContain("k8s_node_cpu_utilization");
    expect(hidden.panelCount).toBeGreaterThan(0);
  });
});

// ── Staleness (§5.3) ───────────────────────────────────────────────────────

describe("§5.3 staleness — min(range.start, now − STALE_GRACE_US)", () => {
  it("(a) short range: lastSeen inside the grace window but before range.start is NOT stale", () => {
    // A healthy stream whose doc_time_max trails ingest by the flush window must
    // never be badged — a bare `< range.start` on a 15m range would badge it.
    const shortRange = { start: NOW_US - 15 * 60 * 1_000_000, end: NOW_US };
    const streams = fullK8sStreams();
    for (const entry of streams.metrics) {
      entry.stats.doc_time_max = NOW_US - 5 * 60 * 1_000_000;
    }
    const resolution = resolve({ streams, range: shortRange });
    expect(resolution.staleGroups).toEqual([]);
  });

  it("(b) long range + threshold: 30d range with a 3-week-old lastSeen IS stale via the 24h threshold", () => {
    const longRange = { start: NOW_US - 30 * DAY_US, end: NOW_US };
    const threeWeeksAgo = NOW_US - 21 * DAY_US;
    const streams = fullK8sStreams();
    for (const entry of streams.metrics) entry.stats.doc_time_max = threeWeeksAgo;

    const resolution = resolve({ streams, range: longRange });
    // lastSeen > range.start, so the window rule alone would call this fresh.
    expect(threeWeeksAgo).toBeGreaterThan(longRange.start);
    expect(resolution.staleGroups.length).toBeGreaterThan(0);
    expect(resolution.staleGroups[0].lastSeenUs).toBe(threeWeeksAgo);
  });

  it("the 24h threshold boundary: threshold−1 fresh, threshold+1 stale (raw µs literals)", () => {
    const longRange = { start: NOW_US - 30 * DAY_US, end: NOW_US };
    const fresh = fullK8sStreams();
    for (const entry of fresh.metrics) {
      entry.stats.doc_time_max = NOW_US - STALENESS_24H_US + 1;
    }
    expect(resolve({ streams: fresh, range: longRange }).staleGroups).toEqual([]);

    const stale = fullK8sStreams();
    for (const entry of stale.metrics) {
      entry.stats.doc_time_max = NOW_US - STALENESS_24H_US - 1;
    }
    expect(resolve({ streams: stale, range: longRange }).staleGroups.length).toBeGreaterThan(0);
  });

  it("a MILLISECOND-shaped doc_time_max reads stale — the µs compare is pinned", () => {
    // A unit mix-up can only make a timestamp look OLDER, so this is the direction
    // that discriminates (§5.3; a ms-shaped `start` silently disables the rule).
    const streams = fullK8sStreams();
    for (const entry of streams.metrics) {
      entry.stats.doc_time_max = Math.floor(NOW_US / 1000);
    }
    const resolution = resolve({ streams });
    // A ms value read as µs sits ~45 years back, so it is not merely stale — it
    // trips §5.2's liveness gate first and the group is HIDDEN, exactly as the
    // 177-day case (c) demands. `staleGroups` only covers PRESENT groups, so the
    // µs compare is pinned where the verdict actually lands: the hidden rows'
    // per-stream tag, which reads 'stale' (stopped reporting) and not 'absent'.
    expect(resolution.staleGroups).toEqual([]);
    expect(resolution.hiddenGroups.length).toBeGreaterThan(0);
    // Every stream the fixture actually LISTS is tagged 'stale'; the pack's drift
    // spellings it never listed stay 'absent', which is the §5.2 distinction.
    const listed = new Set(streams.metrics.map((entry: any) => entry.name));
    const tags = resolution.hiddenGroups.flatMap((h: any) =>
      h.missingStreams.map((m: any) => ({ name: m.name, state: m.state })),
    );
    const listedTags = tags.filter((t: any) => listed.has(t.name));
    expect(listedTags.length).toBeGreaterThan(0);
    expect(listedTags.every((t: any) => t.state === "stale")).toBe(true);
    // The control that makes this discriminate: read as MILLISECONDS the same
    // number is `now`, i.e. perfectly fresh — a resolver that mixed the units
    // would render every group and this would go green for the wrong reason.
    const fresh = fullK8sStreams();
    for (const entry of fresh.metrics) entry.stats.doc_time_max = NOW_US;
    expect(resolve({ streams: fresh }).hiddenGroups).toEqual([]);
  });

  it("doc_time_max === 0 with the stream listed ⇒ 'no data yet' badge variant, NOT hidden", () => {
    // The ONE carve-out from §5.2's liveness gate, and it is deliberate: a
    // never-ingested stream serializes all-zero stats (§3.2), and the stream
    // EXISTS, so hiding it would lie about the collector being absent. The gate
    // hides dead streams; zero is "not yet", not "no longer".
    const streams = fullK8sStreams();
    for (const entry of streams.metrics) entry.stats.doc_time_max = 0;
    const resolution = resolve({ streams });
    expect(resolution.hiddenGroups).toEqual([]);
    expect(resolution.staleGroups.length).toBeGreaterThan(0);
    expect(resolution.staleGroups.every((s: any) => s.noDataYet === true)).toBe(true);
    // …and the badge copy differs from the ordinary stale one, so "never started"
    // is not rendered as "stopped reporting".
    const dashboard = build(resolution);
    const badged = dashboard.tabs
      .flatMap((t: any) => t.panels)
      .find((p: any) => p.config.curated_badge);
    expect(badged.config.curated_badge.key).toBe("infra.curated.staleNoDataBadge");
  });

  it("a never-ingested variant 1 (0 docs, created 9 months ago) LOSES to the live variant 2", () => {
    // Measured: k8s_node_cpu_utilization carries doc_num 0 since 2024 while
    // k8s_node_cpu_usage holds 148M docs. All-zero stats made the dead spelling
    // satisfy requiresStreams, so it WON selection and rendered "No Data" over a
    // working fallback defined right beneath it.
    const streams = streamLists([
      {
        name: "k8s_node_cpu_utilization",
        docTimeMax: 0,
        docNum: 0,
        createdAt: NOW_US - 270 * DAY_US,
        schema: KUBELET_NODE_SCHEMA,
      },
      { name: "k8s_node_cpu_usage", schema: KUBELET_NODE_SCHEMA },
      { name: "k8s_node_memory_usage", schema: KUBELET_NODE_SCHEMA },
    ]);
    const resolution = resolve({ streams });

    for (const id of ["k8s_ov_node_cpu_top", "k8s_nd_cpu"]) {
      const panel = panelById(resolution, id);
      expect(panel.hidden, id).toBe(false);
      expect(panel.selectedVariant.requiresStreams, id).toEqual(["k8s_node_cpu_usage"]);
    }
    // The live sibling keeps the group alive, so nothing badges over a healthy collector.
    expect(hiddenFor(resolution, "kubelet-node")).toBeUndefined();
    expect(resolution.staleGroups.some((s: any) => s.group.id === "kubelet-node")).toBe(false);
  });

  it("a BRAND-NEW zero-doc stream is still live — 'not yet' survives the never-ingested gate", () => {
    // The carve-out above must not become a blanket zero-doc kill: a stream created
    // minutes ago has not failed, it has not started.
    const streams = streamLists([
      {
        name: "k8s_node_cpu_utilization",
        docTimeMax: 0,
        docNum: 0,
        createdAt: NOW_US - 5 * 60 * 1_000_000,
        schema: KUBELET_NODE_SCHEMA,
      },
      { name: "k8s_node_cpu_usage", schema: KUBELET_NODE_SCHEMA },
      { name: "k8s_node_memory_usage", schema: KUBELET_NODE_SCHEMA },
    ]);
    const resolution = resolve({ streams });
    expect(panelById(resolution, "k8s_nd_cpu").selectedVariant.requiresStreams).toEqual([
      "k8s_node_cpu_utilization",
    ]);
  });

  it("a zero-doc stream with NO created_at stays live — an unknown age never hides a panel", () => {
    const streams = streamLists([
      { name: "k8s_node_cpu_utilization", docTimeMax: 0, docNum: 0, schema: KUBELET_NODE_SCHEMA },
      { name: "k8s_node_cpu_usage", schema: KUBELET_NODE_SCHEMA },
      { name: "k8s_node_memory_usage", schema: KUBELET_NODE_SCHEMA },
    ]);
    expect(panelById(resolve({ streams }), "k8s_nd_cpu").selectedVariant.requiresStreams).toEqual([
      "k8s_node_cpu_utilization",
    ]);
  });

  it("an OLD stream that HAS docs but a zero doc_time_max stays live — the gate reads doc_num", () => {
    // doc_num is what separates "never ingested" from "stats not serialized yet";
    // an age test alone would kill a long-lived stream whose max simply did not land.
    const streams = streamLists([
      {
        name: "k8s_node_cpu_utilization",
        docTimeMax: 0,
        docNum: 5_000,
        createdAt: NOW_US - 270 * DAY_US,
        schema: KUBELET_NODE_SCHEMA,
      },
      { name: "k8s_node_cpu_usage", schema: KUBELET_NODE_SCHEMA },
      { name: "k8s_node_memory_usage", schema: KUBELET_NODE_SCHEMA },
    ]);
    expect(panelById(resolve({ streams }), "k8s_nd_cpu").selectedVariant.requiresStreams).toEqual([
      "k8s_node_cpu_utilization",
    ]);
  });

  it("opts.lastSeenUs (a dead host in a live fleet) beats the fleet-wide stream max", () => {
    const deadHost = NOW_US - 5 * DAY_US;
    const resolution = resolveManifest({
      manifest: hostsPage,
      streams: fullHostsStreams(), // every system_* stream fresh — the fleet is alive
      semanticGroups: dictionary(GROUP.host),
      range: RANGE,
      now: NOW_US,
      pins: { [GROUP.host]: "host-1" },
      lastSeenUs: deadHost,
    });
    expect(resolution.staleGroups.length).toBe(1);
    expect(resolution.staleGroups[0].lastSeenUs).toBe(deadHost);
  });

  it("stalenessStreams branch 1: a DECLARED set wins over the variant union", () => {
    // The two sources give OPPOSITE verdicts, so the branch choice is observable:
    // the declared stream is 3 days dead (⇒ stale) while every other kubelet-node
    // stream — which the union would include and whose max would win — is fresh.
    const STALE_AT = NOW_US - 3 * DAY_US;
    const declared = {
      ...kubernetesPage,
      groups: kubernetesPage.groups.map((g: any) =>
        g.id === "kubelet-node" ? { ...g, stalenessStreams: ["k8s_node_network_io"] } : g,
      ),
    };
    const streams = fullK8sStreams();
    streams.metrics.find((s: any) => s.name === "k8s_node_network_io")!.stats.doc_time_max =
      STALE_AT;

    // Control: without the declaration the union's max is fresh ⇒ NOT stale.
    expect(resolve({ streams }).staleGroups.some((s: any) => s.group.id === "kubelet-node")).toBe(
      false,
    );

    const stale = resolve({ manifest: declared, streams }).staleGroups.find(
      (s: any) => s.group.id === "kubelet-node",
    );
    expect(stale).toBeDefined();
    expect(stale.lastSeenUs).toBe(STALE_AT);
  });

  it("stalenessStreams branch 2: undeclared ⇒ the union of SELECTED-variant streams only", () => {
    // A fossil of the UNSELECTED spelling must not enter the union: the group
    // selected the live usage variant, so the dead utilization stream is not its
    // staleness source. Asserted through the whole path — a naive "max over every
    // stream the group's variants MENTION" would badge this healthy group.
    const streams = fullK8sStreams();
    streams.metrics.push(
      streamEntry({
        name: "k8s_node_cpu_utilization",
        docTimeMax: NOW_US - 177 * DAY_US,
        schema: KUBELET_NODE_SCHEMA,
      }),
    );
    const resolution = resolve({ streams });
    // The dead spelling is present in the list and IS the first variant's stream…
    expect(streams.metrics.some((s: any) => s.name === "k8s_node_cpu_utilization")).toBe(true);
    // …but variant 2 was selected, so it is not a staleness source.
    expect(panelById(resolution, "k8s_nd_cpu").selectedVariant.requiresStreams).toEqual([
      "k8s_node_cpu_usage",
    ]);
    expect(resolution.staleGroups.some((s: any) => s.group.id === "kubelet-node")).toBe(false);
  });

  it("stalenessStreams branch 3: a PROBE group's source is the RESOLVED candidate, not probe.streams[0]", () => {
    // The third branch of the §5.3 source rule, and the only one with two
    // plausible-looking sources. `probe.streams[0]` is present but lacks the probe
    // column, so the ladder walks past it to `default` — and the two carry
    // DIVERGENT doc_time_max, so reading the head of the candidate LIST instead of
    // the RESOLVED stream badges a group whose actual data source is live.
    const DEAD = NOW_US - 30 * DAY_US;
    const probePage = {
      ...kubernetesPage,
      id: "probe-staleness",
      groups: [
        {
          id: "probed",
          labelKey: "synthetic.probed.label",
          capabilityKey: "synthetic.probed.cap",
          setupHintKey: "synthetic.probed.hint",
          setup: { kind: "route", routeName: "syntheticSetup" },
          streamType: "logs",
          probe: {
            streams: ["dedicated", "default"],
            sqlFilter: "probe_col IS NOT NULL",
            fields: ["probe_col"],
          },
          fieldOverrides: { [GROUP.host]: "host_name" },
        },
      ],
      scopePickers: [],
      sections: [
        {
          id: "overview",
          titleKey: "synthetic.overview",
          scopedBy: [],
          panels: [
            {
              id: "probed_p1",
              groupId: "probed",
              titleKey: "synthetic.probed.title",
              type: "line",
              layout: { w: 96, h: 16 },
              variants: [
                {
                  queryType: "sql",
                  requiresStreams: [] as string[],
                  fields: { x: [], y: [], breakdown: [] },
                  queries: [{ query: `SELECT COUNT(*) FROM "<probe>"`, legend: "" }],
                },
              ],
              drilldown: [],
            },
          ],
        },
      ],
    };
    const streams = streamLists(
      [],
      [
        // Present and live, but WITHOUT the probe column ⇒ the ladder walks past it.
        { name: "dedicated", docTimeMax: DEAD, schema: ["unrelated_col"] },
        { name: "default", schema: ["probe_col"] },
      ],
    );

    const resolution = resolveManifest({
      manifest: probePage,
      streams,
      semanticGroups: [],
      range: RANGE,
      now: NOW_US,
    });

    expect(resolution.probeStreams?.probed).toBe("default");
    expect(resolution.staleGroups.some((s: any) => s.group.id === "probed")).toBe(false);

    // Control, same fixture with the dates swapped: when the RESOLVED candidate is
    // the dead one the verdict flips, so the assertion above is not vacuous.
    const inverted = streamLists(
      [],
      [
        { name: "dedicated", schema: ["unrelated_col"] },
        { name: "default", docTimeMax: DEAD, schema: ["probe_col"] },
      ],
    );
    const flipped = resolveManifest({
      manifest: probePage,
      streams: inverted,
      semanticGroups: [],
      range: { start: NOW_US - 60 * DAY_US, end: NOW_US },
      now: NOW_US,
    });
    const stale = flipped.staleGroups.find((s: any) => s.group.id === "probed");
    expect(stale).toBeDefined();
    expect(stale.lastSeenUs).toBe(DEAD);
  });
});

// ── Scope pickers (§5.5) ───────────────────────────────────────────────────

describe("§5.5 scope pickers", () => {
  it("(a) omitWhenFieldAbsent: no member of the cluster group on valuesFrom.stream ⇒ picker dropped", () => {
    const streams = fullK8sStreams();
    // The cluster picker sources from kube_pod_status_phase (kube-state); strip every
    // cluster-group member from THAT stream, and close the rung-1 override that would
    // otherwise resolve the concept without consulting the schema at all.
    streams.metrics.find((s: any) => s.name === "kube_pod_status_phase")!.schema = [
      "namespace",
      "pod",
    ].map((name) => ({ name, type: "Utf8" }));
    const noClusterProbe = {
      ...kubernetesPage,
      groups: kubernetesPage.groups.map((g: any) =>
        g.id === "kube-state"
          ? {
              ...g,
              fieldOverrides: Object.fromEntries(
                Object.entries(g.fieldOverrides ?? {}).filter(([gid]) => gid !== GROUP.cluster),
              ),
            }
          : g,
      ),
    };
    const resolution = resolve({ manifest: noClusterProbe, streams });
    const dashboard = buildDashboard(
      noClusterProbe,
      resolution,
      {},
      { timezone: "UTC", nowUs: NOW_US },
    );
    expect((dashboard.variables?.list ?? []).some((v: any) => v.name === "cluster")).toBe(false);
  });

  it("an omitWhenFieldAbsent picker REGISTERS its source schema, even on a rung-1 override", () => {
    // Browser-verified regression: the cluster picker resolves k8s_cluster from the
    // kube-state rung-1 override, which deliberately consults no schema and (before
    // this fix) registered none. omitWhenFieldAbsent then tested the field against an
    // UNFETCHED schema, which arrives as an empty set, so the field read as absent and
    // the picker vanished from the page — no warning, no hidden-group entry.
    const resolution = resolve({});
    const picker: any = kubernetesPage.scopePickers.find((p: any) => p.name === "cluster");
    expect(picker.omitWhenFieldAbsent, "guards this contract").toBe(true);
    expect(resolution.schemasNeeded).toContain(picker.valuesFrom.stream);
  });

  it("(b) a picker whose valuesFrom.stream is ABSENT from the list is omitted", () => {
    // Drop BOTH source streams: `pod` sources from the kubeletstats stream, while
    // `cluster` and `namespace` source from kube_pod_status_phase.
    const streams = fullK8sStreams();
    streams.metrics = streams.metrics.filter(
      (s: any) => s.name !== "k8s_pod_memory_usage" && s.name !== "kube_pod_status_phase",
    );
    const dashboard = build(resolve({ streams }));
    const names = (dashboard.variables?.list ?? []).map((v: any) => v.name);
    expect(names).not.toContain("cluster");
    expect(names).not.toContain("namespace");
    expect(names).not.toContain("pod");
  });

  it("(c) DRY-RUN finding 6: a picker whose valuesFrom.stream is PRESENT BUT DEAD is omitted", () => {
    // `_values` on the 177-day-dead k8s_node_cpu_utilization returned 0 values while
    // the live k8s_node_cpu_usage returned all 10 clusters. A fossil stream must not
    // ship an empty dropdown.
    const streams = fullK8sStreams();
    streams.metrics.find((s: any) => s.name === "kube_pod_status_phase")!.stats.doc_time_max =
      NOW_US - 177 * DAY_US;
    const dashboard = build(resolve({ streams }));
    expect((dashboard.variables?.list ?? []).some((v: any) => v.name === "cluster")).toBe(false);
  });

  it("(d) every picker's built variable carries omitWhenValuesEmpty: true", () => {
    const dashboard = build(resolve({}));
    const list = dashboard.variables?.list ?? [];
    expect(list.length).toBeGreaterThan(0);
    for (const variable of list) expect(variable.omitWhenValuesEmpty).toBe(true);
  });

  it("picker LABELS come from the group's own `display`, never an i18n key", () => {
    const dashboard = build(resolve({}));
    const cluster = (dashboard.variables?.list ?? []).find((v: any) => v.name === "cluster");
    expect(cluster.label).toBe("K8s Cluster");
    const namespace = (dashboard.variables?.list ?? []).find((v: any) => v.name === "namespace");
    expect(namespace.label).toBe("K8s Namespace");
  });

  it("renaming `display` in the dictionary renames the picker", () => {
    const renamed = K8S_FULL_DICT.map((g) =>
      g.id === GROUP.cluster ? { ...g, display: "Fleet" } : g,
    );
    const dashboard = build(resolve({ dict: renamed }));
    const cluster = (dashboard.variables?.list ?? []).find((v: any) => v.name === "cluster");
    expect(cluster.label).toBe("Fleet");
  });

  it("an explicit labelKey overrides `display` — the escape hatch of §4.1", () => {
    const withLabelKey = {
      ...kubernetesPage,
      scopePickers: kubernetesPage.scopePickers.map((p: any) =>
        p.name === "cluster" ? { ...p, labelKey: "infra.hosts.panel.cpuBusy" } : p,
      ),
    };
    const resolution = resolve({ manifest: withLabelKey });
    const dashboard = buildDashboard(
      withLabelKey,
      resolution,
      {},
      { timezone: "UTC", nowUs: NOW_US },
    );
    const cluster = (dashboard.variables?.list ?? []).find((v: any) => v.name === "cluster");
    expect(cluster.labelKey).toBe("infra.hosts.panel.cpuBusy");
    expect(cluster.label).not.toBe("K8s Cluster");
  });

  it("PINS remove their concept's picker entirely (the hosts drawer has no host picker)", () => {
    const resolution = resolveManifest({
      manifest: hostsPage,
      streams: fullHostsStreams(),
      semanticGroups: dictionary(GROUP.host),
      range: RANGE,
      now: NOW_US,
      pins: { [GROUP.host]: "host-1" },
    });
    const dashboard = buildDashboard(
      hostsPage,
      resolution,
      { [GROUP.host]: "host-1" },
      { timezone: "UTC", nowUs: NOW_US },
    );
    expect(dashboard.variables?.list ?? []).toHaveLength(0);
  });
});

// ── buildDashboard (§5.5) ──────────────────────────────────────────────────

describe("§5.5 buildDashboard", () => {
  it("emits a v8 document with tabs = sections and tabId = section id", () => {
    const dashboard = build(resolve({}));
    expect(dashboard.version).toBe(8);
    expect(dashboard.tabs.map((t: any) => t.tabId)).toEqual([
      "overview",
      "inventory",
      "health",
      "utilization",
      "nodes",
      "workloads",
    ]);
  });

  it("gives every tab the section id as its NAME, so ?tab= never contradicts the label", () => {
    // The displayed name is the value a reader copies out of the URL; a divergence makes ?tab= unreadable.
    for (const tab of build(resolve({})).tabs) expect(tab.name).toBe(tab.tabId);
  });

  it("drops a section whose panels ALL hid — the tab list never shows an empty tab", () => {
    // No kubelet-pod streams ⇒ the Workloads section keeps only its kube-state panels;
    // strip every kube-state stream too and the whole section goes.
    const streams = streamLists([
      { name: "k8s_node_cpu_usage", schema: KUBELET_NODE_SCHEMA },
      { name: "k8s_node_memory_usage", schema: KUBELET_NODE_SCHEMA },
    ]);
    const dashboard = build(resolve({ streams }));
    expect(dashboard.tabs.map((t: any) => t.tabId)).not.toContain("workloads");
  });

  it("carries only VISIBLE panels, with the variant's unit override on config.unit", () => {
    const streams = streamLists([
      { name: "k8s_node_cpu_usage", schema: KUBELET_NODE_SCHEMA },
      { name: "k8s_node_memory_usage", schema: KUBELET_NODE_SCHEMA },
    ]);
    const dashboard = build(resolve({ streams }));
    const nodesTab = dashboard.tabs.find((t: any) => t.tabId === "nodes");
    const cpu = nodesTab.panels.find((p: any) => p.id === "k8s_nd_cpu");
    expect(cpu.config.unit).toBe("numbers");
    expect(nodesTab.panels.some((p: any) => p.id === "k8s_nd_conditions")).toBe(false);
  });

  it("promql panels carry an empty fields block; queryType rides the variant", () => {
    const dashboard = build(resolve({}));
    const panel = dashboard.tabs[0].panels[0];
    expect(panel.queryType).toBe("promql");
    expect(panel.queries[0].fields).toEqual(
      expect.objectContaining({ x: [], y: [], z: [], breakdown: [] }),
    );
  });

  it("pickers become v8 query_values variables with the all-sentinel and a resolved field", () => {
    const dashboard = build(resolve({}));
    const namespace = (dashboard.variables?.list ?? []).find((v: any) => v.name === "namespace");
    expect(namespace.type).toBe("query_values");
    expect(namespace.multiSelect).toBe(true);
    expect(namespace.selectAllValueForMultiSelect).toBe("all");
    expect(namespace.scope).toBe("global");
    expect(namespace.query_data).toEqual(
      expect.objectContaining({
        stream_type: "metrics",
        // Sourced from the kube-state stream the health tables query; the field is
        // that stream's own spelling, not the kubeletstats one.
        stream: "kube_pod_status_phase",
        field: "namespace",
        max_record_size: 100,
      }),
    );
  });

  it("a picker with defaultFirstValue emits the 'first' sentinel instead of 'all'", () => {
    // The cluster picker opts in: a fleet-wide default mixes ten clusters into one
    // crash-loop list nobody can act on. useVariablesManager:96-112 falls through to
    // the first loaded option for any value other than "all"/"custom".
    const dashboard = build(resolve({}));
    const byName = Object.fromEntries(
      (dashboard.variables?.list ?? []).map((v: any) => [v.name, v]),
    );
    expect(byName.cluster.selectAllValueForMultiSelect).toBe("first");
    expect(byName.namespace.selectAllValueForMultiSelect).toBe("all");
    expect(byName.pod.selectAllValueForMultiSelect).toBe("all");
  });

  it("a chained picker carries one IN filter row per parent, each field spelled for its OWN stream", () => {
    const dashboard = build(resolve({}));
    const pod = (dashboard.variables?.list ?? []).find((v: any) => v.name === "pod");
    // Namespace alone does not identify a pod: `openobserve` exists in several
    // clusters, so filtering on it returned every cluster's pods.
    expect(pod.query_data.filter).toEqual([
      { name: "k8s_cluster", operator: "IN", value: "$cluster" },
      { name: "namespace", operator: "IN", value: "$namespace" },
    ]);
  });

  it("a single-parent picker still emits exactly one clause — no multi-parent regression", () => {
    const dashboard = build(resolve({}));
    const namespace = (dashboard.variables?.list ?? []).find((v: any) => v.name === "namespace");
    expect(namespace.query_data.filter).toEqual([
      { name: "k8s_cluster", operator: "IN", value: "$cluster" },
    ]);
    const cluster = (dashboard.variables?.list ?? []).find((v: any) => v.name === "cluster");
    expect(cluster.query_data.filter).toEqual([]);
  });

  it("EVERY parent clause is re-spelled for the child's stream, not copied from the parent", () => {
    // Both parents resolve against kube-state, so a resolver that reused the
    // parent's own field verbatim would name `namespace` on a kubeletstats stream
    // that spells it k8s_namespace_name — an empty list, not an error.
    const manifest = {
      ...kubernetesPage,
      scopePickers: kubernetesPage.scopePickers.map((picker: any) =>
        picker.name === "pod"
          ? {
              ...picker,
              valuesFrom: {
                groupId: "kubelet-pod",
                stream: "k8s_pod_memory_usage",
                streamType: "metrics",
              },
            }
          : picker,
      ),
    };
    const dashboard: any = buildDashboard(manifest as any, resolve({ manifest }), {}, {
      timezone: "UTC",
      nowUs: NOW_US,
    } as any);
    const pod = dashboard.variables.list.find((v: any) => v.name === "pod");
    expect(pod.query_data.stream).toBe("k8s_pod_memory_usage");
    expect(pod.query_data.filter).toEqual([
      { name: "k8s_cluster", operator: "IN", value: "$cluster" },
      { name: "k8s_namespace_name", operator: "IN", value: "$namespace" },
    ]);
  });

  it("a multi-parent child drops only the clause whose parent was omitted", () => {
    // The dangling-reference rule, per clause: losing cluster must not cost the
    // namespace narrowing that still has a live parent to point at.
    const resolution: any = resolve({});
    const pruned = {
      ...resolution,
      pickers: resolution.pickers.filter((p: any) => p.def.name !== "cluster"),
    };
    const dashboard: any = build(pruned);
    const names = new Set(dashboard.variables.list.map((v: any) => v.name));
    expect(names.has("cluster")).toBe(false);
    const pod = dashboard.variables.list.find((v: any) => v.name === "pod");
    expect(pod.query_data.filter).toEqual([
      { name: "namespace", operator: "IN", value: "$namespace" },
    ]);
  });

  it("showDynamicFilters is false — curated pages are not explorers", () => {
    expect(build(resolve({})).variables.showDynamicFilters).toBe(false);
  });

  it("stale groups stamp config.curated_badge with a key, a DATE and a DURATION", () => {
    const longRange = { start: NOW_US - 30 * DAY_US, end: NOW_US };
    const streams = fullK8sStreams();
    for (const entry of streams.metrics) entry.stats.doc_time_max = NOW_US - 3 * DAY_US;
    const dashboard = build(resolve({ streams, range: longRange }));
    const badged = dashboard.tabs
      .flatMap((t: any) => t.panels)
      .filter((p: any) => p.config.curated_badge);
    expect(badged.length).toBeGreaterThan(0);
    for (const panel of badged) {
      expect(panel.config.curated_badge.key).toBe("infra.curated.staleBadge");
      expect(panel.config.curated_badge.date).toBeTruthy();
      expect(panel.config.curated_badge.duration).toBeTruthy();
    }
  });

  it("badge dates format against the PASSED timezone — resolve.ts never reads a store", () => {
    const longRange = { start: NOW_US - 30 * DAY_US, end: NOW_US };
    const streams = fullK8sStreams();
    for (const entry of streams.metrics) entry.stats.doc_time_max = NOW_US - 3 * DAY_US;
    const resolution = resolve({ streams, range: longRange });
    const utc = buildDashboard(kubernetesPage, resolution, {}, { timezone: "UTC", nowUs: NOW_US });
    const tokyo = buildDashboard(
      kubernetesPage,
      resolution,
      {},
      { timezone: "Asia/Tokyo", nowUs: NOW_US },
    );
    const dateOf = (d: any) =>
      d.tabs.flatMap((t: any) => t.panels).find((p: any) => p.config.curated_badge).config
        .curated_badge.date;
    expect(dateOf(utc)).not.toBe(dateOf(tokyo));
  });

  it("the cardinality exemption is CLAUSE-local — one re-aggregated clause arms no others", () => {
    // The exemption tested the whole query string, so a single count(count by …)
    // anywhere disarmed the topk bound for every other clause in that query.
    const leaky: any = {
      ...kubernetesPage,
      sections: [
        {
          id: "overview",
          titleKey: "infra.k8s.section.overview",
          scopedBy: [],
          panels: [
            {
              id: "leaky",
              groupId: "kubelet-node",
              titleKey: "infra.k8s.panel.nodes",
              type: "line",
              unit: "numbers",
              layout: { w: 96, h: 16 },
              variants: [
                {
                  requiresStreams: ["k8s_node_cpu_usage"],
                  queryType: "promql",
                  queries: [
                    {
                      // Clause 1 is legitimately re-aggregated; clause 2 is an
                      // UNBOUNDED per-pod fan-out that must still be flagged.
                      query:
                        "count(count by (k8s_node_name) (k8s_node_cpu_usage))" +
                        " + sum by (k8s_pod_name) (k8s_pod_cpu_usage)",
                      legend: "",
                    },
                  ],
                },
              ],
              drilldown: [],
            },
          ],
        },
      ],
    };
    const violations = lintManifest(leaky);
    const cardinality = violations.filter((v) => v.rule === "cardinality");
    expect(cardinality.length).toBeGreaterThan(0);
    expect(cardinality.some((v) => v.message.includes("k8s_pod_name"))).toBe(true);
    // …and the genuinely re-aggregated clause is NOT flagged.
    expect(cardinality.some((v) => v.message.includes("k8s_node_name"))).toBe(false);
  });

  it("the drilldown URL carries the SUBSTITUTED query and the SELECTED variant's stream", () => {
    // The authored drilldown is built at pack-authoring time from variant 1's raw
    // text, so it shipped `${f:}` tokens and the wrong variant's stream — decoding
    // it is the only way to catch that; asserting it merely EXISTS passes anyway.
    const dashboard = build(resolve({}));
    const panels = dashboard.tabs.flatMap((tab: any) => tab.panels);
    const withDrilldown = panels.filter((panel: any) =>
      (panel.config.drilldown ?? []).some((d: any) => d.name === "openInMetricsExplorer"),
    );
    expect(withDrilldown.length).toBeGreaterThan(0);

    for (const panel of withDrilldown) {
      const entry = panel.config.drilldown.find((d: any) => d.name === "openInMetricsExplorer");
      const params = new URLSearchParams(String(entry.data.url).split("?")[1]);
      const decoded = b64DecodeUnicodeSafe(params.get("query") ?? "");

      // No unsubstituted tokens survive into the link the user opens.
      expect(decoded).not.toContain("${f:");
      expect(decoded).not.toContain("${scope:");
      expect(decoded).not.toContain("<probe>");
      // …and it is the query the TILE ran, not the one the pack authored.
      expect(decoded).toBe(panel.queries[0].query);
      expect(params.get("query_type")).toBe("promql");
    }
  });

  it("a panel resolving to the OTHER variant drills down to THAT variant's stream", () => {
    // node-CPU carries two variants (_usage | _utilization). The authored link
    // always named the first; only the resolved one is correct.
    const streams = streamLists([
      { name: "k8s_node_cpu_utilization", schema: KUBELET_NODE_SCHEMA },
      { name: "k8s_node_memory_usage", schema: KUBELET_NODE_SCHEMA },
      { name: "k8s_node_network_io", schema: KUBELET_NODE_SCHEMA },
    ]);
    const dashboard = build(resolve({ streams }));
    const panel = dashboard.tabs
      .flatMap((tab: any) => tab.panels)
      .find((p: any) => String(p.id).includes("cpu") && p.config.drilldown?.length);
    expect(panel).toBeTruthy();
    const entry = panel.config.drilldown.find((d: any) => d.name === "openInMetricsExplorer");
    const params = new URLSearchParams(String(entry.data.url).split("?")[1]);
    const decoded = b64DecodeUnicodeSafe(params.get("query") ?? "");
    expect(decoded).toContain("k8s_node_cpu_utilization");
    expect(decoded).not.toContain("k8s_node_cpu_usage");
  });

  it("the Nodes tile substitutes kube-state's `node`, not the kubeletstats spelling", () => {
    // The tile moved collectors, so its node token must resolve through kube-state's
    // override — the kubeletstats spelling would group by a label that is not there.
    const dashboard = build(resolve({}));
    const inventoryTab = dashboard.tabs.find((t: any) => t.tabId === "inventory");
    const [query] = inventoryTab.panels
      .find((p: any) => p.id === "k8s_ov_nodes")
      .queries.map((q: any) => q.query);
    expect(query).toContain("count by (node)");
    expect(query).toContain("kube_node_status_allocatable");
    expect(query).not.toContain("k8s_node_name");
  });

  it("carries the per-panel drilldown from the def", () => {
    const dashboard = build(resolve({}));
    const inventoryTab = dashboard.tabs.find((t: any) => t.tabId === "inventory");
    const panel = inventoryTab.panels.find((p: any) => p.id === "k8s_ov_nodes");
    expect(Array.isArray(panel.config.drilldown)).toBe(true);
    expect(panel.config.drilldown.length).toBeGreaterThan(0);
  });
});

// ── Layout (§5.5 / §6.5 FMP) ───────────────────────────────────────────────

describe("layout flow — 192-col rows", () => {
  it("fills rows to 192 without overlapping and never exceeds the grid width", () => {
    const dashboard = build(resolve({}));
    for (const tab of dashboard.tabs) {
      const rows = new Map<number, Array<{ x: number; w: number }>>();
      for (const panel of tab.panels) {
        expect(panel.layout.x + panel.layout.w).toBeLessThanOrEqual(192);
        const row = rows.get(panel.layout.y) ?? [];
        row.push({ x: panel.layout.x, w: panel.layout.w });
        rows.set(panel.layout.y, row);
      }
      for (const [, row] of rows) {
        const sorted = [...row].sort((a, b) => a.x - b.x);
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i].x).toBeGreaterThanOrEqual(sorted[i - 1].x + sorted[i - 1].w);
        }
      }
    }
  });

  it("FMP pin (finding 3): the six Inventory tiles fill row 1; every h:16 chart is below it", () => {
    // The tile row's w:32 × 6 is load-bearing for first-meaningful-paint, not
    // cosmetic — a later panel insertion that pushes a chart into row 1 fails here.
    const inventory = build(resolve({})).tabs.find((t: any) => t.tabId === "inventory");
    const tiles = inventory.panels.filter((p: any) => p.layout.h === 6);
    expect(tiles).toHaveLength(6);
    expect(tiles.map((p: any) => p.layout.y)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(tiles.map((p: any) => p.layout.x).sort((a: number, b: number) => a - b)).toEqual([
      0, 32, 64, 96, 128, 160,
    ]);
    for (const chart of inventory.panels.filter((p: any) => p.layout.h === 16)) {
      expect(chart.layout.y).toBeGreaterThan(0);
    }
  });

  it("forwards a panel's decimals into config, and omits the key when unset", () => {
    // A `decimals` the resolver drops leaves the renderer on its default 2, which is
    // what clipped "800.00 cores" — the declaration is only worth anything if it lands.
    const overview = build(resolve({})).tabs.find((t: any) => t.tabId === "overview");
    const cfg = (id: string) => overview.panels.find((p: any) => p.id === id).config;
    expect(cfg("k8s_sm_fleet_cpu").decimals).toBe(0);
    expect(cfg("k8s_sm_fleet_memory")).not.toHaveProperty("decimals");
  });

  it("packs a short panel into the free column beside a taller one", () => {
    // The Overview stack: the quadrant is h:39 and the two bar panels h:20 + h:19, so a
    // plain left-to-right wrap would drop the memory panel to y=39 UNDER the quadrant
    // instead of under the CPU panel. This is the only section that exercises the
    // packing, and the one whose arrangement was asked for explicitly.
    const overview = build(resolve({})).tabs.find((t: any) => t.tabId === "overview");
    const at = (id: string) => overview.panels.find((p: any) => p.id === id).layout;
    expect(at("k8s_sm_fleet_quadrant")).toMatchObject({ x: 0, y: 0, w: 120, h: 39 });
    expect(at("k8s_sm_fleet_cpu")).toMatchObject({ x: 120, y: 0, w: 72, h: 20 });
    expect(at("k8s_sm_fleet_memory")).toMatchObject({ x: 120, y: 20, w: 72, h: 19 });
  });

  it("leaves every uniform-height section laid out exactly as a plain wrap would", () => {
    // The packing must be a no-op wherever a row's panels share one height, which is
    // every section but Overview. Checked against the plain wrap recomputed here, so a
    // future packing change that silently reflows Health or Utilization fails.
    for (const tab of build(resolve({})).tabs) {
      if (tab.tabId === "overview") continue;
      let x = 0;
      let y = 0;
      let rowHeight = 0;
      for (const p of tab.panels) {
        if (x + p.layout.w > 192) {
          x = 0;
          y += rowHeight;
          rowHeight = 0;
        }
        expect({ id: p.id, x: p.layout.x, y: p.layout.y }).toEqual({ id: p.id, x, y });
        x += p.layout.w;
        rowHeight = Math.max(rowHeight, p.layout.h);
      }
    }
  });
});

// ── Strip model + freshness (pass-4 additions) ─────────────────────────────

describe("strip model", () => {
  it("hidden and stale group info both surface capabilityKey — the collapsed line's source", () => {
    const resolution = resolve({
      streams: streamLists([{ name: "kube_pod_status_phase", schema: KUBE_POD_PHASE_SCHEMA }]),
    });
    expect(resolution.hiddenGroups.length).toBeGreaterThan(0);
    for (const hidden of resolution.hiddenGroups) {
      expect(hidden.group.capabilityKey).toBeTruthy();
    }
  });

  it("a hidden group owning an INVENTORY panel sets autoExpand; one that does not, does not", () => {
    // kube-state owns Inventory tiles; kubelet-pod owns none.
    const noKubeState = fullK8sStreams();
    noKubeState.metrics = noKubeState.metrics.filter((s: any) => !s.name.startsWith("kube_"));
    expect(resolve({ streams: noKubeState }).stripAutoExpand).toBe(true);

    const noKubeletPod = fullK8sStreams();
    noKubeletPod.metrics = noKubeletPod.metrics.filter((s: any) => !s.name.startsWith("k8s_pod_"));
    expect(resolve({ streams: noKubeletPod }).stripAutoExpand).toBe(false);
  });

  it("targets the inventory section by ID, not whichever section happens to be first", () => {
    // kubelet-node owns three Inventory panels and NONE in the leading Overview
    // section, so a positional sections[0] lookup would read false here.
    const noKubeletNode = fullK8sStreams();
    noKubeletNode.metrics = noKubeletNode.metrics.filter(
      (s: any) => !s.name.startsWith("k8s_node_"),
    );
    expect(kubernetesPage.sections[0].id, "precondition: inventory is not first").not.toBe(
      "inventory",
    );
    expect(resolve({ streams: noKubeletNode }).stripAutoExpand).toBe(true);
  });

  it("a variant-miss panel folds into its PRESENT group's row with the drift spelling listed", () => {
    // kubelet-node present via CPU, but the memory family is absent entirely.
    const streams = streamLists([{ name: "k8s_node_cpu_usage", schema: KUBELET_NODE_SCHEMA }]);
    const resolution = resolve({ streams });
    expect(hiddenFor(resolution, "kubelet-node")).toBeUndefined();
    const partial = resolution.partialGroups.find((p: any) => p.group.id === "kubelet-node");
    expect(partial).toBeDefined();
    expect(partial.hiddenPanelIds).toContain("k8s_nd_memory");
    expect(partial.missingStreams.map((m: any) => m.name)).toContain("k8s_node_memory_usage");
  });
});

describe("emptyMeansHealthy travels to the panel config", () => {
  it("a section that declares it stamps every one of its panels", () => {
    const dashboard = build(resolve({}));
    const health = dashboard.tabs.find((t: any) => t.tabId === "health");
    expect(health, "health tab must build").toBeTruthy();
    for (const panel of health.panels) {
      expect(panel.config.curated_empty_means_healthy, panel.id).toBe(true);
    }
  });

  it("a section that does NOT declare it stamps nothing", () => {
    const dashboard = build(resolve({}));
    for (const tab of dashboard.tabs) {
      if (tab.tabId === "health") continue;
      for (const panel of tab.panels) {
        expect(panel.config.curated_empty_means_healthy, panel.id).toBeUndefined();
      }
    }
  });

  it("a STALE group is not marked healthy — a dead collector must never render green", () => {
    // The green check asserts "all clear", which is only honest when the collector
    // is alive and simply has nothing to report. Riding on the same eligibility the
    // no-data state already uses keeps the two verdicts from diverging.
    const streams = fullK8sStreams();
    for (const entry of streams.metrics) {
      entry.stats.doc_time_max = NOW_US - 40 * DAY_US;
    }
    const dashboard = build(resolve({ streams }));
    const health = dashboard.tabs.find((t: any) => t.tabId === "health");
    for (const panel of health?.panels ?? []) {
      expect(panel.config.curated_no_data_eligible, panel.id).not.toBe(true);
      expect(panel.config.curated_empty_means_healthy, panel.id).not.toBe(true);
    }
  });
});

describe("tileNoData + positive freshness", () => {
  it("a metric tile in a PRESENT+FRESH group is marked as ELIGIBLE for the tileNoData state", () => {
    // The resolver cannot know whether a query returned series — that arrives at
    // render time — so its half of finding 2a is the eligibility flag: only tiles
    // in a present AND fresh group may show "No Data" rather than a blank. The
    // rendering half is pinned in CuratedPageView.spec.ts.
    const dashboard = build(resolve({}));
    const failed = dashboard.tabs
      .flatMap((t: any) => t.panels)
      .find((p: any) => p.id === "k8s_ov_pods_failed");
    expect(failed.config.curated_no_data_eligible).toBe(true);
  });

  it("a metric tile in a STALE group is NOT tileNoData-eligible — the badge already explains it", () => {
    const longRange = { start: NOW_US - 30 * DAY_US, end: NOW_US };
    const streams = fullK8sStreams();
    for (const entry of streams.metrics) entry.stats.doc_time_max = NOW_US - 3 * DAY_US;
    const dashboard = build(resolve({ streams, range: longRange }));
    const failed = dashboard.tabs
      .flatMap((t: any) => t.panels)
      .find((p: any) => p.id === "k8s_ov_pods_failed");
    expect(failed.config.curated_no_data_eligible).toBe(false);
  });

  it("lastDataUs is the max doc_time_max across present groups when NOTHING is stale", () => {
    const newest = NOW_US - 12 * 1_000_000;
    const streams = fullK8sStreams();
    streams.metrics.find((s: any) => s.name === "k8s_node_cpu_usage")!.stats.doc_time_max = newest;
    expect(resolve({ streams }).lastDataUs).toBe(newest);
  });

  it("lastDataUs is NULL when ANY group is stale — the line never sits beside the banner", () => {
    const longRange = { start: NOW_US - 30 * DAY_US, end: NOW_US };
    const streams = fullK8sStreams();
    for (const entry of streams.metrics) {
      if (entry.name.startsWith("kube_")) entry.stats.doc_time_max = NOW_US - 3 * DAY_US;
    }
    const resolution = resolve({ streams, range: longRange });
    expect(resolution.staleGroups.length).toBeGreaterThan(0);
    expect(resolution.lastDataUs).toBeNull();
  });
});

// ── Hosts pack — the drawer's synchronous-open contract ────────────────────

describe("hosts pack resolution (§7.3, pass-4 finding 17)", () => {
  it("resolves host → host_name off the OVERRIDE, with no anchor schema and a hostile dictionary", () => {
    // The `host` group lists `host` FIRST and `host_name` fifth, so this fails on
    // BOTH regressions: dropping the override, and letting rung 2 take over.
    const streams = fullHostsStreams();
    for (const entry of streams.metrics) {
      entry.schema = [{ name: "host", type: "Utf8" }];
    }
    const resolution = resolveManifest({
      manifest: hostsPage,
      streams,
      semanticGroups: dictionary(GROUP.host),
      range: RANGE,
      now: NOW_US,
      pins: { [GROUP.host]: "host-1" },
    });
    expect(groupById(GROUP.host).fields[0]).toBe("host");
    for (const panel of resolution.panels.filter((p: any) => !p.hidden)) {
      expect(panel.resolvedFields[GROUP.host]).toBe("host_name");
    }
  });

  it("requires NO schema reads and NO dictionary at all", () => {
    const resolution = resolveManifest({
      manifest: hostsPage,
      streams: fullHostsStreams(),
      semanticGroups: [],
      range: RANGE,
      now: NOW_US,
      pins: { [GROUP.host]: "host-1" },
    });
    expect(resolution.schemasNeeded).toEqual([]);
    expect(resolution.needsSemanticGroups).toBe(false);
    expect(resolution.hiddenGroups).toEqual([]);
  });

  it("a host whose collector omits the filesystem scraper hides that panel and explains it", () => {
    const streams = fullHostsStreams();
    streams.metrics = streams.metrics.filter((s: any) => s.name !== "system_filesystem_usage");
    const resolution = resolveManifest({
      manifest: hostsPage,
      streams,
      semanticGroups: dictionary(GROUP.host),
      range: RANGE,
      now: NOW_US,
      pins: { [GROUP.host]: "host-1" },
    });
    const fs = resolution.panels.find((p: any) => p.id === "hd_fs_used_pct");
    expect(fs.hidden).toBe(true);
    const partial = resolution.partialGroups.find((p: any) => p.group.id === "hostmetrics");
    expect(partial.hiddenPanelIds).toContain("hd_fs_used_pct");
  });
});

// ── §8.2 parity: the engine reproduces the frozen pre-retrofit builder ──────

describe("§8.2 golden parity — hosts pack vs the frozen buildHostDashboard output", () => {
  /**
   * Delete EXACTLY the §8.2 modulo set from both sides, so any new divergence
   * fails instead of silently widening the tolerance. `config.drilldown` is in
   * the set because the frozen builder authored none while §6.6's lint requires
   * one on every non-probe chart panel — see the §8.2 note.
   */
  const strip = (doc: any) => {
    const copy = JSON.parse(JSON.stringify(doc));
    delete copy.created;
    delete copy.title;
    for (const tab of copy.tabs ?? []) {
      delete tab.tabId;
      delete tab.name;
      for (const panel of tab.panels ?? []) {
        // buildDashboard is pure and i18n-free (§5.5 — every call site passes only
        // { timezone }), so it emits titleKey and can never reproduce the fixture's
        // translated copy. Titles are pinned by key in hosts.page.spec.ts instead.
        delete panel.title;
        delete panel.config?.curated_badge;
        delete panel.config?.drilldown;
        // The frozen builder predates these; they are pinned by the sparse-series specs below.
        delete panel.config?.show_symbol;
        delete panel.config?.connect_nulls;
      }
    }
    return copy;
  };

  it("builds a dashboard deep-equal to the committed fixture modulo the enumerated key set", async () => {
    // The fixture was generated from the pre-retrofit builder BEFORE its deletion;
    // this spec never imports buildHostDashboard, so it outlives the migration.
    const golden = (await import("./packs/__fixtures__/hostDashboard.golden.json")).default as any;

    const resolution = resolveManifest({
      manifest: hostsPage,
      streams: fullHostsStreams(),
      semanticGroups: dictionary(GROUP.host),
      range: RANGE,
      now: NOW_US,
      pins: { [GROUP.host]: "host-1" },
    });
    const engine = buildDashboard(
      hostsPage,
      resolution,
      { [GROUP.host]: "host-1" },
      { timezone: "UTC", nowUs: NOW_US },
    );

    expect(strip(engine)).toEqual(strip(golden));
  });

  it('every ENGINE-BUILT query pins host_name="host-1" — the escape contract survived the move', () => {
    // Asserted against buildDashboard output, not the fixture: a spec that reads
    // the fixture and asserts facts about the fixture touches no engine code and
    // can never go red.
    const resolution = resolveManifest({
      manifest: hostsPage,
      streams: fullHostsStreams(),
      semanticGroups: dictionary(GROUP.host),
      range: RANGE,
      now: NOW_US,
      pins: { [GROUP.host]: "host-1" },
    });
    const engine = buildDashboard(
      hostsPage,
      resolution,
      { [GROUP.host]: "host-1" },
      { timezone: "UTC", nowUs: NOW_US },
    );
    const queries = allQueries(engine);
    expect(queries).toHaveLength(10);
    for (const query of queries) {
      expect(query).toContain('host_name="host-1"');
      expect(query).not.toContain("${f:");
      expect(query).not.toContain("${scope:");
    }
  });

  describe("every Inventory/Nodes panel emits a REAL cluster matcher after substitution", () => {
    // The shipped bug read as "the picker does nothing" because the built query
    // had no matcher in it. Asserted on buildDashboard output — the same text
    // that reaches the query API — so a token that fails to substitute is caught
    // here rather than by a user watching a tile not move.
    it("substitutes a cluster matcher into all nine Inventory panels", () => {
      const built = build(resolve({}));
      const inventory = (built.tabs ?? []).find((t: any) => t.tabId === "inventory");
      expect(inventory.panels.length).toBe(9);
      for (const p of inventory.panels) {
        for (const q of p.queries) {
          // The SPELLING is per-panel-stream (§5.4): the fixture's kubelet-node
          // streams carry k8s_cluster_name while kube-state carries k8s_cluster,
          // so the pin is "a resolved cluster matcher", not one literal name.
          expect(q.query, p.id).toMatch(/k8s_cluster(_name)?=~"\$cluster"/);
          expect(q.query, `${p.id} left a token unsubstituted`).not.toContain("${scope:");
        }
      }
    });

    it("both spellings appear across the section — proof it resolved per stream", () => {
      const built = build(resolve({}));
      const inventory = (built.tabs ?? []).find((t: any) => t.tabId === "inventory");
      const queries = inventory.panels.flatMap((p: any) => p.queries.map((q: any) => q.query));
      expect(queries.some((q: string) => q.includes('k8s_cluster_name=~"$cluster"'))).toBe(true);
      expect(queries.some((q: string) => /[^_]k8s_cluster=~"\$cluster"/.test(q))).toBe(true);
    });

    it("pins collapse the same token to an exact-match literal, braces intact", () => {
      const built = build(resolve({}), { pins: { [GROUP.cluster]: "ap1cloud" } });
      const inventory = (built.tabs ?? []).find((t: any) => t.tabId === "inventory");
      for (const p of inventory.panels) {
        for (const q of p.queries) {
          expect(q.query, p.id).toMatch(/k8s_cluster(_name)?="ap1cloud"/);
          expect(q.query, `${p.id} empty matcher`).not.toMatch(/\{\s*\}/);
          expect(q.query, `${p.id} dangling comma`).not.toMatch(/[{,]\s*[,}]/);
        }
      }
    });
  });

  // ── B2: per-tab picker applicability rides the built variable ──────────────
  describe("scope-picker applicability is declared, not stamped per active tab", () => {
    // The rebuild that flips curatedDisabled hands RenderDashboardCharts a new
    // dashboardData identity, which re-runs useVariablesManager.initialize over
    // the freshly built variables. initialize marks an INDEPENDENT query_values
    // pending only when it has no custom/all default (:479-491), so every
    // all-sentinel picker comes back with options: [] and is never re-fetched.
    // Carrying the loaded options ON the rebuilt variable is what survives that.
    it("a rebuilt picker keeps the options the previous build already loaded", async () => {
      const resolution = resolveManifest({
        manifest: kubernetesPage,
        streams: fullK8sStreams(),
        semanticGroups: defaultSemanticGroups as FieldAlias[],
        range: RANGE,
        now: NOW_US,
      });
      const loaded = [{ label: "argocd", value: "argocd" }];
      const built: any = buildDashboard(kubernetesPage, resolution, {}, {
        timezone: "UTC",
        nowUs: NOW_US,
        pickerOptions: { namespace: loaded },
      } as any);

      const namespace = built.variables.list.find((v: any) => v.name === "namespace");
      expect(namespace.options).toEqual(loaded);

      // The REAL seam: the manager clones the built variables on initialize, so
      // the carried options are what the dropdown shows while the refetch is in
      // flight — without them the rebuild flashes an empty list on every tab switch.
      const manager = useVariablesManager(((key: string) => key) as never);
      await manager.initialize(built.variables.list, built);
      const managed = manager
        .getAllVisibleVariables("workloads")
        .find((v: any) => v.name === "namespace") as any;
      expect(managed.options).toEqual(loaded);
    });

    // The cache above only replays options a PREVIOUS build already loaded — it
    // cannot seed the first one. VariablesValueSelector fires a values query for
    // exactly one reason: checkAndLoadPendingVariables (:1814-1828) walks the
    // managed variables and calls loadDependentVariable only where
    // isVariableLoadingPending === true. useVariablesManager.initialize marks an
    // independent query_values pending only when it has NO custom/all default
    // (:479-491), so an all-sentinel picker is born unpending, never fetches, and
    // renders <ALL> over an empty option list forever. A chained CHILD is NOT
    // fast-tracked here: its parent carries loadOptionsWithAllDefault and so
    // really does fetch, and starting the child in parallel sends its filter with
    // `$namespace` never substituted. The child is released by the parent's
    // completion notification instead.
    it("every INDEPENDENT built picker is marked pending by the real manager", async () => {
      const resolution = resolveManifest({
        manifest: kubernetesPage,
        streams: fullK8sStreams(),
        semanticGroups: defaultSemanticGroups as FieldAlias[],
        range: RANGE,
        now: NOW_US,
      });
      const built: any = buildDashboard(
        kubernetesPage,
        resolution,
        {},
        { timezone: "UTC", nowUs: NOW_US },
      );

      const manager = useVariablesManager(((key: string) => key) as never);
      await manager.initialize(built.variables.list, built);
      const managed = manager.getAllVisibleVariables("workloads") as any[];
      expect(managed.length).toBeGreaterThan(0);

      // Independent pickers are the ones that regressed; assert them by name so a
      // pack that later drops the chain cannot make this pass vacuously.
      const independent = managed.filter((v) => !v.query_data?.filter?.length);
      expect(independent.map((v) => v.name)).toContain("cluster");
      for (const variable of independent) {
        expect(
          variable.isVariableLoadingPending,
          `${variable.name} must be pending or it never fetches its values`,
        ).toBe(true);
      }

      // A chained child WAITS: firing it now would race its parent and ship the
      // filter with `$namespace` unsubstituted, yielding no values at all. The
      // chain is three deep (cluster → namespace → pod), so the MIDDLE link must
      // wait as a child and still be waited ON as a parent.
      const chained = managed.filter((v) => v.query_data?.filter?.length);
      expect(chained.map((v) => v.name)).toEqual(expect.arrayContaining(["namespace", "pod"]));
      for (const variable of chained) {
        expect(
          variable.isVariableLoadingPending,
          `${variable.name} must wait for its parent's values`,
        ).toBe(false);
      }
    });

    // The dashboards feature is the reference producer for chained variables, and
    // the bundled host_metrics dashboard is its known-good artifact ($mountpoint
    // and $device chain on $host_name). Conformance is structural, not literal:
    // the keys the manager and VariablesValueSelector read must be present and
    // shaped identically, so a curated picker cannot drift into a shape stored
    // dashboards never produce.
    it("emits the same variable shape the bundled host_metrics dashboard uses", () => {
      const reference: any[] = (hostMetricsDashboard as any).variables.list;
      const referenceParent = reference.find((v) => v.query_data.filter.length === 0);
      const referenceChild = reference.find((v) => v.query_data.filter.length > 0);
      expect(referenceParent && referenceChild).toBeTruthy();

      const resolution = resolveManifest({
        manifest: kubernetesPage,
        streams: fullK8sStreams(),
        semanticGroups: defaultSemanticGroups as FieldAlias[],
        range: RANGE,
        now: NOW_US,
      });
      const built: any = buildDashboard(
        kubernetesPage,
        resolution,
        {},
        { timezone: "UTC", nowUs: NOW_US },
      );

      const shape = (v: any) => ({
        keys: Object.keys(v).sort(),
        queryDataKeys: Object.keys(v.query_data).sort(),
        type: v.type,
        scope: v.scope,
        multiSelect: v.multiSelect,
        selectAll: v.selectAllValueForMultiSelect,
        filterShape: v.query_data.filter.map((f: any) => Object.keys(f).sort()),
        filterOperators: v.query_data.filter.map((f: any) => f.operator),
        // The parent is referenced as a bare `$name`, never `${name}` or `{{name}}` —
        // buildScopedDependencyGraph resolves the edge by extracting that token.
        filterRefsAreBareDollar: v.query_data.filter.every((f: any) =>
          /^\$[a-zA-Z0-9_-]+$/.test(f.value),
        ),
      });

      // Curated adds `curated*` presentation keys on top; the reference key set
      // must be a strict subset, so nothing the shared code reads is missing.
      for (const variable of built.variables.list) {
        const ours = shape(variable);
        const theirs = shape(variable.query_data.filter.length ? referenceChild : referenceParent);
        for (const key of theirs.keys) {
          expect(ours.keys, `${variable.name} is missing key ${key}`).toContain(key);
        }
        expect(ours.queryDataKeys).toEqual(theirs.queryDataKeys);
        expect(ours.type).toBe(theirs.type);
        expect(ours.scope).toBe(theirs.scope);
        expect(ours.multiSelect).toBe(theirs.multiSelect);
        // The sentinel VALUE is a deliberate per-picker choice, not a shape contract:
        // `cluster` opts into "first" so the page opens on one cluster rather than a
        // ten-cluster mix. What parity requires is that the value stays one the shared
        // manager understands (useVariablesManager:96-112 reads "all" and "custom"
        // specially and falls through to the first option for anything else).
        expect(["all", "first", "custom"]).toContain(ours.selectAll);
        // Parity is per CLAUSE, not per count: the reference child narrows by one
        // parent, while a curated child may narrow by several (pod needs cluster as
        // well as namespace). Each clause must still be shaped the way it shapes its one.
        for (const clause of ours.filterShape) expect(clause).toEqual(theirs.filterShape[0]);
        for (const operator of ours.filterOperators) {
          expect(operator).toBe(theirs.filterOperators[0]);
        }
        expect(ours.filterRefsAreBareDollar).toBe(true);
      }

      // The chain itself, resolved by the same graph builder stored dashboards use.
      const graph = buildScopedDependencyGraph(
        built.variables.list.map((v: any) => ({ ...v, scope: "global" })),
        {},
      );
      // The middle link is both a child and a parent, only the root is independent,
      // and pod waits on BOTH — a namespace name alone does not identify a pod.
      expect(graph["pod@global"].parents).toEqual(["cluster@global", "namespace@global"]);
      expect(graph["namespace@global"].parents).toEqual(["cluster@global"]);
      expect(graph["cluster@global"].parents).toEqual([]);
    });

    // A picker can be dropped after its child declared chainedOn it (the cluster
    // picker is omitted for values-emptiness). If the child still emitted
    // `IN $cluster`, buildScopedDependencyGraph would resolve a parent that is not
    // in the list — so the child must be promoted to independent instead.
    it("a picker whose chained parent was omitted carries no dangling reference", () => {
      const resolution = resolveManifest({
        manifest: kubernetesPage,
        streams: fullK8sStreams(),
        semanticGroups: defaultSemanticGroups as FieldAlias[],
        range: RANGE,
        now: NOW_US,
      });

      // Drop the parent the way an omission rule does, leaving the child's
      // chainedOn declaration untouched.
      const pruned = {
        ...resolution,
        pickers: resolution.pickers.filter((p: any) => p.def.name !== "namespace"),
      };
      const built: any = buildDashboard(kubernetesPage, pruned as any, {}, {
        timezone: "UTC",
        nowUs: NOW_US,
      } as any);

      const names = new Set(built.variables.list.map((v: any) => v.name));
      expect(names.has("namespace")).toBe(false);
      expect(names.has("pod")).toBe(true);

      for (const variable of built.variables.list) {
        for (const filter of variable.query_data.filter) {
          const referenced = /^\$([a-zA-Z0-9_-]+)$/.exec(filter.value)?.[1];
          expect(referenced && names.has(referenced), `${variable.name} -> ${filter.value}`).toBe(
            true,
          );
        }
      }

      // And the real graph agrees: pod keeps the parent it still HAS and waits on
      // no ghost — dropping one link of a multi-parent chain is not dropping them all.
      const graph = buildScopedDependencyGraph(
        built.variables.list.map((v: any) => ({ ...v, scope: "global" })),
        {},
      );
      expect(graph["pod@global"].parents).toEqual(["cluster@global"]);
    });
  });

  // ── B4: a dead group is "stopped reporting", never "not found" ─────────────
  it("all-dead streams tag every missingStreams entry `stale`, never `absent`", () => {
    // The measured sweep: 23.9h => present+badged; past the 24h liveness floor
    // the group hides, but the ENTRIES stay tagged stale so the strip renders
    // "stopped reporting" (restart the collector) and not "not found" (install one).
    const H = 60 * 60 * 1_000_000;
    const build = (ageHours: number) => {
      const streams = fullK8sStreams();
      for (const entry of streams.metrics) {
        entry.stats = { doc_time_max: NOW_US - ageHours * H };
      }
      return resolve({ streams });
    };

    const fresh = build(23.9);
    expect(fresh.presentGroupIds).toContain("kubelet-node");
    expect(fresh.staleGroups.map((g: any) => g.group.id)).toContain("kubelet-node");

    for (const ageHours of [24.1, 120]) {
      const dead = build(ageHours);
      expect(dead.presentGroupIds).toEqual([]);
      // Only streams the fixture actually LISTS can be "stale" — a name the org
      // never had is genuinely absent, and conflating the two is the bug's mirror image.
      const listed = new Set(fullK8sStreams().metrics.map((entry: any) => entry.name));
      const entries = dead.hiddenGroups
        .flatMap((h: any) => h.missingStreams)
        .filter((entry: any) => listed.has(entry.name));
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.state, `${entry.name} at ${ageHours}h`).toBe("stale");
        expect(entry.lastSeenUs).toBeGreaterThan(0);
      }
    }
  });

  // ── M2: the drilldown must open the SAME window the panel shows ────────────
  it("threads the page range onto every explorer drilldown URL", () => {
    const resolution = resolve({});
    const relative: any = buildDashboard(
      kubernetesPage,
      resolution,
      {},
      {
        timezone: "UTC",
        nowUs: NOW_US,
        drilldownRange: { period: "3h" },
      },
    );
    const urls = (dashboard: any) =>
      (dashboard.tabs as any[])
        .flatMap((tab) => tab.panels)
        .flatMap((panel: any) => panel.config.drilldown ?? [])
        .filter((entry: any) => entry.name === "openInMetricsExplorer")
        .map((entry: any) => entry.data.url as string);

    const relativeUrls = urls(relative);
    expect(relativeUrls.length).toBeGreaterThan(0);
    // A relative window travels as its PERIOD so the destination re-anchors it.
    for (const url of relativeUrls) expect(url).toContain("period=3h");

    const absolute: any = buildDashboard(
      kubernetesPage,
      resolution,
      {},
      {
        timezone: "UTC",
        nowUs: NOW_US,
        drilldownRange: { from: 111, to: 222 },
      },
    );
    for (const url of urls(absolute)) {
      expect(url).toContain("from=111");
      expect(url).toContain("to=222");
      expect(url).not.toContain("period=");
    }
  });

  // ── M4: one clock — the badge carries lastSeenUs so the reader recomputes ──
  it("the stale badge carries lastSeenUs, not only a build-time count", () => {
    // A count baked at build time froze while the page banner kept counting, so
    // the two numbers on one screen disagreed. The raw timestamp travels instead.
    const streams = fullK8sStreams();
    for (const entry of streams.metrics) entry.stats = { doc_time_max: NOW_US - 30 * 60_000_000 };
    const resolution = resolve({ streams, range: { start: NOW_US - 60_000_000, end: NOW_US } });
    expect(resolution.staleGroups.length).toBeGreaterThan(0);

    const dashboard: any = buildDashboard(
      kubernetesPage,
      resolution,
      {},
      {
        timezone: "UTC",
        nowUs: NOW_US,
      },
    );
    const badges = (dashboard.tabs as any[])
      .flatMap((tab) => tab.panels)
      .map((panel: any) => panel.config.curated_badge)
      .filter(Boolean);
    expect(badges.length).toBeGreaterThan(0);
    for (const badge of badges) {
      expect(typeof badge.lastSeenUs).toBe("number");
      expect(badge.lastSeenUs).toBe(NOW_US - 30 * 60_000_000);
    }
  });
});

// ── Inventory tables must name the object, not the clock ───────────────────

describe("inventory tables render label columns", () => {
  // Verbatim from the live deployment (o2.introspect, org default, 2026-09-04):
  // GET /api/default/prometheus/api/v1/query_range with the k8s_ov_unhealthy_pods
  // query returned resultType "matrix", 467 series, 3163 total points.
  const liveRangeResponse = {
    status: "success",
    data: {
      resultType: "matrix",
      result: [
        {
          metric: {
            namespace: "trivy-system",
            pod: "scan-vulnerabilityreport-7fd6d87c89-4pdt6",
            phase: "Pending",
          },
          values: [
            [1788513360, "1"],
            [1788513420, "1"],
          ],
        },
        {
          metric: {
            namespace: "monitor",
            pod: "monitor-openobserve-actions-0",
            phase: "Pending",
          },
          values: [[1788513360, "1"]],
        },
      ],
    },
  };

  const tablePanels = (dashboard: any) =>
    (dashboard.tabs ?? [])
      .flatMap((tab: any) => tab.panels ?? [])
      .filter((p: any) => p.type === "table");

  it("every table panel asks for the label-column mode, not the timestamp mode", () => {
    // convertPromQLTableChart.ts:86 defaults `promql_table_mode` to "single",
    // and :154-155 makes that mode emit exactly [Timestamp, Value] — no labels.
    // The Metrics Explorer sets "all" for precisely this reason at
    // utils/metrics/metricsHandoff.ts:180-183.
    const dashboard: any = build(resolve({}));
    const tables = tablePanels(dashboard);
    expect(tables.length).toBeGreaterThan(0);
    for (const p of tables) {
      expect(p.config.promql_table_mode, p.id).toBe("all");
    }
  });

  it("the REAL converter turns the live response into namespace/pod/phase columns", async () => {
    const { convertPromQLChartData } =
      await import("@/utils/dashboard/promql/convertPromQLChartData");
    const dashboard: any = build(resolve({}));
    const unhealthy = tablePanels(dashboard).find((p: any) => p.id === "k8s_ov_unhealthy_pods");
    expect(unhealthy).toBeTruthy();

    const result: any = await convertPromQLChartData([liveRangeResponse], {
      panelSchema: unhealthy,
      store: { state: { timezone: "UTC", theme: "light" } },
      chartPanelRef: { value: null },
      hoveredSeriesState: null,
      annotations: null,
      metadata: null,
    } as any);

    // convertPromQLChartData returns { options, extras }; the TableConverter's
    // rows/columns ride on `options` (convertPromQLChartData.ts:105-118, :150).
    const columnNames = (result.options.columns ?? []).map((c: any) => c.name);
    expect(columnNames).toContain("namespace");
    expect(columnNames).toContain("pod");
    expect(columnNames).toContain("phase");
    // The bug: a timestamp column instead of the labels.
    expect(columnNames).not.toContain("timestamp");

    // One row PER SERIES, not per data point — 2 series, not 3 points.
    expect(result.options.rows).toHaveLength(2);
    const byPod = Object.fromEntries(result.options.rows.map((r: any) => [r.pod, r]));
    expect(byPod["scan-vulnerabilityreport-7fd6d87c89-4pdt6"].namespace).toBe("trivy-system");
    expect(byPod["monitor-openobserve-actions-0"].namespace).toBe("monitor");
  });
});

// A disclosure that eats the title it qualifies has destroyed the thing it discloses.
// The phase fact is about the TRIO, so it is stated once per section, not three times
// beside three titles that then truncate to "Pods ru…" (user-reported).
describe("section-level note replaces the per-tile subtitle", () => {
  // The note travels PER TAB on the tab object, not as one active-section field
  // on the dashboard: a dashboard-level note would make the built object depend
  // on the selected tab, which is exactly what forced the rebuild.
  it("each tab carries its OWN noteKey", () => {
    const dashboard: any = build(resolve({}));
    const inventory = dashboard.tabs.find((t: any) => t.tabId === "inventory");
    expect(inventory.curatedNoteKey).toBe("infra.k8s.section.inventoryNote");
  });

  it("a section without a noteKey carries none — the line is per-section, not global", () => {
    const dashboard: any = build(resolve({}));
    const nodes = dashboard.tabs.find((t: any) => t.tabId === "nodes");
    expect(nodes.curatedNoteKey).toBeUndefined();
  });

  it("no Inventory tile stamps curated_subtitle_key any more", () => {
    const dashboard: any = build(resolve({}));
    const inventory = dashboard.tabs.find((t: any) => t.tabId === "inventory");
    const withSubtitle = inventory.panels.filter((p: any) => p.config.curated_subtitle_key);
    expect(withSubtitle.map((p: any) => p.id)).toEqual([]);
  });
});

// ── The restructure (design: conform to the dashboards tab model) ────────────
// Dashboards never rebuild their dashboard object to change tabs: the tab is a
// reactive injected ref (ViewDashboard :540-542) and per-tab variables are a
// COMPUTED FILTER over one stable list (RenderDashboardCharts :528-531). The
// curated engine used to bake an active-section `curatedDisabled` flag into each
// built variable, which forced a rebuild per tab switch, which re-initialized the
// variables manager and re-seeded every picker from `value: ""` — losing the
// user's selection. These pins hold the build TAB-INDEPENDENT so that cannot
// return.
describe("the built dashboard does not depend on the selected tab", () => {
  it("buildDashboard takes no active section and emits one object for all tabs", () => {
    const resolution = resolve({});
    // Deep-equal, not identity: buildDashboard is a pure builder, so two calls
    // legitimately allocate. What must not vary is the CONTENT.
    expect(build(resolution)).toEqual(build(resolution));
  });

  it("no built variable carries a disabled flag — an inapplicable picker is not rendered at all", () => {
    const dashboard: any = build(resolve({}));
    expect(dashboard.variables.list.length).toBeGreaterThan(0);
    for (const variable of dashboard.variables.list) {
      expect(variable.curatedDisabled, `${variable.name} still carries curatedDisabled`).toBe(
        undefined,
      );
      expect(variable.curatedDisabledTooltipKey).toBe(undefined);
    }
  });

  // Which tabs a picker applies to is DECLARED on the variable, exactly as the
  // dashboards model declares `tabs` for a tab-scoped variable — the difference
  // being that curated pickers stay global-scoped so they still load (an
  // all-sentinel variable at tab scope is skipped by setTabVisibility :756-765
  // and would never fetch its options at all).
  it("each built picker declares the sections that scope it", () => {
    const dashboard: any = build(resolve({}));
    const byName = Object.fromEntries(
      dashboard.variables.list.map((v: any) => [v.name, v.curatedTabs]),
    );
    // Cluster renders on ALL THREE tabs: a Workloads without it answered a
    // per-cluster question with every cluster's pods, silently.
    expect(byName.cluster).toEqual(["inventory", "health", "utilization", "nodes", "workloads"]);
    expect(byName.namespace).toEqual(["health", "utilization", "workloads"]);
    expect(byName.pod).toEqual(["workloads"]);
  });

  it("the namespace picker narrows by cluster, naming a field its OWN stream carries", () => {
    // The chain filter is applied to the CHILD's values stream, but the field name
    // comes from the PARENT, which resolves against a different stream
    // (k8s_node_cpu_usage vs k8s_pod_memory_usage). If the two streams spell the
    // cluster differently the filter names a column the query cannot see and the
    // namespace list comes back EMPTY — a silent failure that looks like "this
    // cluster has no namespaces". Live check 2026-09-05 on the introspect org:
    // both streams carry a populated `k8s_cluster` (k8s_cluster_name exists in the
    // schema but no series sets it), so one spelling covers the chain.
    const dashboard: any = build(resolve({}));
    const byName = Object.fromEntries(dashboard.variables.list.map((v: any) => [v.name, v]));

    const namespaceVar = byName.namespace;
    expect(namespaceVar.query_data.filter).toHaveLength(1);
    const [filter] = namespaceVar.query_data.filter;
    expect(filter.operator).toBe("IN");
    expect(filter.value).toBe("$cluster");

    // The filter field must be a real column of the stream the child queries.
    const phaseStreamFields = new Set(KUBE_POD_PHASE_SCHEMA);
    expect(namespaceVar.query_data.stream).toBe("kube_pod_status_phase");
    expect(
      phaseStreamFields.has(filter.name),
      `namespace narrows by "${filter.name}", which kube_pod_status_phase does not carry`,
    ).toBe(true);

    // Every clause of a multi-parent chain answers to the same rule.
    const podVar = byName.pod;
    expect(podVar.query_data.stream).toBe("kube_pod_status_phase");
    expect(podVar.query_data.filter.map((f: any) => f.value)).toEqual(["$cluster", "$namespace"]);
    for (const clause of podVar.query_data.filter) {
      expect(
        phaseStreamFields.has(clause.name),
        `pod narrows by "${clause.name}", which kube_pod_status_phase does not carry`,
      ).toBe(true);
    }
    expect(byName.cluster.query_data.filter).toEqual([]);
  });

  it("the declared sections match the manifest's scopedBy exactly", () => {
    const dashboard: any = build(resolve({}));
    for (const variable of dashboard.variables.list) {
      const expected = kubernetesPage.sections
        .filter((section) => (section.scopedBy ?? []).includes(variable.name))
        .map((section) => section.id);
      expect(variable.curatedTabs, variable.name).toEqual(expected);
    }
  });
});

// "Fleet CPU" was jargon AND ambiguous — a bare core count answers neither
// "how much" nor "out of what". Measured live 2026-09-04 on the introspect org:
// used 57.87 / allocatable 457.27 = 13.04% fleet-wide; production alone is
// 15.37 / 63.94 = 24.15%. Scoping ONLY the numerator returns 3.76% — the
// "lying gauge" of the addendum §2.7c, a 6.4x understatement that no runtime
// check can catch because the query succeeds and returns exactly one series.
describe("CPU tile reads used-vs-capacity, and both sides carry the scope", () => {
  const cpuPanel = (dashboard: any) =>
    dashboard.tabs
      .find((t: any) => t.tabId === "inventory")
      .panels.find((p: any) => p.id === "k8s_ov_cpu_used");

  it("the ratio variant divides usage by ALLOCATABLE and reads as a percentage", () => {
    const panel = cpuPanel(build(resolve({})));
    expect(panel).toBeTruthy();
    expect(panel.config.unit).toBe("percent");
    expect(panel.queries[0].query).toContain("kube_node_status_allocatable");
    expect(panel.queries[0].query).toContain('resource="cpu"');
  });

  it("BOTH numerator and denominator carry a cluster matcher — a one-sided ratio lies", () => {
    const panel = cpuPanel(build(resolve({})));
    const [numerator, denominator] = panel.queries[0].query.split("/");
    expect(numerator, "numerator unscoped").toMatch(/k8s_cluster(_name)?=~"\$cluster"/);
    expect(denominator, "denominator unscoped").toMatch(/k8s_cluster(_name)?=~"\$cluster"/);
  });

  it("degrades to bare cores when the allocatable denominator is absent", () => {
    // kube-state present but WITHOUT allocatable: never a percentage of nothing.
    const streams = streamLists([
      { name: "k8s_node_cpu_usage", schema: KUBELET_NODE_SCHEMA },
      { name: "k8s_node_memory_usage", schema: KUBELET_NODE_SCHEMA },
    ]);
    const panel = cpuPanel(build(resolve({ streams })));
    expect(panel).toBeTruthy();
    expect(panel.config.unit).toBe("numbers");
    expect(panel.queries[0].query).not.toContain("kube_node_status_allocatable");
    expect(panel.queries[0].query).not.toContain("*");
  });
});

// The executor reads `query_type` off the PER-QUERY config
// (usePanelPromQLExecutor.ts:181) and, for "instant", collapses the range by
// sending start == end (useStreamingSearch.ts:205-207). A pack that declares
// queryMode but never reaches that key would still run as a 3h range query and
// keep contradicting the tiles, so this pins the emission, not the manifest.
describe("instant panels reach the executor's query_type seam", () => {
  const instantPanelIds = ["k8s_ov_unhealthy_pods", "k8s_nd_conditions", "k8s_nd_not_ready"];

  it("emits query_type 'instant' on every query of an instant panel", () => {
    const dashboard = build(resolve({}));
    const panels = (dashboard.tabs ?? []).flatMap((tab: any) => tab.panels ?? []);
    for (const id of instantPanelIds) {
      const emitted = panels.find((p: any) => p.id === id);
      expect(emitted, `${id} was not built`).toBeDefined();
      for (const query of emitted.queries) {
        expect(query.config?.query_type, `${id} query_type`).toBe("instant");
      }
    }
  });

  it("leaves time-series panels on the default range execution", () => {
    const dashboard = build(resolve({}));
    const panels = (dashboard.tabs ?? []).flatMap((tab: any) => tab.panels ?? []);
    const line = panels.find((p: any) => p.id === "k8s_ov_pods_by_phase");
    for (const query of line.queries) {
      expect(query.config?.query_type).toBeUndefined();
    }
  });
});

// An operator cannot act on a panel that looks the same whether the query failed
// or nothing is wrong. Tables now return a clean empty vector instead of 500ing,
// so they can carry the same honest "no data" verdict the tiles already get.
describe("inventory tables can say 'nothing is wrong' rather than staying blank", () => {
  it("marks instant tables no-data eligible, like the metric tiles", () => {
    const dashboard = build(resolve({}));
    const panels = (dashboard.tabs ?? []).flatMap((tab: any) => tab.panels ?? []);
    for (const id of ["k8s_ov_unhealthy_pods", "k8s_nd_not_ready"]) {
      const emitted = panels.find((p: any) => p.id === id);
      expect(emitted.config.curated_no_data_eligible, `${id} no-data eligibility`).toBe(true);
    }
  });
});

describe("schemasPending — the tier-2 gap must never read as absence", () => {
  /** The live pre-tier-2 shape: getStreams forces schema=false and the API serializes `schema: []`. */
  const schemaless = () => {
    const streams = fullK8sStreams();
    for (const entry of streams.metrics) (entry as any).schema = [];
    return streams;
  };

  const pendingResolve = (streams: any) =>
    resolveManifest({
      manifest: kubernetesPage,
      streams,
      semanticGroups: K8S_FULL_DICT,
      range: RANGE,
      now: NOW_US,
      probeVerdicts: {},
      schemasPending: true,
    });

  it("resolves rung-1 overrides and withholds the rest", () => {
    const resolution = pendingResolve(schemaless());
    // kube-state overrides all four concepts, so its panels resolve with no schema at all.
    expect(resolution.presentGroupIds).toContain("kube-state");
    const nonRunning = panelById(resolution, "k8s_wl_nonrunning_by_ns");
    expect(nonRunning.hidden).toBe(false);
    expect(nonRunning.resolvedFields[GROUP.namespace]).toBe("namespace");
  });

  it("reports NO hidden group and NO schema/field warning while the tier is in flight", () => {
    const resolution = pendingResolve(schemaless());
    expect(resolution.hiddenGroups).toEqual([]);
    expect(resolution.warnings.filter((w: any) => w.kind === "schema")).toEqual([]);
    expect(resolution.warnings.filter((w: any) => w.kind === "field-unresolved")).toEqual([]);
  });

  it("never GUESSES a spelling — the unfetched fallback is suppressed, not applied", () => {
    const resolution = pendingResolve(schemaless());
    // Without the flag this same input resolves k8s-node to the dictionary's first spelling.
    const nodeCpu = panelById(resolution, "k8s_nd_cpu");
    expect(nodeCpu.pending).toBe(true);
    expect(nodeCpu.resolvedFields[GROUP.node]).toBeUndefined();
  });

  it("a group with NO rung-1 panel is neither present nor hidden — the absent-face guard", () => {
    // Today's packs always keep one overridden panel visible, so the all-pending
    // shape is built explicitly: one group, one panel, one dictionary-only concept.
    const manifest: any = {
      ...kubernetesPage,
      groups: [{ ...kubernetesPage.groups[0], id: "solo", fieldOverrides: undefined }],
      scopePickers: [],
      sections: [
        {
          id: "overview",
          titleKey: "infra.k8s.section.overview",
          panels: [
            {
              id: "solo_p",
              groupId: "solo",
              titleKey: "infra.k8s.section.overview",
              type: "line",
              unit: "default",
              variants: [
                {
                  requiresStreams: ["k8s_node_cpu_usage"],
                  queries: [{ query: `sum by (\${f:${GROUP.node}}) (k8s_node_cpu_usage)` }],
                },
              ],
            },
          ],
        },
      ],
    };
    const resolution = resolveManifest({
      manifest,
      streams: schemaless(),
      semanticGroups: K8S_FULL_DICT,
      range: RANGE,
      now: NOW_US,
      probeVerdicts: {},
      schemasPending: true,
    });
    expect(resolution.panels.every((p: any) => p.pending)).toBe(true);
    expect(resolution.presentGroupIds).toEqual([]);
    // The whole point: zero rendering panels must NOT be reported as a missing collector.
    expect(resolution.hiddenGroups).toEqual([]);
  });

  it("a pending panel contributes NOTHING to a sibling group's strip row", () => {
    // A group with one rendering panel and one pending panel: the pending half
    // must not add a `field-unresolved` row beside the half that works.
    const resolution = pendingResolve(schemaless());

    const podStrip = resolution.hiddenGroups.find((h: any) => h.group.id === "kubelet-pod");
    expect(podStrip).toBeUndefined();
    // And the panels really are in that mixed shape, or the assertion above proves nothing.
    const podPanels = resolution.panels.filter((p: any) => p.groupId === "kubelet-pod");
    expect(podPanels.some((p: any) => !p.hidden)).toBe(true);
    expect(podPanels.some((p: any) => p.pending)).toBe(true);
    expect(podPanels.every((p: any) => p.unresolvedConcepts.length === 0)).toBe(true);
  });

  it("without the flag the SAME input reports ABSENCE — the flag is what withholds it", () => {
    const resolution = resolveManifest({
      manifest: kubernetesPage,
      streams: schemaless(),
      semanticGroups: K8S_FULL_DICT,
      range: RANGE,
      now: NOW_US,
      probeVerdicts: {},
    });
    // `schema: []` reads as a stream that genuinely carries no such column, so the
    // strip names every kubeletstats group as unavailable — correct once tier 2 has
    // answered, and a lie while it is still in flight.
    expect(resolution.hiddenGroups.map((h: any) => h.group.id)).toContain("kubelet-node");
    const nodeCpu = panelById(resolution, "k8s_nd_cpu");
    expect(nodeCpu.hidden).toBe(true);
    expect(nodeCpu.pending).toBeUndefined();
  });
});

describe("sparse series must render as something, not nothing", () => {
  const chartPanels = () =>
    (build(resolve({})).tabs ?? [])
      .flatMap((tab: any) => tab.panels ?? [])
      .filter((panel: any) => ["line", "area-stacked", "scatter"].includes(panel.type));

  it("shows a symbol on every time-series panel, so a lone point is visible", () => {
    const panels = chartPanels();
    expect(panels.length).toBeGreaterThan(0);
    for (const panel of panels) {
      expect(panel.config.show_symbol, `${panel.id} would draw an invisible point`).toBe(true);
    }
  });

  it("leaves connect_nulls off, so a collector that stopped reporting shows a gap", () => {
    for (const panel of chartPanels()) {
      expect(panel.config.connect_nulls, `${panel.id} would imply data it never had`).toBe(false);
    }
  });
});
