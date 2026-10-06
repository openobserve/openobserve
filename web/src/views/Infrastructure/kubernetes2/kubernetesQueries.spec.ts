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
  ALWAYS_QUERIES,
  DETECTION_STREAMS,
  KSM_ANCHOR,
  OPTIONAL_STREAMS,
  QUERY_FAMILY,
  QUERY_STREAM,
  SPARSE_STREAMS,
  TAB_QUERIES,
  podTrendQuery,
  queryText,
  rangeSeconds,
  type QueryId,
} from "./kubernetesQueries";

const ALL_IDS: QueryId[] = [
  "P1",
  "P2",
  "P3",
  "P4",
  "P5",
  "P6",
  "P7",
  "P8",
  "P9",
  "P10",
  "P11",
  "P12",
  "K1",
  "K2",
  "K3",
  "K4",
  "N1",
  "N2",
  "D1",
  "D2",
];

describe("kubernetesQueries", () => {
  it("groups every query by both cluster spellings", () => {
    for (const id of ALL_IDS) {
      expect(queryText(id, 3600), id).toContain("k8s_cluster, k8s_cluster_name");
    }
  });

  it("keeps uid in every KSM pod query except the replicaset owner join", () => {
    for (const id of ALL_IDS.filter((q) => q.startsWith("P") && q !== "P5")) {
      expect(queryText(id, 3600), id).toMatch(/\buid\b/);
    }
    expect(queryText("P5", 3600)).toContain("replicaset");
  });

  it("keeps k8s_pod_uid on the pod usage queries", () => {
    expect(queryText("K1", 3600)).toBe(
      "sum by (k8s_cluster, k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_pod_uid) (k8s_pod_cpu_usage)",
    );
    expect(queryText("K2", 3600)).toBe(
      "sum by (k8s_cluster, k8s_cluster_name, k8s_namespace_name, k8s_pod_name, k8s_pod_uid) (k8s_pod_memory_working_set)",
    );
  });

  it("reads current container reasons from the bare selector, never last_over_time", () => {
    expect(queryText("P2", 3600)).toBe(
      "max by (k8s_cluster, k8s_cluster_name, namespace, pod, uid, container, reason) (kube_pod_container_status_waiting_reason == 1)",
    );
    expect(queryText("P3", 3600)).not.toContain("last_over_time");
  });

  it("wraps slow-changing state in a 10m last_over_time", () => {
    for (const id of [
      "P1",
      "P4",
      "P5",
      "P6",
      "P8",
      "P9",
      "P10",
      "P11",
      "P12",
      "N1",
      "N2",
      "D1",
      "D2",
    ] as QueryId[]) {
      expect(queryText(id, 3600), id).toContain("[10m]");
    }
  });

  it("uses only controller owner references", () => {
    expect(queryText("P4", 3600)).toContain('kube_pod_owner{owner_is_controller="true"}');
    expect(queryText("P5", 3600)).toContain('kube_replicaset_owner{owner_is_controller="true"}');
  });

  it("measures restarts as a per-container increase over the picker range", () => {
    expect(queryText("P7", 5400)).toBe(
      "sum by (k8s_cluster, k8s_cluster_name, namespace, pod, uid, container) (increase(kube_pod_container_status_restarts_total[5400s]))",
    );
  });

  it("reads deployment availability from the available-replicas metric", () => {
    expect(queryText("D2", 3600)).toContain("kube_deployment_status_replicas_available");
    expect(queryText("D2", 3600)).not.toContain("replicas_ready");
  });

  it("converts the picker range to whole seconds", () => {
    expect(rangeSeconds(0, 3_600_000_000)).toBe(3600);
    expect(rangeSeconds(0, 1_400_000)).toBe(1);
    expect(rangeSeconds(5, 5)).toBe(1);
  });

  it("splits the always-fetched set from the per-tab extras (§6.2)", () => {
    expect(ALWAYS_QUERIES).toEqual([
      "P1",
      "P2",
      "P3",
      "P7",
      "P9",
      "P10",
      "P11",
      "P12",
      "K2",
      "N1",
      "D1",
      "D2",
    ]);
    expect(TAB_QUERIES.pods).toEqual(["P4", "P5", "P6", "P8", "K1"]);
    expect(TAB_QUERIES.nodes).toEqual(["P6", "N2", "K3", "K4"]);
    expect(TAB_QUERIES.deployments).toEqual(["P4", "P5"]);
  });

  it("gates KSM families on their anchors and usage on its own stream", () => {
    expect(KSM_ANCHOR).toEqual({
      pods: "kube_pod_status_phase",
      nodes: "kube_node_status_condition",
      deployments: "kube_deployment_spec_replicas",
    });
    expect(QUERY_FAMILY.P9).toBe("pods");
    expect(QUERY_FAMILY.N2).toBe("nodes");
    expect(QUERY_FAMILY.D2).toBe("deployments");
    expect(QUERY_FAMILY.K1).toBeUndefined();
    expect(QUERY_STREAM.K1).toBe("k8s_pod_cpu_usage");
    expect(QUERY_STREAM.K2).toBe("k8s_pod_memory_working_set");
    expect(QUERY_STREAM.K3).toBe("k8s_node_cpu_usage");
    expect(QUERY_STREAM.K4).toBe("k8s_node_memory_working_set");
    expect([...SPARSE_STREAMS]).toEqual([
      "kube_pod_container_status_waiting_reason",
      "kube_pod_container_resource_limits",
    ]);
    expect([...OPTIONAL_STREAMS]).toEqual(["kube_pod_container_status_last_terminated_reason"]);
  });

  it("detects on any of the seven anchor or usage streams", () => {
    expect([...DETECTION_STREAMS].sort()).toEqual(
      [
        "kube_pod_status_phase",
        "kube_node_status_condition",
        "kube_deployment_spec_replicas",
        "k8s_pod_cpu_usage",
        "k8s_pod_memory_working_set",
        "k8s_node_cpu_usage",
        "k8s_node_memory_working_set",
      ].sort(),
    );
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
