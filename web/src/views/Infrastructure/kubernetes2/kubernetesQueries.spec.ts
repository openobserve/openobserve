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

import { describe, expect, it } from "vitest";
import {
  CLUSTER_QUERIES,
  DETECTION_STREAMS,
  OPTIONAL_STREAM,
  QUERY_STREAM,
  SPARSE_STREAMS,
  VIEW_ANCHORS,
  VIEW_QUERIES,
  detailQueries,
  familyOf,
  mapQueries,
  podTrendQuery,
  queryText,
  type QueryId,
} from "./kubernetesQueries";

const ALL_IDS = Object.keys(QUERY_STREAM) as QueryId[];
const SCOPED_IDS = ALL_IDS.filter((id) => !CLUSTER_QUERIES.includes(id));
const MATCHERS = { ksm: 'k8s_cluster="c"', kubelet: 'k8s_cluster_name="c"' };

// Every `metric{…}` or bare `metric` selector in a query.
const selectors = (text: string) =>
  [
    ...text.replace(/^[a-z]+ by \([^)]*\) /, "").matchAll(/\b((?:kube|k8s)_[a-z_]+)(\{[^}]*\})?/g),
  ].map((m) => ({ metric: m[1], inner: m[2] ?? "" }));

describe("kubernetesQueries", () => {
  it("groups every query by both cluster spellings", () => {
    for (const id of ALL_IDS) expect(queryText(id), id).toContain("k8s_cluster, k8s_cluster_name");
  });

  it("keeps uid in every KSM pod query except the replicaset owner join", () => {
    for (const id of ALL_IDS.filter((q) => /^P\d+$/.test(q) && q !== "P5")) {
      expect(queryText(id), id).toMatch(/\buid\b/);
    }
  });

  it("reads current container reasons from the bare selector, never last_over_time", () => {
    for (const id of ["P2", "P3", "P14"] as QueryId[]) {
      expect(queryText(id), id).not.toContain("last_over_time");
      expect(queryText(id), id).toContain("== 1");
    }
    expect(queryText("P14")).toBe(
      "max by (k8s_cluster, k8s_cluster_name, namespace, pod, uid, container, reason) (kube_pod_container_status_terminated_reason == 1)",
    );
  });

  it("reads lifetime restarts per container with no increase()", () => {
    expect(queryText("P7")).toBe(
      "max by (k8s_cluster, k8s_cluster_name, namespace, pod, uid, container) (last_over_time(kube_pod_container_status_restarts_total[10m]))",
    );
    expect(queryText("P7")).not.toContain("increase");
  });

  it("matches the §7.3 text of the changed and new queries", () => {
    expect(queryText("P6")).toBe(
      "max by (k8s_cluster, k8s_cluster_name, namespace, pod, uid, node, pod_ip, priority_class) (last_over_time(kube_pod_info[10m]))",
    );
    expect(queryText("P10")).toContain("container, image)");
    expect(queryText("P15")).toBe(
      "max by (k8s_cluster, k8s_cluster_name, namespace, pod, uid, reason) (last_over_time(kube_pod_status_reason[10m]) == 1)",
    );
    expect(queryText("N2")).toContain('resource=~"cpu|memory|pods|ephemeral_storage"');
    expect(queryText("J5")).toBe(
      'max by (k8s_cluster, k8s_cluster_name, namespace, job_name) (last_over_time(kube_job_complete{condition="true"}[10m]))',
    );
    expect(queryText("V1")).toBe(
      "max by (k8s_cluster, k8s_cluster_name, namespace, persistentvolumeclaim, phase) (last_over_time(kube_persistentvolumeclaim_status_phase[10m]) == 1)",
    );
    expect(queryText("NS2")).toBe(
      "max by (k8s_cluster, k8s_cluster_name, namespace) (last_over_time(kube_namespace_created[10m]))",
    );
    expect(queryText("K7")).toBe(
      "max by (k8s_cluster, k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_persistentvolumeclaim_name) (k8s_volume_capacity)",
    );
    expect(queryText("CL1P")).toBe(
      "count by (k8s_cluster, k8s_cluster_name) (last_over_time(kube_pod_status_phase[10m]))",
    );
    expect(queryText("CL2N")).toBe("count by (k8s_cluster, k8s_cluster_name) (k8s_node_cpu_usage)");
  });

  it("uses only controller owner references", () => {
    expect(queryText("P4")).toContain('kube_pod_owner{owner_is_controller="true"}');
    expect(queryText("P5")).toContain('kube_replicaset_owner{owner_is_controller="true"}');
  });

  describe("server-side cluster scoping", () => {
    it("injects the KSM matcher inside every KSM selector, beside its own matchers", () => {
      for (const id of SCOPED_IDS.filter((q) => familyOf(q) === "kube-state-metrics")) {
        const found = selectors(queryText(id, MATCHERS));
        expect(found.length, id).toBeGreaterThan(0);
        for (const s of found) expect(s.inner, `${id} ${s.metric}`).toContain('k8s_cluster="c"');
      }
      expect(queryText("P4", MATCHERS)).toContain(
        'kube_pod_owner{owner_is_controller="true",k8s_cluster="c"}',
      );
    });

    it("injects the kubeletstats spelling into every kubeletstats selector", () => {
      for (const id of SCOPED_IDS.filter((q) => familyOf(q) === "kubeletstats")) {
        for (const s of selectors(queryText(id, MATCHERS))) {
          expect(s.inner, id).toBe('{k8s_cluster_name="c"}');
        }
      }
    });

    it("sends a family without a matcher unscoped, and never scopes the CL queries", () => {
      expect(queryText("D1", { ksm: null, kubelet: 'k8s_cluster="c"' })).toBe(queryText("D1"));
      for (const id of CLUSTER_QUERIES) expect(queryText(id, MATCHERS)).toBe(queryText(id));
    });

    it("keeps the by() grouping so client normalization still runs", () => {
      expect(queryText("K1", MATCHERS)).toBe(
        'sum by (k8s_cluster, k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_pod_uid) (k8s_pod_cpu_usage{k8s_cluster_name="c"})',
      );
    });
  });

  describe("per-view sets (§7.2)", () => {
    it.each([
      ["cluster", ["O1", "O2", "O3", "O4", "O5", "N1", "P1", "P2", "P11", "P12"]],
      ["nodes", ["N1", "N2", "N3", "N4", "N5", "K3", "K4", "K5", "K6"]],
      ["deployments", ["D1", "D2", "D3", "D5"]],
      ["daemonsets", ["DS1", "DS2", "DS3", "DS5"]],
      ["statefulsets", ["SS1", "SS2", "SS3", "SS4"]],
      ["replicasets", ["RS2", "RS3", "RS4", "RS5", "P5"]],
      ["jobs", ["J1", "J2", "J3", "J4", "J5", "J6"]],
      ["cronjobs", ["CJ1", "CJ2", "CJ3", "CJ4", "J6", "J7"]],
      ["pvcs", ["V1", "V2", "V3", "V4", "K7"]],
      ["hpas", ["H1", "H2", "H3", "H4", "H5"]],
      ["namespaces", ["NS1", "NS2"]],
      ["events", []],
    ] as const)("%s sends exactly %j", (view, ids) => {
      expect([...VIEW_QUERIES[view]].sort()).toEqual([...ids].sort());
    });

    it("sends P1–P15, K1 and K2 on Pods, and the workloads overview sends P5 once", () => {
      expect(VIEW_QUERIES.pods).toHaveLength(17);
      expect(VIEW_QUERIES.workloads).toHaveLength(16);
      expect(VIEW_QUERIES.workloads.filter((id) => id === "P5")).toHaveLength(1);
    });

    it("sends the Map's pod set, plus N1 only when grouped by node", () => {
      const pods = mapQueries("pods", "namespace");
      expect(pods).toHaveLength(15);
      expect(pods).not.toContain("P13");
      expect(pods).not.toContain("P14");
      expect(mapQueries("pods", "node")).toEqual([...pods, "N1"]);
      expect(mapQueries("nodes", "node")).toEqual(["N1", "N2", "K3", "K4"]);
    });

    it("adds each drawer's extras and the Pods set where the drawer lists pods", () => {
      expect(detailQueries("deployment")).toEqual(
        expect.arrayContaining(["D1", "D4", "D6", "P5", "RS2", "RS4", "P13", "K1"]),
      );
      expect(detailQueries("cronjob").sort()).toEqual(
        ["CJ1", "CJ2", "CJ3", "CJ4", "J6", "J7", "J1", "J2", "J3", "J5"].sort(),
      );
      expect(detailQueries("hpa").sort()).toEqual(["H1", "H2", "H3", "H4", "H5", "H8"].sort());
      expect(detailQueries("pvc")).not.toContain("P1");
      expect(detailQueries("node")).toContain("P6");
    });
  });

  it("anchors Jobs on any of its three status streams and the Events view on none", () => {
    expect(VIEW_ANCHORS.jobs).toEqual([
      "kube_job_status_failed",
      "kube_job_status_succeeded",
      "kube_job_status_active",
    ]);
    expect(VIEW_ANCHORS.events).toBeNull();
    expect(VIEW_ANCHORS.pods).toEqual(["kube_pod_status_phase"]);
  });

  it("treats waiting, limits and terminated reasons as sparse, and the last-terminated reason as optional", () => {
    expect([...SPARSE_STREAMS].sort()).toEqual(
      [
        "kube_pod_container_status_waiting_reason",
        "kube_pod_container_resource_limits",
        "kube_pod_container_status_terminated_reason",
      ].sort(),
    );
    expect(OPTIONAL_STREAM).toBe("kube_pod_container_status_last_terminated_reason");
    expect(QUERY_STREAM.P14).toBe("kube_pod_container_status_terminated_reason");
    expect(QUERY_STREAM.CL2P).toBe("k8s_pod_cpu_usage");
    expect(QUERY_STREAM.J5).toBe("kube_job_complete");
    expect(DETECTION_STREAMS).toContain("kube_pod_status_phase");
  });

  describe("podTrendQuery", () => {
    it("filters on the row's cluster spelling, namespace, pod and uid", () => {
      expect(
        podTrendQuery("k8s_pod_cpu_usage", {
          clusterLabel: "k8s_cluster_name",
          cluster: "prod",
          namespace: "shop",
          pod: "web-1",
          uid: "B",
        }),
      ).toBe(
        'sum(k8s_pod_cpu_usage{k8s_cluster_name="prod",k8s_namespace_name="shop",k8s_pod_name="web-1",k8s_pod_uid="B"})',
      );
    });

    it("omits the cluster matcher for an empty cluster and the uid matcher when absent", () => {
      expect(
        podTrendQuery("k8s_pod_memory_working_set", {
          clusterLabel: null,
          cluster: "",
          namespace: "shop",
          pod: "web-1",
          uid: null,
        }),
      ).toBe('sum(k8s_pod_memory_working_set{k8s_namespace_name="shop",k8s_pod_name="web-1"})');
    });

    it("escapes backslashes and double quotes in label values", () => {
      expect(
        podTrendQuery("k8s_pod_cpu_usage", {
          clusterLabel: "k8s_cluster",
          cluster: 'a"b',
          namespace: "c\\d",
          pod: "p",
          uid: null,
        }),
      ).toBe(
        'sum(k8s_pod_cpu_usage{k8s_cluster="a\\"b",k8s_namespace_name="c\\\\d",k8s_pod_name="p"})',
      );
    });
  });
});
