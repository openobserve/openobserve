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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { ref } from "vue";
import {
  bindLogsUrlRouter,
  changedParams,
  decodeColumns,
  dropLineLinkParams,
  encodeColumns,
  initShownSearchFromUrl,
  pageFromRequest,
  parseRowsParam,
  parseSharedPage,
  recordShownSearch,
  resetLogsUrlForTests,
  routeHasLineLink,
  setLogsHistoryStateProvider,
  shownEntryFor,
  shownSearch,
  urlWriteMode,
  writeLogsUrl,
} from "@/composables/useLogs/useLogsUrl";
import type { ExecutedRecordedEvent, LogsSignature } from "@/composables/useLogs/useAutoRun";

const signature = (overrides: Partial<LogsSignature> = {}): LogsSignature => ({
  query: "level = 'error'",
  sqlMode: false,
  streams: ["app", "web"],
  streamType: "logs",
  time: { type: "relative", period: "15m" },
  transform: null,
  quickMode: false,
  quickModeFields: [],
  regions: [],
  clusters: [],
  effectiveSortOrder: "desc",
  definedSchemas: "user_defined_schema",
  ...overrides,
});

const gridEvent = (
  overrides: Partial<ExecutedRecordedEvent> = {},
  req: unknown = { query: { from: 100, size: 50, start_time: 10, end_time: 20 } },
): ExecutedRecordedEvent => ({
  surface: "logs",
  generation: 3,
  signature: signature(),
  req,
  ...overrides,
});

const makeRouter = (query: Record<string, unknown> = {}) => {
  const currentRoute = ref<any>({ name: "logs", query });
  const router = {
    currentRoute,
    push: vi.fn(async (to: any) => {
      currentRoute.value = { name: "logs", query: to.query };
    }),
    replace: vi.fn(async (to: any) => {
      currentRoute.value = { name: "logs", query: to.query };
    }),
  };
  return router;
};

describe("useLogsUrl (4c C7b)", () => {
  beforeEach(() => resetLogsUrlForTests());

  describe("pageFromRequest", () => {
    it("derives the displayed page and size from the recorded request", () => {
      expect(pageFromRequest({ query: { from: 100, size: 50 } })).toEqual({ page: 3, rows: 50 });
      expect(pageFromRequest({ query: { from: 0, size: 25 } })).toEqual({ page: 1, rows: 25 });
    });

    it("reads a request that asks one extra row for the page count as its page size", () => {
      expect(pageFromRequest({ query: { from: 100, size: 51 } })).toEqual({ page: 3, rows: 50 });
      expect(pageFromRequest({ query: { from: 25, size: 26 } })).toEqual({ page: 2, rows: 25 });
    });

    it("treats aggregate (-1) and unknown sizes as page 1 with no page size", () => {
      expect(pageFromRequest({ query: { from: 0, size: -1 } })).toEqual({ page: 1, rows: null });
      expect(pageFromRequest({ query: { from: 40, size: 40 } })).toEqual({ page: 1, rows: null });
      expect(pageFromRequest(null)).toEqual({ page: 1, rows: null });
    });
  });

  describe("recordShownSearch", () => {
    it("sets the surface entry from the record, not live state", () => {
      const patch = recordShownSearch(gridEvent(), { selectedStreams: ["web", "app"] });
      expect(patch).toBe(false);
      expect(shownSearch.logs).toEqual({
        generation: 3,
        inputs: {
          streams: ["web", "app"],
          streamType: "logs",
          query: "level = 'error'",
          sqlMode: false,
          functionContent: null,
          quickMode: false,
          regions: [],
          clusters: [],
          definedSchemas: "user_defined_schema",
          freeTextScan: undefined,
        },
        period: { type: "relative", period: "15m" },
        bounds: { start_time: 10, end_time: 20 },
        page: 3,
        rows: 50,
      });
    });

    it("keeps the signature's stream set when the live selection moved on", () => {
      recordShownSearch(gridEvent(), { selectedStreams: ["other"] });
      expect(shownSearch.logs?.inputs.streams).toEqual(["app", "web"]);
    });

    it("reports a re-fired record of the same run as a patch (server moved the window)", () => {
      recordShownSearch(gridEvent());
      const moved = gridEvent({
        signature: signature({ time: { type: "absolute", startUs: 11, endUs: 19 } }),
      });
      expect(recordShownSearch(moved)).toBe(true);
      expect(shownSearch.logs?.period).toEqual({ type: "absolute", startUs: 11, endUs: 19 });
      expect(recordShownSearch(gridEvent({ generation: 4 }))).toBe(false);
    });

    it("keys entries by surface; a Patterns record resolves its window from the run's live bounds", () => {
      recordShownSearch(gridEvent());
      recordShownSearch(
        { surface: "patterns", generation: 9, signature: signature({ query: "b" }) },
        { resolvedWindow: { startTime: 500, endTime: 900 } },
      );
      expect(shownSearch.logs?.inputs.query).toBe("level = 'error'");
      expect(shownSearch.patterns?.inputs.query).toBe("b");
      expect(shownSearch.patterns?.bounds).toEqual({ start_time: 500, end_time: 900 });
      expect(shownSearch.patterns?.page).toBe(1);
    });

    it("falls back to the grid's entry for a surface that never ran", () => {
      expect(shownEntryFor("visualize")).toBeNull();
      recordShownSearch(gridEvent());
      expect(shownEntryFor("visualize")).toBe(shownSearch.logs);
    });
  });

  describe("initShownSearchFromUrl", () => {
    it("names the link the user opened before anything ran", () => {
      initShownSearchFromUrl({
        stream: "app,web",
        stream_type: "logs",
        from: "100",
        to: "200",
        query: btoa("level = 'error'"),
        sql_mode: "false",
        quick_mode: "false",
        defined_schemas: "all_fields",
        page: "3",
        rows: "25",
      });
      expect(shownSearch.logs?.inputs.streams).toEqual(["app", "web"]);
      expect(shownSearch.logs?.inputs.query).toBe("level = 'error'");
      expect(shownSearch.logs?.period).toEqual({ type: "absolute", startUs: 100, endUs: 200 });
      expect(shownSearch.logs?.bounds).toEqual({ start_time: 100, end_time: 200 });
      expect(shownSearch.logs?.page).toBe(3);
      expect(shownSearch.logs?.rows).toBe(25);
      expect(shownSearch.logs?.generation).toBeNull();
    });

    it("leaves the entry empty for a URL that names no search", () => {
      recordShownSearch(gridEvent());
      initShownSearchFromUrl({ org_identifier: "default" });
      expect(shownSearch.logs).toBeNull();
    });
  });

  describe("param parsers", () => {
    it("accepts page 1–1000 only", () => {
      expect(parseSharedPage("3")).toBe(3);
      expect(parseSharedPage("1000")).toBe(1000);
      expect(parseSharedPage("1001")).toBeNull();
      expect(parseSharedPage("0")).toBeNull();
      expect(parseSharedPage("2.5")).toBeNull();
      expect(parseSharedPage(undefined)).toBeNull();
    });

    it("accepts only the paginator's page sizes", () => {
      expect(parseRowsParam("10")).toBe(10);
      expect(parseRowsParam("100")).toBe(100);
      expect(parseRowsParam("75")).toBeNull();
      expect(parseRowsParam("-10")).toBeNull();
    });

    it("round-trips columns, including an empty selection", () => {
      expect(decodeColumns(encodeColumns(["level", "message"]))).toEqual(["level", "message"]);
      expect(decodeColumns(encodeColumns([]))).toEqual([]);
      expect(decodeColumns(btoa('{"a":1}'))).toBeNull();
      expect(decodeColumns("%%%")).toBeNull();
      expect(decodeColumns(undefined)).toBeNull();
    });
  });

  describe("replace-vs-push rule", () => {
    it("replaces when only view-state params change", () => {
      const current = { stream: "app", period: "15m", page: "2", refresh: "0" };
      expect(urlWriteMode(current, { ...current, page: 3, columns: "W10=" })).toBe("replace");
      expect(urlWriteMode(current, { ...current, log_ts: "1" })).toBe("replace");
      expect(urlWriteMode(current, { ...current, type: "search_scheduler" })).toBe("replace");
    });

    it("pushes when a search input changes", () => {
      const current = { stream: "app", period: "15m" };
      expect(urlWriteMode(current, { ...current, period: "1h" })).toBe("push");
      expect(urlWriteMode(current, { ...current, query: "x" })).toBe("push");
    });

    it("compares values as the router stores them (strings)", () => {
      expect(
        changedParams({ refresh: "0", quick_mode: "false" }, { refresh: 0, quick_mode: false }),
      ).toEqual([]);
    });
  });

  describe("writeLogsUrl", () => {
    it("writes through the bound router with the history context, and skips an identical query", async () => {
      const router = makeRouter({ stream: "app" });
      bindLogsUrlRouter(router as any);
      setLogsHistoryStateProvider(() => ({
        zoomStack: [1],
        returnPreset: "15m",
        stackId: "s",
        level: 1,
      }));
      await writeLogsUrl("replace", { stream: "app", page: 2 });
      expect(router.replace).toHaveBeenCalledWith({
        query: { stream: "app", page: 2 },
        state: { zoomStack: [1], returnPreset: "15m", stackId: "s", level: 1 },
      });
      await writeLogsUrl("push", { stream: "app", page: "2" });
      expect(router.push).not.toHaveBeenCalled();
      await writeLogsUrl("push", { stream: "web" });
      expect(router.push).toHaveBeenCalledTimes(1);
    });

    it("drops log_* with a replace and leaves a URL without them alone", async () => {
      const router = makeRouter({ stream: "app", log_stream: "app", log_ts: "5", log_fp: "x" });
      bindLogsUrlRouter(router as any);
      expect(routeHasLineLink(router.currentRoute.value.query)).toBe(true);
      await dropLineLinkParams();
      expect(router.replace).toHaveBeenCalledTimes(1);
      expect(router.currentRoute.value.query).toEqual({ stream: "app" });
      await dropLineLinkParams();
      expect(router.replace).toHaveBeenCalledTimes(1);
      expect(router.push).not.toHaveBeenCalled();
    });
  });
});
