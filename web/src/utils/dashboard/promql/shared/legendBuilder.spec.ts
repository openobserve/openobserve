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

import { describe, it, expect } from "vitest";
import {
  getPromqlLegendName,
  getDiscriminatingLabels,
  getPreferredLabels,
  buildPromqlSeriesNames,
  getLegendPosition,
} from "./legendBuilder";

describe("legendBuilder", () => {
  describe("getPromqlLegendName", () => {
    it("should replace single placeholder with metric value", () => {
      const metric = { job: "prometheus", instance: "localhost:9090" };
      const label = "{job}";

      expect(getPromqlLegendName(metric, label)).toBe("prometheus");
    });

    it("should replace multiple placeholders with metric values", () => {
      const metric = { job: "node_exporter", instance: "server1:9100" };
      const label = "{job} on {instance}";

      expect(getPromqlLegendName(metric, label)).toBe("node_exporter on server1:9100");
    });

    it("should handle complex template with text and multiple placeholders", () => {
      const metric = {
        job: "api",
        instance: "server1",
        environment: "production",
      };
      const label = "Service: {job} | Host: {instance} | Env: {environment}";

      expect(getPromqlLegendName(metric, label)).toBe(
        "Service: api | Host: server1 | Env: production",
      );
    });

    it("should leave placeholder unchanged if metric key does not exist", () => {
      const metric = { job: "prometheus" };
      const label = "{job} - {nonexistent}";

      expect(getPromqlLegendName(metric, label)).toBe("prometheus - {nonexistent}");
    });

    it("should leave placeholder unchanged if metric value is undefined", () => {
      const metric = { job: "prometheus", instance: undefined };
      const label = "{job} - {instance}";

      expect(getPromqlLegendName(metric, label)).toBe("prometheus - {instance}");
    });

    it("should leave placeholder unchanged if metric value is null", () => {
      const metric = { job: "prometheus", instance: null };
      const label = "{job} - {instance}";

      expect(getPromqlLegendName(metric, label)).toBe("prometheus - {instance}");
    });

    it("should leave placeholder unchanged if metric value is empty string", () => {
      const metric = { job: "prometheus", instance: "" };
      const label = "{job} - {instance}";

      expect(getPromqlLegendName(metric, label)).toBe("prometheus - {instance}");
    });

    it("should handle template with no placeholders", () => {
      const metric = { job: "prometheus" };
      const label = "Static Legend";

      expect(getPromqlLegendName(metric, label)).toBe("Static Legend");
    });

    it("should handle template with special characters", () => {
      const metric = { job: "api-server", instance: "host.example.com:8080" };
      const label = "{job}@{instance}";

      expect(getPromqlLegendName(metric, label)).toBe("api-server@host.example.com:8080");
    });

    it("should handle repeated placeholders", () => {
      const metric = { job: "prometheus" };
      const label = "{job} and {job} again";

      expect(getPromqlLegendName(metric, label)).toBe("prometheus and prometheus again");
    });

    it("should handle adjacent placeholders", () => {
      const metric = { job: "api", version: "v1" };
      const label = "{job}{version}";

      expect(getPromqlLegendName(metric, label)).toBe("apiv1");
    });

    it("should return JSON stringified metric when label is empty string", () => {
      const metric = { job: "prometheus", instance: "localhost" };
      const label = "";

      expect(getPromqlLegendName(metric, label)).toBe(JSON.stringify(metric));
    });

    it("should return JSON stringified metric when label is null", () => {
      const metric = { __name__: "up", job: "prometheus" };
      const label = null as any;

      expect(getPromqlLegendName(metric, label)).toBe(JSON.stringify(metric));
    });

    it("should return JSON stringified metric when label is undefined", () => {
      const metric = { job: "node", instance: "server1" };
      const label = undefined as any;

      expect(getPromqlLegendName(metric, label)).toBe(JSON.stringify(metric));
    });

    it("should handle empty metric object with template", () => {
      const metric = {};
      const label = "{job} - {instance}";

      expect(getPromqlLegendName(metric, label)).toBe("{job} - {instance}");
    });

    it("should handle empty metric object without template", () => {
      const metric = {};
      const label = "";

      expect(getPromqlLegendName(metric, label)).toBe(JSON.stringify({}));
    });

    it("should handle metric with __name__ label", () => {
      const metric = { __name__: "up", job: "prometheus" };
      const label = "{__name__}: {job}";

      expect(getPromqlLegendName(metric, label)).toBe("up: prometheus");
    });

    it("should handle nested braces in metric values", () => {
      const metric = { job: "test{nested}" };
      const label = "{job}";

      expect(getPromqlLegendName(metric, label)).toBe("test{nested}");
    });

    it("should handle numeric metric values", () => {
      const metric = { job: "api", port: "9090" };
      const label = "{job}:{port}";

      expect(getPromqlLegendName(metric, label)).toBe("api:9090");
    });

    it("should handle template with only one placeholder at the end", () => {
      const metric = { job: "prometheus" };
      const label = "Job: {job}";

      expect(getPromqlLegendName(metric, label)).toBe("Job: prometheus");
    });

    it("should handle template with placeholder at the beginning", () => {
      const metric = { job: "prometheus" };
      const label = "{job} - Service";

      expect(getPromqlLegendName(metric, label)).toBe("prometheus - Service");
    });

    it("should handle template with multiple same keys in metric", () => {
      const metric = { job: "api", job2: "backend" };
      const label = "{job} and {job2}";

      expect(getPromqlLegendName(metric, label)).toBe("api and backend");
    });

    it("should handle whitespace in placeholder names", () => {
      const metric = { job: "api", "my instance": "server1" };
      const label = "{job} on {my instance}";

      expect(getPromqlLegendName(metric, label)).toBe("api on server1");
    });

    it("should preserve template when no placeholders exist in template", () => {
      const metric = { job: "api" };
      const label = "No placeholders here";

      expect(getPromqlLegendName(metric, label)).toBe("No placeholders here");
    });
  });

  describe("getDiscriminatingLabels", () => {
    it("returns only the keys whose value differs across the result set", () => {
      const metrics = [
        { __name__: "http_requests", container: "api", pod: "api-1" },
        { __name__: "http_requests", container: "api", pod: "api-2" },
      ];

      expect(getDiscriminatingLabels(metrics)).toEqual(["pod"]);
    });

    it("counts a key missing from some series as varying", () => {
      const metrics = [{ pod: "api-1", zone: "a" }, { pod: "api-1" }];

      expect(getDiscriminatingLabels(metrics)).toEqual(["zone"]);
    });

    it("has nothing to compare with fewer than two series", () => {
      expect(getDiscriminatingLabels([{ pod: "api-1" }])).toEqual([]);
      expect(getDiscriminatingLabels([])).toEqual([]);
      expect(getDiscriminatingLabels(undefined as any)).toEqual([]);
    });
  });

  describe("getPromqlLegendName with discriminating labels", () => {
    const metric = {
      __name__: "http_requests",
      aggregation_temporality: "AGGREGATION_TEMPORALITY_CUMULATIVE",
      pod: "api-1",
    };

    it("names a series by its one varying label, bare", () => {
      expect(getPromqlLegendName(metric, "", undefined, ["pod"])).toBe("api-1");
    });

    it('keeps Prometheus\' {k="v"} form when several labels vary', () => {
      expect(getPromqlLegendName(metric, "", undefined, ["pod", "__name__"])).toBe(
        '{pod="api-1", __name__="http_requests"}',
      );
    });

    it("skips varying labels this series does not carry", () => {
      expect(getPromqlLegendName(metric, "", undefined, ["pod", "zone"])).toBe("api-1");
    });

    it("falls back to the full label set when nothing varies", () => {
      expect(getPromqlLegendName({ pod: "api-1" }, "", undefined, [])).toBe('{"pod":"api-1"}');
    });

    it("never overrides an explicit legend template", () => {
      expect(getPromqlLegendName(metric, "{__name__}", undefined, ["pod"])).toBe("http_requests");
    });
  });

  describe("getPreferredLabels", () => {
    const groups = [
      {
        id: "k8s-namespace",
        display: "Namespace",
        fields: ["k8s_namespace_name"],
        is_stable: true,
      },
      { id: "k8s-pod-name", display: "Pod", fields: ["k8s_pod_name"], is_stable: true },
      { id: "pod-uid", display: "Pod UID", fields: ["k8s_pod_uid"], is_stable: false },
      {
        id: "pod-start-time",
        display: "Pod start",
        fields: ["k8s_pod_start_time"],
        is_stable: false,
      },
      { id: "container-id", display: "Container", fields: ["container_id"], is_stable: true },
    ];

    it("drops the churny identifiers correlation marks unstable", () => {
      expect(getPreferredLabels(["k8s_pod_uid", "k8s_pod_start_time"], groups)).toEqual([]);
    });

    it("drops stable labels that are not identities", () => {
      expect(getPreferredLabels(["container_id"], groups)).toEqual([]);
    });

    it("orders identities namespace-first, not by the order they were seen", () => {
      expect(getPreferredLabels(["k8s_pod_name", "k8s_namespace_name"], groups)).toEqual([
        "k8s_namespace_name",
        "k8s_pod_name",
      ]);
    });

    it("keeps the identity and discards the noise beside it", () => {
      expect(getPreferredLabels(["k8s_pod_uid", "k8s_pod_name"], groups)).toEqual(["k8s_pod_name"]);
    });

    it("recognises identities with no semantic groups loaded at all", () => {
      // The endpoint the groups come from is enterprise-only; OSS still names.
      expect(getPreferredLabels(["k8s_pod_name"], [])).toEqual(["k8s_pod_name"]);
      expect(getPreferredLabels(["k8s.pod.name"], [])).toEqual(["k8s.pod.name"]);
      expect(getPreferredLabels(["pod"], [])).toEqual(["pod"]);
      expect(getPreferredLabels([], groups)).toEqual([]);
    });

    it("matches the whole name, so a uid is never mistaken for the pod", () => {
      expect(getPreferredLabels(["k8s_pod_uid", "k8s_pod_start_time"], [])).toEqual([]);
    });

    it("lets a semantic group veto a label the vocabulary would accept", () => {
      const vetoed = [{ id: "pod-id", display: "Pod", fields: ["pod"], is_stable: false }];

      expect(getPreferredLabels(["pod"], vetoed)).toEqual([]);
    });
  });

  describe("getPromqlLegendName with preferred labels", () => {
    const metric = {
      __name__: "kube_pod_status",
      k8s_namespace_name: "prod",
      k8s_pod_name: "api-1",
      k8s_pod_uid: "9f2c-4a11",
    };

    it("names the series by its identity, path-style", () => {
      expect(
        getPromqlLegendName(
          metric,
          "",
          undefined,
          ["k8s_pod_uid"],
          ["k8s_namespace_name", "k8s_pod_name"],
        ),
      ).toBe("prod/api-1");
    });

    it("says a repeated value once — a DaemonSet pod named after its service", () => {
      const daemonSet = {
        service_name: "node-exporter-drhf7",
        k8s_pod_name: "node-exporter-drhf7",
        k8s_node_name: "ip-10-2-84-190.us-east-2.compute.internal",
      };

      expect(
        getPromqlLegendName(
          daemonSet,
          "",
          undefined,
          [],
          ["service_name", "k8s_pod_name", "k8s_node_name"],
        ),
      ).toBe("node-exporter-drhf7/ip-10-2-84-190.us-east-2.compute.internal");
    });

    it("collapses to a single name when every identity agrees", () => {
      const metric = { service_name: "api", k8s_pod_name: "api" };

      expect(getPromqlLegendName(metric, "", undefined, [], ["service_name", "k8s_pod_name"])).toBe(
        "api",
      );
    });

    it("will not name a series after a uid, even when the uid is all that varies", () => {
      // Naming by churn tells two series apart while naming neither; the metric
      // name at least says what is plotted, and the collision pass appends the
      // uid to it when that is genuinely the only difference.
      expect(getPromqlLegendName(metric, "", undefined, ["k8s_pod_uid"], [])).toBe(
        "kube_pod_status",
      );
      expect(getPromqlLegendName(metric, "", "Heap bytes", ["k8s_pod_uid"], [])).toBe("Heap bytes");
    });

    // container_memory_usage_bytes returns a pod-level series with no `container`
    // label beside the per-container ones.
    it("names a series carrying none of the discriminating labels", () => {
      const podLevel = { __name__: "container_memory_usage_bytes", pod: "api-1" };

      expect(getPromqlLegendName(podLevel, "", undefined, ["container"], [])).toBe(
        "container_memory_usage_bytes",
      );
    });

    it("keeps the full label set when nothing names the series", () => {
      // Told nothing discriminates and nothing is preferred, there is nothing to
      // pick — the labels are all the reader has.
      expect(getPromqlLegendName({ job: "api" }, "", undefined, [], [])).toBe('{"job":"api"}');
    });

    it("still lets an explicit template win", () => {
      expect(
        getPromqlLegendName(metric, "{__name__}", undefined, ["k8s_pod_uid"], ["k8s_pod_name"]),
      ).toBe("kube_pod_status");
    });
  });

  describe("buildPromqlSeriesNames", () => {
    const nameList = (names: Map<any, string>, metrics: any[]) => metrics.map((m) => names.get(m));

    it("names by identity and drops the churn beside it", () => {
      const metrics = [
        { __name__: "kube_pod", k8s_pod_name: "api-1", k8s_pod_uid: "aaa" },
        { __name__: "kube_pod", k8s_pod_name: "api-2", k8s_pod_uid: "bbb" },
      ];

      const names = buildPromqlSeriesNames([{ metrics }]);

      expect(nameList(names, metrics)).toEqual(["api-1", "api-2"]);
    });

    // ECharts keys the legend, the colour and the tooltip row by series name, so
    // two series sharing one is not cosmetic — they merge into a single entry.
    it("keeps two queries over the same pods apart", () => {
      const requests = [{ __name__: "http_requests", pod: "api-1" }];
      const errors = [{ __name__: "http_errors", pod: "api-1" }];

      const names = buildPromqlSeriesNames([{ metrics: requests }, { metrics: errors }]);

      expect(names.get(requests[0])).not.toBe(names.get(errors[0]));
      expect(new Set(nameList(names, [...requests, ...errors])).size).toBe(2);
    });

    it("keeps sibling containers in one pod apart", () => {
      const metrics = [
        { pod: "api-1", container: "app" },
        { pod: "api-1", container: "sidecar" },
        { pod: "api-2", container: "app" },
      ];

      const names = buildPromqlSeriesNames([{ metrics }]);

      expect(new Set(nameList(names, metrics)).size).toBe(3);
      expect(names.get(metrics[0])).toContain("api-1");
      expect(names.get(metrics[0])).toContain("app");
    });

    it("reaches for a churny label only when nothing else separates two series", () => {
      const metrics = [
        { pod: "api", k8s_pod_uid: "aaa" },
        { pod: "api", k8s_pod_uid: "bbb" },
      ];

      const names = buildPromqlSeriesNames([{ metrics }]);

      expect(new Set(nameList(names, metrics)).size).toBe(2);
    });

    // rate(node_disk_io_time_seconds_total[5m]) — a series per disk per node.
    // The device separates the disks of one node; that node's own address,
    // repeated on each of its disks, separates nothing, and neither do the pod
    // uid and start time.
    it("adds only the label that actually separates the collision", () => {
      const disk = (node: string, device: string) => ({
        k8s_node_name: node,
        device,
        server_address: node,
        k8s_pod_uid: `uid-${node}`,
        k8s_pod_start_time: `start-${node}`,
      });
      const metrics = [
        disk("ip-10-2-82-165", "nvme0n1"),
        disk("ip-10-2-82-165", "nvme2n1"),
        disk("ip-10-2-98-101", "nvme0n1"),
        disk("ip-10-2-98-101", "nvme2n1"),
      ];

      const names = buildPromqlSeriesNames([{ metrics }]);

      expect(names.get(metrics[0])).toBe('ip-10-2-82-165 {device="nvme0n1"}');
      expect(names.get(metrics[3])).toBe('ip-10-2-98-101 {device="nvme2n1"}');
      for (const name of names.values()) {
        expect(name).not.toContain("k8s_pod_uid");
        expect(name).not.toContain("k8s_pod_start_time");
        expect(name).not.toContain("server_address");
      }
    });

    // The cAdvisor shape end-to-end: one pod-level series with no `container`
    // label alongside the per-container ones.
    it("names the pod-level series without dumping its labels", () => {
      const metrics = [
        { __name__: "container_memory_usage_bytes", pod: "api-1" },
        { __name__: "container_memory_usage_bytes", pod: "api-1", container: "app" },
        { __name__: "container_memory_usage_bytes", pod: "api-1", container: "sidecar" },
      ];

      const names = buildPromqlSeriesNames([{ metrics }]);

      expect(names.get(metrics[0])).toBe("container_memory_usage_bytes");
      expect(names.get(metrics[1])).toBe("app");
      expect(names.get(metrics[2])).toBe("sidecar");
      for (const name of names.values()) expect(name).not.toContain('{"');
    });

    // An aggregated query has no __name__ and a dashboard sets no fallback, so
    // this pod-level series had nothing left and dumped its labels.
    it("names a sibling-less series by its identity when nothing else can", () => {
      const metrics = [
        { pod: "api-1", container: "app" },
        { pod: "api-1", container: "sidecar" },
        { pod: "api-1" },
      ];

      const names = buildPromqlSeriesNames([{ metrics }]);

      expect(names.get(metrics[2])).toBe("api-1");
      for (const name of names.values()) expect(name).not.toContain('{"');
    });

    it("appends a uid to a real name rather than naming a series after it", () => {
      const metrics = [
        { __name__: "kube_pod", pod: "api", k8s_pod_uid: "u1" },
        { __name__: "kube_pod", pod: "api", k8s_pod_uid: "u2" },
      ];

      const names = buildPromqlSeriesNames([{ metrics }]);

      expect(names.get(metrics[0])).toBe('kube_pod {k8s_pod_uid="u1"}');
      expect(names.get(metrics[1])).toBe('kube_pod {k8s_pod_uid="u2"}');
    });

    // sum by (node) (...) over one node: no siblings to differ from, but `node`
    // still says which node it is.
    it("names a lone series by its identity rather than dumping its labels", () => {
      const metrics = [{ node: "ip-10-1-118-97.us-east-2.compute.internal" }];

      const names = buildPromqlSeriesNames([{ metrics }]);

      expect(names.get(metrics[0])).toBe("ip-10-1-118-97.us-east-2.compute.internal");
    });

    it("leaves a lone series with no identity label alone", () => {
      const metrics = [{ job: "api", handler: "/healthz" }];

      const names = buildPromqlSeriesNames([{ metrics }]);

      expect(names.get(metrics[0])).toBe('{"job":"api","handler":"/healthz"}');
    });

    it("leaves a templated query to its own template", () => {
      const metrics = [{ pod: "api-1", container: "app" }];

      const names = buildPromqlSeriesNames([{ metrics, template: "{container}" }]);

      expect(names.get(metrics[0])).toBe("app");
    });

    it("falls back to the query's fallback when a series has no labels at all", () => {
      const metrics = [{}];

      const names = buildPromqlSeriesNames([{ metrics, fallback: "heap_alloc_bytes" }]);

      expect(names.get(metrics[0])).toBe("heap_alloc_bytes");
    });
  });

  describe("getLegendPosition", () => {
    it('should return "horizontal" for "bottom" position', () => {
      expect(getLegendPosition("bottom")).toBe("horizontal");
    });

    it('should return "vertical" for "right" position', () => {
      expect(getLegendPosition("right")).toBe("vertical");
    });

    it('should return "horizontal" for unknown position', () => {
      expect(getLegendPosition("top")).toBe("horizontal");
      expect(getLegendPosition("left")).toBe("horizontal");
      expect(getLegendPosition("center")).toBe("horizontal");
    });

    it('should return "horizontal" for empty string', () => {
      expect(getLegendPosition("")).toBe("horizontal");
    });

    it('should return "horizontal" for null', () => {
      expect(getLegendPosition(null as any)).toBe("horizontal");
    });

    it('should return "horizontal" for undefined', () => {
      expect(getLegendPosition(undefined as any)).toBe("horizontal");
    });

    it("should handle case-sensitive position values", () => {
      expect(getLegendPosition("Bottom")).toBe("horizontal");
      expect(getLegendPosition("RIGHT")).toBe("horizontal");
      expect(getLegendPosition("BOTTOM")).toBe("horizontal");
    });

    it("should handle numeric input", () => {
      expect(getLegendPosition(123 as any)).toBe("horizontal");
    });

    it("should handle special characters", () => {
      expect(getLegendPosition("@#$%")).toBe("horizontal");
    });
  });
});

describe("getPromqlLegendName — empty label sets", () => {
  it("names a label-less series from the fallback instead of '{}'", () => {
    // An aggregating query (count/sum/avg) strips every label, so the legend
    // used to read "{}" — which names nothing.
    expect(getPromqlLegendName({}, "", "Errors")).toBe("Errors");
  });

  it("keeps real labels when the series has them", () => {
    expect(getPromqlLegendName({ job: "api" }, "", "Errors")).toBe('{"job":"api"}');
  });

  it("still prefers an explicit legend template over the fallback", () => {
    expect(getPromqlLegendName({ job: "api" }, "{job}", "Errors")).toBe("api");
  });

  it("preserves the previous output when no fallback is supplied", () => {
    // Dashboards that pass nothing must behave exactly as before.
    expect(getPromqlLegendName({}, "")).toBe("{}");
  });

  it("ignores an empty fallback string", () => {
    expect(getPromqlLegendName({}, "", "")).toBe("{}");
  });
});
