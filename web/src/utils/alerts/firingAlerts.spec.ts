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
import { ackCanChange, alertRailState, isFiringNow, type FiringRow } from "./firingAlerts";

const row = (over: Partial<FiringRow>): FiringRow => ({
  alert_id: "a",
  folder_id: "f",
  folder_name: "payments",
  name: "checkout_5xx_rate",
  alert_type: "scheduled",
  ...over,
});

describe("isFiringNow", () => {
  it.each([
    [{ last_outcome: "firing" }, true],
    [{ last_outcome: "notify_failed" }, true],
    [{ last_outcome: "normal", firing_started_at: 5 }, true],
    [{ last_outcome: "error", groups_firing: 2 }, true],
    [{ last_outcome: "error" }, false],
    [{ last_outcome: "normal" }, false],
    [{ last_outcome: "firing", enabled: false, firing_started_at: 5 }, false],
    [{ last_outcome: "firing", enabled: true }, true],
  ])("reads %j", (over, expected) => {
    expect(isFiringNow(row(over))).toBe(expected);
  });
});

describe("ackCanChange", () => {
  const ack = {
    acked_by: "a@example.com",
    acked_at: 1,
    ack_source: "ui" as const,
    groups_acked: 2,
  };
  it.each([
    [{}, true],
    [{ ack }, false],
    [{ ack, multi_alert: true, groups_firing: 3 }, true],
    [{ ack, multi_alert: true, groups_firing: 2 }, false],
    [{ ack, multi_alert: true, groups_firing: 2, groups_firing_is_lower_bound: true }, true],
    [{ ack, multi_alert: true }, false],
  ])("reads %j", (row, expected) => {
    expect(ackCanChange(row)).toBe(expected);
  });
});

describe("alertRailState", () => {
  const ack = { acked_by: "a@example.com", acked_at: 1, ack_source: "ui" as const };
  it.each([
    ["failed", { is_real_time: "anomaly", status: "failed", enabled: true }, "failed"],
    ["firing", { enabled: true, last_outcome: "firing" }, "firing"],
    ["fully acknowledged", { enabled: true, last_outcome: "firing", ack }, "acknowledged"],
    [
      "partly acknowledged",
      {
        enabled: true,
        last_outcome: "firing",
        multi_alert: true,
        groups_firing: 2,
        ack: { ...ack, groups_acked: 1 },
      },
      "firing",
    ],
    [
      "lower-bound acknowledged",
      {
        enabled: true,
        last_outcome: "firing",
        multi_alert: true,
        groups_firing: 2,
        groups_firing_is_lower_bound: true,
        ack: { ...ack, groups_acked: 2 },
      },
      "firing",
    ],
    ["paused", { enabled: false, last_outcome: "firing" }, "paused"],
    ["quiet", { enabled: true, last_outcome: "ok" }, "active"],
    [
      "status-unknown",
      { enabled: true, last_outcome: "firing", status_unavailable: true },
      "active",
    ],
  ] as const)("reads a %s alert", (_state, over, expected) => {
    expect(alertRailState(over, false)).toBe(expected);
    // A list-wide unknown run state hides every firing the same way.
    expect(alertRailState({ ...over, status_unavailable: false }, true)).toBe(
      expected === "failed" || expected === "paused" ? expected : "active",
    );
  });
});
