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

import { describe, expect, it, vi } from "vitest";
import {
  convertPivotTableData,
  resolvePivotCustomQueryAggregations,
} from "@/utils/dashboard/convertPivotTableData";
import {
  PIVOT_TABLE_MAX_COLUMNS,
  PIVOT_TABLE_SEPARATOR,
  PIVOT_TABLE_OTHERS_LABEL,
  PIVOT_TABLE_TOTAL_LABEL,
  PIVOT_TABLE_EMPTY_KEY,
  PIVOT_TABLE_EMPTY_LABEL,
} from "@/utils/dashboard/constants";

// Translated strings are asserted by key so the tests stay locale-independent.
vi.mock("@/types/i18n", () => ({
  gt: (key: string) => key,
}));

const store = { state: { timezone: "UTC" } };

const field = (alias: string, label = alias.toUpperCase()) => ({ alias, label });

// y fields carry the aggregation that drives duplicate-cell merging; "count"
// (additive) is the default the sum-asserting tests assume.
const yField = (alias: string, label = alias.toUpperCase(), functionName: any = "count") => ({
  alias,
  label,
  functionName,
});

/** Builds a table panel schema in pivot mode (x + breakdown + y all present). */
const schema = (opts: {
  x?: any[];
  y?: any[];
  breakdown?: any[];
  config?: any;
  customQuery?: boolean;
}) => ({
  type: "table",
  queries: [
    {
      customQuery: opts.customQuery ?? false,
      fields: {
        x: opts.x ?? [field("country", "Country")],
        y: opts.y ?? [yField("cnt", "Count")],
        breakdown: opts.breakdown ?? [field("method", "Method")],
      },
    },
  ],
  config: opts.config ?? {},
});

const colNames = (r: any) => r.columns.map((c: any) => c.name);
const valueColumns = (r: any) => r.columns.filter((c: any) => !c._isRowField);

describe("convertPivotTableData", () => {
  describe("guard conditions", () => {
    const empty = { rows: [], columns: [], pivotHeaderLevels: [] };

    it("returns empty for non-array search data", () => {
      expect(convertPivotTableData(schema({}), null as any, store)).toEqual(empty);
    });

    it("returns empty for an empty result set", () => {
      expect(convertPivotTableData(schema({}), [[]], store)).toEqual(empty);
    });

    it("returns empty when no panel schema is supplied", () => {
      expect(convertPivotTableData(null as any, [[{ a: 1 }]], store)).toEqual(empty);
    });

    it.each([
      ["breakdown", { breakdown: [] }],
      ["y", { y: [] }],
      ["x", { x: [] }],
    ])("returns empty when %s fields are missing", (_name, override) => {
      const data = [[{ country: "US", method: "GET", cnt: 1 }]];
      expect(convertPivotTableData(schema(override), data, store)).toEqual(empty);
    });
  });

  describe("single-level pivot", () => {
    const data = [
      [
        { country: "US", method: "GET", cnt: 10 },
        { country: "US", method: "POST", cnt: 5 },
        { country: "IN", method: "GET", cnt: 7 },
      ],
    ];

    it("turns breakdown values into columns and x values into rows", () => {
      const result = convertPivotTableData(schema({}), data, store);

      expect(colNames(result)).toEqual(["country", "GET_cnt", "POST_cnt"]);
      expect(result.rows).toEqual([
        { country: "US", GET_cnt: 10, POST_cnt: 5 },
        { country: "IN", GET_cnt: 7, POST_cnt: null },
      ]);
    });

    it("uses the raw breakdown value as the column label for a single value field", () => {
      const result = convertPivotTableData(schema({}), data, store);
      expect(valueColumns(result).map((c: any) => c.label)).toEqual(["GET", "POST"]);
    });

    it("leaves missing combinations as null rather than 0", () => {
      const result = convertPivotTableData(schema({}), data, store);
      // IN has no POST row; null keeps it out of averages and sorts distinctly.
      expect(result.rows[1].POST_cnt).toBeNull();
    });

    it("emits no multi-row header metadata for 1 breakdown + 1 value field", () => {
      expect(convertPivotTableData(schema({}), data, store).pivotHeaderLevels).toEqual([]);
    });

    it("orders breakdown columns by descending total", () => {
      const skewed = [
        [
          { country: "US", method: "small", cnt: 1 },
          { country: "US", method: "big", cnt: 100 },
        ],
      ];
      const result = convertPivotTableData(schema({}), skewed, store);
      expect(colNames(result)).toEqual(["country", "big_cnt", "small_cnt"]);
    });
  });

  describe("duplicate source rows", () => {
    const dup = (a: number, b: number) => [
      [
        { country: "US", method: "GET", cnt: a },
        { country: "US", method: "GET", cnt: b },
      ],
    ];

    it("sums repeated (x, breakdown) pairs for additive aggregations", () => {
      const result = convertPivotTableData(schema({}), dup(5, 7), store);
      expect(result.rows[0].GET_cnt).toBe(12);
    });

    it("keeps row totals consistent with the merged cells", () => {
      const result = convertPivotTableData(
        schema({ config: { table_pivot_show_row_totals: true } }),
        dup(5, 7),
        store,
      );
      expect(result.rows[0][`${PIVOT_TABLE_TOTAL_LABEL}_cnt`]).toBe(12);
    });

    it.each([
      ["min", 5],
      ["max", 7],
    ])("merges %s duplicates to the exact bound", (fn, expected) => {
      const result = convertPivotTableData(
        schema({ y: [yField("cnt", "Count", fn)] }),
        dup(5, 7),
        store,
      );
      expect(result.rows[0].GET_cnt).toBe(expected);
    });

    it.each([["avg"], ["p95"], ["count-distinct"], [null]])(
      "keeps the first value for non-reconstructable aggregation %s",
      (fn) => {
        // Summing an avg/percentile/distinct-count fabricates a value that
        // never existed; null models custom SQL with no known aggregation.
        const result = convertPivotTableData(
          schema({ y: [yField("cnt", "Count", fn)] }),
          dup(5, 7),
          store,
        );
        expect(result.rows[0].GET_cnt).toBe(5);
      },
    );

    it("treats a null aggregate as absent, not zero, when merging", () => {
      // min() over an all-null SQL group returns null; coercing it to 0 before
      // the merge would make min(0, 5) = 0 and fabricate the cell.
      const data = [
        [
          { country: "US", method: "GET", cnt: null },
          { country: "US", method: "GET", cnt: 5 },
        ],
      ];
      const result = convertPivotTableData(
        schema({ y: [yField("cnt", "Count", "min")] }),
        data,
        store,
      );
      expect(result.rows[0].GET_cnt).toBe(5);
    });

    it("seeds keep-first merges from the first numeric value, skipping nulls", () => {
      const data = [
        [
          { country: "US", method: "GET", cnt: null },
          { country: "US", method: "GET", cnt: 7 },
        ],
      ];
      const result = convertPivotTableData(
        schema({ y: [yField("cnt", "Count", "avg")] }),
        data,
        store,
      );
      expect(result.rows[0].GET_cnt).toBe(7);
    });

    it("keeps max exact for negative data with null duplicates", () => {
      const data = [
        [
          { country: "US", method: "GET", cnt: null },
          { country: "US", method: "GET", cnt: -5 },
          { country: "US", method: "GET", cnt: -3 },
        ],
      ];
      const result = convertPivotTableData(
        schema({ y: [yField("cnt", "Count", "max")] }),
        data,
        store,
      );
      expect(result.rows[0].GET_cnt).toBe(-3);
    });

    it("leaves a cell null when every source aggregate is null", () => {
      const data = [
        [
          { country: "US", method: "GET", cnt: null },
          { country: "US", method: "POST", cnt: 4 },
        ],
      ];
      const result = convertPivotTableData(
        schema({ y: [yField("cnt", "Count", "min")] }),
        data,
        store,
      );
      expect(result.rows[0].GET_cnt).toBeNull();
      expect(result.rows[0].POST_cnt).toBe(4);
    });

    // The reviewer's report: a max panel whose query grouped more finely than
    // (x, breakdown) showed every cell as the SUM of its rows, and the row
    // Total as the sum of all 20 returned values (11511) instead of 843.
    const svc1 = [801, 633, 591, 549, 12, 843, 759, 717, 675, 507];
    const svc4 = [18, 6, 780, 738, 696, 528, 822, 654, 612, 570];
    const finerThanPivot = [
      [
        ...svc1.map((val, i) => ({ country: "IN", service: "svc1", endpoint: `e${i}`, val })),
        ...svc4.map((val, i) => ({ country: "IN", service: "svc4", endpoint: `f${i}`, val })),
      ],
    ];
    const maxSchema = (yExtra: any, customQuery = false) =>
      schema({
        y: [{ alias: "val", label: "Max Val", ...yExtra }],
        breakdown: [field("service", "Service")],
        config: { table_pivot_show_row_totals: true, table_pivot_show_col_totals: true },
        customQuery,
      });

    it.each([
      ["functionName (builder shape)", { functionName: "max" }],
      ["aggregationFunction (legacy shape)", { aggregationFunction: "max" }],
      ["upper-case function name", { functionName: "MAX" }],
    ])("keeps the bound, never the sum, for max declared via %s", (_name, yExtra) => {
      const result = convertPivotTableData(maxSchema(yExtra), finerThanPivot, store);
      const row = result.rows[0];

      expect(row.svc1_val).toBe(843);
      expect(row.svc4_val).toBe(822);
      // The reported symptom: 6087 / 5424 summed the endpoint rows.
      expect(row.svc1_val).not.toBe(6087);
    });

    it("reports the row total of a max pivot as the bound, not a sum of bounds", () => {
      const result = convertPivotTableData(
        maxSchema({ functionName: "max" }),
        finerThanPivot,
        store,
      );
      // 11511 was the reported total (every returned value added together).
      expect(result.rows[0][`${PIVOT_TABLE_TOTAL_LABEL}_val`]).toBe(843);
    });

    it("folds column and grand totals of a max pivot by the bound too", () => {
      const result = convertPivotTableData(
        maxSchema({ functionName: "max" }),
        finerThanPivot,
        store,
      );
      const totalRow = result.rows[result.rows.length - 1];

      expect(totalRow.__isTotalRow).toBe(true);
      expect(totalRow.svc1_val).toBe(843);
      expect(totalRow[`${PIVOT_TABLE_TOTAL_LABEL}_val`]).toBe(843);
    });

    it("uses the bound for min totals as well", () => {
      const result = convertPivotTableData(
        maxSchema({ functionName: "min" }),
        finerThanPivot,
        store,
      );
      const row = result.rows[0];

      expect(row.svc1_val).toBe(12);
      expect(row.svc4_val).toBe(6);
      expect(row[`${PIVOT_TABLE_TOTAL_LABEL}_val`]).toBe(6);
    });

    it("still sums additive aggregations and their totals", () => {
      const result = convertPivotTableData(
        maxSchema({ functionName: "sum" }),
        finerThanPivot,
        store,
      );
      const row = result.rows[0];

      expect(row.svc1_val).toBe(6087);
      expect(row.svc4_val).toBe(5424);
      expect(row[`${PIVOT_TABLE_TOTAL_LABEL}_val`]).toBe(11511);
    });

    it("does not trust the functionName placeholder on custom-SQL panels", () => {
      // usePanelFields stamps functionName: "count" on every custom-query y
      // field; the real aggregation is in the SQL text, so adding the rows up
      // would invent a number the query never returned. With no parsed
      // aggregation supplied, the merge keeps a real returned value.
      const result = convertPivotTableData(
        maxSchema({ functionName: "count" }, true),
        finerThanPivot,
        store,
      );
      const row = result.rows[0];

      expect(row.svc1_val).toBe(801);
      expect(row.svc4_val).toBe(18);
      expect(row.svc1_val).not.toBe(6087);
    });

    describe("aggregation parsed from custom SQL", () => {
      const customSql = (aggregation: string) =>
        `SELECT country, service, endpoint, ${aggregation}(duration) as "val" ` +
        `FROM "logs" GROUP BY country, service, endpoint`;

      const runCustomSql = async (aggregation: string) => {
        const panel = maxSchema({ functionName: "count" }, true);
        panel.queries[0].query = customSql(aggregation);
        const parsed = await resolvePivotCustomQueryAggregations(panel.queries[0]);
        return convertPivotTableData(panel, finerThanPivot, store, parsed);
      };

      it("reads max out of the query text and reports the bound", async () => {
        const row = (await runCustomSql("max")).rows[0];

        expect(row.svc1_val).toBe(843);
        expect(row.svc4_val).toBe(822);
        expect(row[`${PIVOT_TABLE_TOTAL_LABEL}_val`]).toBe(843);
      });

      it("reads min out of the query text", async () => {
        const row = (await runCustomSql("min")).rows[0];

        expect(row.svc1_val).toBe(12);
        expect(row[`${PIVOT_TABLE_TOTAL_LABEL}_val`]).toBe(6);
      });

      it("sums only when the query actually says sum", async () => {
        const row = (await runCustomSql("sum")).rows[0];

        expect(row.svc1_val).toBe(6087);
        expect(row[`${PIVOT_TABLE_TOTAL_LABEL}_val`]).toBe(11511);
      });

      it("keeps a real value for avg, which cannot be reconstructed", async () => {
        const row = (await runCustomSql("avg")).rows[0];

        expect(row.svc1_val).toBe(801);
        expect(row.svc1_val).not.toBe(6087);
      });

      it("maps every SELECT alias to its aggregation", async () => {
        const parsed = await resolvePivotCustomQueryAggregations({
          customQuery: true,
          query: customSql("max"),
        });
        expect(parsed).toMatchObject({ val: "max", country: null, service: null });
      });

      it.each([
        ["builder panels", { customQuery: false, query: "SELECT max(a) as val FROM t" }],
        ["a blank query", { customQuery: true, query: "   " }],
        ["a missing query", { customQuery: true }],
      ])("returns null for %s", async (_name, query) => {
        expect(await resolvePivotCustomQueryAggregations(query)).toBeNull();
      });

      it("never reports an aggregation for unparseable SQL", async () => {
        const parsed = await resolvePivotCustomQueryAggregations({
          customQuery: true,
          query: "not sql at all",
        });
        // The parser's fallback aliases cannot collide with real y aliases, so
        // the merge falls through to keeping a real value.
        expect(parsed?.val).toBeUndefined();
      });
    });

    it("leaves a min/max total null when the row has no values", () => {
      const data = [
        [
          { country: "US", method: "GET", cnt: null },
          { country: "IN", method: "GET", cnt: 4 },
        ],
      ];
      const result = convertPivotTableData(
        schema({
          y: [yField("cnt", "Count", "max")],
          config: { table_pivot_show_row_totals: true },
        }),
        data,
        store,
      );
      expect(result.rows[0][`${PIVOT_TABLE_TOTAL_LABEL}_cnt`]).toBeNull();
      expect(result.rows[1][`${PIVOT_TABLE_TOTAL_LABEL}_cnt`]).toBe(4);
    });

    it("applies the same merge to groups folded into the Others bucket", () => {
      // min values from different folded groups: the bucket's min is the true
      // min of the union, not a sum of per-group minimums.
      const rows: any[] = [];
      for (let i = 0; i < PIVOT_TABLE_MAX_COLUMNS + 3; i++) {
        rows.push({ country: "US", method: `M${i}`, cnt: 100 + i });
      }
      const result = convertPivotTableData(
        schema({ y: [yField("cnt", "Count", "min")] }),
        [rows],
        store,
      );
      // The 3 smallest totals (100..102) fold into Others; their min is 100.
      expect(result.rows[0][`${PIVOT_TABLE_OTHERS_LABEL}_cnt`]).toBe(100);
    });
  });

  describe("empty breakdown values", () => {
    it("folds null, undefined and empty string into a single (empty) column", () => {
      const data = [
        [
          { country: "US", method: null, cnt: 1 },
          { country: "US", method: "", cnt: 2 },
          { country: "IN", method: "X", cnt: 3 },
        ],
      ];
      const result = convertPivotTableData(schema({}), data, store);

      expect(colNames(result)).toEqual(["country", `${PIVOT_TABLE_EMPTY_KEY}_cnt`, "X_cnt"]);
      expect(result.rows[0][`${PIVOT_TABLE_EMPTY_KEY}_cnt`]).toBe(3);
    });

    it("labels the empty bucket (empty) while keying it by the sentinel", () => {
      const data = [[{ country: "US", method: "", cnt: 1 }]];
      const result = convertPivotTableData(schema({}), data, store);
      const emptyCol = valueColumns(result)[0];
      expect(emptyCol.name).toBe(`${PIVOT_TABLE_EMPTY_KEY}_cnt`);
      expect(emptyCol.label).toBe(PIVOT_TABLE_EMPTY_LABEL);
    });

    it("never produces a blank column label", () => {
      const data = [[{ country: "US", method: "", cnt: 1 }]];
      const result = convertPivotTableData(schema({}), data, store);
      expect(valueColumns(result).every((c: any) => c.label !== "")).toBe(true);
    });

    it('keeps a literal "(empty)" data value separate from the empty bucket', () => {
      // The bucket's machine key is a sentinel, so genuine "(empty)" strings in
      // the data must not merge into it (they did when the key was the label).
      const data = [
        [
          { country: "US", method: "", cnt: 2 },
          { country: "US", method: PIVOT_TABLE_EMPTY_LABEL, cnt: 5 },
        ],
      ];
      const result = convertPivotTableData(
        schema({ config: { table_pivot_show_row_totals: true } }),
        data,
        store,
      );

      expect(result.rows[0][`${PIVOT_TABLE_EMPTY_KEY}_cnt`]).toBe(2);
      expect(result.rows[0][`${PIVOT_TABLE_EMPTY_LABEL}_cnt`]).toBe(5);
      expect(result.rows[0][`${PIVOT_TABLE_TOTAL_LABEL}_cnt`]).toBe(7);
    });

    it("renders the empty-bucket label in multi-level headers", () => {
      const breakdown = [field("method"), field("code")];
      const data = [
        [
          { country: "US", method: "", code: "200", cnt: 1 },
          { country: "US", method: "GET", code: "200", cnt: 2 },
        ],
      ];
      const result = convertPivotTableData(schema({ breakdown }), data, store);
      const level0Labels = result.pivotHeaderLevels[0].cells.map((c: any) => c.label);
      expect(level0Labels).toContain(PIVOT_TABLE_EMPTY_LABEL);
      expect(level0Labels).not.toContain(PIVOT_TABLE_EMPTY_KEY);
    });
  });

  describe("totals", () => {
    const data = [
      [
        { country: "US", method: "GET", cnt: 10 },
        { country: "US", method: "POST", cnt: 5 },
        { country: "IN", method: "GET", cnt: 7 },
      ],
    ];

    it("adds a row-total column summing across breakdown values", () => {
      const result = convertPivotTableData(
        schema({ config: { table_pivot_show_row_totals: true } }),
        data,
        store,
      );
      expect(result.rows.map((r: any) => r[`${PIVOT_TABLE_TOTAL_LABEL}_cnt`])).toEqual([15, 7]);
    });

    it("adds a column-total row summing down each breakdown value", () => {
      const result = convertPivotTableData(
        schema({ config: { table_pivot_show_col_totals: true } }),
        data,
        store,
      );
      const totalRow = result.rows[result.rows.length - 1];
      expect(totalRow.__isTotalRow).toBe(true);
      expect(totalRow.GET_cnt).toBe(17);
      expect(totalRow.POST_cnt).toBe(5);
    });

    it("computes the grand total when both totals are enabled", () => {
      const result = convertPivotTableData(
        schema({
          config: { table_pivot_show_row_totals: true, table_pivot_show_col_totals: true },
        }),
        data,
        store,
      );
      const totalRow = result.rows[result.rows.length - 1];
      expect(totalRow[`${PIVOT_TABLE_TOTAL_LABEL}_cnt`]).toBe(22);
    });

    it("lifts the total row out of rows when sticky row totals are on", () => {
      const result = convertPivotTableData(
        schema({
          config: {
            table_pivot_show_col_totals: true,
            table_pivot_sticky_row_totals: true,
          },
        }),
        data,
        store,
      );
      expect(result.stickyTotalRow?.__isTotalRow).toBe(true);
      expect(result.rows.some((r: any) => r.__isTotalRow)).toBe(false);
    });

    it("keeps the total row inline when stickiness is off", () => {
      const result = convertPivotTableData(
        schema({ config: { table_pivot_show_col_totals: true } }),
        data,
        store,
      );
      expect(result.stickyTotalRow).toBeUndefined();
      expect(result.rows.some((r: any) => r.__isTotalRow)).toBe(true);
    });
  });

  describe("multi-level pivot", () => {
    const breakdown = [field("method", "Method"), field("code", "Code")];
    const data = [
      [
        { country: "US", method: "GET", code: "200", cnt: 10 },
        { country: "US", method: "GET", code: "404", cnt: 3 },
        { country: "US", method: "POST", code: "200", cnt: 5 },
        { country: "IN", method: "GET", code: "200", cnt: 7 },
      ],
    ];

    it("builds one header level per breakdown field", () => {
      const result = convertPivotTableData(schema({ breakdown }), data, store);
      expect(result.pivotHeaderLevels).toHaveLength(2);
      expect(result.pivotHeaderLevels[1].isLeaf).toBe(true);
    });

    it("groups same-parent children under one colspan", () => {
      const result = convertPivotTableData(schema({ breakdown }), data, store);
      const level0 = result.pivotHeaderLevels[0].cells;

      expect(level0.map((c: any) => [c.label, c.colspan])).toEqual([
        ["GET", 2],
        ["POST", 1],
      ]);
    });

    it("keeps sibling groups adjacent so colspans stay contiguous", () => {
      const result = convertPivotTableData(schema({ breakdown }), data, store);
      const leafKeys = valueColumns(result).map((c: any) => c.name);
      expect(leafKeys).toEqual([
        `GET${PIVOT_TABLE_SEPARATOR}200_cnt`,
        `GET${PIVOT_TABLE_SEPARATOR}404_cnt`,
        `POST${PIVOT_TABLE_SEPARATOR}200_cnt`,
      ]);
    });

    it("makes every header level cover the same leaf width", () => {
      const result = convertPivotTableData(
        schema({ breakdown, config: { table_pivot_show_row_totals: true } }),
        data,
        store,
      );
      const width = (level: any) => level.cells.reduce((sum: number, c: any) => sum + c.colspan, 0);
      // Level 0 spans every leaf. Deeper levels omit the cells that level 0
      // already covers with a rowspan, so add those back before comparing.
      const spannedFromAbove = result.pivotHeaderLevels[0].cells
        .filter((c: any) => (c.rowspan ?? 1) > 1)
        .reduce((sum: number, c: any) => sum + c.colspan, 0);

      expect(width(result.pivotHeaderLevels[1]) + spannedFromAbove).toBe(
        width(result.pivotHeaderLevels[0]),
      );
    });
  });

  describe("multiple value fields", () => {
    const y = [field("cnt", "Count"), field("total", "Sum")];
    const data = [
      [
        { country: "US", method: "GET", cnt: 10, total: 100 },
        { country: "US", method: "POST", cnt: 5, total: 50 },
      ],
    ];

    it("emits one leaf column per breakdown/value pair", () => {
      const result = convertPivotTableData(schema({ y }), data, store);
      expect(valueColumns(result).map((c: any) => c.name)).toEqual([
        "GET_cnt",
        "GET_total",
        "POST_cnt",
        "POST_total",
      ]);
    });

    it("adds a leaf row of value-field labels under the breakdown headers", () => {
      const result = convertPivotTableData(schema({ y }), data, store);
      const leaf = result.pivotHeaderLevels[result.pivotHeaderLevels.length - 1];

      expect(leaf.isLeaf).toBe(true);
      expect(leaf.cells.map((c: any) => c.label)).toEqual(["Count", "Sum", "Count", "Sum"]);
    });

    it("labels leaf columns with the value field once parent headers carry context", () => {
      const result = convertPivotTableData(schema({ y }), data, store);
      expect(valueColumns(result).map((c: any) => c.label)).toEqual([
        "Count",
        "Sum",
        "Count",
        "Sum",
      ]);
    });

    it("totals each value field independently", () => {
      const result = convertPivotTableData(
        schema({ y, config: { table_pivot_show_row_totals: true } }),
        data,
        store,
      );
      expect(result.rows[0][`${PIVOT_TABLE_TOTAL_LABEL}_cnt`]).toBe(15);
      expect(result.rows[0][`${PIVOT_TABLE_TOTAL_LABEL}_total`]).toBe(150);
    });
  });

  describe("column overflow", () => {
    const many = (breakdownFields: string[]) => {
      const rows: any[] = [];
      for (let i = 0; i < PIVOT_TABLE_MAX_COLUMNS + 10; i++) {
        const row: any = { country: "US", cnt: 1000 - i };
        for (const f of breakdownFields) row[f] = `${f}${i}`;
        rows.push(row);
      }
      return [rows];
    };

    it("caps breakdown columns and folds the tail into one Others column", () => {
      const result = convertPivotTableData(schema({}), many(["method"]), store);
      expect(valueColumns(result)).toHaveLength(PIVOT_TABLE_MAX_COLUMNS + 1);
      expect(valueColumns(result).at(-1).name).toBe(`${PIVOT_TABLE_OTHERS_LABEL}_cnt`);
    });

    it("sums every overflow value into the Others bucket", () => {
      const result = convertPivotTableData(schema({}), many(["method"]), store);
      // Values run 1000..941; the 50 largest are kept, the last 10 folded.
      const foldedSum = Array.from({ length: 10 }, (_, i) => 1000 - (PIVOT_TABLE_MAX_COLUMNS + i));
      expect(result.rows[0][`${PIVOT_TABLE_OTHERS_LABEL}_cnt`]).toBe(
        foldedSum.reduce((a, b) => a + b, 0),
      );
    });

    it("translates the Others label on the single-row header path", () => {
      const result = convertPivotTableData(schema({}), many(["method"]), store);
      expect(valueColumns(result).at(-1).label).toBe("dashboard.pivotOthers");
    });

    it("translates the Others label on the multi-level header path", () => {
      const breakdown = [field("method"), field("code")];
      const result = convertPivotTableData(schema({ breakdown }), many(["method", "code"]), store);
      const othersCell = result.pivotHeaderLevels[0].cells.at(-1);
      expect(othersCell.label).toBe("dashboard.pivotOthers");
    });

    it("spans the Others header across every pivot level instead of leaving blanks", () => {
      const breakdown = [field("a"), field("b"), field("c")];
      const result = convertPivotTableData(schema({ breakdown }), many(["a", "b", "c"]), store);

      expect(result.pivotHeaderLevels[0].cells.at(-1).rowspan).toBe(3);
      // Deeper levels must not carry a synthetic cell for the overflow bucket.
      for (const level of result.pivotHeaderLevels) {
        expect(level.cells.every((c: any) => c.label !== undefined)).toBe(true);
      }
    });

    it("gives the Others header a sortable leaf column", () => {
      const breakdown = [field("method"), field("code")];
      const result = convertPivotTableData(schema({ breakdown }), many(["method", "code"]), store);
      const othersCell = result.pivotHeaderLevels[0].cells.at(-1);
      expect(othersCell._sortColumn).toBe(`${PIVOT_TABLE_OTHERS_LABEL}_cnt`);
      expect(colNames(result)).toContain(othersCell._sortColumn);
    });

    it("counts the Others bucket in row totals", () => {
      const result = convertPivotTableData(
        schema({ config: { table_pivot_show_row_totals: true } }),
        many(["method"]),
        store,
      );
      const row = result.rows[0];
      const expected = Array.from({ length: PIVOT_TABLE_MAX_COLUMNS + 10 }, (_, i) => 1000 - i);
      expect(row[`${PIVOT_TABLE_TOTAL_LABEL}_cnt`]).toBe(expected.reduce((a, b) => a + b, 0));
    });
  });

  describe("column definitions", () => {
    const data = [[{ country: "US", method: "GET", cnt: 10 }]];

    it("marks x-axis columns as row fields and left-aligns them", () => {
      const result = convertPivotTableData(schema({}), data, store);
      const rowField = result.columns[0];
      expect(rowField._isRowField).toBe(true);
      expect(rowField.align).toBe("left");
    });

    it("right-aligns value columns and makes them sortable", () => {
      const result = convertPivotTableData(schema({}), data, store);
      for (const col of valueColumns(result)) {
        expect(col.align).toBe("right");
        expect(col.sortable).toBe(true);
      }
    });

    it("sorts value columns numerically rather than lexically", () => {
      const result = convertPivotTableData(schema({}), data, store);
      const { sort } = valueColumns(result)[0];
      expect(sort("9", "10")).toBeLessThan(0);
    });

    it("flags the total column so the renderer can pin it", () => {
      const result = convertPivotTableData(
        schema({ config: { table_pivot_show_row_totals: true } }),
        data,
        store,
      );
      expect(result.columns.at(-1)._isTotalColumn).toBe(true);
    });

    it("passes the sticky flags through to the renderer", () => {
      const result = convertPivotTableData(
        schema({
          config: {
            table_pivot_sticky_row_totals: true,
            table_pivot_sticky_col_totals: true,
          },
        }),
        data,
        store,
      );
      expect(result.stickyRowTotals).toBe(true);
      expect(result.stickyColTotals).toBe(true);
    });
  });
});
