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
import type { CoverageRow } from "./aoTypes";
import {
  chooseCoverageGrouping,
  groupCoverage,
  isGroup,
  chooseMapGrouping,
  mapCoverage,
  sortCoverage,
  type CoverageTableRow,
} from "./coverageTable";

const svc = (service: string, state: string, traffic: number | null, name = service) =>
  ({ service, traffic, status: { state }, identity: { serviceName: name } }) as CoverageRow;
const names = (rows: CoverageTableRow[]) =>
  rows.map((r) => (isGroup(r) ? `${r.title}[${r.children.map((c) => c.service)}]` : r.service));
const byName = (r: CoverageRow) => r.identity!.serviceName;

describe("sortCoverage by traffic", () => {
  it("puts gaps first, busiest first inside a state, unknown traffic last in both directions", () => {
    const rows = [
      svc("quiet", "gap", 1),
      svc("unknown", "gap", null),
      svc("busy-partial", "partial", 900),
      svc("busy", "gap", 50),
    ];
    expect(names(sortCoverage(rows, "traffic", "desc"))).toEqual([
      "busy",
      "quiet",
      "unknown",
      "busy-partial",
    ]);
    expect(names(sortCoverage(rows, "traffic", "asc"))).toEqual([
      "quiet",
      "busy",
      "unknown",
      "busy-partial",
    ]);
  });
});

describe("groupCoverage (0, 1, many)", () => {
  it.each([
    ["no rows", [], []],
    ["a name held once stays a plain row", [svc("api", "gap", 1)], ["api"]],
    [
      "a name in many places folds into one group with counts",
      [svc("nats·a", "gap", 2, "nats"), svc("api", "gap", 1), svc("nats·b", "watched", 3, "nats")],
      ["nats[nats·a,nats·b]", "api"],
    ],
  ])("%s", (_case, rows, expected) => {
    expect(names(groupCoverage(rows as CoverageRow[], byName))).toEqual(expected);
  });

  it("visits each row a fixed number of times, so twice the fleet is twice the work", () => {
    const original = Array.prototype[Symbol.iterator];
    const work = (n: number) => {
      let visited = 0;
      // Names that take every group prefix in turn would make a per-prefix scan quadratic.
      const rows = Array.from({ length: n }, (_, i) => {
        const row = svc(`group${i || ""}:s${i}`, "gap", 1, `p${i % 2}`);
        const service = row.service;
        return Object.defineProperty(row, "service", { get: () => (visited++, service) });
      });
      Array.prototype[Symbol.iterator] = function* (this: unknown[]) {
        for (let i = 0; i < this.length; i++, visited++) yield this[i];
      };
      try {
        groupCoverage(rows, byName);
      } finally {
        Array.prototype[Symbol.iterator] = original;
      }
      return visited;
    };
    expect(work(10_000) / work(5_000)).toBeLessThan(2.5);
  });

  it.each([
    [
      "a real service",
      [
        ["api·a", "api"],
        ["api·b", "api"],
        ["group:api", "group:api"],
      ],
    ],
    [
      "another group",
      [
        ["api·a", "api"],
        ["api·b", "api"],
        ["gapi·a", "group:api"],
        ["gapi·b", "group:api"],
        ["group:api", "solo"],
      ],
    ],
  ])("never gives a group the key of %s", (_case, rows) => {
    const keys = groupCoverage(
      rows.map(([service, name]) => svc(service, "gap", 1, name)),
      byName,
    ).map((r) => r.service);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("counts states, sums known traffic and sorts children by the same order", () => {
    const [group] = sortCoverage(
      groupCoverage(
        [svc("n·a", "watched", 3, "n"), svc("n·b", "gap", null, "n"), svc("n·c", "gap", 2, "n")],
        byName,
      ),
      "traffic",
      "desc",
    );
    if (!isGroup(group)) throw new Error("expected a group");
    expect(group.counts).toEqual({ gap: 2, partial: 0, learning: 0, watched: 1 });
    expect(group.traffic).toBe(5);
    expect(group.children.map((c) => c.service)).toEqual(["n·c", "n·b", "n·a"]);
  });
});

describe("chooseMapGrouping and mapCoverage", () => {
  const place = (r: CoverageRow) => r.service.split("·")[0];
  it.each([
    ["at the cap, one hex per service", 3, false, 3, 0],
    ["past the cap, one hex per place", 6, false, 3, 0],
    ["past the cap in places too, the first places and a count", 10, false, 3, 2],
    ["grouped, one hex per group under the cap", 2, true, 1, 0],
  ])("%s", (_case, count, grouped, hexes, more) => {
    const rows = Array.from({ length: count }, (_, i) =>
      svc(`${count > 6 ? `p${i % 5}` : `p${i % 3}`}·${i}`, "gap", i),
    );
    const by = chooseMapGrouping(rows, 3, grouped ? "service" : null, () => "one", place);
    const fold = (keyOf: (r: CoverageRow) => string) => ({ keyOf, titleOf: keyOf });
    const map = mapCoverage(
      rows,
      3,
      by === "service" ? fold(() => "one") : by === "none" ? null : fold(place),
    );
    expect(map.items).toHaveLength(hexes);
    expect(map.more).toBe(more);
  });
});

describe("chooseCoverageGrouping", () => {
  // `n` names, each in `places` places; place k holds the k-th copy of every name, or `unique` new names.
  const fleet = (n: number, places: number, unique = false) =>
    Array.from({ length: n * places }, (_, i) => {
      const name = unique ? `n${i}` : `n${i % n}`;
      const r = svc(`${name}·p${Math.floor(i / n)}`, "gap", 1, name);
      return { ...r, where: `p${Math.floor(i / n)}` } as CoverageRow;
    });
  const place = (r: CoverageRow) => String(r.where);
  it.each([
    ["no rows", 0, 1, "none"],
    ["a few rows stay flat", 10, 3, "none"],
    ["names repeat across places", 20, 3, "service"],
    ["every name in one place stays flat", 40, 1, "none"],
    ["many names but few places", 60, 2, "namespace"],
    ["many unique names in few places", 40, 2, "namespace", true],
    ["many unique names, each in its own place", 1, 60, "none", true],
  ])("%s", (_case, n, places, expected, unique = false) => {
    expect(chooseCoverageGrouping(fleet(n, places, unique), byName, place)).toBe(expected);
  });

  it("keeps names when places cut the lines by too little: 130 names over 114 places", () => {
    // Each name sits in its own place, then 16 names repeat in a second place shared with another.
    const rows = Array.from({ length: 146 }, (_, i) => {
      const name = `n${i % 130}`;
      return { ...svc(`${name}·${i}`, "gap", 1, name), where: `p${i % 114}` } as CoverageRow;
    });
    expect(new Set(rows.map(place)).size).toBe(114);
    expect(chooseCoverageGrouping(rows, byName, place)).toBe("service");
  });
});
