import { describe, expect, it } from "vitest";
import type { Scope } from "@/services/service_versions";
import {
  pickScope,
  placeFromDimensions,
  podWhereColumns,
  podWheres,
  podWhereSql,
  podWindow,
  summarizeVersions,
  timeRangeParams,
  versionCondition,
  versionColumns,
  versionsSql,
  withTraceVersions,
} from "./correlationVersions";
import { correlationFixtures } from "./correlationVersions.fixtures";
import { goldenTraceFirstEvent } from "@/components/shared/ServiceNameLabel.fixtures";
import producer from "@/test/unit/fixtures/serviceVersions/producer.json";
import defaultSemanticGroups from "@/views/Infrastructure/curated/packs/__fixtures__/semanticGroups.default.json";

const { scopes } = correlationFixtures;

describe("placeFromDimensions", () => {
  it("reads semantic ids before fields, earlier sets first", () => {
    const place = placeFromDimensions(
      [
        { "k8s-namespace": "c1" },
        { k8s_cluster_name: "c1", k8s_namespace_name: "other", env: "_o2_all" },
        { k8s_pod_name: "c1-openobserve-ingester-7" },
      ],
      [{ id: "k8s-cluster", fields: ["k8s_cluster_name"] }],
    );
    expect(place).toEqual({
      cluster: "c1",
      namespace: "c1",
      env: undefined,
      pod: "c1-openobserve-ingester-7",
    });
  });
});

describe("place read in the identity resolver's order", () => {
  it("prefers the resource cluster over the span attribute, as the scope's where does", () => {
    const place = placeFromDimensions([
      {
        k8s_cluster: "cluster-span",
        service_k8s_cluster: "cluster-resource",
        k8s_namespace_name: "ns-span",
        service_k8s_namespace_name: "ns-resource",
      },
    ]);
    expect(place.cluster).toBe("cluster-resource");
    expect(place.namespace).toBe("ns-resource");
  });

  it("keeps the resolver's order when the default semantic groups list the span field first", () => {
    const place = placeFromDimensions(
      [
        {
          k8s_cluster: "cluster-span",
          service_k8s_cluster: "cluster-resource",
          k8s_namespace: "ns-span",
          service_k8s_namespace_name: "ns-resource",
        },
      ],
      defaultSemanticGroups,
    );
    expect(place.cluster).toBe("cluster-resource");
    expect(place.namespace).toBe("ns-resource");
  });
});

describe("pickScope", () => {
  it("matches the k8s cluster and namespace first", () => {
    expect(pickScope(scopes, "ingester", { cluster: "c1", namespace: "c1", env: "dev" })).toBe(
      scopes[0],
    );
  });

  it("falls back to the env when the where has no match", () => {
    expect(pickScope(scopes, "ingester", { cluster: "x", namespace: "y", env: "dev" })).toBe(
      scopes[1],
    );
  });

  it("returns no scope when two scopes share the env or nothing narrows a list", () => {
    const twins: Scope[] = [scopes[0], { ...scopes[1], env: "prod" }];
    expect(pickScope(twins, "ingester", { env: "prod" })).toBe(null);
    expect(pickScope(scopes, "ingester", {})).toBe(null);
  });

  it("returns no scope when a pinned scope and a scope also seen in the env both match", () => {
    const seen = structuredClone(producer.two_env.services.services[0]) as Scope;
    const pinned: Scope = {
      ...seen,
      scope_key: "other",
      where_key: "k8s:c5-cluster/web",
      env: "staging",
      envs: ["staging"],
    };
    expect(pickScope([seen, pinned], seen.service, { env: "staging" })).toBe(null);
    expect(pickScope([pinned, seen], seen.service, { env: "staging" })).toBe(null);
  });

  it("takes the only scope and ignores other services", () => {
    expect(pickScope([scopes[0], scopes[2]], "ingester", {})).toBe(scopes[0]);
    expect(pickScope(scopes, "nats", {})).toBe(null);
  });
  it("takes the one place the pod's spans name before the env, when the own place has no match", () => {
    const place = { cluster: "logging-a", namespace: "c1", env: "dev", pod: "p-1" };
    expect(pickScope(scopes, "ingester", place, ["k8s:c1/c1"])).toBe(scopes[0]);
  });

  it("never guesses from the pod: two places, a failed read or an unknown place give no scope", () => {
    const place = { cluster: "logging-a", namespace: "c1", env: "dev", pod: "p-1" };
    expect(pickScope(scopes, "ingester", place, ["k8s:c1/c1", "env:dev"])).toBe(null);
    expect(pickScope(scopes, "ingester", place, null)).toBe(null);
    expect(pickScope(scopes, "ingester", place, ["k8s:other/ns"])).toBe(null);
  });

  it("lets the own cluster and namespace win over the pod", () => {
    const place = { cluster: "c1", namespace: "c1", pod: "p-1" };
    expect(pickScope(scopes, "ingester", place, ["env:dev"])).toBe(scopes[0]);
  });
});

describe("pod read", () => {
  it("needs a where column and a pod column, and filters the service when it can", () => {
    const k8s = [...correlationFixtures.traceFields.k8s, "o2_service_where"];
    expect(podWhereColumns(k8s)).toEqual({ pod: "service_k8s_pod_name", service: "service_name" });
    expect(podWhereColumns(correlationFixtures.traceFields.k8s)).toBe(null);
    expect(podWhereColumns([...correlationFixtures.traceFields.plain, "o2_service_where"])).toBe(
      null,
    );
  });

  it("asks for at most two distinct places of the pod, quoting values", () => {
    expect(
      podWhereSql('my"traces', "o'svc", "pod-1", { pod: "k8s_pod_name", service: "service_name" }),
    ).toBe(
      `SELECT o2_service_where AS where_key FROM "my""traces" WHERE k8s_pod_name = 'pod-1' AND service_name = 'o''svc' AND o2_service_where IS NOT NULL GROUP BY o2_service_where LIMIT 2`,
    );
  });

  it("reads five minutes either side of the log time and dedupes the places", () => {
    expect(podWindow(1_000_000_000)).toEqual({ startTime: 700_000_000, endTime: 1_300_000_000 });
    expect(podWheres([{ where_key: "a" }, { where_key: "a" }, { where_key: null }])).toEqual(["a"]);
  });
});

describe("versions line", () => {
  it("counts distinct pods per version, most pods first, and finds the source pod's newest", () => {
    const summary = summarizeVersions(
      [
        { version: "v1.0.0", pod: "ingester-1", last_seen: 10 },
        { version: "v1.1.0-rc2", pod: "ingester-7", last_seen: 30 },
        { version: "v1.1.0-rc2", pod: "ingester-8", last_seen: 20 },
        { version: "v1.0.0", pod: "ingester-7", last_seen: 5 },
        { version: null, pod: "ingester-9", last_seen: 50 },
      ],
      "ingester-7",
    );
    expect(summary).toEqual({
      versions: [
        { version: "v1.1.0-rc2", pods: 2 },
        { version: "v1.0.0", pods: 2 },
      ],
      sourcePodVersion: "v1.1.0-rc2",
    });
  });

  it("builds one grouped search and a quoted version condition", () => {
    expect(
      versionsSql('tr"aces', "service_name = 'ingester'", { pod: "service_k8s_pod_name" }),
    ).toBe(
      `SELECT o2_service_version AS version, service_k8s_pod_name AS pod, MAX(_timestamp) AS last_seen FROM "tr""aces" WHERE (service_name = 'ingester') AND o2_service_version IS NOT NULL GROUP BY o2_service_version, service_k8s_pod_name`,
    );
    expect(versionCondition("v1'2")).toBe("o2_service_version = 'v1''2'");
  });
});

describe("versions read on the trace stream schema", () => {
  const fields = (names: string[]) => ["_timestamp", "service_name", ...names];

  it("groups by the stamped pod column, else by version only, and skips a stream with no version", () => {
    expect(versionColumns(fields(["o2_service_version", "service_k8s_pod_name"]))).toEqual({
      pod: "service_k8s_pod_name",
    });
    expect(versionColumns(fields(["o2_service_version", "k8s_pod_name"]))).toEqual({
      pod: "k8s_pod_name",
    });
    expect(versionColumns(fields(["o2_service_version"]))).toEqual({ pod: null });
    expect(versionColumns(fields(["service_k8s_pod_name"]))).toBe(null);
  });

  it("reads versions without a pod column and counts no pods", () => {
    expect(versionsSql("default", "", { pod: null })).toBe(
      `SELECT o2_service_version AS version, MAX(_timestamp) AS last_seen FROM "default" WHERE o2_service_version IS NOT NULL GROUP BY o2_service_version`,
    );
    expect(
      summarizeVersions(
        [
          { version: "v1.0.0", pod: null, last_seen: 10 },
          { version: "v1.1.0", pod: null, last_seen: 30 },
        ],
        undefined,
        false,
      ),
    ).toEqual({
      versions: [
        { version: "v1.1.0", pods: null },
        { version: "v1.0.0", pods: null },
      ],
      sourcePodVersion: null,
    });
  });
});

describe("withTraceVersions", () => {
  it("copies the summary's first-event version onto the formatted row and leaves others alone", () => {
    const rows = [{ trace_id: "a" }, { trace_id: "b" }, { trace_id: "c" }];
    const hits = [
      { first_event: goldenTraceFirstEvent },
      { first_event: { service_name: goldenTraceFirstEvent.service_name } },
      {},
    ];
    expect(withTraceVersions(rows, hits)).toEqual([
      { trace_id: "a", o2_service_version: goldenTraceFirstEvent.o2_service_version },
      { trace_id: "b" },
      { trace_id: "c" },
    ]);
  });
});

describe("timeRangeParams", () => {
  it("formats microsecond bounds in the timezone and rounds the minutes", () => {
    const start = Date.UTC(2026, 9, 22, 16, 0, 0) * 1000;
    expect(timeRangeParams({ startTime: start, endTime: start + 90 * 60_000_000 }, "UTC")).toEqual({
      start: "16:00:00",
      end: "17:30:00",
      minutes: 90,
    });
    expect(
      timeRangeParams({ startTime: start, endTime: start + 60_000_000 }, "Asia/Kolkata").start,
    ).toBe("21:30:00");
  });
});
