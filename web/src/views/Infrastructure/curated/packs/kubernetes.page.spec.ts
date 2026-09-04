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

// Kubernetes content pack — PACK-SPECIFIC invariants only (design §4.2, §7.1).
// Every generic rule lives in lint.spec.ts, which is parameterized over the
// registry, so registering a pack is what opts it into those.

import { describe, it, expect } from "vitest";
import { kubernetesPage } from "./kubernetes.page";
import { GROUP, STALENESS_24H_US } from "../types";

const allPanels = () => kubernetesPage.sections.flatMap((section: any) => section.panels);

const panel = (id: string) => {
  const found = allPanels().find((p: any) => p.id === id);
  if (!found) throw new Error(`panel ${id} is not in the kubernetes pack`);
  return found;
};

const sectionOf = (id: string) =>
  kubernetesPage.sections.find((s: any) => s.panels.some((p: any) => p.id === id));

const group = (id: string) => {
  const found = kubernetesPage.groups.find((g: any) => g.id === id);
  if (!found) throw new Error(`group ${id} is not in the kubernetes pack`);
  return found;
};

const queriesOf = (id: string): string[] =>
  panel(id).variants.flatMap((v: any) => v.queries.map((q: any) => q.query as string));

describe("kubernetes pack — shape", () => {
  it("declares 3 groups, 3 pickers, 3 sections and 22 panels", () => {
    expect(kubernetesPage.id).toBe("kubernetes");
    expect(kubernetesPage.groups.map((g: any) => g.id)).toEqual([
      "kubelet-node",
      "kubelet-pod",
      "kube-state",
    ]);
    expect(kubernetesPage.scopePickers.map((p: any) => p.name)).toEqual([
      "cluster",
      "namespace",
      "pod",
    ]);
    expect(kubernetesPage.sections.map((s: any) => s.id)).toEqual([
      "overview",
      "nodes",
      "workloads",
    ]);
    expect(allPanels()).toHaveLength(22);
  });

  it("pins the 24h staleness threshold like every v1 pack (§5.3)", () => {
    expect(kubernetesPage.stalenessThresholdUs).toBe(STALENESS_24H_US);
  });

  it("defaults to the 3h relative period the hosts surface already uses", () => {
    expect(kubernetesPage.defaultRelativePeriod).toBe("3h");
  });
});

describe("kube-state fieldOverrides — keyed by the REAL group ids", () => {
  it("overrides namespace/pod/node to the bare kube-state spellings", () => {
    // The key spelling IS the contract (JSON-truth pass) — a `pod:` shorthand
    // silently stops overriding anything and rung 2 takes over.
    expect(group("kube-state").fieldOverrides).toEqual({
      [GROUP.namespace]: "namespace",
      [GROUP.pod]: "pod",
      [GROUP.node]: "node",
    });
    expect(Object.keys(group("kube-state").fieldOverrides)).toEqual([
      "k8s-namespace",
      "k8s-pod-name",
      "k8s-node-name",
    ]);
  });

  it("the kubeletstats groups declare probeFields as the rung-4a net (§5.4)", () => {
    // Not defensive dead code: the validation deployment runs a lossy override.
    expect(group("kubelet-node").probeFields).toEqual({
      [GROUP.node]: ["k8s_node_name", "k8s_node", "node"],
      [GROUP.cluster]: ["k8s_cluster_name", "k8s_cluster", "cluster"],
    });
    expect(group("kubelet-pod").probeFields).toEqual({
      [GROUP.namespace]: ["k8s_namespace_name", "k8s_namespace", "namespace"],
      [GROUP.pod]: ["k8s_pod_name", "k8s_pod", "pod"],
    });
  });
});

describe("drift variants (§10 pass-1 finding 1)", () => {
  it("node CPU and node memory each carry exactly 2 variants of the right families", () => {
    for (const id of ["k8s_nd_cpu", "k8s_ov_node_cpu_top", "k8s_ov_nodes"]) {
      expect(panel(id).variants, id).toHaveLength(2);
      expect(panel(id).variants[0].requiresStreams, id).toEqual(["k8s_node_cpu_utilization"]);
      expect(panel(id).variants[1].requiresStreams, id).toEqual(["k8s_node_cpu_usage"]);
    }
    expect(panel("k8s_nd_memory").variants).toHaveLength(2);
    expect(panel("k8s_nd_memory").variants[0].requiresStreams).toEqual(["k8s_node_memory_usage"]);
    expect(panel("k8s_nd_memory").variants[1].requiresStreams).toEqual(["k8s_node_memory_rss"]);
  });

  it("the usage variant overrides the unit — cores in use is not a ratio", () => {
    expect(panel("k8s_nd_cpu").unit).toBe("percent-1");
    expect(panel("k8s_nd_cpu").variants[1].unit).toBe("numbers");
  });
});

describe("DRY-RUN finding 2 — a `status` label is not a value test", () => {
  it('k8s_nd_not_ready matches condition="Ready" with `== 0`, positively and negatively', () => {
    const [query] = queriesOf("k8s_nd_not_ready");
    expect(panel("k8s_nd_not_ready").type).toBe("table");
    expect(sectionOf("k8s_nd_not_ready")!.id).toBe("nodes");
    expect(panel("k8s_nd_not_ready").groupId).toBe("kube-state");
    expect(query).toContain('condition="Ready"');
    expect(query).toContain("== 0");
    // The old form selected the 13 UNRELATED node-problem-detector conditions and
    // returned 20 healthy nodes valued 0. Asserted negatively so a well-meaning
    // edit cannot restore it.
    expect(query).not.toContain('condition!="Ready"');
    expect(query).not.toMatch(/status="true"(?![^}]*==)/);
  });

  it("k8s_nd_conditions and k8s_ov_nodes_ready both carry a `== 1` value test", () => {
    expect(queriesOf("k8s_nd_conditions")[0]).toContain("== 1");
    expect(queriesOf("k8s_ov_nodes_ready")[0]).toContain("== 1");
    expect(queriesOf("k8s_ov_nodes_ready")[0]).toContain('condition="Ready"');
  });
});

describe("DRY-RUN finding 7 — topk bounds rows only on an instant vector", () => {
  const TABLES = [
    "k8s_ov_unhealthy_pods",
    "k8s_nd_conditions",
    "k8s_nd_not_ready",
    "k8s_wl_pod_restarts",
  ];

  it("every table panel is instant-vector shaped so topk(20) is a real row cap", () => {
    // Measured: a RANGE topk(20) returned 450 series behind a title promising 20.
    for (const id of TABLES) {
      expect(panel(id).type, id).toBe("table");
      for (const query of queriesOf(id)) {
        expect(query, id).toContain("topk(20,");
        expect(query, id).toMatch(/last_over_time\(.*\[\d+[smh]:\]\)/s);
      }
    }
  });

  it("the four tables are the ONLY table panels — every other panel is a chart", () => {
    const tables = allPanels()
      .filter((p: any) => p.type === "table")
      .map((p: any) => p.id);
    expect(tables.sort()).toEqual([...TABLES].sort());
  });

  it("no NON-table panel's query is instant-vector wrapped — topk there is a per-step selector", () => {
    for (const p of allPanels().filter((x: any) => x.type !== "table")) {
      for (const variant of p.variants) {
        for (const q of variant.queries) {
          expect(q.query, p.id).not.toContain("last_over_time(");
        }
      }
    }
  });
});

describe("pass-4 finding 1 — every aggregate has an inventory behind it", () => {
  it("k8s_ov_unhealthy_pods names the pods behind the three phase tiles", () => {
    expect(sectionOf("k8s_ov_unhealthy_pods")!.id).toBe("overview");
    expect(panel("k8s_ov_unhealthy_pods").groupId).toBe("kube-state");
    const [query] = queriesOf("k8s_ov_unhealthy_pods");
    expect(query).toContain('phase=~"Pending|Failed|Unknown"');
    expect(query).toContain("${f:k8s-namespace}");
    expect(query).toContain("${f:k8s-pod-name}");
    expect(query).toContain("phase");
  });

  it("every metric tile counting unhealthy objects has an inventory panel in its group", () => {
    // Structural invariant, so a future tile cannot ship without its "which ones?".
    const unhealthyTiles = allPanels().filter(
      (p: any) =>
        p.type === "metric" &&
        p.variants.some((v: any) =>
          v.queries.some(
            (q: any) => /phase="(Pending|Failed|Unknown)"/.test(q.query) || /== 0/.test(q.query),
          ),
        ),
    );
    expect(unhealthyTiles.length).toBeGreaterThan(0);
    for (const tile of unhealthyTiles) {
      const inventory = allPanels().filter(
        (p: any) => p.type === "table" && p.groupId === tile.groupId,
      );
      expect(inventory.length, tile.id).toBeGreaterThan(0);
    }
  });
});

describe("pass-4 finding 7 — the two headroom panels", () => {
  it("k8s_wl_pod_mem_limit_pct is a kubelet-pod percent-1 panel on the limit-utilization stream", () => {
    expect(panel("k8s_wl_pod_mem_limit_pct").groupId).toBe("kubelet-pod");
    expect(panel("k8s_wl_pod_mem_limit_pct").unit).toBe("percent-1");
    expect(panel("k8s_wl_pod_mem_limit_pct").variants[0].requiresStreams).toEqual([
      "k8s_pod_memory_limit_utilization",
    ]);
  });

  it("k8s_wl_pod_restarts sits in kube-state on the restarts stream, and is NO LONGER flagged unevidenced", () => {
    // Dry run confirmation 12: 864 M docs, 0.1 h fresh, 102 series. §10 row 13 closed.
    expect(panel("k8s_wl_pod_restarts").groupId).toBe("kube-state");
    expect(panel("k8s_wl_pod_restarts").variants[0].requiresStreams).toEqual([
      "kube_pod_container_status_restarts_total",
    ]);
    expect((kubernetesPage as any).unevidencedAssumptions ?? []).not.toContain(
      "kube_pod_container_status_restarts_total",
    );
  });
});

describe("DRY-RUN finding 10 — five phases exist, so the tiles are not a partition", () => {
  it("k8s_ov_pods_by_phase carries NO phase filter — nothing is silently dropped", () => {
    const [query] = queriesOf("k8s_ov_pods_by_phase");
    expect(query).toContain("sum by (phase)");
    expect(query).not.toContain("phase=");
    expect(query).not.toContain("phase=~");
  });

  // The disclosure moved OFF the tiles: sharing a one-line bar with the title it
  // truncated them to "Pods ru…"/"Pods pe…"/"Pods f…". It is a fact about the
  // trio, so the Overview section states it once, above the grid.
  it("the phase fact is a SECTION note, and no tile carries a subtitle", () => {
    const overview = kubernetesPage.sections.find((s: any) => s.id === "overview")!;
    expect(overview.noteKey).toBe("infra.k8s.section.overviewNote");
    for (const id of ["k8s_ov_pods_running", "k8s_ov_pods_pending", "k8s_ov_pods_failed"]) {
      expect((panel(id) as any).subtitleKey, id).toBeUndefined();
    }
  });
});

describe("DRY-RUN finding 6 — pickers source from a LIVE stream and omit on empty values", () => {
  const picker = (name: string) => kubernetesPage.scopePickers.find((p: any) => p.name === name)!;

  it("the cluster picker names k8s_node_cpu_usage, NOT the dead utilization spelling", () => {
    // `_values` on the 177-day-dead utilization stream returned 0 values; on the
    // live usage stream it returned all 10 clusters.
    expect(picker("cluster").valuesFrom.stream).toBe("k8s_node_cpu_usage");
    expect(picker("cluster").valuesFrom.stream).not.toBe("k8s_node_cpu_utilization");
    expect(picker("cluster").valuesFrom.groupId).toBe("kubelet-node");
  });

  it("all three pickers set omitWhenValuesEmpty — schema presence is not resolvability", () => {
    for (const name of ["cluster", "namespace", "pod"]) {
      expect(picker(name).omitWhenValuesEmpty, name).toBe(true);
    }
  });

  it("the cluster picker also sets omitWhenFieldAbsent (single-cluster orgs lack the label)", () => {
    expect(picker("cluster").omitWhenFieldAbsent).toBe(true);
  });

  it("pickers name the real group ids and the pod picker chains on namespace", () => {
    expect(picker("cluster").group).toBe(GROUP.cluster);
    expect(picker("namespace").group).toBe(GROUP.namespace);
    expect(picker("pod").group).toBe(GROUP.pod);
    expect(picker("pod").chainedOn).toEqual([{ picker: "namespace" }]);
  });
});

describe("declarative scoping (pass-1 finding 3)", () => {
  it("Overview and Nodes declare `cluster` only — fleet tiles stay fleet-wide BY DECLARATION", () => {
    expect(kubernetesPage.sections.find((s: any) => s.id === "overview")!.scopedBy).toEqual([
      "cluster",
    ]);
    expect(kubernetesPage.sections.find((s: any) => s.id === "nodes")!.scopedBy).toEqual([
      "cluster",
    ]);
    // Dry-run change 10 left this chart unfiltered by PHASE, so the Succeeded
    // series stays visible; it never meant unscoped by CLUSTER. Pinned both ways
    // so the two decisions cannot be conflated again.
    expect(queriesOf("k8s_ov_pods_by_phase")[0]).not.toMatch(/phase\s*=/);
    expect(queriesOf("k8s_ov_pods_by_phase")[0]).toContain("${scope:cluster}");
  });

  it("EVERY Overview and Nodes panel reacts to the cluster picker (the shipped bug)", () => {
    // A user picking one cluster saw 2 of 9 Overview panels move; the rest kept
    // fleet-wide numbers. No panel in either section is exempt.
    for (const id of ["overview", "nodes"]) {
      const section = kubernetesPage.sections.find((s: any) => s.id === id)!;
      for (const p of section.panels as any[]) {
        expect(p.fleetWide ?? [], `${p.id} claims a cluster exemption`).not.toContain("cluster");
        for (const q of queriesOf(p.id)) expect(q, p.id).toContain("${scope:cluster}");
      }
    }
  });

  it("Workloads declares namespace/pod, and every kube-state workload panel scopes on namespace", () => {
    expect(kubernetesPage.sections.find((s: any) => s.id === "workloads")!.scopedBy).toEqual([
      "namespace",
      "pod",
    ]);
    for (const id of ["k8s_wl_nonrunning_by_ns", "k8s_wl_cpu_requests"]) {
      expect(queriesOf(id)[0], id).toContain("${scope:namespace}");
    }
  });

  it("the pod picker filters per-POD panels and is declined by per-NAMESPACE rollups", () => {
    // The split is the `by (…)` shape: a panel keyed by pod must react to the pod
    // picker; a namespace rollup filtered by pod would under-report the total its
    // own title promises, so it declines the picker in writing.
    for (const id of [
      "k8s_wl_pod_cpu_top",
      "k8s_wl_pod_mem_top",
      "k8s_wl_pod_fs",
      "k8s_wl_pod_restarts",
      "k8s_wl_pod_mem_limit_pct",
    ]) {
      for (const q of queriesOf(id)) expect(q, id).toContain("${scope:pod}");
    }
    for (const id of ["k8s_wl_nonrunning_by_ns", "k8s_wl_cpu_requests", "k8s_wl_pod_network"]) {
      expect(panel(id).fleetWide, id).toEqual(["pod"]);
      for (const q of queriesOf(id)) expect(q, id).not.toContain("${scope:pod}");
    }
  });
});

describe("panel titles carry an N only where the query can honour it", () => {
  it("every line-chart title key is a 'Highest-' style key with no {n} interpolation", () => {
    // Pack-level half of the two-sided lint (dry run finding 7).
    for (const p of allPanels().filter((x: any) => x.type !== "table")) {
      const hasTopk = p.variants.some((v: any) =>
        v.queries.some((q: any) => /topk\(\d+,/.test(q.query)),
      );
      if (!hasTopk) continue;
      expect(p.titleKey, p.id).not.toMatch(/top\d/i);
    }
  });
});
