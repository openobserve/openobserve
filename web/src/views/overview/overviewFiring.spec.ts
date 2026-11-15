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
  firingNow,
  type HomeAlertRow,
} from "./overviewFiring";

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
