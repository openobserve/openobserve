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

import { describe, it, expect } from "vitest";
import { findUnresolvableColumns } from "./conditionColumnCheck";

const FIELDS = [
  { label: "meta.alert_name", value: "meta_alert_name", type: "Utf8" },
  { label: "meta.severity", value: "meta_severity", type: "Utf8" },
  { label: "meta.old_severity", value: "meta_old_severity", type: "Utf8" },
];

const leaf = (column: string) => ({
  filterType: "condition",
  column,
  operator: "=",
  value: "x",
});

const group = (...conditions: any[]) => ({
  filterType: "group",
  logicalOperator: "AND",
  conditions,
});

describe("findUnresolvableColumns", () => {
  it("flags a bare column the payload envelope cannot resolve", () => {
    const out = findUnresolvableColumns(group(leaf("severity")), FIELDS);
    expect(out).toHaveLength(1);
    expect(out[0].column).toBe("severity");
  });

  it("suggests the dotted form of the closest trailing-segment field match", () => {
    const out = findUnresolvableColumns(group(leaf("severity")), FIELDS);
    expect(out[0].suggestion).toBe("meta.severity");
  });

  it("suggestion matching is case-insensitive but the warning still fires", () => {
    const out = findUnresolvableColumns(group(leaf("Severity")), FIELDS);
    expect(out).toHaveLength(1);
    expect(out[0].suggestion).toBe("meta.severity");
  });

  it("returns a null suggestion when no field shares the trailing segment", () => {
    const out = findUnresolvableColumns(group(leaf("hostname")), FIELDS);
    expect(out).toHaveLength(1);
    expect(out[0].suggestion).toBeNull();
  });

  it("accepts a known field value verbatim", () => {
    expect(findUnresolvableColumns(group(leaf("meta_alert_name")), FIELDS)).toEqual([]);
  });

  it("accepts the dotted label form of a known field", () => {
    expect(findUnresolvableColumns(group(leaf("meta.alert_name")), FIELDS)).toEqual([]);
  });

  it("accepts an unknown path under a known root (runtime meta extras)", () => {
    expect(findUnresolvableColumns(group(leaf("meta_custom_thing")), FIELDS)).toEqual([]);
    expect(findUnresolvableColumns(group(leaf("meta.custom_thing")), FIELDS)).toEqual([]);
  });

  it("accepts data[] row paths — row columns are only known at runtime", () => {
    expect(findUnresolvableColumns(group(leaf("data_amount")), FIELDS)).toEqual([]);
    expect(findUnresolvableColumns(group(leaf("data.amount")), FIELDS)).toEqual([]);
  });

  it("skips blank columns and dedupes repeats across nested groups", () => {
    const tree = group(leaf(""), leaf("severity"), group(leaf("severity"), leaf("foo")));
    const out = findUnresolvableColumns(tree, FIELDS);
    expect(out.map((w) => w.column)).toEqual(["severity", "foo"]);
  });

  it("prefers the shortest trailing-segment candidate", () => {
    const out = findUnresolvableColumns(group(leaf("severity")), [
      { label: "meta.old_severity", value: "meta_old_severity", type: "Utf8" },
      { label: "meta.severity", value: "meta_severity", type: "Utf8" },
    ]);
    expect(out[0].suggestion).toBe("meta.severity");
  });

  it("handles a null tree and empty fields without throwing", () => {
    expect(findUnresolvableColumns(null, FIELDS)).toEqual([]);
    expect(findUnresolvableColumns(group(leaf("data_x")), [])).toEqual([]);
  });
});
