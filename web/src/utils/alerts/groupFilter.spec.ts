// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";
import type { AlertGroup } from "@/ts/interfaces/alert";
import {
  groupLabelNames,
  groupLabelValues,
  matchesGroupFilter,
  type GroupFilterCondition,
} from "./groupFilter";

const group = (key: string, labels: Record<string, string>): AlertGroup => ({
  group_key: key,
  group_labels: Object.entries(labels)
    .map(([name, value]) => `${name}=${value}`)
    .join(","),
  labels: Object.entries(labels).map(([name, value]) => ({ name, value })),
});

const groups = [
  group("a", { host: "web-01", region: "eu" }),
  group("b", { host: "web-02", region: "us" }),
  group("c", { host: "db-01" }),
];

const keysFor = (conditions: GroupFilterCondition[]) =>
  groups.filter((g) => matchesGroupFilter(g, conditions)).map((g) => g.group_key);

describe("matchesGroupFilter", () => {
  it("keeps every group when there is no condition", () => {
    expect(keysFor([])).toEqual(["a", "b", "c"]);
  });

  it("matches a label value exactly, not as a substring", () => {
    expect(keysFor([{ field: "host", operator: "eq", values: ["web-01"] }])).toEqual(["a"]);
    expect(keysFor([{ field: "host", operator: "eq", values: ["web"] }])).toEqual([]);
  });

  it("keeps groups without the label on != and NOT IN", () => {
    expect(keysFor([{ field: "region", operator: "neq", values: ["eu"] }])).toEqual(["b", "c"]);
    expect(keysFor([{ field: "region", operator: "not_in", values: ["eu", "us"] }])).toEqual(["c"]);
  });

  it("matches any of the IN values", () => {
    expect(keysFor([{ field: "host", operator: "in", values: ["web-02", "db-01"] }])).toEqual([
      "b",
      "c",
    ]);
  });

  it("ANDs conditions", () => {
    expect(
      keysFor([
        { field: "host", operator: "in", values: ["web-01", "web-02"] },
        { field: "region", operator: "neq", values: ["eu"] },
      ]),
    ).toEqual(["b"]);
  });

  it("searches free text in the rendered labels, ignoring case", () => {
    expect(keysFor([{ field: "", operator: "match_all", values: ["WEB-0"] }])).toEqual(["a", "b"]);
    expect(keysFor([{ field: "", operator: "match_all", values: ["region=us"] }])).toEqual(["b"]);
  });
});

describe("group label suggestions", () => {
  it("lists each label name once, sorted", () => {
    expect(groupLabelNames(groups)).toEqual(["host", "region"]);
  });

  it("lists a label's values narrowed by the typed text", () => {
    expect(groupLabelValues(groups, "host", "")).toEqual(["db-01", "web-01", "web-02"]);
    expect(groupLabelValues(groups, "host", "WEB")).toEqual(["web-01", "web-02"]);
    expect(groupLabelValues(groups, "zone", "")).toEqual([]);
  });

  it("treats a group without parsed labels as having none", () => {
    const bare: AlertGroup = { group_key: "x", group_labels: "host=web-09" };
    expect(groupLabelNames([bare])).toEqual([]);
    expect(matchesGroupFilter(bare, [{ field: "host", operator: "eq", values: ["web-09"] }])).toBe(
      false,
    );
  });
});
