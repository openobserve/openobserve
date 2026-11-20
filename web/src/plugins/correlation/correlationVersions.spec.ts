import { describe, expect, it } from "vitest";
import type { Scope } from "@/services/service_versions";
import {
  appliedFilterSql,
  instanceVersionFilter,
  instanceWhereSql,
  instanceWheres,
  instanceWindow,
  latestVersion,
  pickScope,
  placeFromDimensions,
  summarizeVersions,
  timeRangeParams,
  versionCondition,
  versionColumns,
  versionsSql,
  withTraceVersions,
} from "./correlationVersions";
import { correlationFixtures } from "./correlationVersions.fixtures";
import { serviceKeySql } from "@/utils/serviceCount";
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import { goldenTraceFirstEvent } from "@/components/shared/ServiceNameLabel.fixtures";
import producer from "@/test/unit/fixtures/serviceVersions/producer.json";

const { scopes, groups, location } = correlationFixtures;
const at = (place: { cluster?: string; namespace?: string; env?: string }) =>
  placeFromDimensions(
    [{ "k8s-cluster": place.cluster, "k8s-namespace": place.namespace, environment: place.env }],
    groups,
    location,
  );

describe("placeFromDimensions", () => {
  it("reads semantic ids before fields, earlier sets first", () => {
    const place = placeFromDimensions(
      [
        { "k8s-namespace": "c1" },
        { k8s_cluster_name: "c1", k8s_namespace_name: "other", env: "_o2_all" },
        { k8s_pod_name: "c1-openobserve-ingester-7" },
      ],
      [{ id: "k8s-cluster", fields: ["k8s_cluster_name"] }],
      location,
    );
    expect(place.values).toEqual({ "k8s-cluster": "c1", "k8s-namespace": "c1" });
  });
});

describe("place read in the identity resolver's order", () => {
  it("prefers the resource cluster over the span attribute, as the scope's where does", () => {
    const place = placeFromDimensions(
      [
        {
          k8s_cluster: "cluster-span",
          service_k8s_cluster_name: "cluster-resource",
          k8s_namespace_name: "ns-span",
          service_k8s_namespace_name: "ns-resource",
        },
      ],
      groups,
      location,
    );
    expect(place.values["k8s-cluster"]).toBe("cluster-resource");
    expect(place.values["k8s-namespace"]).toBe("ns-resource");
  });
});

describe("pickScope", () => {
  it("matches the k8s cluster and namespace first", () => {
    expect(pickScope(scopes, "ingester", at({ cluster: "c1", namespace: "c1", env: "dev" }))).toBe(
      scopes[0],
    );
  });

  it("falls back to the env when the where has no match", () => {
    expect(pickScope(scopes, "ingester", at({ cluster: "x", namespace: "y", env: "dev" }))).toBe(
      scopes[1],
    );
  });

  it("returns no scope when two scopes share the env or nothing narrows a list", () => {
    const twins: Scope[] = [scopes[0], { ...scopes[1], env: "prod" }];
    expect(pickScope(twins, "ingester", at({ env: "prod" }))).toBe(null);
    expect(pickScope(scopes, "ingester", at({}))).toBe(null);
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
    expect(pickScope([seen, pinned], seen.service, at({ env: "staging" }))).toBe(null);
    expect(pickScope([pinned, seen], seen.service, at({ env: "staging" }))).toBe(null);
  });

  it("takes the only scope under any spelling of the service and ignores other services", () => {
    expect(pickScope([scopes[0], scopes[2]], "ingester", at({}))).toBe(scopes[0]);
    expect(pickScope([scopes[0], scopes[2]], "Ingester.service", at({}))).toBe(scopes[0]);
    expect(pickScope(scopes, "nats", at({}))).toBe(null);
  });
  it("takes the one place the record's spans name before the env, when the own place has no match", () => {
    const place = at({ cluster: "logging-a", namespace: "c1", env: "dev" });
    expect(pickScope(scopes, "ingester", place, ["k8s:c1/c1"])).toBe(scopes[0]);
  });

  it("never guesses from the spans: a failed read or an unknown place give no scope", () => {
    const place = at({ cluster: "logging-a", namespace: "c1", env: "dev" });
    expect(pickScope(scopes, "ingester", place, null)).toBe(null);
    expect(pickScope(scopes, "ingester", place, ["k8s:other/ns"])).toBe(null);
  });

  it("falls back to the env when the spans name two places, as when they name none", () => {
    const place = at({ cluster: "logging-a", namespace: "c1", env: "dev" });
    const byEnv = scopes.find((scope) => scope.where_key === "env:dev");
    expect(byEnv).toBeDefined();
    expect(pickScope(scopes, "ingester", place, ["k8s:c1/c1", "env:dev"])).toBe(byEnv);
    expect(pickScope(scopes, "ingester", place)).toBe(byEnv);
  });

  it("lets the own cluster and namespace win over the spans", () => {
    const place = at({ cluster: "c1", namespace: "c1" });
    expect(pickScope(scopes, "ingester", place, ["env:dev"])).toBe(scopes[0]);
  });
});

describe("applied filters", () => {
  it("reads every applied record dimension, a custom one included, and skips the all-values pick", () => {
    expect(
      appliedFilterSql({
        stream_name: "traces",
        stream_type: "traces",
        filters: { rack_id: "r12", host_name: "vm-7", zone: SELECT_ALL_VALUE },
      }),
    ).toBe(`"rack_id" = 'r12' AND "host_name" = 'vm-7'`);
    expect(appliedFilterSql(undefined)).toBe("");
  });
});

describe("instance where read", () => {
  it("asks for at most two distinct places of the record's spans, quoting values", () => {
    expect(
      instanceWhereSql('my"traces', "o'svc", `rack = 'r12'`, { service: ["service_name"] }),
    ).toBe(
      `SELECT o2_service_where AS where_key FROM "my""traces" WHERE (rack = 'r12') AND ${serviceKeySql("service_name")} = 'o''svc' AND o2_service_where IS NOT NULL GROUP BY o2_service_where LIMIT 2`,
    );
  });
});

describe("instance version read", () => {
  const k8s = [...correlationFixtures.traceFields.k8s, "o2_service_where"];
  const applied = `"host_name" = 'vm-7'`;
  it.each([
    {
      name: "pins the scope's place and folds the service spelling",
      fields: k8s,
      applied,
      scope: { service: "Ingester", where_key: "k8s:c1/c1" },
      filter: `(${applied}) AND o2_service_where = 'k8s:c1/c1' AND ${serviceKeySql("service_name")} = 'ingester'`,
    },
    {
      name: "pins a scope without a place to unplaced spans",
      fields: k8s,
      applied,
      scope: { service: "ingester", where_key: "" },
      filter: `(${applied}) AND COALESCE(o2_service_where, '') = '' AND ${serviceKeySql("service_name")} = 'ingester'`,
    },
    {
      name: "has nothing to read when correlation applied no filter",
      fields: k8s,
      applied: "",
      scope: { service: "ingester", where_key: "k8s:c1/c1" },
      filter: null,
    },
    {
      name: "cannot pin a stream without a where column",
      fields: correlationFixtures.traceFields.k8s,
      applied,
      scope: { service: "ingester", where_key: "k8s:c1/c1" },
      filter: null,
    },
    {
      name: "cannot read a stream without a version column",
      fields: k8s.filter((field) => field !== "o2_service_version"),
      applied,
      scope: { service: "ingester", where_key: "k8s:c1/c1" },
      filter: null,
    },
  ])("$name", ({ fields, applied, scope, filter }) => {
    expect(instanceVersionFilter(fields, applied, scope, null, groups)).toBe(filter);
  });

  it("reads five minutes either side of the log time, dedupes the places and takes the newest version", () => {
    expect(instanceWindow(1_000_000_000)).toEqual({
      startTime: 700_000_000,
      endTime: 1_300_000_000,
    });
    expect(instanceWheres([{ where_key: "a" }, { where_key: "a" }, { where_key: null }])).toEqual([
      "a",
    ]);
    expect(
      latestVersion([
        { version: "v1.0.0", last_seen: 10 },
        { version: "v1.1.0-rc2", last_seen: 30 },
        { version: null, last_seen: 50 },
      ]),
    ).toBe("v1.1.0-rc2");
    expect(latestVersion([])).toBe(null);
  });
});

describe("versions line", () => {
  it("counts distinct pods per version, most pods first", () => {
    const summary = summarizeVersions([
      { version: "v1.0.0", pod: "ingester-1", last_seen: 10 },
      { version: "v1.1.0-rc2", pod: "ingester-7", last_seen: 30 },
      { version: "v1.1.0-rc2", pod: "ingester-8", last_seen: 20 },
      { version: "v1.0.0", pod: "ingester-7", last_seen: 5 },
      { version: null, pod: "ingester-9", last_seen: 50 },
    ]);
    expect(summary).toEqual({
      versions: [
        { version: "v1.1.0-rc2", pods: 2 },
        { version: "v1.0.0", pods: 2 },
      ],
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

  it("groups by the record's instance column, else by version only, and skips a stream with no version", () => {
    const instance = { dimensions: { "k8s-pod-name": "pod-7" }, groups };
    expect(
      versionColumns(fields(["o2_service_version", "service_k8s_pod_name"]), instance),
    ).toEqual({ pod: "service_k8s_pod_name" });
    expect(versionColumns(fields(["o2_service_version", "k8s_pod_name"]), instance)).toEqual({
      pod: "k8s_pod_name",
    });
    expect(versionColumns(fields(["o2_service_version"]), instance)).toEqual({ pod: null });
    expect(versionColumns(fields(["service_k8s_pod_name"]), instance)).toBe(null);
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
        false,
      ),
    ).toEqual({
      versions: [
        { version: "v1.1.0", pods: null },
        { version: "v1.0.0", pods: null },
      ],
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
