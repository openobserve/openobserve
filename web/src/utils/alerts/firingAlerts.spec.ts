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
  canAcknowledge,
  durationLabel,
  filterRows,
  firingForLabel,
  isFiringNow,
  stateTag,
  type FiringRow,
} from "./firingAlerts";

const NOW_MS = 1_800_000_000_000;
const minutesAgo = (minutes: number) => (NOW_MS - minutes * 60_000) * 1000;

const ack = (groups_acked = 1) => ({
  acked_by: "p",
  acked_at: 1,
  ack_source: "ui" as const,
  groups_acked,
});

const row = (over: Partial<FiringRow>): FiringRow => ({
  alert_id: "a",
  folder_id: "f",
  folder_name: "payments",
  name: "checkout_5xx_rate",
  alert_type: "scheduled",
  ...over,
});

const NO_FILTERS = { search: "", priority: "all", folder: "all" };

describe("firingForLabel", () => {
  it("uses an em dash when the alert has no start time", () => {
    expect(firingForLabel(undefined, NOW_MS)).toBe("—");
  });

  it.each([
    [0, "<1m"],
    [42, "42m"],
    [65, "1h 05m"],
    [130, "2h 10m"],
    [28 * 60, "1d 4h"],
  ])("formats %i minutes as %s", (minutes, label) => {
    expect(firingForLabel(minutesAgo(minutes), NOW_MS)).toBe(label);
  });
});

describe("stateTag", () => {
  it("follows the chip, so an acked row with a failed delivery reads per view", () => {
    const failedAndAcked = row({ last_outcome: "notify_failed", ack: ack() });
    expect(stateTag(failedAndAcked, "acked")).toBe("acknowledged");
    expect(stateTag(failedAndAcked, "failed")).toBe("notify_failed");
  });

  it("marks not delivered rows inside Firing and plain firing otherwise", () => {
    expect(stateTag(row({ last_outcome: "notify_failed" }), "firing")).toBe("notify_failed");
    expect(stateTag(row({ last_outcome: "error" }), "firing")).toBe("firing");
  });

  it("names muted and recovered views", () => {
    expect(stateTag(row({}), "muted")).toBe("muted");
    expect(stateTag(row({}), "recovered")).toBe("normal");
  });
});

describe("canAcknowledge", () => {
  it("refuses an anomaly row, which has no ack route", () => {
    expect(canAcknowledge(row({ alert_type: "anomaly_detection" }))).toBe(false);
  });

  it("refuses an acked single alert", () => {
    expect(canAcknowledge(row({ ack: ack() }))).toBe(false);
  });

  it("offers a partly acked multi-alert", () => {
    const multi = row({
      condition: { aggregation: { multi_alert: true } },
      groups_firing: 3,
      ack: ack(),
    });
    expect(canAcknowledge(multi)).toBe(true);
  });

  it.each([
    { groups_firing: 2, lower: true, ackable: true },
    { groups_firing: 2, lower: false, ackable: false },
    { groups_firing: undefined, lower: true, ackable: false },
  ])("reads $groups_firing firing, lower bound $lower", ({ groups_firing, lower, ackable }) => {
    const multi = row({
      condition: { aggregation: { multi_alert: true } },
      groups_firing,
      groups_firing_is_lower_bound: lower,
      ack: ack(2),
    });
    expect(canAcknowledge(multi)).toBe(ackable);
  });
});

describe("filterRows", () => {
  const rows = [
    row({ alert_id: "1", name: "disk_80pct", priority: 4, stream_name: "node_logs" }),
    row({ alert_id: "2", name: "cert_expiry", folder_name: "security" }),
    row({ alert_id: "3", name: "old", firing_started_at: minutesAgo(25 * 60) }),
    row({ alert_id: "4", name: "fresh", firing_started_at: minutesAgo(10) }),
  ];
  const ids = (filters: Partial<typeof NO_FILTERS>) =>
    filterRows(rows, { ...NO_FILTERS, ...filters }).map((r) => r.alert_id);

  it("keeps the server order when nothing is set", () => {
    expect(ids({})).toEqual(["1", "2", "3", "4"]);
  });

  it("searches name and stream, ignoring case", () => {
    expect(ids({ search: "DISK" })).toEqual(["1"]);
    expect(ids({ search: "node_" })).toEqual(["1"]);
  });

  it("filters by priority, including unset", () => {
    expect(ids({ priority: "4" })).toEqual(["1"]);
    expect(ids({ priority: "unset" })).toEqual(["2", "3", "4"]);
  });

  it("filters by folder", () => {
    expect(ids({ folder: "security" })).toEqual(["2"]);
  });
});

describe("durationLabel", () => {
  it("shares the Firing for format", () => {
    expect(durationLabel(30_000)).toBe("<1m");
    expect(durationLabel(65 * 60_000)).toBe("1h 05m");
    expect(durationLabel(28 * 3_600_000)).toBe("1d 4h");
  });
});

describe("isFiringNow", () => {
  it.each([
    [{ last_outcome: "firing" }, true],
    [{ last_outcome: "notify_failed" }, true],
    [{ last_outcome: "normal", firing_started_at: 5 }, true],
    [{ last_outcome: "error", groups_firing: 2 }, true],
    [{ last_outcome: "error" }, false],
    [{ last_outcome: "normal" }, false],
  ])("reads %j", (over, expected) => {
    expect(isFiringNow(row(over))).toBe(expected);
  });
});
