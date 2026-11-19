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
  alertThreshold,
  installedThresholdDiffers,
  lookAlikeAlerts,
  type LookAlikeAlert,
} from "./lookAlike";

const where = (...conditions: Record<string, unknown>[]) => ({
  type: "custom",
  conditions: { version: 2, conditions: { filterType: "group", conditions } },
});
const eq = (column: string, value: unknown, operator = "=") => ({
  filterType: "condition",
  column,
  operator,
  value,
});

// Shapes taken from the LOCAL list API (`GET /api/v2/{org}/alerts`).
const rows: LookAlikeAlert[] = [
  {
    alert_id: "oom",
    name: "k8s_oomkilled_or_killing",
    stream_type: "logs",
    stream_name: "k8s_events",
    condition: where(eq("body_object_reason", ["Killing", "OOMKilled"], "in")),
  },
  {
    alert_id: "errors",
    name: "errors_over_50",
    stream_type: "logs",
    stream_name: "otel_demo",
    condition: where(eq("severity", "ERROR")),
  },
  {
    alert_id: "errors-sql",
    name: "errors_2x_last_week",
    stream_type: "logs",
    stream_name: "otel_demo",
    condition: { type: "sql", sql: `SELECT count(*) FROM "otel_demo" WHERE "severity" = 'ERROR'` },
  },
  {
    alert_id: "cpu",
    name: "cpu_usage_above_90",
    stream_type: "metrics",
    stream_name: "node_cpu_seconds_total",
    condition: {
      type: "promql",
      promql: '1 - avg without (cpu) (rate(node_cpu_seconds_total{mode="idle"}[5m]))',
      promql_condition: { operator: ">", value: 0.9 },
    },
  },
  {
    alert_id: "p95",
    name: "p95_latency",
    stream_type: "traces",
    stream_name: "default",
    condition: {
      type: "custom",
      aggregation: { function: "p95", having: { column: "duration", operator: ">", value: 500 } },
    },
  },
];

const ids = (draft: Parameters<typeof lookAlikeAlerts>[0], selfId?: string) =>
  lookAlikeAlerts(draft, rows, selfId).map((r) => r.alert_id);

describe("lookAlikeAlerts", () => {
  it.each([
    [
      "a shared filter value, whatever the operator",
      { stream_type: "logs", stream_name: "k8s_events" },
      where(eq("body_object_reason", ["OOMKilled", "OOMKilling"], "in")),
      ["oom"],
    ],
    [
      "builder and SQL alerts on the same equality",
      { stream_type: "logs", stream_name: "OTEL_DEMO" },
      where(eq("severity", "error")),
      ["errors", "errors-sql"],
    ],
    [
      "a PromQL matcher",
      { stream_type: "metrics", stream_name: "node_cpu_seconds_total" },
      {
        type: "promql",
        promql: '100 * (1 - avg by (node) (rate(node_cpu_seconds_total{mode="idle"}[5m])))',
      },
      ["cpu"],
    ],
    [
      "the same aggregate of the same field",
      { stream_type: "traces", stream_name: "default" },
      { type: "custom", aggregation: { function: "p95", having: { column: "duration" } } },
      ["p95"],
    ],
    [
      "nothing for another value on the same stream",
      { stream_type: "logs", stream_name: "otel_demo" },
      where(eq("severity", "WARN")),
      [],
    ],
    [
      "nothing for the same value on another stream",
      { stream_type: "logs", stream_name: "app_logs" },
      where(eq("severity", "ERROR")),
      [],
    ],
    [
      "nothing before a condition is written",
      { stream_type: "logs", stream_name: "otel_demo" },
      where(),
      [],
    ],
  ])("matches %s", (_, stream, condition, expected) => {
    expect(ids({ ...stream, condition })).toEqual(expected);
  });

  it("leaves out the alert being edited", () => {
    expect(
      ids(
        {
          stream_type: "logs",
          stream_name: "otel_demo",
          condition: where(eq("severity", "ERROR")),
        },
        "errors",
      ),
    ).toEqual(["errors-sql"]);
  });
});

describe("alertThreshold", () => {
  it.each([
    ["a PromQL comparison", rows[3].condition, undefined, { operator: ">", value: 0.9 }],
    ["an aggregate's having", rows[4].condition, undefined, { operator: ">", value: 500 }],
    [
      "the trigger count",
      where(),
      { operator: ">=", threshold: 50 },
      { operator: ">=", value: 50 },
    ],
  ])("reads %s", (_, condition, trigger, expected) => {
    expect(alertThreshold(condition, trigger)).toEqual(expected);
  });
});

describe("installedThresholdDiffers", () => {
  const card = {
    query_condition: { type: "promql", promql_condition: { operator: ">", value: 0.8 } },
  };
  it.each([
    [
      "a copy at another value",
      { operator: ">", value: 0.9 },
      { installed: { operator: ">", value: 0.9 }, suggested: { operator: ">", value: 0.8 } },
    ],
    ["a copy at the card's value", { operator: ">", value: 0.8 }, null],
    ["a copy whose comparison is unknown", null, null],
  ])("answers %s", (_, promqlCondition, expected) => {
    const row = { condition: { type: "promql", promql_condition: promqlCondition } };
    expect(installedThresholdDiffers(card, row)).toEqual(expected);
  });
});
