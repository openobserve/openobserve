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
  RESERVED_TS_ALIAS_REPLACEMENT,
  rewriteQueryTimestampAlias,
  normalizeReservedTimestampAlias,
  pickReplacementAlias,
} from "@/utils/dashboard/timestampAliasRewrite";

describe("pickReplacementAlias (collision-avoiding suffix)", () => {
  it("returns `ts` when the query has no `ts` output column", () => {
    expect(pickReplacementAlias('SELECT histogram(_timestamp) AS "_timestamp" FROM t')).toBe("ts");
  });

  it("bumps to `ts_1` when `ts` is already an alias", () => {
    expect(
      pickReplacementAlias('SELECT foo AS "ts", histogram(_timestamp) AS "_timestamp" FROM t'),
    ).toBe("ts_1");
  });

  it("bumps to `ts_1` when `ts` is a bare selected column", () => {
    expect(pickReplacementAlias('SELECT ts, histogram(_timestamp) AS "_timestamp" FROM t')).toBe(
      "ts_1",
    );
  });

  it("finds the first free suffix (`ts_2` when `ts` and `ts_1` are taken)", () => {
    expect(
      pickReplacementAlias(
        'SELECT a AS ts, b AS ts_1, histogram(_timestamp) AS "_timestamp" FROM t',
      ),
    ).toBe("ts_2");
  });

  it("does NOT bump when `ts` only appears in WHERE (not an output column)", () => {
    expect(
      pickReplacementAlias('SELECT histogram(_timestamp) AS "_timestamp" FROM t WHERE ts > 0'),
    ).toBe("ts");
  });
});

describe("rewriteQueryTimestampAlias", () => {
  it('rewrites AS "_timestamp"', () => {
    expect(
      rewriteQueryTimestampAlias('SELECT histogram(_timestamp) AS "_timestamp" FROM "x"'),
    ).toBe('SELECT histogram(_timestamp) AS "ts" FROM "x"');
  });

  it("rewrites AS '_timestamp'", () => {
    expect(
      rewriteQueryTimestampAlias("SELECT histogram(_timestamp) AS '_timestamp' FROM \"x\""),
    ).toBe("SELECT histogram(_timestamp) AS 'ts' FROM \"x\"");
  });

  it("rewrites unquoted AS _timestamp", () => {
    expect(
      rewriteQueryTimestampAlias("SELECT histogram(_timestamp) AS _timestamp FROM \"x\""),
    ).toBe('SELECT histogram(_timestamp) AS ts FROM "x"');
  });

  it("is case-insensitive on the AS keyword", () => {
    expect(rewriteQueryTimestampAlias('SELECT a as "_timestamp"')).toBe(
      'SELECT a as "ts"',
    );
    expect(rewriteQueryTimestampAlias('SELECT a As "_timestamp"')).toBe(
      'SELECT a As "ts"',
    );
  });

  it("leaves the source column untouched when there is no _timestamp alias (histogram/WHERE/ORDER)", () => {
    const sql =
      'SELECT histogram(_timestamp, \'1 minute\') AS "x_axis_1", count(*) AS "y_axis_1" ' +
      'FROM "x" WHERE _timestamp > 0 ORDER BY _timestamp ASC';
    expect(rewriteQueryTimestampAlias(sql)).toBe(sql);
  });

  it("leaves a bare SELECT _timestamp (no alias) untouched", () => {
    const sql = 'SELECT _timestamp, count(*) FROM "x" GROUP BY _timestamp';
    expect(rewriteQueryTimestampAlias(sql)).toBe(sql);
  });

  it("renames GROUP BY and ORDER BY alias references when the alias is defined", () => {
    const sql =
      'SELECT histogram(_timestamp) as "_timestamp", count(_timestamp) as "y_axis_1" ' +
      'FROM "default" GROUP BY _timestamp ORDER BY _timestamp ASC';
    expect(rewriteQueryTimestampAlias(sql)).toBe(
      'SELECT histogram(_timestamp) as "ts", count(_timestamp) as "y_axis_1" ' +
        'FROM "default" GROUP BY ts ORDER BY ts ASC',
    );
  });

  it("renames a quoted alias reference in GROUP BY / ORDER BY", () => {
    const sql =
      'SELECT a AS "_timestamp" FROM "x" GROUP BY "_timestamp" ORDER BY "_timestamp" DESC';
    expect(rewriteQueryTimestampAlias(sql)).toBe(
      'SELECT a AS "ts" FROM "x" GROUP BY "ts" ORDER BY "ts" DESC',
    );
  });

  it("renames the alias reference in a GROUP BY / ORDER BY list but not function args", () => {
    const sql =
      'SELECT histogram(_timestamp) AS "_timestamp", svc AS "breakdown_1" FROM "x" ' +
      "GROUP BY svc, _timestamp ORDER BY svc, _timestamp ASC";
    expect(rewriteQueryTimestampAlias(sql)).toBe(
      'SELECT histogram(_timestamp) AS "ts", svc AS "breakdown_1" FROM "x" ' +
        "GROUP BY svc, ts ORDER BY svc, ts ASC",
    );
  });

  it("does not rename _timestamp inside a function call within GROUP BY", () => {
    const sql =
      'SELECT histogram(_timestamp) AS "_timestamp" FROM "x" GROUP BY histogram(_timestamp)';
    expect(rewriteQueryTimestampAlias(sql)).toBe(
      'SELECT histogram(_timestamp) AS "ts" FROM "x" GROUP BY histogram(_timestamp)',
    );
  });

  it("does not rename _timestamp in the WHERE clause even when the alias is defined", () => {
    const sql =
      'SELECT foo AS "_timestamp" FROM "x" WHERE _timestamp > 0 GROUP BY _timestamp';
    expect(rewriteQueryTimestampAlias(sql)).toBe(
      'SELECT foo AS "ts" FROM "x" WHERE _timestamp > 0 GROUP BY ts',
    );
  });

  it("renames a HAVING alias reference but not a source column inside an aggregate", () => {
    const sql =
      'SELECT histogram(_timestamp) AS "_timestamp" FROM "x" ' +
      "GROUP BY _timestamp HAVING _timestamp > 0 AND count(_timestamp) > 5";
    expect(rewriteQueryTimestampAlias(sql)).toBe(
      'SELECT histogram(_timestamp) AS "ts" FROM "x" ' +
        "GROUP BY ts HAVING ts > 0 AND count(_timestamp) > 5",
    );
  });

  it("does not rewrite a substring column like my_timestamp", () => {
    const sql = 'SELECT foo AS "my_timestamp" FROM "x"';
    expect(rewriteQueryTimestampAlias(sql)).toBe(sql);
  });

  it("honors a custom timestamp column name", () => {
    expect(rewriteQueryTimestampAlias('SELECT a AS "@ts" FROM "x"', "@ts", "ts")).toBe(
      'SELECT a AS "ts" FROM "x"',
    );
  });

  it("returns falsy input unchanged", () => {
    expect(rewriteQueryTimestampAlias("")).toBe("");
  });

  it("exposes the replacement constant", () => {
    expect(RESERVED_TS_ALIAS_REPLACEMENT).toBe("ts");
  });
});

describe("rewriteQueryTimestampAlias — complex queries (never corrupt)", () => {
  it("does NOT touch a string literal containing 'as \"_timestamp\"'", () => {
    const sql =
      'SELECT a AS "_timestamp" FROM "x" ' +
      'WHERE msg LIKE \'%as "_timestamp"%\' GROUP BY _timestamp';
    expect(rewriteQueryTimestampAlias(sql)).toBe(
      'SELECT a AS "ts" FROM "x" WHERE msg LIKE \'%as "_timestamp"%\' GROUP BY ts',
    );
  });

  it("does NOT rename an unquoted _timestamp inside a string literal", () => {
    const sql = "SELECT a AS _timestamp FROM \"x\" WHERE m = 'created as _timestamp' GROUP BY _timestamp";
    expect(rewriteQueryTimestampAlias(sql)).toBe(
      "SELECT a AS ts FROM \"x\" WHERE m = 'created as _timestamp' GROUP BY ts",
    );
  });

  it("renames a CTE that defines the alias and is consumed by SELECT * (no outer name ref)", () => {
    const sql =
      'WITH cte AS (SELECT histogram(_timestamp) AS "_timestamp" FROM t GROUP BY _timestamp) ' +
      "SELECT * FROM cte";
    // CTE renames its own alias + own GROUP BY; outer SELECT * carries the renamed column through
    expect(rewriteQueryTimestampAlias(sql)).toBe(
      'WITH cte AS (SELECT histogram(_timestamp) AS "ts" FROM t GROUP BY ts) ' +
        "SELECT * FROM cte",
    );
  });

  it("migrates each scope's own alias when both an outer and an inner scope define one", () => {
    const sql =
      'SELECT o AS "_timestamp" FROM ' +
      '(SELECT histogram(_timestamp) AS "_timestamp" FROM t GROUP BY _timestamp) s ' +
      "GROUP BY _timestamp";
    expect(rewriteQueryTimestampAlias(sql)).toBe(
      'SELECT o AS "ts" FROM ' +
        '(SELECT histogram(_timestamp) AS "ts" FROM t GROUP BY ts) s ' +
        "GROUP BY ts",
    );
  });

  it("does NOT rename a table alias `FROM x AS _timestamp`", () => {
    const sql = 'SELECT a AS "_timestamp" FROM "x" AS _timestamp GROUP BY _timestamp';
    expect(rewriteQueryTimestampAlias(sql)).toBe(
      'SELECT a AS "ts" FROM "x" AS _timestamp GROUP BY ts',
    );
  });

  it("leaves a window ORDER BY (source column) intact while renaming the output alias", () => {
    const sql =
      'SELECT row_number() OVER (ORDER BY _timestamp) AS "_timestamp" FROM t GROUP BY _timestamp';
    expect(rewriteQueryTimestampAlias(sql)).toBe(
      'SELECT row_number() OVER (ORDER BY _timestamp) AS "ts" FROM t GROUP BY ts',
    );
  });

  it("leaves CAST(... AS type) intact while renaming the output alias + refs", () => {
    const sql =
      'SELECT CAST(_timestamp AS BIGINT) AS "_timestamp" FROM t GROUP BY _timestamp ORDER BY _timestamp';
    expect(rewriteQueryTimestampAlias(sql)).toBe(
      'SELECT CAST(_timestamp AS BIGINT) AS "ts" FROM t GROUP BY ts ORDER BY ts',
    );
  });

  it("resets per UNION branch (only the branch that defines the alias is rewritten)", () => {
    const sql =
      'SELECT a AS "_timestamp" FROM t GROUP BY _timestamp ' +
      "UNION SELECT _timestamp FROM u GROUP BY _timestamp";
    expect(rewriteQueryTimestampAlias(sql)).toBe(
      'SELECT a AS "ts" FROM t GROUP BY ts ' +
        "UNION SELECT _timestamp FROM u GROUP BY _timestamp",
    );
  });

  it("is idempotent on a complex query", () => {
    const sql =
      'SELECT CAST(_timestamp AS BIGINT) AS "_timestamp" FROM t GROUP BY _timestamp ORDER BY _timestamp';
    const once = rewriteQueryTimestampAlias(sql);
    expect(rewriteQueryTimestampAlias(once)).toBe(once);
  });

  // --- Sub-query behaviour (the common, safe cases) ---

  it("migrates an OUTER histogram over a FROM sub-query that does not define the alias", () => {
    const sql =
      'SELECT histogram(_timestamp) AS "_timestamp", count(*) AS "y_axis_1" ' +
      'FROM (SELECT * FROM "t" WHERE code > 0) GROUP BY _timestamp ORDER BY _timestamp ASC';
    expect(rewriteQueryTimestampAlias(sql)).toBe(
      'SELECT histogram(_timestamp) AS "ts", count(*) AS "y_axis_1" ' +
        'FROM (SELECT * FROM "t" WHERE code > 0) GROUP BY ts ORDER BY ts ASC',
    );
  });

  it("leaves a source _timestamp passthrough inside a FROM sub-query alone", () => {
    const sql =
      'SELECT histogram(_timestamp) AS "_timestamp" ' +
      'FROM (SELECT a, _timestamp FROM "t") s GROUP BY _timestamp';
    expect(rewriteQueryTimestampAlias(sql)).toBe(
      'SELECT histogram(_timestamp) AS "ts" ' +
        'FROM (SELECT a, _timestamp FROM "t") s GROUP BY ts',
    );
  });

  it("migrates an OUTER histogram reading from a CTE (CTE body untouched)", () => {
    const sql =
      'WITH cte AS (SELECT a, _timestamp FROM "t") ' +
      'SELECT histogram(_timestamp) AS "_timestamp" FROM cte GROUP BY _timestamp';
    expect(rewriteQueryTimestampAlias(sql)).toBe(
      'WITH cte AS (SELECT a, _timestamp FROM "t") ' +
        'SELECT histogram(_timestamp) AS "ts" FROM cte GROUP BY ts',
    );
  });

  // --- Alias-only rename: only `AS _timestamp` (and its own-scope GROUP/ORDER/
  // HAVING references) change. A column reference to a sub-query/CTE output from
  // an outer scope is NOT an alias, so it is left untouched (by design). ---

  it("leaves a CTE-by-name cross-scope query unchanged (can't match the CTE name — safe)", () => {
    const sql =
      'WITH cte AS (SELECT histogram(x) AS "_timestamp" FROM "t" GROUP BY _timestamp) ' +
      "SELECT _timestamp FROM cte GROUP BY _timestamp";
    expect(rewriteQueryTimestampAlias(sql)).toBe(sql);
  });

  it("propagates a FROM sub-query alias rename to the outer references", () => {
    const sql =
      'SELECT _timestamp, count(*) AS "y_axis_1" ' +
      'FROM (SELECT histogram(x) AS "_timestamp" FROM "t" GROUP BY x) s GROUP BY _timestamp';
    expect(rewriteQueryTimestampAlias(sql)).toBe(
      'SELECT ts, count(*) AS "y_axis_1" ' +
        'FROM (SELECT histogram(x) AS "ts" FROM "t" GROUP BY x) s GROUP BY ts',
    );
  });

  // --- Self-alias `_timestamp AS _timestamp` → `_timestamp AS ts` (alias only) ---

  it("renames a self-alias inside a sub-query (only the alias, not the expression)", () => {
    const sql = 'SELECT a FROM (SELECT _timestamp as _timestamp, x FROM "logs") s';
    expect(rewriteQueryTimestampAlias(sql)).toBe(
      'SELECT a FROM (SELECT _timestamp as ts, x FROM "logs") s',
    );
  });

  it("propagates a sub-query self-alias rename to an outer function over that column", () => {
    const sql =
      "SELECT histogram(_timestamp) as a, count(*) as b " +
      'FROM (SELECT col1, _timestamp as _timestamp FROM "stream1") ' +
      "GROUP BY a, col1 ORDER BY a";
    // inner self-alias → `_timestamp as ts`; the outer histogram over the renamed
    // sub-query column follows to `histogram(ts)`. The physical read inside stays.
    expect(rewriteQueryTimestampAlias(sql)).toBe(
      "SELECT histogram(ts) as a, count(*) as b " +
        'FROM (SELECT col1, _timestamp as ts FROM "stream1") ' +
        "GROUP BY a, col1 ORDER BY a",
    );
  });

  it("renames a top-level self-alias (only the alias)", () => {
    const sql = 'SELECT _timestamp as _timestamp, count(*) as c FROM "logs" GROUP BY _timestamp';
    expect(rewriteQueryTimestampAlias(sql)).toBe(
      'SELECT _timestamp as ts, count(*) as c FROM "logs" GROUP BY ts',
    );
  });

  it("renames a quoted self-alias inside a sub-query (only the alias)", () => {
    const sql = 'SELECT a FROM (SELECT _timestamp AS "_timestamp" FROM "logs") s';
    expect(rewriteQueryTimestampAlias(sql)).toBe(
      'SELECT a FROM (SELECT _timestamp AS "ts" FROM "logs") s',
    );
  });
});

describe("normalizeReservedTimestampAlias", () => {
  const makePanel = (overrides: any = {}) => ({
    config: {},
    queries: [
      {
        customQuery: true,
        query:
          'SELECT histogram(_timestamp) AS "_timestamp", count(*) AS "y_axis_1" ' +
          'FROM "x" GROUP BY _timestamp ORDER BY _timestamp ASC',
        fields: {
          x: [{ alias: "_timestamp", column: "_timestamp", isDerived: false }],
          y: [{ alias: "y_axis_1", column: "count", isDerived: false }],
        },
      },
    ],
    ...overrides,
  });

  const wrap = (panel: any) => ({ version: 8, tabs: [{ panels: [panel] }] });

  it("rewrites the SQL string (alias + GROUP BY/ORDER BY refs) and the matching field alias", () => {
    const data = wrap(makePanel());
    normalizeReservedTimestampAlias(data);

    const query = data.tabs[0].panels[0].queries[0];
    expect(query.query).toBe(
      'SELECT histogram(_timestamp) AS "ts", count(*) AS "y_axis_1" ' +
        'FROM "x" GROUP BY ts ORDER BY ts ASC',
    );
    expect(query.fields.x[0].alias).toBe("ts");
    // source column must be preserved
    expect(query.fields.x[0].column).toBe("_timestamp");
  });

  it("rewrites override_config referencing the alias", () => {
    const panel = makePanel({
      config: {
        override_config: [
          { field: { matchBy: "name", value: "_timestamp" }, config: [] },
          { field: { matchBy: "name", value: "y_axis_1" }, config: [] },
        ],
      },
    });
    normalizeReservedTimestampAlias(wrap(panel));

    expect(panel.config.override_config[0].field.value).toBe("ts");
    expect(panel.config.override_config[1].field.value).toBe("y_axis_1");
  });

  it("rewrites drilldown row.field tokens referencing the alias", () => {
    const panel = makePanel({
      config: {
        drilldown: [
          {
            name: "d1",
            data: {
              variables: [
                { name: "v1", value: '${row.field["_timestamp"]}' },
                { name: "v2", value: "${row.field['_timestamp']}" },
                { name: "v3", value: '${row.field["y_axis_1"]}' },
              ],
            },
          },
        ],
      },
    });
    normalizeReservedTimestampAlias(wrap(panel));

    const vars = panel.config.drilldown[0].data.variables;
    expect(vars[0].value).toBe('${row.field["ts"]}');
    expect(vars[1].value).toBe("${row.field['ts']}");
    expect(vars[2].value).toBe('${row.field["y_axis_1"]}');
  });

  it("does NOT rename a VRL-derived _timestamp field (never in the SQL)", () => {
    const panel = {
      config: {
        override_config: [{ field: { matchBy: "name", value: "_timestamp" }, config: [] }],
      },
      queries: [
        {
          customQuery: false,
          // derived field is not part of the generated SQL
          query: 'SELECT count(*) AS "y_axis_1" FROM "x"',
          fields: {
            x: [{ alias: "_timestamp", column: "_timestamp", isDerived: true }],
            y: [{ alias: "y_axis_1", column: "count", isDerived: false }],
          },
        },
      ],
    };
    normalizeReservedTimestampAlias(wrap(panel));

    expect(panel.queries[0].fields.x[0].alias).toBe("_timestamp");
    // config ref must NOT be rewritten because no field was renamed
    expect(panel.config.override_config[0].field.value).toBe("_timestamp");
  });

  it("does NOT rename a bare SELECT _timestamp custom field (valid, no alias)", () => {
    const panel = {
      config: {},
      queries: [
        {
          customQuery: true,
          query: 'SELECT _timestamp, count(*) AS "y_axis_1" FROM "x" GROUP BY _timestamp',
          fields: {
            x: [{ alias: "_timestamp", column: "_timestamp", isDerived: false }],
            y: [{ alias: "y_axis_1", column: "count", isDerived: false }],
          },
        },
      ],
    };
    normalizeReservedTimestampAlias(wrap(panel));

    expect(panel.queries[0].query).toBe(
      'SELECT _timestamp, count(*) AS "y_axis_1" FROM "x" GROUP BY _timestamp',
    );
    expect(panel.queries[0].fields.x[0].alias).toBe("_timestamp");
  });

  it("handles single-object fields (geomap/sankey) and multiple queries", () => {
    const data = {
      version: 8,
      tabs: [
        {
          panels: [
            {
              config: {},
              queries: [
                {
                  query: 'SELECT lat AS "_timestamp" FROM "x"',
                  fields: {
                    latitude: { alias: "_timestamp", column: "lat", isDerived: false },
                  },
                },
                {
                  query: 'SELECT b AS "_timestamp" FROM "y"',
                  fields: { x: [{ alias: "_timestamp", column: "b", isDerived: false }] },
                },
              ],
            },
          ],
        },
      ],
    };
    normalizeReservedTimestampAlias(data);

    expect(data.tabs[0].panels[0].queries[0].fields.latitude.alias).toBe("ts");
    expect(data.tabs[0].panels[0].queries[1].fields.x[0].alias).toBe("ts");
  });

  it("skips PromQL panels (SQL-only rule)", () => {
    for (const queryType of ["promql", "promql-builder"]) {
      const panel = {
        queryType,
        config: {
          override_config: [{ field: { matchBy: "name", value: "_timestamp" }, config: [] }],
        },
        queries: [
          {
            // PromQL never has `AS _timestamp`, but assert the panel is skipped wholesale
            query: 'histogram_quantile(0.9, rate(x[5m])) AS "_timestamp"',
            fields: { x: [{ alias: "_timestamp", column: "_timestamp", isDerived: false }] },
          },
        ],
      };
      const data = wrap(panel);
      const before = JSON.parse(JSON.stringify(data));
      normalizeReservedTimestampAlias(data);
      expect(data, `queryType=${queryType}`).toEqual(before); // untouched
    }
  });

  it("uses a collision-free alias (ts_1) consistently across SQL, field, and config", () => {
    const panel = {
      config: {
        override_config: [{ field: { matchBy: "name", value: "_timestamp" }, config: [] }],
      },
      queries: [
        {
          customQuery: true,
          query:
            'SELECT foo AS "ts", histogram(_timestamp) AS "_timestamp" ' +
            "FROM t GROUP BY _timestamp ORDER BY _timestamp",
          fields: {
            x: [{ alias: "_timestamp", column: "_timestamp", isDerived: false }],
            y: [{ alias: "ts", column: "foo", isDerived: false }],
          },
        },
      ],
    };
    normalizeReservedTimestampAlias(wrap(panel));

    // `ts` is taken by `foo AS "ts"`, so `_timestamp` becomes `ts_1` everywhere
    expect(panel.queries[0].query).toBe(
      'SELECT foo AS "ts", histogram(_timestamp) AS "ts_1" ' +
        "FROM t GROUP BY ts_1 ORDER BY ts_1",
    );
    expect(panel.queries[0].fields.x[0].alias).toBe("ts_1");
    expect(panel.queries[0].fields.y[0].alias).toBe("ts"); // the pre-existing ts column untouched
    expect(panel.config.override_config[0].field.value).toBe("ts_1");
  });

  it("is idempotent", () => {
    const data = wrap(makePanel());
    normalizeReservedTimestampAlias(data);
    const once = JSON.parse(JSON.stringify(data));
    normalizeReservedTimestampAlias(data);
    expect(data).toEqual(once);
  });

  it("is a no-op for dashboards without tabs/panels/queries", () => {
    expect(() => normalizeReservedTimestampAlias(undefined)).not.toThrow();
    expect(() => normalizeReservedTimestampAlias({})).not.toThrow();
    expect(() => normalizeReservedTimestampAlias({ tabs: [{}] })).not.toThrow();
    expect(() =>
      normalizeReservedTimestampAlias({ tabs: [{ panels: [{}] }] }),
    ).not.toThrow();
  });
});
