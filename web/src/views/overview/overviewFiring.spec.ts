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
  alertsByName,
  firingByLevel,
  firingLevel,
  firingForLabel,
  firingNow,
  undeliveredCount,
  type HomeAlertRow,
} from "./overviewFiring";

const NOW_MS = 1_800_000_000_000;
const minutesAgo = (minutes: number) => (NOW_MS - minutes * 60_000) * 1000;
const ack = (groups_acked = 1) => ({
  acked_by: "p",
  acked_at: 1,
  ack_source: "ui" as const,
  groups_acked,
});

const row = (over: Partial<HomeAlertRow>): HomeAlertRow => ({
  alert_id: over.name ?? "a",
  folder_id: "default",
  folder_name: "default",
  name: "a",
  alert_type: "scheduled",
  enabled: true,
  last_outcome: "firing",
  ...over,
});

describe("firingNow", () => {
  it("keeps what the Firing view lists, most severe level first", () => {
    const rows = firingNow([
      row({ name: "w", level: "warning" }),
      row({ name: "ok", last_outcome: "normal" }),
      row({ name: "off", enabled: false }),
      row({ name: "c", level: "CRITICAL" }),
      row({ name: "x", level: null }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["c", "w", "x"]);
  });
});

describe("firingByLevel", () => {
  it("counts critical, warning and the rest", () => {
    const rows = [row({ level: "critical" }), row({ level: "critical" }), row({ level: "ok" })];
    expect(firingByLevel(rows)).toEqual({ critical: 2, warning: 0, other: 1 });
    expect(firingLevel(row({}))).toBe("other");
  });
});

describe("alertsByName", () => {
  it("maps a unique name to its alert and drops a name two folders share", () => {
    const map = alertsByName([
      row({ alert_id: "1", name: "solo" }),
      row({ alert_id: "2", name: "twin", folder_id: "a" }),
      row({ alert_id: "3", name: "twin", folder_id: "b" }),
    ]);
    expect(map.get("solo")?.alert_id).toBe("1");
    expect(map.has("twin")).toBe(false);
  });
});

describe("firingNow triage", () => {
  it("drops acked and muted firings but keeps a partly acked multi-alert", () => {
    const rows = firingNow([
      row({ name: "acked", ack: ack() }),
      row({ name: "muted", active_downtime: { id: "d" } as HomeAlertRow["active_downtime"] }),
      row({ name: "partly", ack: ack(1), groups_firing: 3 }),
      row({ name: "floor", ack: ack(3), groups_firing: 3, groups_firing_is_lower_bound: true }),
      row({ name: "open", last_outcome: "error", firing_started_at: 10 }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["open", "floor", "partly"]);
  });

  it("ranks within a level by undelivered, then priority, then the earliest firing", () => {
    const rows = firingNow([
      row({ name: "late", priority: 1, firing_started_at: 30 }),
      row({ name: "unset", firing_started_at: 1 }),
      row({ name: "early", priority: 1, firing_started_at: 20 }),
      row({ name: "undelivered", last_outcome: "notify_failed", priority: 5 }),
      row({ name: "p2", priority: 2, firing_started_at: 1 }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["undelivered", "early", "late", "p2", "unset"]);
  });
});

describe("undeliveredCount", () => {
  it("counts live alerts whose notification failed", () => {
    expect(
      undeliveredCount([
        row({ last_outcome: "notify_failed" }),
        row({ last_outcome: "notify_failed", ack: ack() }),
        row({ last_outcome: "notify_failed", enabled: false }),
        row({ last_outcome: "firing" }),
      ]),
    ).toBe(2);
  });
});

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
