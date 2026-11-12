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

import type { Incident } from "@/services/incidents";
import type { ServicesTrendResponse } from "@/services/service_graph";

import { alertRow, anomalyRow, serviceRow } from "./homeFixtures";
import { healthState, type HealthInput } from "./homeHealth";

const incident = (id: string, status = "open") => ({ id, status, severity: "P3" }) as Incident;

const trend = (total: number, degraded: number) =>
  ({ total_services: total, degraded_total: degraded }) as ServicesTrendResponse;

const input = (over: Partial<HealthInput> = {}): HealthInput => ({
  incidents: { open: [], acknowledged: [] },
  trend: null,
  topology: null,
  rows: [],
  alertList: [],
  failed: false,
  denied: false,
  ...over,
});

describe("healthState", () => {
  it("is nothingMonitored, never allClear, for an org with no services, incidents or alerts", () => {
    expect(healthState(input())).toBe("nothingMonitored");
    expect(healthState(input({ trend: trend(0, 0), incidents: null, alertList: null }))).toBe(
      "nothingMonitored",
    );
  });

  it("is allClear once something is watched and nothing is open", () => {
    expect(healthState(input({ trend: trend(40, 0) }))).toBe("allClear");
    expect(healthState(input({ topology: { nodes: [{ id: "svc-a" }], edges: [] } }))).toBe("allClear");
    expect(healthState(input({ alertList: [{ id: "a" } as never] }))).toBe("allClear");
  });

  it("is null while a service is degraded, an incident is open or any row is open", () => {
    expect(healthState(input({ trend: trend(40, 2) }))).toBeNull();
    expect(healthState(input({ incidents: { open: [incident("i")], acknowledged: [] } }))).toBeNull();
    expect(healthState(input({ incidents: { open: [], acknowledged: [incident("i", "acknowledged")] } }))).toBeNull();
    expect(healthState(input({ rows: [alertRow("a")] }))).toBeNull();
    expect(healthState(input({ rows: [anomalyRow("an")] }))).toBeNull();
    expect(healthState(input({ rows: [serviceRow("svc-a")] }))).toBeNull();
  });

  it("ignores recovered rows", () => {
    expect(
      healthState(input({ trend: trend(3, 0), rows: [alertRow("a", { state: "recovered", bucket: "recovered" })] })),
    ).toBe("allClear");
  });

  it("is failed when a source failed, even with nothing open, and null when one was denied", () => {
    expect(healthState(input({ trend: trend(3, 0), failed: true }))).toBe("failed");
    expect(healthState(input({ trend: trend(3, 0), denied: true }))).toBeNull();
  });
});
