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
  hasFullPage,
  eventSecondWindow,
  explorerErrorText,
  explorerSql,
  whereOfExplorerSql,
  labelsOnMetric,
  metricsSql,
  sampleLabels,
  traceDetailWindow,
} from "./pointExplorers";

const MIN = 60_000_000;

describe("Trace Explorer helpers", () => {
  it("opens a trace over its own span, one minute wider each side", () => {
    expect(traceDetailWindow({ trace_start_time: 10 * MIN, trace_end_time: 12 * MIN })).toEqual({
      startTime: 9 * MIN,
      endTime: 13 * MIN,
    });
  });

  it.each([
    [25, 25, true],
    [24, 25, false],
    [0, 25, false],
  ])("%i rows of a %i-row page has a next page: %s", (rows, size, expected) => {
    expect(hasFullPage(rows, size)).toBe(expected);
  });
});

describe("Metrics Explorer helpers", () => {
  it("keeps the clicked labels the metric carries and drops the others", () => {
    const filters = [
      { field: "service_name", value: "cart" },
      { field: "k8s_namespace", value: "shop" },
    ];
    expect(labelsOnMetric(filters, ["service_name", "value"])).toEqual([
      { field: "service_name", value: "cart" },
    ]);
  });

  it("builds the raw-sample SQL newest first, quoting values", () => {
    expect(metricsSql("cpu", [{ field: "pod", value: "a'b" }])).toBe(
      `SELECT * FROM "cpu" WHERE pod = 'a''b' ORDER BY _timestamp DESC`,
    );
    expect(metricsSql("cpu", [])).toBe(`SELECT * FROM "cpu" ORDER BY _timestamp DESC`);
  });

  it("names a sample's series by its labels, leaving out time, value and internals", () => {
    const row = { _timestamp: 1, value: 3, __name__: "cpu", __hash__: "h", pod: "a", zone: "" };
    expect(sampleLabels(row)).toEqual([
      { field: "pod", value: "a" },
      { field: "zone", value: null },
    ]);
  });
});

describe("eventSecondWindow", () => {
  it("is the whole second holding the event, end exclusive", () => {
    expect(eventSecondWindow(1_700_000_123_456_789)).toEqual({
      startTime: 1_700_000_123_000_000,
      endTime: 1_700_000_124_000_000,
    });
  });

  it("an event on a whole second starts its own window", () => {
    expect(eventSecondWindow(5_000_000)).toEqual({ startTime: 5_000_000, endTime: 6_000_000 });
  });
});

describe("explorerSql / whereOfExplorerSql", () => {
  it("builds the list query and reads its WHERE back, case and spacing aside", () => {
    expect(explorerSql("app", " level = 'error' ")).toBe(
      `SELECT * FROM "app" WHERE level = 'error' ORDER BY _timestamp DESC`,
    );
    expect(explorerSql("app", "")).toBe(`SELECT * FROM "app" ORDER BY _timestamp DESC`);
    expect(
      whereOfExplorerSql(
        "app",
        `select *  from "app"\n where a = 1 and b = 'x' order by _timestamp desc;`,
      ),
    ).toBe("a = 1 and b = 'x'");
    expect(whereOfExplorerSql("app", `SELECT * FROM "app" ORDER BY _timestamp DESC`)).toBe("");
  });

  it("anything else is not the plain shape", () => {
    expect(whereOfExplorerSql("app", `SELECT a FROM "app" ORDER BY _timestamp DESC`)).toBeNull();
    expect(whereOfExplorerSql("app", `SELECT * FROM "other" ORDER BY _timestamp DESC`)).toBeNull();
    expect(whereOfExplorerSql("app", `SELECT * FROM "app" WHERE a = 1 LIMIT 5`)).toBeNull();
  });
});

describe("explorerErrorText", () => {
  const backendError = (error: string) => ({
    message: "Request failed",
    response: { data: { error } },
  });

  it("drops the Error# prefix and unwraps the parser's ParserError(...)", () => {
    const raw = String.raw`Error# SQL error: ParserError("Expected: end of statement, found: \"k8s\" at Line: 1, Column: 14")`;
    expect(explorerErrorText(backendError(raw))).toBe(
      'SQL error: Expected: end of statement, found: "k8s" at Line: 1, Column: 14',
    );
  });

  it("keeps a plain backend message as it is", () => {
    expect(explorerErrorText(backendError("Search field not found: foo"))).toBe(
      "Search field not found: foo",
    );
  });

  it("falls back to the HTTP message only when the backend sent none", () => {
    expect(explorerErrorText({ message: "Request failed with status code 400" })).toBe(
      "Request failed with status code 400",
    );
    expect(explorerErrorText({ message: "x", response: { data: { message: "from body" } } })).toBe(
      "from body",
    );
    expect(explorerErrorText(null)).toBe("Search failed");
  });
});

describe("explorerErrorText: the traces endpoint", () => {
  it("drops the repeated 'invalid filter: invalid filter expression:' lead, keeping the parser part", () => {
    const error =
      "invalid filter: invalid filter expression: sql parser error: Expected: an expression, found: = at Line: 1, Column: 39";
    expect(explorerErrorText({ response: { data: { error } } })).toBe(
      "SQL parser error: Expected: an expression, found: = at Line: 1, Column: 39",
    );
  });

  it("leaves 'invalid filter' inside a message alone", () => {
    expect(
      explorerErrorText({ response: { data: { error: "field x: invalid filter value" } } }),
    ).toBe("field x: invalid filter value");
  });
});
