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
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import type {
  AnnotationConditionGroup,
  AnnotationConditionLeaf,
  AnnotationSource,
} from "@/ts/interfaces/dashboard";
import {
  ANNOTATION_PREVIEW_ROW_LIMIT,
  MAX_ANNOTATION_SOURCES,
  annotationFiltersHaveBlankCondition,
  annotationPreviewHasProblems,
  annotationRowsToMarkers,
  annotationSourceColumns,
  annotationSourceTargetsPanel,
  buildAnnotationBuilderSql,
  buildAnnotationFiltersSql,
  extractTemplateFields,
  getAnnotationSourceSql,
  isBlankAnnotationCondition,
  renderAnnotationTemplate,
  sqlFromStream,
  sqlSelectAliases,
  summarizeAnnotationPreview,
  toMicroseconds,
  validateAnnotationSources,
} from "./annotationSources";
import { isValidAnnotationColumn } from "./validateAnnotationSources";

const t = i18n.global.t as unknown as TranslateFn;

/** Builds a leaf condition (the engine V2 tree the condition builder edits). */
const leaf = (
  column: string,
  operator: string,
  value: string,
  logicalOperator: "AND" | "OR" = "AND",
): AnnotationConditionLeaf => ({
  filterType: "condition",
  column,
  operator,
  value,
  logicalOperator,
});

/** Builds a condition group; `logicalOperator` is the prefix this group carries when nested. */
const group = (
  logicalOperator: "AND" | "OR",
  conditions: Array<AnnotationConditionLeaf | AnnotationConditionGroup> = [],
): AnnotationConditionGroup => ({ filterType: "group", logicalOperator, conditions });

const source = (overrides: Partial<AnnotationSource> = {}): AnnotationSource => ({
  id: "s1",
  name: "Deploys",
  color: "#5b8ef0",
  enabled: true,
  mode: "builder",
  streamType: "logs",
  stream: "k8s_events",
  filters: group("AND"),
  title: "{service} deployed",
  ...overrides,
});

describe("renderAnnotationTemplate", () => {
  it("fills {field} placeholders from the row", () => {
    expect(
      renderAnnotationTemplate("{service} {version} deployed", {
        service: "checkout",
        version: "v2",
      }),
    ).toEqual({ text: "checkout v2 deployed", missing: [] });
  });

  it("reports a field the row does not carry and leaves its slot empty", () => {
    expect(renderAnnotationTemplate("{service} by {author}", { service: "api" })).toEqual({
      text: "api by",
      missing: ["author"],
    });
  });

  it("treats a present null as present, rendering it empty", () => {
    expect(renderAnnotationTemplate("[{author}]", { author: null })).toEqual({
      text: "[]",
      missing: [],
    });
  });

  it("renders $variables and ${variables} with their current values", () => {
    const variables = [
      { name: "env", value: "prod" },
      { name: "region", value: ["us", "eu"] },
    ];
    expect(
      renderAnnotationTemplate("$env/${region}: {service}", { service: "x" }, variables),
    ).toEqual({ text: "prod/us, eu: x", missing: [] });
  });

  it("leaves an unknown $name as written and does not read it as a field", () => {
    expect(renderAnnotationTemplate("cost $5 {a}", { a: "1" }).text).toBe("cost $5 1");
  });

  it("does not treat the {{var}} variable syntax as a field", () => {
    expect(renderAnnotationTemplate("{{env}}", {}, [{ name: "env", value: "dev" }])).toEqual({
      text: "dev",
      missing: [],
    });
  });

  it("serialises object values instead of printing [object Object]", () => {
    expect(renderAnnotationTemplate("{meta}", { meta: { a: 1 } }).text).toBe('{"a":1}');
  });

  it("does not mistake a variable's own value for an unresolved {field}", () => {
    const variables = [{ name: "tag", value: "{hotfix}" }];
    expect(
      renderAnnotationTemplate("{service} via $tag", { service: "checkout" }, variables),
    ).toEqual({ text: "checkout via {hotfix}", missing: [] });
  });
});

describe("extractTemplateFields", () => {
  it("lists each field once, skipping variables", () => {
    expect(extractTemplateFields("{a} {b} {a} $c ${d} {{e}}")).toEqual(["a", "b"]);
  });
});

describe("buildAnnotationFiltersSql", () => {
  it("quotes string values and escapes an embedded single quote", () => {
    expect(buildAnnotationFiltersSql(group("AND", [leaf("msg", "=", "it's")]))).toBe(
      `msg = 'it''s'`,
    );
  });

  it("honours each condition's own AND/OR prefix, not just the group's", () => {
    const tree = group("AND", [
      leaf("event", "=", "deploy", "AND"),
      leaf("env", "=", "prod", "AND"),
      leaf("service", "=", "api", "OR"),
    ]);
    expect(buildAnnotationFiltersSql(tree)).toBe(
      `event = 'deploy' AND env = 'prod' OR service = 'api'`,
    );
  });

  it("wraps a nested group in parentheses, honouring its own AND/OR inside", () => {
    const tree = group("AND", [
      leaf("event", "=", "deploy", "AND"),
      group("AND", [
        leaf("namespace", "=", "backend", "OR"),
        leaf("service", "=", "checkout", "OR"),
      ]),
    ]);
    expect(buildAnnotationFiltersSql(tree)).toBe(
      `event = 'deploy' AND (namespace = 'backend' OR service = 'checkout')`,
    );
  });

  it("drops an empty nested group and the operator that would have prefixed it", () => {
    const tree = group("AND", [leaf("event", "=", "deploy"), group("OR", [])]);
    expect(buildAnnotationFiltersSql(tree)).toBe(`event = 'deploy'`);
  });

  it("is empty for a root group with no conditions", () => {
    expect(buildAnnotationFiltersSql(group("AND"))).toBe("");
    expect(buildAnnotationFiltersSql(null)).toBe("");
  });

  it("escapes LIKE values for Contains/NotContains", () => {
    expect(buildAnnotationFiltersSql(group("AND", [leaf("msg", "Contains", "it's")]))).toBe(
      `msg LIKE '%it''s%'`,
    );
    expect(buildAnnotationFiltersSql(group("AND", [leaf("msg", "NotContains", "x")]))).toBe(
      `msg NOT LIKE '%x%'`,
    );
  });

  it("renders a null check without a value, regardless of what the value holds", () => {
    expect(buildAnnotationFiltersSql(group("AND", [leaf("x", "is_null", "'")]))).toBe(`x IS NULL`);
    expect(buildAnnotationFiltersSql(group("AND", [leaf("x", "is_not_null", "")]))).toBe(
      `x IS NOT NULL`,
    );
  });

  it("drops a blank-value condition, keeping a null check with no value", () => {
    const tree = group("AND", [
      leaf("event", "=", "deploy"),
      leaf("", "=", "ignored"),
      leaf("env", "=", ""),
      leaf("x", "is_null", ""),
    ]);
    expect(buildAnnotationFiltersSql(tree)).toBe(`event = 'deploy' AND x IS NULL`);
  });
});

describe("isBlankAnnotationCondition / annotationFiltersHaveBlankCondition", () => {
  it("is blank with no column, or a non-unary operator with no value", () => {
    expect(isBlankAnnotationCondition(leaf("", "=", "x"))).toBe(true);
    expect(isBlankAnnotationCondition(leaf("event", "=", " "))).toBe(true);
    expect(isBlankAnnotationCondition(leaf("event", "is_null", ""))).toBe(false);
    expect(isBlankAnnotationCondition(leaf("event", "=", "deploy"))).toBe(false);
  });

  it("finds a blank leaf anywhere in the tree, including nested groups", () => {
    expect(annotationFiltersHaveBlankCondition(group("AND", [leaf("event", "=", "deploy")]))).toBe(
      false,
    );
    expect(
      annotationFiltersHaveBlankCondition(
        group("AND", [leaf("event", "=", "deploy"), group("OR", [leaf("env", "=", "")])]),
      ),
    ).toBe(true);
  });
});

describe("annotationSourceColumns", () => {
  it("includes a field when no schema is given at all (preserves the existing default)", () => {
    expect(
      annotationSourceColumns({ title: "{ver}", description: null, endTimeField: null }),
    ).toEqual(["_timestamp", "ver"]);
  });

  it("includes every field when the schema is a genuinely empty array", () => {
    expect(
      annotationSourceColumns({ title: "{ver}", description: null, endTimeField: null }, []),
    ).toEqual(["_timestamp", "ver"]);
  });

  it("excludes every non-timestamp field when the schema is null (fetch failed/still pending)", () => {
    expect(
      annotationSourceColumns({ title: "{ver}", description: null, endTimeField: null }, null),
    ).toEqual(["_timestamp"]);
  });
});

describe("buildAnnotationBuilderSql", () => {
  const deploy = {
    stream: "k8s_events",
    filters: group("AND", [
      leaf("event", "=", "deploy"),
      leaf("", "=", "ignored"),
      leaf("env", "=", "$env"),
    ]),
    title: "{service} {ver}",
    description: "by {author} ({service})",
    endTimeField: "end_time",
  };

  it("selects _timestamp plus every field the templates and end time read", () => {
    expect(buildAnnotationBuilderSql(deploy)).toBe(
      [
        `SELECT _timestamp, service, ver, author, end_time`,
        `FROM k8s_events`,
        `WHERE event = 'deploy' AND env = '$env'`,
        `ORDER BY _timestamp DESC`,
      ].join("\n"),
    );
  });

  it("leaves out fields the stream schema lacks, so they render empty instead of failing", () => {
    expect(
      buildAnnotationBuilderSql(deploy, ["_timestamp", "service", "author", "event", "env"]),
    ).toBe(
      [
        `SELECT _timestamp, service, author`,
        `FROM k8s_events`,
        `WHERE event = 'deploy' AND env = '$env'`,
        `ORDER BY _timestamp DESC`,
      ].join("\n"),
    );
  });

  it("honours a nested AND/OR group", () => {
    const tree = {
      stream: "k8s_events",
      filters: group("AND", [
        leaf("event", "=", "deploy"),
        group("AND", [
          leaf("namespace", "=", "backend", "OR"),
          leaf("service", "=", "checkout", "OR"),
        ]),
      ]),
      title: "x",
    };
    expect(buildAnnotationBuilderSql(tree)).toBe(
      [
        `SELECT _timestamp`,
        `FROM k8s_events`,
        `WHERE event = 'deploy' AND (namespace = 'backend' OR service = 'checkout')`,
        `ORDER BY _timestamp DESC`,
      ].join("\n"),
    );
  });

  it("omits WHERE without filters, but still orders by _timestamp", () => {
    expect(buildAnnotationBuilderSql({ stream: "s", filters: group("AND"), title: "x" })).toBe(
      `SELECT _timestamp\nFROM s\nORDER BY _timestamp DESC`,
    );
  });

  it("is what a builder source runs, while a SQL source runs its own query unmodified", () => {
    expect(getAnnotationSourceSql(source({ title: "Deploy {ver}" }), ["service"])).toBe(
      `SELECT _timestamp\nFROM k8s_events\nORDER BY _timestamp DESC`,
    );
    expect(getAnnotationSourceSql(source({ mode: "sql", query: " SELECT 1 " }))).toBe("SELECT 1");
  });

  it("quotes a column that needs it: not a simple identifier, or a reserved keyword", () => {
    expect(buildAnnotationBuilderSql({ stream: "s", filters: group("AND"), title: "x" })).toContain(
      "FROM s",
    );
    expect(buildAnnotationFiltersSql(group("AND", [leaf("weird col", "=", "x")]))).toBe(
      `"weird col" = 'x'`,
    );
  });

  it("quotes a dotted or hyphenated field name, an ordinary field shape this codebase uses", () => {
    expect(buildAnnotationFiltersSql(group("AND", [leaf("k8s.namespace", "=", "x")]))).toBe(
      `"k8s.namespace" = 'x'`,
    );
    expect(buildAnnotationFiltersSql(group("AND", [leaf("service-name", "=", "x")]))).toBe(
      `"service-name" = 'x'`,
    );
  });

  it("neutralizes a malicious column by quoting it as an identifier instead of executing it", () => {
    const malicious = "x = 1 OR 1=1 --";
    expect(buildAnnotationFiltersSql(group("AND", [leaf(malicious, "=", "1")]))).toBe(
      `"x = 1 OR 1=1 --" = '1'`,
    );
  });

  it("resolves a $variable column to its current value before quoting it, escaping a malicious value", () => {
    const tree = group("AND", [leaf("$col", "=", "1")]);
    expect(buildAnnotationFiltersSql(tree, [{ name: "col", value: `evil" OR "1"="1` }])).toBe(
      `"evil"" OR ""1""=""1" = '1'`,
    );
  });
});

describe("sqlFromStream / sqlSelectAliases", () => {
  it("reads the stream a custom query selects from, quoted or bare", () => {
    expect(
      sqlFromStream(`SELECT _timestamp, end_ts FROM "pt_change_calendar" WHERE kind='m'`),
    ).toBe("pt_change_calendar");
    expect(sqlFromStream("select * from app_logs where x = 1")).toBe("app_logs");
    expect(sqlFromStream(`SELECT 1 FROM "a""b"`)).toBe('a"b');
    expect(sqlFromStream("SELECT 1")).toBe("");
  });

  it("lists the aliases a custom query introduces", () => {
    expect(sqlSelectAliases(`SELECT _timestamp, max(x) AS "peak", y as label FROM s`)).toEqual([
      "peak",
      "label",
    ]);
  });
});

describe("annotationSourceTargetsPanel", () => {
  it("targets every time-series panel when no panel list is set", () => {
    expect(annotationSourceTargetsPanel(source(), "p1", "line")).toBe(true);
    expect(annotationSourceTargetsPanel(source({ panels: null }), "p9", "area-stacked")).toBe(true);
  });

  it("targets no panel when its list was emptied", () => {
    expect(annotationSourceTargetsPanel(source({ panels: [] }), "p1", "line")).toBe(false);
  });

  it("never targets a non time-series panel, even when listed", () => {
    expect(annotationSourceTargetsPanel(source({ panels: ["t1"] }), "t1", "table")).toBe(false);
    expect(annotationSourceTargetsPanel(source(), "m1", "metric")).toBe(false);
  });

  it("targets only the listed panels", () => {
    const listed = source({ panels: ["p1", "p2"] });
    expect(annotationSourceTargetsPanel(listed, "p2", "bar")).toBe(true);
    expect(annotationSourceTargetsPanel(listed, "p3", "bar")).toBe(false);
  });

  it("never targets from a disabled source", () => {
    expect(annotationSourceTargetsPanel(source({ enabled: false }), "p1", "line")).toBe(false);
  });
});

describe("toMicroseconds", () => {
  it("normalises micro, milli and second epochs, as numbers or numeric strings", () => {
    expect(toMicroseconds(1_700_000_000_000_000)).toBe(1_700_000_000_000_000);
    expect(toMicroseconds(1_700_000_000_000)).toBe(1_700_000_000_000_000);
    expect(toMicroseconds(1_700_000_000)).toBe(1_700_000_000_000_000);
    expect(toMicroseconds("1700000000000000")).toBe(1_700_000_000_000_000);
    expect(toMicroseconds("1700000000000")).toBe(1_700_000_000_000_000);
    expect(toMicroseconds("1700000000")).toBe(1_700_000_000_000_000);
  });

  it("parses a zoned ISO string using its own offset", () => {
    expect(toMicroseconds("2023-11-14T22:13:20Z")).toBe(1_700_000_000_000_000);
    expect(toMicroseconds("2023-11-14T22:13:20+00:00")).toBe(1_700_000_000_000_000);
  });

  it("parses a zone-less ISO string as UTC, not local time", () => {
    expect(toMicroseconds("2023-11-14T22:13:20")).toBe(1_700_000_000_000_000);
  });

  it("returns null for blanks and garbage", () => {
    expect(toMicroseconds(null)).toBeNull();
    expect(toMicroseconds("")).toBeNull();
    expect(toMicroseconds("not a time")).toBeNull();
  });
});

describe("annotationRowsToMarkers", () => {
  it("renders each row into a marker carrying its source", () => {
    const markers = annotationRowsToMarkers(
      source({ description: "on $env", endTimeField: "end" }),
      [
        { _timestamp: 1_700_000_000_000_000, service: "api", end: 1_700_000_060_000_000 },
        { _timestamp: 1_700_000_100_000_000, service: "web", end: 1 },
        { service: "no time" },
      ],
      [{ name: "env", value: "prod" }],
    );
    expect(markers).toEqual([
      {
        start_time: 1_700_000_000_000_000,
        end_time: 1_700_000_060_000_000,
        title: "api deployed",
        text: "on prod",
        source: { id: "s1", name: "Deploys", color: "#5b8ef0" },
      },
      {
        start_time: 1_700_000_100_000_000,
        end_time: null,
        title: "web deployed",
        text: "on prod",
        source: { id: "s1", name: "Deploys", color: "#5b8ef0" },
      },
    ]);
  });
});

describe("summarizeAnnotationPreview", () => {
  it("flags placeholders and an end field that no row carries", () => {
    const summary = summarizeAnnotationPreview(
      source({ mode: "sql", title: "{title}", description: "{who}", endTimeField: "end" }),
      [{ _timestamp: 1_700_000_000_000_000, title: "a" }],
    );
    expect(summary.missingFields).toEqual(["who"]);
    expect(summary.endFieldMissing).toBe(true);
    expect(summary.rows).toHaveLength(1);
  });

  it("does not flag a field some rows carry", () => {
    const summary = summarizeAnnotationPreview(source({ title: "{who}" }), [
      { _timestamp: 1 },
      { _timestamp: 2, who: "x" },
    ]);
    expect(summary.missingFields).toEqual([]);
  });

  it("flags nothing but the empty result when no rows came back", () => {
    const summary = summarizeAnnotationPreview(source({ endTimeField: "end" }), []);
    expect(summary).toEqual({
      rows: [],
      missingFields: [],
      endFieldMissing: false,
      timestampMissing: false,
      truncated: false,
    });
    expect(annotationPreviewHasProblems(summary)).toBe(false);
  });

  it("checks fields against the stream schema when it is known, rows or not", () => {
    const summary = summarizeAnnotationPreview(
      source({ title: "Deploy {ver}", endTimeField: "end_ts" }),
      [],
      [],
      ["_timestamp", "version", "end_ts"],
    );
    expect(summary.missingFields).toEqual(["ver"]);
    expect(summary.endFieldMissing).toBe(false);
    expect(annotationPreviewHasProblems(summary)).toBe(true);
  });

  it("still draws a marker whose placeholder is missing, with that slot empty", () => {
    const summary = summarizeAnnotationPreview(source({ title: "Deploy {ver}" }), [
      { _timestamp: 1_700_000_000_000_000, version: "v2" },
    ]);
    expect(summary.rows).toEqual([
      { time: 1_700_000_000_000_000, end: null, title: "Deploy", description: "" },
    ]);
    expect(summary.missingFields).toEqual(["ver"]);
  });

  it("trusts rows with a usable _timestamp over the SQL text, even when the text never names it", () => {
    // The server adds _timestamp to a plain SELECT; the SQL text must not be what blocks this.
    const summary = summarizeAnnotationPreview(
      source({ mode: "sql", query: `SELECT title FROM "cal"`, title: "{title}" }),
      [{ _timestamp: 1_700_000_000_000_000, title: "x" }],
    );
    expect(summary.timestampMissing).toBe(false);
  });

  it("uses the response's column list to decide a zero-row Custom SQL result", () => {
    const base = source({ mode: "sql", query: `SELECT title FROM "cal"`, title: "{title}" });
    expect(
      summarizeAnnotationPreview(base, [], [], [], ["_timestamp", "title"]).timestampMissing,
    ).toBe(false);
    expect(summarizeAnnotationPreview(base, [], [], [], ["title"]).timestampMissing).toBe(true);
  });

  it("does not block on the timestamp check when the server sent no column list for a zero-row result", () => {
    const base = source({ mode: "sql", query: `SELECT title FROM "cal"`, title: "{title}" });
    expect(summarizeAnnotationPreview(base, [], [], [], null).timestampMissing).toBe(false);
    expect(summarizeAnnotationPreview(base, []).timestampMissing).toBe(false);
  });

  it("flags truncation when the query returns exactly the preview row cap", () => {
    const rows = Array.from({ length: ANNOTATION_PREVIEW_ROW_LIMIT }, (_, index) => ({
      _timestamp: 1_700_000_000_000_000 + index,
      title: `row${index}`,
    }));
    expect(summarizeAnnotationPreview(source({ title: "{title}" }), rows).truncated).toBe(true);
    expect(
      summarizeAnnotationPreview(source({ title: "{title}" }), rows.slice(0, -1)).truncated,
    ).toBe(false);
  });

  it("flags rows that come back without a usable _timestamp", () => {
    const summary = summarizeAnnotationPreview(
      source({ mode: "sql", query: "SELECT _timestamp, count(*) AS n FROM s", title: "{n}" }),
      [{ n: 3 }],
    );
    expect(summary.timestampMissing).toBe(true);
    expect(summary.rows).toEqual([]);
    expect(annotationPreviewHasProblems(summary)).toBe(true);
  });
});

describe("validateAnnotationSources", () => {
  it("accepts a missing list and a valid list", () => {
    expect(validateAnnotationSources(t, undefined)).toEqual([]);
    expect(
      validateAnnotationSources(t, [
        source(),
        source({ id: "s2", name: "SQL source", mode: "sql", query: "SELECT 1" }),
      ]),
    ).toEqual([]);
  });

  it("rejects a non-array", () => {
    expect(validateAnnotationSources(t, {})).toEqual(["annotationSources must be an array"]);
  });

  it("rejects a duplicate name, case-insensitively and trimmed", () => {
    expect(
      validateAnnotationSources(t, [
        source({ id: "s1", name: "Deploys" }),
        source({ id: "s2", name: " DEPLOYS " }),
      ]),
    ).toEqual(["Annotation source 2: Another source already uses this name"]);
  });

  it("rejects a color that is not a 6-digit hex code", () => {
    expect(validateAnnotationSources(t, [source({ color: "red" })])).toEqual([
      "Annotation source 1: Color must be a 6-digit hex code",
    ]);
  });

  it("accepts a source with no color at all", () => {
    expect(validateAnnotationSources(t, [{ ...source(), color: undefined }])).toEqual([]);
  });

  it("accepts exactly the cap and rejects one over it", () => {
    const atCap = Array.from({ length: MAX_ANNOTATION_SOURCES }, (_, i) =>
      source({ id: `s${i}`, name: `Source ${i}` }),
    );
    expect(validateAnnotationSources(t, atCap)).toEqual([]);

    const overCap = [...atCap, source({ id: "over", name: "Over" })];
    expect(validateAnnotationSources(t, overCap)).toEqual([
      `A dashboard can have at most ${MAX_ANNOTATION_SOURCES} annotation sources.`,
    ]);
  });

  it("reports each broken source by position", () => {
    const errors = validateAnnotationSources(t, [
      source(),
      source({ name: "", title: " " }),
      source({ name: "SQL source", mode: "sql", query: "" }),
      source({ id: "s9", name: "Ops", filters: group("AND", [leaf("a", "LIKE", "x")]) }),
      "nope",
    ]);
    expect(errors).toEqual([
      "Annotation source 2: ID s1 is used more than once",
      "Annotation source 2: Name is required",
      "Annotation source 2: Title is required",
      "Annotation source 3: ID s1 is used more than once",
      "Annotation source 3: Enter a query",
      "Annotation source 4: Filter operator LIKE is not supported",
      "Annotation source 5: Each annotation source must be an object",
    ]);
  });

  it("accepts a dotted or hyphenated filter column, an ordinary field shape", () => {
    expect(
      validateAnnotationSources(t, [
        source({ filters: group("AND", [leaf("k8s.namespace", "=", "x")]) }),
      ]),
    ).toEqual([]);
    expect(
      validateAnnotationSources(t, [
        source({ filters: group("AND", [leaf("service-name", "=", "x")]) }),
      ]),
    ).toEqual([]);
  });

  it("rejects a filter column that could break out of a quoted identifier", () => {
    expect(
      validateAnnotationSources(t, [source({ filters: group("AND", [leaf('a"b', "=", "x")]) })]),
    ).toEqual(['Annotation source 1: Filter column a"b is not supported']);
    expect(
      validateAnnotationSources(t, [
        source({ filters: group("AND", [leaf("a; DROP TABLE x", "=", "1")]) }),
      ]),
    ).toEqual(["Annotation source 1: Filter column a; DROP TABLE x is not supported"]);
  });
});

describe("isValidAnnotationColumn", () => {
  it("allows a plain identifier, a dotted or hyphenated field, and a $variable reference", () => {
    expect(isValidAnnotationColumn("service")).toBe(true);
    expect(isValidAnnotationColumn("k8s.namespace")).toBe(true);
    expect(isValidAnnotationColumn("service-name")).toBe(true);
    expect(isValidAnnotationColumn("$env")).toBe(true);
  });

  it("rejects empty, a double quote, a semicolon, --, and control characters", () => {
    expect(isValidAnnotationColumn("")).toBe(false);
    expect(isValidAnnotationColumn("$")).toBe(false);
    expect(isValidAnnotationColumn('a"b')).toBe(false);
    expect(isValidAnnotationColumn("a;b")).toBe(false);
    expect(isValidAnnotationColumn("a -- b")).toBe(false);
    expect(isValidAnnotationColumn("a\nb")).toBe(false);
  });
});
