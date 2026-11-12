// Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));

import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";
import config from "@/aws-exports";
import i18n from "@/locales";
import { isPrefillBlocked, needsThreshold, normalizePrefill } from "../alertPrefill";
import { raw } from "@/types/i18n";
import {
  LEVEL0_COLUMNS,
  LEVEL3_COLUMNS,
  MIXED_3_0_COLUMNS,
} from "@/views/Infrastructure/kubernetes2/__fixtures__/flattenSchemas";
import {
  baselineSql,
  errorFieldOf,
  errorsAlert,
  latencyAlert,
  memoryAlert,
  noDataAlert,
  nodeAlert,
  restartAlert,
  sourceNoDataAlert,
  type AutoObserveAlertOptions,
  type ServiceScope,
} from "./fromAutoObserve";

// 2026-11-06T12:00:00Z in microseconds.
const NOW = 1_793_966_400_000_000;

const parser = new Parser();

const textOf = (w: { key: string; params?: Record<string, string | number> }) =>
  i18n.global.t(`alerts.prefill.warnings.${w.key}`, w.params ?? {});

const options: AutoObserveAlertOptions = {
  team: {
    name: "ops",
    folderId: "ops",
    folderName: "ops",
    source: "folder",
    reason: raw("Where svc-a's 3 alerts live."),
  },
  notify: { destinations: ["ops-webhook"], reason: raw("svc-a's 3 alerts notify ops-webhook.") },
  now: NOW,
};

const logsScope = (overrides: Partial<ServiceScope> = {}): ServiceScope => ({
  service: "svc-a",
  cluster: "cluster-k",
  namespace: "ns-b",
  stream: { type: "logs", name: "app_logs" },
  schema: ["_timestamp", "service_name", "k8s_cluster", "k8s_namespace_name", "level", "took"],
  ...overrides,
});

const tracesScope = (overrides: Partial<ServiceScope> = {}): ServiceScope => ({
  ...logsScope(),
  stream: { type: "traces", name: "app_traces" },
  schema: [
    "_timestamp",
    "service_name",
    "k8s_cluster",
    "k8s_namespace_name",
    "span_status",
    "duration",
  ],
  ...overrides,
});

afterEach(() => {
  config.isEnterprise = "true";
});

describe("noDataAlert", () => {
  it("scopes to the service and namespace over 15 minutes in the analyzer's absence shape", () => {
    const prefill = noDataAlert(logsScope({ cluster: null }), options)!;

    expect(prefill.sql).toBe(
      'SELECT count(*) AS row_count FROM "app_logs" WHERE "service_name" = \'svc-a\' AND "k8s_namespace_name" = \'ns-b\' HAVING count(*) = 0',
    );
    expect(prefill.periodMinutes).toBe(15);
    expect(prefill.source).toBe("autoobserve");
    expect(prefill.sourceLabel).toBe("Suggested by AutoObserve for svc-a");
    expect(prefill.triggerThreshold).toBe(1);
    expect(prefill.triggerOperator).toBe(">=");
    expect(prefill.meta).toMatchObject({
      check: "no_data",
      description: "Created from an AutoObserve suggestion for svc-a on Nov 6.",
      folderId: "ops",
      destinations: ["ops-webhook"],
      service: { name: "svc-a", cluster: null, namespace: "ns-b" },
    });
  });

  it("adds the cluster when the stream carries it", () => {
    expect(noDataAlert(logsScope(), options)!.sql).toContain(
      `"service_name" = 'svc-a' AND "k8s_cluster" = 'cluster-k' AND "k8s_namespace_name" = 'ns-b'`,
    );
  });

  it("scopes a no-namespace service to rows with no namespace, as its charts do (T2-8)", () => {
    const prefill = noDataAlert(logsScope({ cluster: null, namespace: null }), options)!;

    expect(prefill.sql).toBe(
      'SELECT count(*) AS row_count FROM "app_logs" WHERE "service_name" = \'svc-a\' AND ("k8s_namespace_name" IS NULL OR "k8s_namespace_name" = \'\') HAVING count(*) = 0',
    );
    expect(prefill.name).not.toMatch(/null/i);
    expect(JSON.stringify(prefill.meta)).not.toContain('"null"');
  });

  it("scopes a no-namespace traces service by the span namespace field", () => {
    const prefill = noDataAlert(
      {
        service: "svc-b",
        cluster: null,
        namespace: null,
        stream: { type: "traces", name: "app_traces" },
        schema: ["_timestamp", "service_name", "service_k8s_namespace_name"],
      },
      options,
    )!;
    expect(prefill.sql).toContain(
      `WHERE "service_name" = 'svc-b' AND ("service_k8s_namespace_name" IS NULL OR "service_k8s_namespace_name" = '')`,
    );
  });

  it("names the service in the subtitle the way the coverage page does (T2-N4)", () => {
    const prefill = noDataAlert(
      { ...logsScope({ cluster: null, namespace: "ns-d" }), label: "svc-a · ns-d" },
      options,
    )!;
    expect(prefill.sourceLabel).toBe("Suggested by AutoObserve for svc-a · ns-d");
    expect(prefill.sql).toContain(`"service_name" = 'svc-a'`);
  });

  it("with no namespace field in the stream it filters on the service alone, with no null text", () => {
    const prefill = noDataAlert(
      logsScope({ cluster: null, namespace: null, schema: ["_timestamp", "service_name"] }),
      options,
    )!;
    expect(prefill.sql).toBe(
      'SELECT count(*) AS row_count FROM "app_logs" WHERE "service_name" = \'svc-a\' HAVING count(*) = 0',
    );
    expect(prefill.sql).not.toMatch(/null/i);
    expect(
      noDataAlert(logsScope({ cluster: null, namespace: null, schema: undefined }), options)!.sql,
    ).not.toMatch(/null/i);
  });

  it("escapes a quote in the service name and strips double quotes from field names", () => {
    const prefill = noDataAlert(
      logsScope({
        service: "o'brien",
        cluster: null,
        namespace: 'ns"x',
        schema: ['service"_name', "service_name", "k8s_namespace_name"],
      }),
      options,
    )!;

    expect(prefill.sql).toContain(`"service_name" = 'o''brien'`);
    expect(prefill.sql).toContain(`"k8s_namespace_name" = 'ns"x'`);
    expect(prefill.sql).not.toContain("'o'brien'");
  });

  it("strips double quotes from a field name that needs quoting", () => {
    const prefill = sourceNoDataAlert(
      {
        stream: { type: "logs", name: "k8s_events" },
        field: 'k8s"-cluster',
        value: "c'd",
        cohortSize: 1,
      },
      options,
    )!;

    expect(prefill.sql).toContain(`"k8s-cluster" = 'c''d'`);
  });

  it("never guesses a cluster field it was not shown, and says it scoped to the service only", () => {
    const prefill = noDataAlert(logsScope({ schema: undefined }), options)!;

    expect(prefill.sql).toBe(
      'SELECT count(*) AS row_count FROM "app_logs" WHERE "service_name" = \'svc-a\' HAVING count(*) = 0',
    );
    expect(prefill.warnings.map((w) => w.key)).toEqual(["autoobserve.scopeServiceOnly"]);
  });

  it("blocks rather than scoping to a field the stream does not have", () => {
    const prefill = normalizePrefill(
      noDataAlert(logsScope({ schema: ["_timestamp", "body"] }), options)!,
    );

    expect(isPrefillBlocked(prefill)).toBe(true);
    expect(prefill.warnings.map((w) => w.key)).toContain("autoobserve.noServiceField");
  });

  it("takes a longer window when the caller asks for one", () => {
    expect(noDataAlert(logsScope(), { ...options, minutes: 30 })!.periodMinutes).toBe(30);
  });
});

describe("errorsAlert", () => {
  it("reads span_status on traces", () => {
    const prefill = errorsAlert(tracesScope(), { ...options, errorField: null, usualPerHour: 17 })!;

    expect(prefill.sql).toBe(
      'SELECT count(*) AS errors FROM "app_traces" WHERE "service_name" = \'svc-a\' AND "k8s_cluster" = \'cluster-k\' AND "k8s_namespace_name" = \'ns-b\' AND "span_status" = \'ERROR\' HAVING count(*) > 51',
    );
    expect(prefill.periodMinutes).toBe(60);
  });

  it("fires above a whole error count, rounded up from three times the usual", () => {
    const prefill = errorsAlert(tracesScope(), {
      ...options,
      errorField: null,
      usualPerHour: 1.4,
    })!;

    expect(prefill.sql).toMatch(/HAVING count\(\*\) > 5$/);
    expect(prefill.meta?.threshold).toBe(5);
  });

  it("scopes a traces alert by the cluster and namespace spans keep under their service_ prefix", () => {
    const prefill = errorsAlert(
      tracesScope({
        schema: [
          "_timestamp",
          "service_name",
          "service_k8s_cluster_name",
          "service_k8s_namespace_name",
          "span_status",
        ],
      }),
      { ...options, errorField: null, usualPerHour: 17 },
    )!;

    expect(prefill.sql).toContain(
      `"service_name" = 'svc-a' AND "service_k8s_cluster_name" = 'cluster-k' AND "service_k8s_namespace_name" = 'ns-b'`,
    );
  });

  it("reads the schema's level field on logs, never the message body", () => {
    const field = errorFieldOf("logs", logsScope().schema)!;
    const prefill = errorsAlert(logsScope(), { ...options, errorField: field, usualPerHour: 17 })!;

    expect(field).toEqual({ name: "level", kind: "level" });
    expect(prefill.sql).toContain(`lower("level") IN ('error', 'fatal'`);
    expect(prefill.sql).not.toMatch(/\bbody\b/);
  });

  it("reads a status code field as 5xx", () => {
    const field = errorFieldOf("logs", ["status_code", "body"])!;
    const prefill = errorsAlert(logsScope(), { ...options, errorField: field, usualPerHour: 17 })!;

    expect(prefill.sql).toContain(`"status_code" >= 500`);
  });

  it("skips a numeric level for a text severity, and a text status code (F3)", () => {
    const types = { level: "Int64", severity_text: "Utf8", status: "Utf8", status_code: "Int64" };
    expect(errorFieldOf("logs", ["level", "severity_text"], types)).toEqual({
      name: "severity_text",
      kind: "level",
    });
    expect(errorFieldOf("logs", ["level", "status", "status_code"], types)).toEqual({
      name: "status_code",
      kind: "status_code",
    });
    expect(errorFieldOf("logs", ["level", "status"], types)).toBeNull();
  });

  it("takes a status field only when it holds numbers, never a boolean or a date (F3)", () => {
    for (const type of ["Boolean", "Timestamp(Microsecond, None)", "Binary"]) {
      expect(errorFieldOf("logs", ["status"], { status: type })).toBeNull();
    }
    for (const type of ["Int64", "UInt16", "Float64", "Decimal128(10, 2)"]) {
      expect(errorFieldOf("logs", ["status"], { status: type })).toEqual({
        name: "status",
        kind: "status_code",
      });
    }
  });

  it("blocks a scoped alert whose stream lacks the namespace or cluster field it must filter on", () => {
    const noNs = noDataAlert(logsScope({ schema: ["service_name", "k8s_cluster"] }), options)!;
    expect(noNs.warnings).toContainEqual(
      expect.objectContaining({ key: "autoobserve.noNamespaceField", level: "blocking" }),
    );
    const noCluster = noDataAlert(
      logsScope({ schema: ["service_name"], namespace: null }),
      options,
    )!;
    expect(noCluster.warnings).toContainEqual(
      expect.objectContaining({ key: "autoobserve.noClusterField", level: "blocking" }),
    );
  });

  it("filters on the field the schema names the service by, such as app", () => {
    const prefill = noDataAlert(
      logsScope({ cluster: null, namespace: null, schema: ["app", "body"] }),
      options,
    )!;
    expect(prefill.sql).toContain(`"app" = 'svc-a'`);
    expect(prefill.sql).not.toContain("service_name");
  });

  it("gives no prefill for a logs stream with neither a status nor a level field", () => {
    expect(errorFieldOf("logs", ["_timestamp", "body", "message"])).toBeNull();
    expect(errorsAlert(logsScope(), { ...options, errorField: null, usualPerHour: 17 })).toBeNull();
  });

  it("sets the threshold at three times the usual hourly count", () => {
    const prefill = errorsAlert(tracesScope(), { ...options, errorField: null, usualPerHour: 17 })!;

    expect(prefill.meta?.threshold).toBe(51);
    expect(prefill.sql).toMatch(/HAVING count\(\*\) > 51$/);
  });

  it("with no usual count, fires on any error and says so, so the draft can be added at once", () => {
    const prefill = errorsAlert(tracesScope(), {
      ...options,
      errorField: null,
      usualPerHour: null,
    })!;

    expect(prefill.sql).toMatch(/HAVING count\(\*\) > 0$/);
    expect(prefill.meta?.threshold).toBe(0);
    expect(prefill.thresholdInput).toMatchObject({
      label: "Fire above",
      suffix: "errors an hour",
      value: 0,
      note: "AutoObserve found no errors for svc-a · cluster-k / ns-b in the last 7 days, so this alert fires on any error. Raise the threshold if some errors are normal.",
    });
    expect(needsThreshold(prefill)).toBe(false);
  });

  it("with no usual count and the field cleared, asks for a threshold and leaves Save off (F1)", () => {
    const prefill = errorsAlert(tracesScope(), {
      ...options,
      errorField: null,
      usualPerHour: null,
      threshold: Number.NaN,
    })!;

    expect(prefill.sql).not.toContain("HAVING");
    expect(prefill.meta?.threshold).toBeNull();
    expect(prefill.thresholdInput).toMatchObject({
      reason:
        "AutoObserve found no usual error count for svc-a · cluster-k / ns-b over the last 7 days. Set a threshold to add this alert.",
      value: null,
    });
    expect(needsThreshold(prefill)).toBe(true);
    expect(isPrefillBlocked(prefill)).toBe(false);
  });

  it("takes a threshold the user set, so one returned row fires it (F1)", () => {
    const prefill = errorsAlert(tracesScope(), {
      ...options,
      errorField: null,
      usualPerHour: null,
      threshold: 40,
    })!;

    expect(prefill.sql).toMatch(/HAVING count\(\*\) > 40$/);
    expect(prefill).toMatchObject({ triggerThreshold: 1, triggerOperator: ">=" });
    expect(prefill.thresholdInput?.value).toBe(40);
  });
});

describe("AutoObserve is the destination", () => {
  it("every AutoObserve draft opens an incident, so one with no destination still pages on-call", () => {
    const silent = {
      ...options,
      notify: { destinations: [] as string[], reason: "none" as const },
    };
    expect(noDataAlert(logsScope(), silent)!.createsIncident).toBe(true);
    expect(
      errorsAlert(tracesScope(), { ...silent, errorField: null, usualPerHour: 2 })!.createsIncident,
    ).toBe(true);
  });
});

describe("baselineSql (F1)", () => {
  it("counts the service's errors over all its rows, with when its data starts (T2-1)", () => {
    expect(
      baselineSql(logsScope(), { kind: "errors", errorField: { name: "level", kind: "level" } }),
    ).toBe(
      `SELECT sum(CASE WHEN lower("level") IN ('error', 'fatal', 'critical', 'err', 'crit', 'alert', 'emerg', 'emergency') THEN 1 ELSE 0 END) AS errors, min("_timestamp") AS first_seen FROM "app_logs" WHERE "service_name" = 'svc-a' AND "k8s_cluster" = 'cluster-k' AND "k8s_namespace_name" = 'ns-b'`,
    );
  });

  it("reads the p95 in milliseconds and the request count for latency", () => {
    expect(baselineSql(tracesScope(), { kind: "latency", durationField: "duration" })).toBe(
      `SELECT approx_percentile_cont("duration", 0.95) / 1000 AS p95_ms, count(*) AS requests FROM "app_traces" WHERE "service_name" = 'svc-a' AND "k8s_cluster" = 'cluster-k' AND "k8s_namespace_name" = 'ns-b'`,
    );
  });

  it("measures nothing it could not scope to the service", () => {
    expect(
      baselineSql(logsScope({ schema: ["level"] }), {
        kind: "errors",
        errorField: { name: "level", kind: "level" },
      }),
    ).toBeNull();
    expect(baselineSql(logsScope(), { kind: "errors", errorField: null })).toBeNull();
  });
});

describe("latencyAlert", () => {
  it("fires at twice the usual p95, read in milliseconds from microsecond spans", () => {
    const prefill = latencyAlert(tracesScope(), {
      ...options,
      durationField: "duration",
      p95Ms: 420,
    })!;

    expect(prefill.meta?.threshold).toBe(840);
    expect(prefill.sql).toContain(`approx_percentile_cont("duration", 0.95) / 1000 > 840`);
    expect(prefill.sql).toContain("count(*) >= 20");
    expect(prefill.periodMinutes).toBe(15);
  });

  it("with no usual p95, asks for a threshold in milliseconds; a set one fires (F1)", () => {
    const empty = latencyAlert(tracesScope(), {
      ...options,
      durationField: "duration",
      p95Ms: null,
    })!;
    expect(empty.sql).not.toContain("HAVING");
    expect(empty.thresholdInput).toMatchObject({ suffix: "ms (p95)", value: null });
    const set = latencyAlert(tracesScope(), {
      ...options,
      durationField: "duration",
      p95Ms: null,
      threshold: 300,
    })!;
    expect(set.sql).toContain(`approx_percentile_cont("duration", 0.95) / 1000 > 300`);
    expect(set.thresholdInput?.value).toBe(300);
  });

  it("reads a logs duration field as milliseconds and says so", () => {
    const prefill = latencyAlert(logsScope(), { ...options, durationField: "took", p95Ms: 420 })!;

    expect(prefill.sql).toContain(`approx_percentile_cont("took", 0.95) > 840`);
    expect(prefill.warnings.map((w) => w.key)).toContain("autoobserve.latencyUnit");
  });
});

describe("sourceNoDataAlert", () => {
  const member = {
    stream: { type: "logs", name: "k8s_events" },
    field: "k8s_cluster",
    value: "cluster-d",
  };

  it("waits an hour, the outage's bucket size", () => {
    const prefill = sourceNoDataAlert({ ...member, cohortSize: 1 }, options)!;

    expect(prefill.sql).toBe(
      'SELECT count(*) AS row_count FROM "k8s_events" WHERE "k8s_cluster" = \'cluster-d\' HAVING count(*) = 0',
    );
    expect(prefill.periodMinutes).toBe(60);
    expect(prefill.sourceLabel).toBe("Suggested by AutoObserve for cluster-d");
    expect(prefill.warnings).toEqual([]);
  });

  it("with others stopped too, says it covers this source only", () => {
    const prefill = sourceNoDataAlert({ ...member, cohortSize: 7 }, options)!;
    const warning = prefill.warnings.find((w) => w.key === "autoobserve.outageOthers")!;

    expect(warning.level).toBe("warning");
    expect(i18n.global.t(`alerts.prefill.warnings.${warning.key}`, warning.params!)).toBe(
      "This alert covers cluster-d only; 6 other sources stopped at the same time.",
    );
  });

  it("says source, not sources, for one other", () => {
    const prefill = sourceNoDataAlert({ ...member, cohortSize: 2 }, options)!;
    const warning = prefill.warnings[0];

    expect(i18n.global.t(`alerts.prefill.warnings.${warning.key}`, warning.params!)).toBe(
      "This alert covers cluster-d only; 1 other source stopped at the same time.",
    );
  });
});

describe("other checks", () => {
  const metrics = (name: string): ServiceScope =>
    logsScope({
      stream: { type: "metrics", name },
      schema: ["k8s_deployment_name", "k8s_cluster", "k8s_namespace_name"],
    });

  it("memory alerts at 90% of the limit on a utilization series, scoped by its labels", () => {
    const prefill = memoryAlert(metrics("k8s_pod_memory_limit_utilization"), options)!;

    expect(prefill.queryType).toBe("promql");
    expect(prefill.promql).toBe(
      'max(k8s_pod_memory_limit_utilization{k8s_deployment_name="svc-a", k8s_cluster="cluster-k", k8s_namespace_name="ns-b"})',
    );
    expect(prefill.promqlCondition).toEqual({ column: "value", operator: ">", value: 0.9 });
  });

  it("memory on a byte series has no limit to compare to, so its threshold is empty", () => {
    const prefill = memoryAlert(metrics("container_memory_working_set"), options)!;

    expect(prefill.promqlCondition).toBeNull();
    expect(prefill.warnings.map((w) => w.key)).toContain("autoobserve.noBaseline");
  });

  it("escapes a PromQL label value", () => {
    const prefill = memoryAlert(
      { ...metrics("k8s_pod_memory_limit_utilization"), service: 'a"b\\c' },
      options,
    )!;

    expect(prefill.promql).toContain('k8s_deployment_name="a\\"b\\\\c"');
  });

  it("node alerts read the cluster, never the namespace", () => {
    const prefill = nodeAlert(metrics("k8s_node_memory_utilization"), options)!;

    expect(prefill.promql).toBe('max(k8s_node_memory_utilization{k8s_cluster="cluster-k"})');
  });

  it("restarts fire on three in ten minutes from Kubernetes events, by namespace and workload", () => {
    const prefill = restartAlert(
      logsScope({
        stream: { type: "logs", name: "k8s_events" },
        schema: [
          "k8s_cluster",
          "k8s_namespace_name",
          "body_object_reason",
          "body_object_regarding",
        ],
      }),
      options,
    )!;

    expect(prefill.sql).toBe(
      "SELECT count(*) AS restarts FROM \"k8s_events\" WHERE json_get_str(\"body_object_regarding\", 'name') LIKE 'svc-a-%' AND \"k8s_cluster\" = 'cluster-k' AND \"k8s_namespace_name\" = 'ns-b' AND \"body_object_reason\" IN ('BackOff', 'OOMKilling') HAVING count(*) >= 3",
    );
    expect(prefill.periodMinutes).toBe(10);
  });

  it("blocks memory on a series with no service or workload label, rather than watching every service", () => {
    const prefill = memoryAlert(
      {
        ...metrics("k8s_pod_memory_limit_utilization"),
        schema: ["k8s_cluster", "k8s_namespace_name"],
      },
      options,
    )!;
    const blocking = prefill.warnings.filter((w) => w.level === "blocking");

    expect(isPrefillBlocked(prefill)).toBe(true);
    expect(blocking.map((w) => w.key)).toEqual(["autoobserve.noServiceLabel"]);
    expect(textOf(blocking[0])).toBe(
      "k8s_pod_memory_limit_utilization has no service or workload label, so this alert cannot be scoped to svc-a.",
    );
  });

  it("blocks a node alert with no cluster to limit it to, rather than watching every cluster", () => {
    const series = metrics("k8s_node_memory_utilization");
    const unknown = nodeAlert({ ...series, cluster: null }, options)!;
    const unlabelled = nodeAlert({ ...series, schema: ["k8s_node_name"] }, options)!;

    for (const prefill of [unknown, unlabelled]) {
      const blocking = prefill.warnings.filter((w) => w.level === "blocking");
      expect(isPrefillBlocked(prefill)).toBe(true);
      expect(blocking.map((w) => w.key)).toEqual(["autoobserve.noCluster"]);
    }
    expect(textOf(unknown.warnings.find((w) => w.key === "autoobserve.noCluster")!)).toBe(
      "svc-a's cluster is not known for k8s_node_memory_utilization, so this node alert would watch every cluster.",
    );
  });

  it("blocks memory on a series that can't carry the service's cluster or namespace (F2)", () => {
    const noNamespace = memoryAlert(
      {
        ...metrics("k8s_pod_memory_limit_utilization"),
        schema: ["k8s_deployment_name", "k8s_cluster"],
      },
      options,
    )!;
    const noCluster = memoryAlert(
      {
        ...metrics("k8s_pod_memory_limit_utilization"),
        schema: ["k8s_deployment_name", "k8s_namespace_name"],
      },
      options,
    )!;
    expect(noNamespace.warnings.filter((w) => w.level === "blocking").map((w) => w.key)).toEqual([
      "autoobserve.noNamespaceField",
    ]);
    expect(noCluster.warnings.filter((w) => w.level === "blocking").map((w) => w.key)).toEqual([
      "autoobserve.noClusterField",
    ]);
  });

  it("blocks restarts on an events stream that can't carry the service's cluster or namespace (F2)", () => {
    const base = ["body_object_reason", "body_object_regarding"];
    const scope = (schema: string[]) =>
      logsScope({ stream: { type: "logs", name: "k8s_events" }, schema });
    const noNamespace = restartAlert(scope([...base, "k8s_cluster"]), options)!;
    const noCluster = restartAlert(scope([...base, "k8s_namespace_name"]), options)!;
    expect(isPrefillBlocked(noNamespace)).toBe(true);
    expect(noNamespace.warnings.map((w) => w.key)).toContain("autoobserve.noNamespaceField");
    expect(isPrefillBlocked(noCluster)).toBe(true);
    expect(noCluster.warnings.map((w) => w.key)).toContain("autoobserve.noClusterField");
  });

  it("leaves a memory or node alert that is scoped unblocked", () => {
    expect(
      isPrefillBlocked(memoryAlert(metrics("k8s_pod_memory_limit_utilization"), options)!),
    ).toBe(false);
    expect(isPrefillBlocked(nodeAlert(metrics("k8s_node_memory_utilization"), options)!)).toBe(
      false,
    );
  });
});

describe("restartAlert on each event layout", () => {
  const events = (schema: string[] | undefined) =>
    logsScope({ stream: { type: "logs", name: "k8s_events" }, schema });

  it("reads the flattened object name of a level-0 events stream", () => {
    const prefill = restartAlert(events(LEVEL0_COLUMNS), options)!;

    expect(isPrefillBlocked(prefill)).toBe(false);
    expect(prefill.sql).toBe(
      "SELECT count(*) AS restarts FROM \"k8s_events\" WHERE \"body_object_regarding_name\" LIKE 'svc-a-%' AND \"k8s_cluster\" = 'cluster-k' AND \"k8s_namespace_name\" = 'ns-b' AND \"body_object_reason\" IN ('BackOff', 'OOMKilling') HAVING count(*) >= 3",
    );
  });

  it("reads the object's name, not its whole JSON, on a level-3 stream", () => {
    const prefill = restartAlert(events(LEVEL3_COLUMNS), options)!;

    expect(prefill.sql).toContain(`json_get_str("body_object_regarding", 'name') LIKE 'svc-a-%'`);
  });

  it("reads either layout on a re-levelled stream", () => {
    const prefill = restartAlert(events(MIXED_3_0_COLUMNS), options)!;

    expect(prefill.sql).toContain(
      `COALESCE(json_get_str("body_object_regarding", 'name'), "body_object_regarding_name") LIKE 'svc-a-%'`,
    );
  });

  it("blocks when no field names the workload, rather than counting the whole namespace", () => {
    const prefill = restartAlert(
      events(["k8s_cluster", "k8s_namespace_name", "body_object_reason"]),
      options,
    )!;
    const blocking = prefill.warnings.filter((w) => w.level === "blocking");

    expect(isPrefillBlocked(prefill)).toBe(true);
    expect(blocking.map((w) => w.key)).toEqual(["autoobserve.noWorkload"]);
    expect(textOf(blocking[0])).toBe(
      "k8s_events has no field naming the workload, so this alert cannot count restarts for svc-a only.",
    );
  });
});

describe("field names", () => {
  it("quotes a field named like a SQL keyword, so the query still parses", () => {
    const prefill = sourceNoDataAlert(
      { stream: { type: "logs", name: "edge" }, field: "select", value: "v", cohortSize: 1 },
      options,
    )!;

    expect(prefill.sql).toBe(
      'SELECT count(*) AS row_count FROM "edge" WHERE "select" = \'v\' HAVING count(*) = 0',
    );
    expect(() => parser.astify(prefill.sql!)).not.toThrow();
  });

  it("every SQL check parses as DataFusion SQL", () => {
    const level = errorFieldOf("logs", logsScope().schema)!;
    const status = errorFieldOf("logs", ["status_code"])!;
    const sqls = [
      noDataAlert(logsScope(), options),
      errorsAlert(tracesScope(), { ...options, errorField: null, usualPerHour: 17 }),
      errorsAlert(logsScope(), { ...options, errorField: level, usualPerHour: 17 }),
      errorsAlert(logsScope(), { ...options, errorField: status, usualPerHour: 17 }),
      latencyAlert(tracesScope(), { ...options, durationField: "duration", p95Ms: 420 }),
      latencyAlert(logsScope(), { ...options, durationField: "end", p95Ms: 420 }),
      ...[LEVEL0_COLUMNS, LEVEL3_COLUMNS, MIXED_3_0_COLUMNS].map((schema) =>
        restartAlert(logsScope({ stream: { type: "logs", name: "k8s_events" }, schema }), options),
      ),
    ].map((p) => p!.sql!);

    for (const sql of sqls) expect(() => parser.astify(sql), sql).not.toThrow();
  });
});

describe("every builder on an OSS build", () => {
  it("returns null", () => {
    config.isEnterprise = "false";
    const o = { ...options };

    expect(noDataAlert(logsScope(), o)).toBeNull();
    expect(errorsAlert(tracesScope(), { ...o, errorField: null, usualPerHour: 17 })).toBeNull();
    expect(latencyAlert(tracesScope(), { ...o, durationField: "duration", p95Ms: 420 })).toBeNull();
    expect(memoryAlert(logsScope(), o)).toBeNull();
    expect(restartAlert(logsScope(), o)).toBeNull();
    expect(nodeAlert(logsScope(), o)).toBeNull();
    expect(
      sourceNoDataAlert(
        {
          stream: { type: "logs", name: "k8s_events" },
          field: "k8s_cluster",
          value: "cluster-d",
          cohortSize: 7,
        },
        o,
      ),
    ).toBeNull();
  });
});

describe("the Playwright fixture", () => {
  it("is exactly what noDataAlert builds for svc-ingest-b", () => {
    const file = resolve(
      __dirname,
      "../../../../../tests/ui-testing/playwright-tests/AutoObserve/fixtures/autoobserve-no-data-prefill.json",
    );
    const fixture = JSON.parse(readFileSync(file, "utf8"));
    const built = normalizePrefill(
      noDataAlert(
        {
          service: "svc-ingest-b",
          cluster: null,
          namespace: null,
          stream: { type: "logs", name: "ingest_b" },
          schema: ["_timestamp", "service_name"],
        },
        options,
      )!,
    );

    expect(JSON.parse(JSON.stringify(built))).toEqual(fixture);
  });
});
