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

// The required SET is a function of SLI type × query language, so the tests are
// arranged by SHAPE. Each asserts the paths that MUST be flagged and, just as
// importantly, the ones that must not: a rule leaking across shapes blocks a
// legitimate definition, which is the more expensive failure of the two.

import { describe, expect, it } from "vitest";

import { makeAddSloSchema, type SloFormMeta } from "./AddSlo.schema";

const t = ((key: string) => key) as any;

const meta = (over: Partial<SloFormMeta> = {}): SloFormMeta => ({
  isPromqlCount: false,
  isPromqlTimeSlice: false,
  isGrouped: false,
  ...over,
});

/** The paths flagged for one form value, as dotted strings. */
const paths = (form: unknown, m: SloFormMeta = meta()): string[] => {
  const result = makeAddSloSchema(t, m).safeParse(form);
  return result.success ? [] : result.error.issues.map((i) => i.path.join("."));
};

const countSql = (over: Record<string, unknown> = {}) => ({
  name: "checkout-availability",
  sli_type: "count",
  target: 99.9,
  slice_interval_secs: 60,
  config: { stream_type: "logs", stream: "default", good_expr: "status < 500" },
  ...over,
});

describe("AddSlo.schema — identity and objective", () => {
  it("accepts a complete SQL count definition", () => {
    expect(paths(countSql())).toEqual([]);
  });

  it("requires a name", () => {
    expect(paths(countSql({ name: "" }))).toContain("name");
  });

  it("treats a whitespace-only name as blank", () => {
    expect(paths(countSql({ name: "   " }))).toContain("name");
  });

  it("accepts a name at the server's inclusive 256 bound and rejects 257", () => {
    expect(paths(countSql({ name: "z".repeat(256) }))).toEqual([]);
    expect(paths(countSql({ name: "z".repeat(257) }))).toContain("name");
  });

  it("requires a target", () => {
    expect(paths(countSql({ target: "" }))).toContain("target");
  });

  it("rejects both open boundaries of the target range", () => {
    expect(paths(countSql({ target: 0 }))).toContain("target");
    expect(paths(countSql({ target: 100 }))).toContain("target");
  });

  it("accepts a target just inside the range", () => {
    expect(paths(countSql({ target: 99.999 }))).toEqual([]);
  });

  it("rejects a target beyond 3 decimal places", () => {
    expect(paths(countSql({ target: 99.9999 }))).toContain("target");
  });

  // `Number("") === 0`, so a rule that coerced first could not tell an empty
  // target from a deliberate zero — and the two get different messages.
  it("distinguishes a blank target from a zero one", () => {
    const blank = makeAddSloSchema(t, meta()).safeParse(countSql({ target: "" }));
    const zero = makeAddSloSchema(t, meta()).safeParse(countSql({ target: 0 }));
    expect((blank as any).error.issues[0].message).not.toBe((zero as any).error.issues[0].message);
  });
});

describe("AddSlo.schema — count SLI", () => {
  it("requires stream, stream type and the good expression in SQL", () => {
    const flagged = paths({ name: "x", sli_type: "count", target: 99, config: {} });
    expect(flagged).toEqual(
      expect.arrayContaining(["config.stream_type", "config.stream", "config.good_expr"]),
    );
  });

  // The PromQL count is the one shape carrying no stream; requiring it here
  // would block a definition the server accepts.
  it("requires both queries and NOT the stream in PromQL", () => {
    const flagged = paths(
      { name: "x", sli_type: "count", target: 99, config: {} },
      meta({ isPromqlCount: true }),
    );
    expect(flagged).toEqual(expect.arrayContaining(["config.good", "config.total"]));
    expect(flagged).not.toContain("config.stream");
    expect(flagged).not.toContain("config.good_expr");
  });

  it("accepts a complete PromQL count", () => {
    const flagged = paths(
      {
        name: "x",
        sli_type: "count",
        target: 99,
        config: { good: "sum(ok)", total: "sum(all)" },
      },
      meta({ isPromqlCount: true }),
    );
    expect(flagged).toEqual([]);
  });
});

describe("AddSlo.schema — time-slice SLI", () => {
  const base = { name: "x", sli_type: "time_slice", target: 99, config: {} };

  it("requires stream, aggregate, comparator and threshold", () => {
    expect(paths(base)).toEqual(
      expect.arrayContaining([
        "config.stream",
        "config.query",
        "config.comparator",
        "config.threshold",
      ]),
    );
  });

  // "errors < 1" is an ordinary slice rule, so a truthiness test here would
  // reject a valid SLO.
  it("accepts a threshold of zero", () => {
    const flagged = paths({
      ...base,
      config: {
        stream_type: "logs",
        stream: "default",
        query: "count(*)",
        comparator: "<",
        threshold: 0,
      },
    });
    expect(flagged).toEqual([]);
  });

  it("rejects a non-numeric threshold", () => {
    const flagged = paths({
      ...base,
      config: {
        stream_type: "logs",
        stream: "default",
        query: "count(*)",
        comparator: "<",
        threshold: "abc",
      },
    });
    expect(flagged).toContain("config.threshold");
  });

  // Unlike the PromQL count, a PromQL time-slice is evaluated against a named
  // metrics stream — so the stream stays required.
  it("still requires the stream in PromQL", () => {
    expect(paths(base, meta({ isPromqlTimeSlice: true }))).toContain("config.stream");
  });
});

describe("AddSlo.schema — alert SLI", () => {
  it("requires a source alert and nothing stream-shaped", () => {
    const flagged = paths({ name: "x", sli_type: "alert", target: 99, config: {} });
    expect(flagged).toEqual(["config.alert_id"]);
  });

  it("accepts a chosen source", () => {
    expect(
      paths({ name: "x", sli_type: "alert", target: 99, config: { alert_id: "abc" } }),
    ).toEqual([]);
  });

  // The availability ledger records one run per alert, not per group, so there
  // is no per-group coverage to stand on.
  it("refuses grouping outright", () => {
    const flagged = paths(
      {
        name: "x",
        sli_type: "alert",
        target: 99,
        slice_interval_secs: 300,
        config: { alert_id: "abc" },
      },
      meta({ isGrouped: true }),
    );
    expect(flagged).toContain("group_by");
  });
});

describe("AddSlo.schema — grouping (D30)", () => {
  it("refuses a grouped SLO on a 1-minute slice", () => {
    expect(paths(countSql({ slice_interval_secs: 60 }), meta({ isGrouped: true }))).toContain(
      "group_by",
    );
  });

  it("accepts a grouped SLO on the 5-minute grid", () => {
    expect(paths(countSql({ slice_interval_secs: 300 }), meta({ isGrouped: true }))).toEqual([]);
  });

  it("leaves an ungrouped SLO on a 1-minute slice alone", () => {
    expect(paths(countSql({ slice_interval_secs: 60 }))).toEqual([]);
  });
});
