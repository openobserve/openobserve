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

import { alertRow, anomalyRow, incidentRow, serviceRow } from "./homeFixtures";
import { briefingCounts, groupNowRows, incidentService, splitNowRows } from "./nowGrouping";

const noService = () => null;

describe("groupNowRows", () => {
  it("keeps a service's rows together, the most urgent service first", () => {
    const rows = [
      serviceRow("cart", { bucket: "degraded" }),
      alertRow("a1", { bucket: "critical" }),
      incidentRow("i1", { bucket: "recovered" }),
      serviceRow("checkout", { bucket: "critical" }),
    ];
    const serviceOf = (id: string) => (id === "i1" ? "cart" : null);
    const keys = groupNowRows(rows, serviceOf).map((item) => item.row.key);
    expect(keys).toEqual(["alert:a1", "service:checkout", "service:cart", "incident:i1"]);
  });

  it("collapses a flapping alert to one row and counts its fires", () => {
    const rows = [
      alertRow("a1", { name: "orders-db p95", state: "recovered", bucket: "recovered", count: 4 }),
      alertRow("a2", { name: "orders-db p95", state: "firing", bucket: "degraded", count: 1 }),
    ];
    const grouped = groupNowRows(rows, noService);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ repeats: 2, flapping: true });
  });

  it("marks an alert that fired twice and recovered as flapping, and one fire as not", () => {
    const flapping = groupNowRows(
      [alertRow("a1", { state: "recovered", bucket: "recovered", count: 2 })],
      noService,
    );
    const steady = groupNowRows([alertRow("a2", { state: "firing", count: 1 })], noService);
    expect(flapping[0].flapping).toBe(true);
    expect(steady[0].flapping).toBe(false);
  });

  it("names an incident's service from its dimensions", () => {
    expect(incidentService({ group_values: { service_name: "checkout" } } as any)).toBe("checkout");
    expect(incidentService({ group_values: { host: "ip-1" } } as any)).toBeNull();
  });
});

describe("splitNowRows and briefingCounts", () => {
  it("moves open services no alert matches to Problems and counts the rows Now draws", () => {
    const grouped = groupNowRows(
      [
        serviceRow("checkout", { coverage: "none" }),
        serviceRow("cart", { coverage: "covered" }),
        incidentRow("i1"),
        serviceRow("search", { coverage: "none", bucket: "recovered" }),
        anomalyRow("x1"),
      ],
      (id) => (id === "i1" ? "cart" : null),
    );
    const split = splitNowRows(grouped);
    expect(split.problems.map((item) => item.row.key)).toEqual(["service:checkout"]);
    expect(split.now.map((item) => item.row.key)).not.toContain("service:checkout");
    expect(briefingCounts(split)).toEqual({ needYou: 3, noAlert: 1 });
  });

  it("counts one headline item per drawn row, even two rows of one service", () => {
    const grouped = groupNowRows(
      [serviceRow("cart", { coverage: "covered" }), incidentRow("i1"), incidentRow("i2")],
      () => "cart",
    );
    const split = splitNowRows(grouped);
    expect(split.now).toHaveLength(3);
    expect(briefingCounts(split)).toEqual({ needYou: 3, noAlert: 0 });
  });

  it("on a phone keeps services no alert matches in Now and still names them", () => {
    const grouped = groupNowRows(
      [serviceRow("checkout", { coverage: "none" }), alertRow("hot", { state: "firing" })],
      noService,
    );
    expect(briefingCounts({ now: grouped, problems: [] })).toEqual({ needYou: 2, noAlert: 1 });
  });

  it("keeps recovered rows out of Now unless they flap, and counts exactly the rows shown", () => {
    const grouped = groupNowRows(
      [
        alertRow("calm", { state: "recovered", bucket: "recovered", count: 1 }),
        alertRow("flap", { state: "recovered", bucket: "recovered", count: 3 }),
        incidentRow("old", { bucket: "recovered" }),
        alertRow("hot", { state: "firing" }),
      ],
      noService,
    );
    const split = splitNowRows(grouped);
    expect(split.now.map((item) => item.row.key)).toEqual(["alert:hot", "alert:flap"]);
    expect(briefingCounts(split).needYou).toBe(split.now.length);
  });

  it("reads nothing to do on an empty list", () => {
    expect(briefingCounts(splitNowRows([]))).toEqual({ needYou: 0, noAlert: 0 });
  });
});
