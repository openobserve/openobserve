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

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FREE_TEXT_SCHEMA_MAX_AGE_MS,
  buildFilterContext,
  filterForParsing,
  freeTextDecorations,
  freeTextHighlight,
  freeTextWhereByStream,
  noFtsStreams,
  noFtsRecoveryTerm,
  noFtsRecoveryStreams,
  rewrittenFilter,
  planStreamsFilter,
  recoveryCardsFor,
  refreshFreeTextSchemas,
  resetFreeTextSchemasForTests,
  searchTextReplacement,
  type FreeTextSearchObj,
} from "./freeTextSearch";
import { planFilter } from "@/utils/query/freeTextFilter";

vi.mock("@/utils/query/sqlIdentifiers", () => ({
  quoteSqlIdentifierIfNeeded: (identifier: string) => identifier,
}));

const fts = (name: string, extra: { name: string; type: string }[] = []) => ({
  name,
  schema: [{ name: "body", type: "Utf8" }, { name: "level", type: "Utf8" }, ...extra],
  settings: {},
});

const noFts = (name: string) => ({
  name,
  schema: [
    { name: "msg_text", type: "Utf8" },
    { name: "detail", type: "Utf8" },
  ],
  settings: {},
});

const zeroText = (name: string) => ({
  name,
  schema: [{ name: "code", type: "Int64" }],
  settings: {},
});

const zoConfig = { default_fts_keys: ["body", "log", "message"] };

const makeSearchObj = (query: string, streams: any[]): FreeTextSearchObj => ({
  organizationIdentifier: "org1",
  meta: { sqlMode: false, freeTextScan: {} },
  data: {
    query,
    stream: {
      selectedStream: streams.map((s) => s.name),
      selectedStreamFields: streams.flatMap((s) =>
        (s.schema ?? []).map((f: any) => ({ name: f.name })),
      ),
      streamType: "logs",
    },
    streamResults: { list: streams },
    freeTextBlocked: null,
  },
});

const t = (key: string, params?: Record<string, unknown>) =>
  `${key}${params ? JSON.stringify(params) : ""}`;

beforeEach(() => {
  resetFreeTextSchemasForTests();
});

describe("buildFilterContext", () => {
  it("counts _all_values that removeSchemaFields stripped from the schema (spec 6.2)", () => {
    const stream = {
      name: "s",
      schema: [{ name: "code", type: "Int64" }],
      removedSchemaFields: [{ name: "_all_values", type: "LargeUtf8" }],
      settings: { index_all_values: true },
    };
    const ctx = buildFilterContext(makeSearchObj("x", [stream]), { default_fts_keys: [] });
    expect(ctx.targets.s).toEqual({ mode: "fts", fields: ["_all_values"] });
    expect(ctx.fieldNames.has("_all_values")).toBe(true);
  });

  it("passes the configured backend UDS limit into stream target resolution", () => {
    const stream = {
      ...fts("app"),
      settings: { defined_schema_fields: ["level", "code"] },
    };
    const obj = makeSearchObj("error", [stream]);
    expect(
      buildFilterContext(obj, { ...zoConfig, quick_mode_num_fields: 2 }).targets.app.mode,
    ).toBe("blocked");
    const ctx = buildFilterContext(obj, { ...zoConfig, quick_mode_num_fields: 1 });
    expect(ctx.targets.app).toEqual({ mode: "fts", fields: ["body"] });
    expect(freeTextWhereByStream(obj, { ...zoConfig, quick_mode_num_fields: 1 })?.get("app")).toBe(
      "match_all('error')",
    );
  });

  it("disables text while a selected stream has no schema, so the filter is sent unchanged", () => {
    const ctx = buildFilterContext(makeSearchObj("timeout", [{ name: "s" }]), zoConfig);
    expect(ctx.textEnabled).toBe(false);
    expect(planStreamsFilter("timeout", ["s"], ctx)).toEqual({ kind: "sql", filter: "timeout" });
  });

  it("lists field names and stream names as field-like", () => {
    const ctx = buildFilterContext(makeSearchObj("", [fts("app")]), zoConfig);
    expect([...ctx.fieldNames].sort()).toEqual(["app", "body", "level"]);
    expect(planStreamsFilter("level", ["app"], ctx).kind).toBe("sql");
    expect(planStreamsFilter("app", ["app"], ctx).kind).toBe("sql");
  });

  it("applies the token gate for fts targets only (AC5.9)", () => {
    const ctxFts = buildFilterContext(makeSearchObj("a", [fts("app")]), zoConfig);
    expect(planStreamsFilter("a", ["app"], ctxFts).kind).toBe("sql");
    const ctxBlocked = buildFilterContext(makeSearchObj("a", [noFts("raw")]), zoConfig);
    expect(planStreamsFilter("a", ["raw"], ctxBlocked).kind).toBe("freeText");
  });

  it("reads the token limits from /config and falls back to 2 and 64", () => {
    const obj = makeSearchObj("timeout", [fts("app")]);
    const strict = buildFilterContext(obj, { ...zoConfig, inverted_index_min_token_length: 8 });
    expect(planStreamsFilter("timeout", ["app"], strict).kind).toBe("sql");
    expect(buildFilterContext(obj, zoConfig).tokenLimits).toEqual({ min: 2, max: 64 });
  });
});

describe("freeTextHighlight and freeTextDecorations", () => {
  it("renders for the first stream that can search text", () => {
    const obj = makeSearchObj("timeout", [noFts("raw"), fts("app")]);
    const ctx = buildFilterContext(obj, zoConfig);
    expect(freeTextHighlight(obj, ctx)).toBe("match_all('timeout')");
  });

  it("returns nothing for SQL filters, so their highlight is unchanged", () => {
    const obj = makeSearchObj("level='x'", [fts("app")]);
    const ctx = buildFilterContext(obj, zoConfig);
    expect(freeTextHighlight(obj, ctx)).toBeNull();
    expect(freeTextDecorations(obj, ctx, t)).toBeNull();
  });

  it("decorates phrases with their source offsets and skips connectives", () => {
    const obj = makeSearchObj('  "connection refused" OR timeout', [fts("app")]);
    const deco = freeTextDecorations(obj, buildFilterContext(obj, zoConfig), t);
    expect(deco?.ranges).toEqual([
      { start: 2, end: 22 },
      { start: 26, end: 33 },
    ]);
    expect(deco?.hover).toContain('search.freeTextSearchedFields{"fields":"body"}');
  });

  it("has no decoration when no stream can search text", () => {
    const obj = makeSearchObj("timeout", [noFts("raw")]);
    expect(freeTextDecorations(obj, buildFilterContext(obj, zoConfig), t)).toBeNull();
  });
});

describe("recoveryCardsFor and searchTextReplacement (J5)", () => {
  it("offers Run as for a text+field mix on full-text streams (AC5.6)", () => {
    const obj = makeSearchObj("level='api' timeout", [fts("app")]);
    expect(recoveryCardsFor(obj, zoConfig)).toEqual({
      runSuggestion: "level='api' AND match_all('timeout')",
      freeTextCandidate: null,
    });
  });

  it("offers only Search text when a stream lacks full-text fields (AC5.6)", () => {
    const obj = makeSearchObj("level='api' timeout", [noFts("raw")]);
    expect(recoveryCardsFor(obj, zoConfig).runSuggestion).toBeNull();
  });

  it("offers Search text for unclassifiable input and nothing in SQL mode (AC5.1, AC5.3)", () => {
    const obj = makeSearchObj("status = ", [fts("app")]);
    expect(recoveryCardsFor(obj, zoConfig).freeTextCandidate).toBe("status =");
    obj.meta.sqlMode = true;
    expect(recoveryCardsFor(obj, zoConfig)).toEqual({
      runSuggestion: null,
      freeTextCandidate: null,
    });
  });

  it("writes durable match_all on full-text streams, which later runs keep as SQL (AC5.2, AC5.7)", () => {
    const obj = makeSearchObj("level", [fts("app")]);
    const text = searchTextReplacement("level", obj, zoConfig);
    expect(text).toBe("match_all('level')");
    expect(planFilter(text, new Set(["level", "body"])).kind).toBe("sql");
    expect(searchTextReplacement("it's a", obj, zoConfig)).toBe("match_all('it''s a')");
  });

  it("writes a quoted phrase on a no-FTS stream, which stays text (AC5.9)", () => {
    const obj = makeSearchObj("a", [noFts("raw")]);
    const text = searchTextReplacement("status =", obj, zoConfig);
    expect(text).toBe("'status ='");
    expect(planFilter(text, new Set(["msg_text"]), { targetMode: "blocked" }).kind).toBe(
      "freeText",
    );
  });
});

describe("freeTextWhereByStream and filterForParsing", () => {
  it("renders text per stream and keeps no text nodes where a stream cannot search (AC6.4)", () => {
    const obj = makeSearchObj("timeout", [fts("app"), noFts("raw")]);
    expect([...(freeTextWhereByStream(obj, zoConfig) ?? new Map())]).toEqual([
      ["app", "match_all('timeout')"],
      ["raw", "FALSE"],
    ]);
  });

  it("returns null for SQL filters, which keep today's values path", () => {
    expect(freeTextWhereByStream(makeSearchObj("level='x'", [fts("app")]), zoConfig)).toBeNull();
  });

  it("parses text as match_all so a word never looks like a column (AC6.5)", () => {
    expect(filterForParsing("timeout", new Set(["level"]))).toBe("match_all('timeout')");
    expect(filterForParsing("match_all('timeout') and level='error'", new Set(["level"]))).toBe(
      "match_all('timeout') and level='error'",
    );
  });
});

describe("noFtsStreams", () => {
  it("marks a stream with no string field at all (AC3.7)", () => {
    const obj = makeSearchObj("timeout", [noFts("raw"), zeroText("metrics_only")]);
    obj.data.freeTextBlocked = {
      streams: ["raw", "metrics_only"],
      plan: planFilter("x", new Set()),
    };
    expect(noFtsStreams(obj, zoConfig)).toEqual([
      { name: "raw", hasTextFields: true },
      { name: "metrics_only", hasTextFields: false },
    ]);
  });
});

describe("planStreamsFilter mixed rewrites", () => {
  it("rewrites a text+SQL mix only when every selected stream has FTS", () => {
    const raw = "timeout and level='x'";
    const both = makeSearchObj(raw, [fts("app"), fts("web")]);
    expect(planStreamsFilter(raw, ["app", "web"], buildFilterContext(both, zoConfig))).toEqual({
      kind: "sql",
      filter: "match_all('timeout') AND level='x'",
    });
    const mixed = makeSearchObj(raw, [fts("app"), noFts("raw")]);
    expect(planStreamsFilter(raw, ["app", "raw"], buildFilterContext(mixed, zoConfig))).toEqual({
      kind: "sql",
      filter: raw,
    });
  });
});

describe("refreshFreeTextSchemas (spec 6.3 residual risk)", () => {
  it("re-reads the schema once before the first rewrite and uses its new fields", async () => {
    const obj = makeSearchObj("is_error", [fts("app")]);
    const fetchStream = vi.fn(async () => fts("app", [{ name: "is_error", type: "Boolean" }]));

    await refreshFreeTextSchemas(obj, zoConfig, fetchStream, 1_000);
    await refreshFreeTextSchemas(obj, zoConfig, fetchStream, 2_000);

    expect(fetchStream).toHaveBeenCalledTimes(1);
    const ctx = buildFilterContext(obj, zoConfig);
    expect(planStreamsFilter("is_error", ["app"], ctx).kind).toBe("sql");
  });

  it("re-reads a schema older than ten minutes", async () => {
    const obj = makeSearchObj("timeout", [fts("app")]);
    const fetchStream = vi.fn(async () => fts("app"));
    await refreshFreeTextSchemas(obj, zoConfig, fetchStream, 0);
    await refreshFreeTextSchemas(obj, zoConfig, fetchStream, FREE_TEXT_SCHEMA_MAX_AGE_MS + 1);
    expect(fetchStream).toHaveBeenCalledTimes(2);
  });

  it("sends the filter unchanged after a failed refresh, and retries on the next run", async () => {
    const obj = makeSearchObj("timeout", [fts("app")]);
    const fetchStream = vi
      .fn()
      .mockRejectedValueOnce(new Error("403"))
      .mockResolvedValueOnce(fts("app"));

    await refreshFreeTextSchemas(obj, zoConfig, fetchStream, 0);
    expect(planStreamsFilter("timeout", ["app"], buildFilterContext(obj, zoConfig)).kind).toBe(
      "sql",
    );

    await refreshFreeTextSchemas(obj, zoConfig, fetchStream, 1);
    expect(planStreamsFilter("timeout", ["app"], buildFilterContext(obj, zoConfig)).kind).toBe(
      "freeText",
    );
  });

  it("re-reads before a mixed rewrite, so a new boolean field stays a SQL predicate", async () => {
    const obj = makeSearchObj("is_error and level='x'", [fts("app")]);
    const fetchStream = vi.fn(async () => fts("app", [{ name: "is_error", type: "Boolean" }]));
    await refreshFreeTextSchemas(obj, zoConfig, fetchStream, 0);
    expect(fetchStream).toHaveBeenCalledTimes(1);
    const ctx = buildFilterContext(obj, zoConfig);
    const raw = "is_error and level='x'";
    expect(planStreamsFilter(raw, ["app"], ctx)).toEqual({ kind: "sql", filter: raw });
  });

  it("does nothing for SQL filters or in SQL mode", async () => {
    const fetchStream = vi.fn();
    await refreshFreeTextSchemas(makeSearchObj("level='x'", [fts("app")]), zoConfig, fetchStream);
    const sqlMode = makeSearchObj("timeout", [fts("app")]);
    sqlMode.meta.sqlMode = true;
    await refreshFreeTextSchemas(sqlMode, zoConfig, fetchStream);
    expect(fetchStream).not.toHaveBeenCalled();
  });
});

describe("recovery terms and editor comment preservation", () => {
  it("offers only backend-searchable UDS fields at the limit", () => {
    const entry = noFts("raw");
    entry.schema = [
      { name: "level", type: "Utf8" },
      { name: "extra", type: "Utf8" },
    ];
    entry.settings = { defined_schema_fields: ["level"] };
    const obj = makeSearchObj("error", [entry]);
    expect(noFtsRecoveryStreams(obj, ["raw"], zoConfig)[0].schema.map((f) => f.name)).toEqual([
      "level",
    ]);
    expect(noFtsRecoveryStreams(obj, ["raw"], { quick_mode_num_fields: 0 })[0].schema).toEqual(
      entry.schema,
    );
  });

  it.each([
    ["-refused", ""],
    ["debug -message", "debug"],
    ["debug timeout", "debug"],
    ['-"connection refused"', ""],
    ['"connection refused" -debug', "connection refused"],
    ["NOT NOT debug", "debug"],
  ])("prefills one positive unit for %s", (query, expected) => {
    expect(noFtsRecoveryTerm(makeSearchObj(query, [noFts("raw")]), zoConfig)).toBe(expected);
  });

  it.each([
    ["error -- note\nAND level='x'", "-- note\nmatch_all('error') AND level = 'x'"],
    ["error /* note */ timeout", "/* note */\nmatch_all('error') AND match_all('timeout')"],
    [
      "error AND level=/* inside */'x' -- tail",
      "-- tail\nmatch_all('error') AND level = /* inside */'x'",
    ],
    ["error--timeout", "match_all('error--timeout')"],
    ["'error -- literal'", "match_all('error -- literal')"],
    ["it's -- note", "-- note\nmatch_all('it''s')"],
    ["'error -- note' -- note", "-- note\nmatch_all('error -- note')"],
    ["error /* same */ /* same */", "/* same */\n/* same */\nmatch_all('error')"],
  ])("retains comments in the editor rendering of %s", (query, expected) => {
    expect(
      rewrittenFilter(
        makeSearchObj(query, [fts("app")]),
        buildFilterContext(makeSearchObj(query, [fts("app")]), zoConfig),
      ),
    ).toBe(expected);
  });
});
