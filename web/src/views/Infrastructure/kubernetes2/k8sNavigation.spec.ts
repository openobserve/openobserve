// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { b64DecodeUnicode } from "@/utils/formatters";
import {
  metricsRoute,
  metricsTarget,
  pickTracesStream,
  tracesFilter,
  tracesRoute,
} from "./k8sNavigation";
import type { DetailsRef } from "./kubernetesUrlState";

const ref = (kind: DetailsRef["kind"], namespace: string, name: string): DetailsRef => ({
  kind,
  cluster: "prod",
  namespace,
  name,
});
const ctx = { orgId: "default", start: 1000, end: 2000, stream: "otel_traces" };

describe("metricsTarget", () => {
  it("selects a pod's usage series by pod and namespace", () => {
    expect(metricsTarget(ref("pod", "web", "api-1"))).toEqual({
      stream: "k8s_pod_cpu_usage",
      promql: 'k8s_pod_cpu_usage{k8s_pod_name="api-1", k8s_namespace_name="web"}',
    });
  });

  it("selects a node's usage series by node name", () => {
    expect(metricsTarget(ref("node", "", "ip-10-0-0-1")).promql).toBe(
      'k8s_node_cpu_usage{k8s_node_name="ip-10-0-0-1"}',
    );
  });

  it("sums a namespace's pods", () => {
    expect(metricsTarget(ref("namespace", "", "web")).promql).toBe(
      'sum(k8s_pod_cpu_usage{k8s_namespace_name="web"})',
    );
  });

  it.each([
    ["deployment", "api-[a-z0-9]+-[a-z0-9]{5}"],
    ["statefulset", "api-[0-9]+"],
    ["daemonset", "api-[a-z0-9]{5}"],
    ["replicaset", "api-[a-z0-9]{5}"],
    ["job", "api-[a-z0-9]{5}"],
    ["cronjob", "api-[0-9]+-[a-z0-9]{5}"],
  ] as const)("matches a %s's pods by their generated names", (kind, pattern) => {
    expect(metricsTarget(ref(kind, "web", "api")).promql).toBe(
      `sum(k8s_pod_cpu_usage{k8s_pod_name=~"${pattern}", k8s_namespace_name="web"})`,
    );
  });

  it("escapes regex metacharacters in a workload name", () => {
    expect(metricsTarget(ref("statefulset", "web", "db.v1")).promql).toContain(
      'k8s_pod_name=~"db\\\\.v1-[0-9]+"',
    );
  });

  it("escapes quotes in names", () => {
    expect(metricsTarget(ref("pod", "web", 'a"b')).promql).toContain('a\\"b');
  });
});

describe("metricsRoute", () => {
  it("opens Metrics in promql mode with the query encoded and the range carried", () => {
    const route = metricsRoute(ref("pod", "web", "api-1"), ctx) as any;
    expect(route.name).toBe("metrics");
    expect(route.query).toMatchObject({
      org_identifier: "default",
      query_type: "promql",
      stream_name: "k8s_pod_cpu_usage",
      from: "1000",
      to: "2000",
    });
    expect(b64DecodeUnicode(route.query.query)).toContain("api-1");
  });
});

describe("tracesRoute", () => {
  it("filters by pod and namespace", () => {
    expect(tracesFilter(ref("pod", "web", "api-1"))).toBe(
      "k8s_pod_name='api-1' AND k8s_namespace_name='web'",
    );
    expect((tracesRoute(ref("pod", "web", "api-1"), ctx) as any).query.filter).toContain("api-1");
  });

  it("opens the stream the caller resolved", () => {
    expect((tracesRoute(ref("pod", "web", "api-1"), ctx) as any).query.stream).toBe("otel_traces");
  });

  it("drops the namespace term when there is none", () => {
    expect(tracesFilter(ref("pod", "", "api-1"))).toBe("k8s_pod_name='api-1'");
  });

  it("escapes single quotes the SQL way", () => {
    expect(tracesFilter(ref("pod", "", "a'b"))).toContain("a''b");
  });
});

describe("pickTracesStream", () => {
  it("prefers default, else the first name sorted, else null", () => {
    expect(pickTracesStream(["zeta", "default", "alpha"])).toBe("default");
    expect(pickTracesStream(["zeta", "alpha"])).toBe("alpha");
    expect(pickTracesStream([])).toBeNull();
  });
});
