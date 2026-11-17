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

import { beforeAll, describe, expect, it } from "vitest";
import { reactive } from "vue";
import { createTracesSqlTexts, type TracesSqlTextsHost } from "./tracesSqlTexts";

const parser: { value: any } = { value: null };

beforeAll(async () => {
  const mod = await import("@openobserve/node-sql-parser/build/datafusionsql");
  parser.value = new mod.default.Parser();
});

const PREFILL = `SELECT * FROM "default" WHERE service_name = 'api' ORDER BY start_time DESC`;
const GROUPED = `SELECT service_name, count(*) FROM "default" WHERE a = 1 GROUP BY service_name`;

const setup = (view: "traces" | "spans" = "spans", editorValue = "service_name = 'api'") => {
  const host = reactive({
    meta: { searchMode: view, sqlMode: false, scope: "all", resultGrid: { sortBy: "start_time" } },
    data: { editorValue, stream: { selectedStream: { value: "default" }, hasParentColumn: true } },
  }) as TracesSqlTextsHost;
  return { host, ...createTracesSqlTexts(host, parser) };
};

// Spans with SQL on and the grouped query typed over the pre-fill.
const spansWithSql = (sql = GROUPED) => {
  const ctx = setup();
  ctx.turnSqlOn();
  ctx.host.data.editorValue = sql;
  return ctx;
};

describe("two texts", () => {
  it("forgets the sidebar's own conditions with the SQL text, so they never claim later text", () => {
    const ctx = spansWithSql(`SELECT * FROM "default" WHERE service_name = 'api'`);
    const own = { service_name: { text: "service_name = 'api'", values: ["api"], exclude: false } };
    ctx.host.data.stream.sqlFieldConditions = { ...own };
    ctx.leaveSql();
    expect(ctx.host.data.stream.sqlFieldConditions).toEqual(own);
    ctx.reset();
    expect(ctx.host.data.stream.sqlFieldConditions).toEqual({});

    const typed = spansWithSql(`SELECT * FROM "default" WHERE service_name = 'api'`);
    typed.host.data.stream.sqlFieldConditions = { ...own };
    typed.host.data.editorValue = "service_name = 'api'";
    typed.deleteSqlText();
    expect(typed.host.data.stream.sqlFieldConditions).toEqual({});
  });

  it("pre-fills from the filter the first time, and brings the stored SQL text back after", () => {
    const ctx = setup();
    ctx.turnSqlOn();
    expect(ctx.host.meta.sqlMode).toBe(true);
    expect(ctx.host.data.editorValue).toBe(PREFILL);
    expect(ctx.sqlTexts.prefill).toBe(PREFILL);

    ctx.host.data.editorValue = GROUPED;
    ctx.leaveSql();
    expect(ctx.host.data.editorValue).toBe("service_name = 'api'");
    expect(ctx.sqlTexts.sql).toBe(GROUPED);

    ctx.host.data.editorValue = "duration > 1";
    ctx.turnSqlOn();
    expect(ctx.host.data.editorValue).toBe(GROUPED);
    expect(ctx.sqlTexts.filter).toBe("duration > 1");
  });

  it("writes the Spans scope into the pre-fill, and the scope steps back to All spans", () => {
    const ctx = setup();
    ctx.host.meta.scope = "root";
    ctx.turnSqlOn();
    expect(ctx.host.data.editorValue).toContain(
      "(reference_parent_span_id IS NULL OR reference_parent_span_id = '')",
    );
    expect(ctx.host.meta.scope).toBe("all");
  });

  it("SQL off in Spans drops an untouched pre-fill and gives back the scope it folded in", () => {
    const ctx = setup();
    ctx.host.meta.scope = "root";
    ctx.turnSqlOn();
    ctx.leaveSql();
    expect(ctx.host.meta.sqlMode).toBe(false);
    expect(ctx.host.meta.scope).toBe("root");
    expect(ctx.host.data.editorValue).toBe("service_name = 'api'");
    expect(ctx.sqlTexts.sql).toBe("");
    expect(ctx.sqlTexts.prefill).toBeNull();
  });

  it("SQL off over an erased pre-fill gives back the scope it folded in", () => {
    const ctx = setup();
    ctx.host.meta.scope = "root";
    ctx.turnSqlOn();
    ctx.host.data.editorValue = "";
    ctx.leaveSql();
    expect(ctx.host.meta.scope).toBe("root");
    expect(ctx.sqlTexts.prefill).toBeNull();
    expect(ctx.sqlTexts.scopeBeforePrefill).toBeNull();
    expect(ctx.sqlTexts.sql).toBe("");
  });

  it("gives back the folded scope only while the select still shows All spans", () => {
    const ctx = setup();
    ctx.host.meta.scope = "root";
    ctx.turnSqlOn();
    ctx.host.meta.scope = "entrypoint";
    ctx.leaveSql();
    expect(ctx.host.meta.scope).toBe("entrypoint");
  });

  it("keeps an empty editor empty, so the template gallery shows", () => {
    const ctx = setup("spans", "");
    ctx.turnSqlOn();
    expect(ctx.host.meta.sqlMode).toBe(true);
    expect(ctx.host.data.editorValue).toBe("");
    expect(ctx.sqlTexts.prefill).toBeNull();
  });

  it("keeps a statement typed over the filter as the SQL text, and the filter from before it", () => {
    const ctx = setup();
    ctx.noteFilterText("duration > 1");
    ctx.noteFilterText("SEL");
    ctx.noteFilterText(GROUPED);
    ctx.host.data.editorValue = GROUPED;
    ctx.turnSqlOn();
    expect(ctx.host.data.editorValue).toBe(GROUPED);
    expect(ctx.sqlTexts.filter).toBe("duration > 1");
  });

  it("notes a cleared filter, so a statement typed after it keeps the empty filter", () => {
    const ctx = setup();
    ctx.noteFilterText("a = 1");
    ctx.noteFilterText("");
    ctx.noteFilterText("S");
    expect(ctx.sqlTexts.filterBeforeStatement).toBe("");
  });

  it("does not note the first letters of a statement typed over the filter", () => {
    const ctx = setup();
    ctx.noteFilterText("a = 1");
    ctx.noteFilterText("SEL");
    expect(ctx.sqlTexts.filterBeforeStatement).toBe("a = 1");
  });

  it("deleting the SELECT turns SQL off, keeps what is left and gives back the folded scope", () => {
    const ctx = setup();
    ctx.host.meta.scope = "root";
    ctx.turnSqlOn();
    ctx.host.data.editorValue = "s";
    ctx.deleteSqlText();
    expect(ctx.host.meta.sqlMode).toBe(false);
    expect(ctx.host.data.editorValue).toBe("s");
    expect(ctx.host.meta.scope).toBe("root");
    expect(ctx.sqlTexts.sql).toBe("");
  });

  it("forgets everything on reset", () => {
    const ctx = spansWithSql();
    ctx.normalizeTracesView("traces", { kind: "move" });
    ctx.reset();
    expect(ctx.sqlTexts.sql).toBe("");
    expect(ctx.sqlTexts.filterBeforeStatement).toBe("");
  });
});

describe("normalizeTracesView: the seven paths", () => {
  it("1, 2: a toggle or the nav to Traces turns SQL off, shows the filter and keeps the SQL text", () => {
    const ctx = spansWithSql();
    ctx.host.meta.resultGrid.sortBy = "service_name";
    const out = ctx.normalizeTracesView("traces", { kind: "move" });
    expect(out).toEqual({ view: "traces", waitForRun: false });
    expect(ctx.host.meta.searchMode).toBe("traces");
    expect(ctx.host.meta.sqlMode).toBe(false);
    expect(ctx.host.data.editorValue).toBe("service_name = 'api'");
    expect(ctx.sqlTexts.sql).toBe(GROUPED);
    expect(ctx.host.meta.resultGrid.sortBy).toBe("start_time");
  });

  it("1: a plain click back on Spans brings the SQL back on, waiting for Run", () => {
    const ctx = spansWithSql();
    ctx.normalizeTracesView("traces", { kind: "move" });
    ctx.host.data.editorValue = "duration > 5";
    const out = ctx.normalizeTracesView("spans", { kind: "move" });
    expect(out).toEqual({ view: "spans", waitForRun: true });
    expect(ctx.host.meta.sqlMode).toBe(true);
    expect(ctx.host.data.editorValue).toBe(GROUPED);
    expect(ctx.sqlTexts.filter).toBe("duration > 5");
  });

  it("1: a plain Spans click brings the stored SQL back, even when Spans was left with SQL off", () => {
    const ctx = spansWithSql();
    ctx.leaveSql();
    ctx.normalizeTracesView("traces", { kind: "move" });
    expect(ctx.sqlTexts.sql).toBe(GROUPED);
    const out = ctx.normalizeTracesView("spans", { kind: "move" });
    expect(out.waitForRun).toBe(true);
    expect(ctx.host.meta.sqlMode).toBe(true);
    expect(ctx.host.data.editorValue).toBe(GROUPED);
  });

  it("1: a plain Spans click with no stored SQL stays in filter mode", () => {
    const ctx = setup("traces", "a = 1");
    const out = ctx.normalizeTracesView("spans", { kind: "move" });
    expect(out.waitForRun).toBe(false);
    expect(ctx.host.meta.sqlMode).toBe(false);
    expect(ctx.host.data.editorValue).toBe("a = 1");
  });

  it("3: Back or Forward to a Spans SQL entry shows the entry's SQL, waiting for Run", () => {
    const ctx = setup("traces", "a = 1");
    const out = ctx.normalizeTracesView("spans", { kind: "move", sql: GROUPED });
    expect(out).toEqual({ view: "spans", waitForRun: true });
    expect(ctx.host.data.editorValue).toBe(GROUPED);
    expect(ctx.sqlTexts.filter).toBe("a = 1");
  });

  it("4: a landing link with tab=traces and sql_mode=true opens Spans with SQL on", () => {
    const ctx = setup("traces", "");
    const out = ctx.normalizeTracesView("traces", { kind: "open", text: GROUPED, sqlMode: true });
    expect(out.view).toBe("spans");
    expect(ctx.host.meta.sqlMode).toBe(true);
    expect(ctx.host.data.editorValue).toBe(GROUPED);
    expect(ctx.sqlTexts.filter).toBe("");
  });

  it("4: a link with a query and no sql_mode is a filter, and replaces any kept SQL text", () => {
    const ctx = spansWithSql();
    ctx.normalizeTracesView("traces", { kind: "move" });
    const out = ctx.normalizeTracesView("traces", { kind: "open", text: "a = 2" });
    expect(out.view).toBe("traces");
    expect(ctx.host.meta.sqlMode).toBe(false);
    expect(ctx.host.data.editorValue).toBe("a = 2");
    expect(ctx.sqlTexts.sql).toBe("");
  });

  it.each([
    ["a saved view with sqlMode", { text: GROUPED, sqlMode: true }],
    ["a version 1 view or recent search whose text is a statement", { text: GROUPED }],
  ])("5: %s opens Spans with SQL on and the filter empty", (_, entry) => {
    const ctx = setup("traces", "old = 1");
    const out = ctx.normalizeTracesView("traces", { kind: "open", ...entry });
    expect(out.view).toBe("spans");
    expect(ctx.host.meta.sqlMode).toBe(true);
    expect(ctx.sqlTexts.filter).toBe("");
  });

  it("5: a filter view opens as stored, and an IN (SELECT ...) filter stays a filter", () => {
    const ctx = setup("spans", "");
    const text = `trace_id IN (SELECT trace_id FROM "default")`;
    const out = ctx.normalizeTracesView("traces", { kind: "open", text, sqlMode: false });
    expect(out.view).toBe("traces");
    expect(ctx.host.meta.sqlMode).toBe(false);
    expect(ctx.host.data.editorValue).toBe(text);
  });

  it("6: a handoff turns SQL off, clears the kept SQL text and writes its filter", () => {
    const ctx = spansWithSql();
    const out = ctx.normalizeTracesView("traces", {
      kind: "handoff",
      filter: "service_name = 'b'",
    });
    expect(out.view).toBe("traces");
    expect(ctx.host.meta.sqlMode).toBe(false);
    expect(ctx.host.data.editorValue).toBe("service_name = 'b'");
    expect(ctx.sqlTexts.sql).toBe("");
  });

  it("6: a handoff naming no service keeps the filter, and still clears the SQL", () => {
    const ctx = spansWithSql();
    ctx.normalizeTracesView("traces", { kind: "handoff", filter: null });
    expect(ctx.host.meta.sqlMode).toBe(false);
    expect(ctx.host.data.editorValue).toBe("service_name = 'api'");
    expect(ctx.sqlTexts.sql).toBe("");
  });

  it("1: Spans SQL through a graph view and back keeps SQL on, with nothing come back to wait for", () => {
    const ctx = spansWithSql();
    ctx.normalizeTracesView("service-graph", { kind: "move" });
    expect(ctx.host.meta.sqlMode).toBe(true);
    const out = ctx.normalizeTracesView("spans", { kind: "move" });
    expect(out).toEqual({ view: "spans", waitForRun: false });
    expect(ctx.host.data.editorValue).toBe(GROUPED);
  });

  it("3: Back or Forward to a Spans entry with its own SQL replaces staged SQL, waiting for Run", () => {
    const ctx = spansWithSql(`SELECT * FROM "default" WHERE b = 2`);
    ctx.host.meta.searchMode = "service-graph";
    const out = ctx.normalizeTracesView("spans", { kind: "move", sql: GROUPED });
    expect(out).toEqual({ view: "spans", waitForRun: true });
    expect(ctx.host.meta.sqlMode).toBe(true);
    expect(ctx.host.data.editorValue).toBe(GROUPED);
    expect(ctx.sqlTexts.filter).toBe("service_name = 'api'");
  });

  it("3: Back or Forward to a Spans entry with the staged SQL changes nothing and does not wait", () => {
    const ctx = spansWithSql();
    ctx.host.meta.searchMode = "service-graph";
    const out = ctx.normalizeTracesView("spans", { kind: "move", sql: GROUPED });
    expect(out).toEqual({ view: "spans", waitForRun: false });
    expect(ctx.host.data.editorValue).toBe(GROUPED);
    expect(ctx.sqlTexts.filter).toBe("service_name = 'api'");
  });

  it("3: an entry's SQL over an untouched pre-fill gives back the scope and drops the pre-fill", () => {
    const ctx = setup();
    ctx.host.meta.scope = "root";
    ctx.turnSqlOn();
    ctx.host.meta.searchMode = "service-graph";
    ctx.normalizeTracesView("spans", { kind: "move", sql: GROUPED });
    expect(ctx.host.data.editorValue).toBe(GROUPED);
    expect(ctx.sqlTexts.prefill).toBeNull();
    expect(ctx.sqlTexts.scopeBeforePrefill).toBeNull();
    expect(ctx.host.meta.scope).toBe("root");
  });

  it.each(["service-graph", "services-catalog"] as const)(
    "4: a %s link with sql_mode keeps its view, with SQL on for Spans",
    (view) => {
      const ctx = setup("traces", "");
      const out = ctx.normalizeTracesView(view, { kind: "open", text: GROUPED, sqlMode: true });
      expect(out.view).toBe(view);
      expect(ctx.host.meta.sqlMode).toBe(true);
      expect(ctx.host.data.editorValue).toBe(GROUPED);
    },
  );

  it("7: a return to Traces after leaving the page from Spans SQL acts as path 1", () => {
    const ctx = spansWithSql();
    ctx.host.meta.searchMode = "service-graph";
    ctx.normalizeTracesView("traces", { kind: "move" });
    expect(ctx.host.meta.sqlMode).toBe(false);
    expect(ctx.host.data.editorValue).toBe("service_name = 'api'");
    expect(ctx.sqlTexts.sql).toBe(GROUPED);
  });
});

describe("normalizeTracesView: moving into SQL", () => {
  it("the SQL switch in Traces pre-fills from the filter and waits for Run", () => {
    const ctx = setup("traces");
    const out = ctx.normalizeTracesView("traces", { kind: "sql" });
    expect(out).toEqual({ view: "spans", waitForRun: true });
    expect(ctx.host.data.editorValue).toBe(PREFILL);
  });

  it("Back to Traces clears an untouched pre-fill, so no line shows", () => {
    const ctx = setup("traces");
    ctx.normalizeTracesView("traces", { kind: "sql" });
    ctx.normalizeTracesView("traces", { kind: "move" });
    expect(ctx.sqlTexts.sql).toBe("");
    expect(ctx.host.data.editorValue).toBe("service_name = 'api'");
  });

  it("Back to Traces gives back the scope an untouched pre-fill folded in", () => {
    const ctx = setup("traces");
    ctx.host.meta.scope = "root";
    ctx.normalizeTracesView("traces", { kind: "sql" });
    expect(ctx.host.meta.scope).toBe("all");
    ctx.normalizeTracesView("traces", { kind: "move" });
    expect(ctx.host.meta.scope).toBe("root");
    expect(ctx.sqlTexts.sql).toBe("");
  });

  it("keeps the folded scope stepped back once the pre-fill ran", () => {
    const ctx = setup("traces");
    ctx.host.meta.scope = "root";
    ctx.normalizeTracesView("traces", { kind: "sql" });
    ctx.sqlTexts.prefill = null;
    ctx.normalizeTracesView("traces", { kind: "move" });
    expect(ctx.host.meta.scope).toBe("all");
  });

  it("keeps a pre-fill that ran, even unchanged", () => {
    const ctx = setup("traces");
    ctx.normalizeTracesView("traces", { kind: "sql" });
    ctx.sqlTexts.prefill = null;
    ctx.normalizeTracesView("traces", { kind: "move" });
    expect(ctx.sqlTexts.sql).toBe(PREFILL);
  });

  it("Back to SQL brings the stored SQL text back, with filter edits made in Traces kept apart", () => {
    const ctx = spansWithSql();
    ctx.normalizeTracesView("traces", { kind: "move" });
    ctx.host.data.editorValue = "span_status = 'ERROR'";
    ctx.normalizeTracesView("traces", { kind: "sql" });
    expect(ctx.host.data.editorValue).toBe(GROUPED);
    expect(ctx.sqlTexts.filter).toBe("span_status = 'ERROR'");
  });

  it("Back to SQL from the kept line brings the stored SQL, and a SELECT typed in Traces stays the filter", () => {
    const ctx = spansWithSql();
    ctx.normalizeTracesView("traces", { kind: "move" });
    const typed = `SELECT trace_id FROM "default"`;
    ctx.host.data.editorValue = typed;
    const out = ctx.normalizeTracesView("traces", { kind: "sql", stored: true });
    expect(out).toEqual({ view: "spans", waitForRun: true });
    expect(ctx.host.data.editorValue).toBe(GROUPED);
    expect(ctx.sqlTexts.filter).toBe(typed);
  });

  it("Open in Spans view: the typed text replaces the kept SQL, and the filter keeps its value from before", () => {
    const ctx = spansWithSql();
    ctx.normalizeTracesView("traces", { kind: "move" });
    ctx.noteFilterText("service_name = 'api'", true);
    const typed = `SELECT trace_id FROM "default"`;
    ctx.host.data.editorValue = typed;
    const out = ctx.normalizeTracesView("traces", { kind: "sql", text: typed });
    expect(out.waitForRun).toBe(true);
    expect(ctx.host.data.editorValue).toBe(typed);
    expect(ctx.sqlTexts.filter).toBe("service_name = 'api'");
  });

  it("a Spans click with a statement typed in Traces turns SQL on with it, not run", () => {
    const ctx = setup("traces", "a = 1");
    ctx.noteFilterText("a = 1", true);
    ctx.host.data.editorValue = GROUPED;
    const out = ctx.normalizeTracesView("spans", { kind: "move" });
    expect(out.waitForRun).toBe(true);
    expect(ctx.host.data.editorValue).toBe(GROUPED);
    expect(ctx.sqlTexts.filter).toBe("a = 1");
  });
});
