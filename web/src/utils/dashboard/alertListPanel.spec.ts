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
import { ALERT_LIST_DEFAULT_MAX, alertListState, buildAlertListRows } from "./alertListPanel";

const alert = (overrides: Record<string, any>) => ({
  alert_id: overrides.name,
  folder_id: "default",
  folder_name: "default",
  enabled: true,
  last_outcome: "succeeded",
  last_satisfied_at: null,
  ...overrides,
});

const alerts = [
  alert({ name: "disk full", last_outcome: "firing", last_satisfied_at: 1793057797456037 }),
  alert({
    name: "api errors",
    last_outcome: "error",
    folder_id: "payments",
    folder_name: "Payments",
  }),
  alert({ name: "cpu high", enabled: false, last_outcome: "firing", last_satisfied_at: 2e15 }),
  alert({ name: "new alert", last_outcome: null }),
  alert({ name: "latency", last_outcome: "pending", last_satisfied_at: 1793057797000000 }),
  alert({ name: "backlog", last_outcome: "conditionnotsatisfied" }),
];

describe("alertListState", () => {
  it("reads a paused alert as paused, never as its stale outcome", () => {
    expect(alertListState(alerts[2])).toBe("paused");
  });

  it("buckets outcomes and marks a never-evaluated alert unknown", () => {
    expect(alerts.map(alertListState)).toEqual([
      "firing",
      "error",
      "paused",
      "unknown",
      "pending",
      "ok",
    ]);
  });
});

describe("buildAlertListRows", () => {
  it("sorts by state with no config: firing first, paused last", () => {
    expect(buildAlertListRows(alerts, {}).map((row) => row.name)).toEqual([
      "disk full",
      "api errors",
      "latency",
      "backlog",
      "new alert",
      "cpu high",
    ]);
  });

  it("keeps the last evaluation and the last firing apart, as the Alerts page does", () => {
    const evaluated = alert({ name: "quiet", last_triggered_at: 1793057797456037 });
    const [row] = buildAlertListRows([evaluated], {});
    expect(row.lastTriggeredAt).toBe(1793057797456037);
    expect(row.lastSatisfiedAt).toBeNull();
  });

  it("carries the fields the Alerts page cells read", () => {
    const [row] = buildAlertListRows(
      [
        alert({
          name: "checkout",
          priority: 2,
          owner: "sre@example.com",
          ack: { acked_by: "sam" },
          last_outcome_at: 1793057797000000,
          is_real_time: true,
        }),
      ],
      {},
    );
    expect(row).toMatchObject({
      priority: 2,
      owner: "sre@example.com",
      ack: { acked_by: "sam" },
      lastOutcomeAt: 1793057797000000,
      alertType: "Real Time",
      isSlo: false,
    });
    const [composite] = buildAlertListRows(
      [
        alert({
          name: "combo",
          alert_type: "composite",
          child_count: 3,
          expression_summary: "a AND b",
        }),
      ],
      {},
    );
    expect(composite).toMatchObject({
      alertType: "Composite",
      childCount: 3,
      expression: "a AND b",
    });
  });

  it("sorts by name and by when it last fired, never-fired last", () => {
    expect(buildAlertListRows(alerts, { alert_list_sort: "name" })[0].name).toBe("api errors");
    expect(
      buildAlertListRows(alerts, { alert_list_sort: "time" })
        .map((row) => row.name)
        .slice(0, 3),
    ).toEqual(["cpu high", "disk full", "latency"]);
  });

  it("filters by state and folder", () => {
    expect(
      buildAlertListRows(alerts, { alert_list_state: ["firing", "paused"] }).map((r) => r.name),
    ).toEqual(["disk full", "cpu high"]);
    expect(buildAlertListRows(alerts, { alert_list_folder: "payments" })).toMatchObject([
      { name: "api errors", folderName: "Payments" },
    ]);
  });

  it("caps the rows at alert_list_max, defaulting to 20 and clamping bad values", () => {
    const many = Array.from({ length: 30 }, (_, i) => alert({ name: `a${i}` }));
    expect(buildAlertListRows(many, {})).toHaveLength(ALERT_LIST_DEFAULT_MAX);
    expect(buildAlertListRows(many, { alert_list_max: 3 })).toHaveLength(3);
    expect(buildAlertListRows(many, { alert_list_max: 0 })).toHaveLength(ALERT_LIST_DEFAULT_MAX);
  });

  it("drops rows without an id and tolerates a missing list", () => {
    expect(buildAlertListRows([{ name: "x" }], {})).toEqual([]);
    expect(buildAlertListRows(undefined as any, {})).toEqual([]);
  });
});
