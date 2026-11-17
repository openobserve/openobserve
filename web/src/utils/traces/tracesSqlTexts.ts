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

import { reactive } from "vue";
import type { TraceSearchMode } from "@/ts/interfaces/traces/trace.types";
import { isTracesScope, scopePredicate, withScope } from "@/utils/traces/tracesScope";
import { buildTracesSql } from "@/utils/traces/tracesSql";
import { resolveTracesFilter } from "@/utils/traces/resolveTracesFilter";
import { isAuthoredStatement } from "@/utils/query/freeTextFilter";

/** What brought the page to a view, which decides what happens to SQL on the way in. */
export type TracesViewEntry =
  /** A view toggle, the nav, Back or Forward, or a return to the page; `sql` is a history entry's own SQL. */
  | { kind: "move"; sql?: string }
  /** The SQL switch in the Traces view, Back to SQL (`stored`), or Open in Spans view with the typed `text`. */
  | { kind: "sql"; text?: string; stored?: boolean }
  /** A link, saved view or recent search that brings its own text. */
  | { kind: "open"; text: string; sqlMode?: boolean }
  /** A service graph or catalog handoff; a null filter keeps the current one. */
  | { kind: "handoff"; filter: string | null };

/** The parts of the page state the two texts move between. */
export interface TracesSqlTextsHost {
  meta: {
    searchMode: TraceSearchMode;
    sqlMode: boolean;
    scope?: unknown;
    resultGrid: { sortBy: string };
  };
  data: {
    editorValue: string;
    stream: {
      selectedStream: { value: string };
      hasParentColumn?: boolean;
      sqlFieldConditions?: Record<string, unknown>;
    };
  };
}

// A word on its way to SELECT, WITH or EXPLAIN is a statement being typed, not a filter to keep.
const STATEMENT_START =
  /^\s*(?:s|se|sel|sele|selec|w|wi|wit|e|ex|exp|expl|expla|explai|explain(?:\s+\w*)?)?\s*$/i;

/** The editor shows one of the Spans SQL text and the shared filter; this keeps the other, and SQL never writes to the filter. */
export function createTracesSqlTexts(host: TracesSqlTextsHost, parser: { value: any }) {
  const sqlTexts = reactive({
    /** The SQL text while the editor shows the filter. */
    sql: "",
    /** The filter while the editor shows SQL. */
    filter: "",
    /** The SQL that turning SQL on pre-filled, until a run; text still equal to it was never edited. */
    prefill: null as string | null,
    /** The scope the pre-fill folded into its WHERE, given back if the pre-fill is dropped untouched. */
    scopeBeforePrefill: null as unknown,
    /** The WHERE that Use WHERE from SQL wrote into the filter. */
    filterFromSql: null as string | null,
    /** The filter as it was before a statement was typed over it. */
    filterBeforeStatement: "",
  });

  const editorText = () => String(host.data.editorValue ?? "");

  /** Remembers the filter a typed statement may replace; called with each filter edit and run. */
  const noteFilterText = (text: string, run = false) => {
    if (isAuthoredStatement(text)) return;
    // A cleared filter is noted, so a statement typed after it keeps the empty filter.
    if (!run && text.trim() && STATEMENT_START.test(text)) return;
    sqlTexts.filterBeforeStatement = text;
  };

  /** Forgets the stored SQL text and what came from it; the editor keeps whatever it shows. */
  const clearSqlText = () => {
    // The sidebar finds its conditions by exact text, so with the SQL gone they could claim typed text.
    if (Object.keys(host.data.stream.sqlFieldConditions ?? {}).length) {
      host.data.stream.sqlFieldConditions = {};
    }
    sqlTexts.sql = "";
    sqlTexts.prefill = null;
    sqlTexts.scopeBeforePrefill = null;
    sqlTexts.filterFromSql = null;
  };

  /** Everything, for a new org. */
  const reset = () => {
    clearSqlText();
    sqlTexts.filter = "";
    sqlTexts.filterBeforeStatement = "";
  };

  // SQL mode turns on before the text lands, so the editor's echo of it reads as SQL.
  const showSql = (sql: string, filter: string) => {
    sqlTexts.filter = filter;
    sqlTexts.sql = "";
    host.meta.sqlMode = true;
    host.data.editorValue = sql;
  };

  // An abandoned pre-fill gives back the scope it folded in, if the select still shows All spans.
  const giveBackPrefillScope = () => {
    if (sqlTexts.scopeBeforePrefill !== null && host.meta.scope === "all") {
      host.meta.scope = sqlTexts.scopeBeforePrefill;
    }
    sqlTexts.prefill = null;
    sqlTexts.scopeBeforePrefill = null;
  };

  // An untouched or erased pre-fill says nothing the filter does not, so it goes.
  const dropUntouchedPrefill = () => {
    if (sqlTexts.prefill === null || (sqlTexts.sql && sqlTexts.sql !== sqlTexts.prefill)) return;
    giveBackPrefillScope();
    clearSqlText();
  };

  /** The editor goes back to the shared filter and keeps the SQL text, unless it is an untouched pre-fill; nothing runs here. */
  const leaveSql = () => {
    if (!host.meta.sqlMode) return;
    const sql = editorText();
    host.meta.sqlMode = false;
    host.data.editorValue = sqlTexts.filter;
    sqlTexts.filter = "";
    sqlTexts.sql = sql.trim() ? sql : "";
    dropUntouchedPrefill();
  };

  /** Deleting the SELECT turns SQL off; what is left becomes the filter and a folded scope comes back. */
  const deleteSqlText = () => {
    giveBackPrefillScope();
    clearSqlText();
    sqlTexts.filter = "";
    host.meta.sqlMode = false;
  };

  /** A statement typed over the filter becomes the SQL text, and the filter keeps its value from before. */
  const takeTypedSql = (text: string) => {
    clearSqlText();
    showSql(text, sqlTexts.filterBeforeStatement);
  };

  /** Turns SQL on with the stored text, or the first time with a SELECT built from the filter; `stored` never takes a typed statement. */
  const turnSqlOn = (stored = false) => {
    if (host.meta.sqlMode) return;
    const filter = editorText();
    if (stored && sqlTexts.sql) {
      showSql(sqlTexts.sql, filter);
      return;
    }
    if (isAuthoredStatement(filter)) {
      takeTypedSql(filter);
      return;
    }
    if (sqlTexts.sql) {
      showSql(sqlTexts.sql, filter);
      return;
    }
    const stream = host.data.stream.selectedStream?.value ?? "";
    const scope = isTracesScope(host.meta.scope)
      ? scopePredicate(host.meta.scope, !!host.data.stream.hasParentColumn)
      : "";
    // An empty filter with no scope leaves the editor empty, so the template gallery shows.
    if (!stream || (!filter.trim() && !scope)) {
      showSql("", filter);
      return;
    }
    const sql = buildTracesSql(
      stream,
      withScope(resolveTracesFilter(filter, parser.value, stream), scope),
    );
    const scopeBefore = host.meta.scope;
    showSql(sql, filter);
    sqlTexts.prefill = sql;
    sqlTexts.scopeBeforePrefill = scope ? scopeBefore : null;
    // The condition now lives in the WHERE, so the select steps back instead of applying it twice.
    if (scope) host.meta.scope = "all";
  };

  // A move into Spans brings SQL back from the history entry, a typed statement or the SQL left there.
  const enterSpans = (entrySql?: string): boolean => {
    const typed = editorText();
    if (host.meta.sqlMode) {
      // SQL still on never left the screen, unless a history entry brings its own SQL over the staged text.
      if (!entrySql?.trim() || entrySql === typed) return false;
      if (sqlTexts.prefill !== null && typed === sqlTexts.prefill) giveBackPrefillScope();
      showSql(entrySql, sqlTexts.filter);
      return true;
    }
    if (entrySql?.trim()) showSql(entrySql, typed);
    else if (isAuthoredStatement(typed)) takeTypedSql(typed);
    else if (sqlTexts.sql) showSql(sqlTexts.sql, typed);
    else return false;
    return true;
  };

  const openEntry = (text: string, sqlMode?: boolean): boolean => {
    clearSqlText();
    sqlTexts.filter = "";
    const sql = !!text.trim() && (!!sqlMode || isAuthoredStatement(text));
    host.meta.sqlMode = sql;
    host.data.editorValue = text;
    return sql;
  };

  /** The one writer of the view, so Traces never has SQL on; `waitForRun` means SQL came back and must not run by itself. */
  const normalizeTracesView = (
    view: TraceSearchMode,
    entry: TracesViewEntry,
  ): { view: TraceSearchMode; waitForRun: boolean } => {
    let target = view;
    let waitForRun = false;
    if (entry.kind === "handoff") {
      leaveSql();
      clearSqlText();
      if (entry.filter !== null) host.data.editorValue = entry.filter;
    } else if (entry.kind === "open") {
      // A graph or catalog link keeps its view; SQL waits there for the move to Spans.
      if (openEntry(entry.text, entry.sqlMode) && (view === "traces" || view === "spans")) {
        target = "spans";
      }
    } else if (entry.kind === "sql") {
      target = "spans";
      waitForRun = true;
      if (entry.text !== undefined) takeTypedSql(entry.text);
      else turnSqlOn(entry.stored);
    } else if (view === "spans") {
      waitForRun = enterSpans(entry.sql);
    } else if (view === "traces") {
      leaveSql();
    }
    if (target === "traces") {
      const sort = host.meta.resultGrid.sortBy;
      if (sort !== "start_time" && sort !== "duration") host.meta.resultGrid.sortBy = "start_time";
    }
    host.meta.searchMode = target;
    return { view: target, waitForRun };
  };

  return {
    sqlTexts,
    noteFilterText,
    clearSqlText,
    deleteSqlText,
    reset,
    leaveSql,
    turnSqlOn,
    takeTypedSql,
    normalizeTracesView,
  };
}
