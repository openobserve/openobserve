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
import { defineComponent, h, reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";
import i18n from "@/locales";
import { bumpSeveritySchemaGeneration } from "@/utils/logs/statusParser";
import { useSearchAround } from "./searchAround";
import useLogSeverity, {
  bindSeverityRequest,
  captureSeverityRequest,
  recordSeverityRequest,
} from "./useLogSeverity";

const state = vi.hoisted(() => ({ searchObj: null as any, zoConfig: {} as any }));
const searchAroundMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/search", () => ({
  default: { search_around: searchAroundMock },
}));

vi.mock("@/composables/useLogs/useStreamFields", () => ({
  default: () => ({
    extractFields: vi.fn(),
    updateGridColumns: vi.fn(),
    filterHitsColumns: vi.fn(),
  }),
}));

vi.mock("@/composables/useLogs/useHistogram", () => ({
  default: () => ({ generateHistogramData: vi.fn(), generateHistogramSkeleton: vi.fn() }),
}));

vi.mock("@/composables/useLogs/searchState", () => ({
  searchState: () => ({ searchObj: state.searchObj, notificationMsg: { value: "" } }),
}));

vi.mock("vuex", () => ({
  useStore: () => ({
    get state() {
      return { zoConfig: state.zoConfig };
    },
  }),
}));

vi.mock("@/composables/useLogs/logsUtils", () => {
  const parser = new Parser();
  return {
    logsUtils: () => ({
      fnParsedSQL: (query?: string) => parser.astify(query ?? state.searchObj.data.query),
      fnUnparsedSQL: (ast: any) => parser.sqlify(ast),
      addTraceId: () => undefined,
      removeTraceId: () => undefined,
      shouldAddFunctionToSearch: () => false,
    }),
  };
});

const schema = (n: number) => [
  { name: "_timestamp" },
  { name: "level" },
  { name: "message" },
  ...Array.from({ length: Math.max(0, n - 3) }, (_, i) => ({ name: `f${i}` })),
];

const freshSearchObj = (fields = 3, uds: string[] = []) =>
  reactive({
    organizationIdentifier: "default",
    loading: false,
    meta: { sqlMode: false, quickMode: false, showHistogram: false },
    data: {
      query: "",
      tempFunctionContent: "",
      histogram: { chartParams: { title: "", titleParts: null } },
      searchAround: { histogramHide: false },
      stream: {
        selectedStream: ["app"],
        streamType: "logs",
        interestingFieldList: [] as string[],
        missingStreamMultiStreamFilter: [] as string[],
        selectedStreamFields: [] as any[],
      },
      streamResults: {
        list: [{ name: "app", schema: schema(fields), settings: { defined_schema_fields: uds } }],
      },
      queryResults: { hits: [] as any[] },
    },
  });

const withComposable = () => {
  let api!: ReturnType<typeof useLogSeverity>;
  mount(
    defineComponent({
      setup() {
        api = useLogSeverity();
        return () => h("div");
      },
    }),
  );
  return api;
};

const run = (row: Record<string, unknown>) => {
  state.searchObj.data.queryResults = { hits: [row] };
  return state.searchObj.data.queryResults.hits[0];
};

describe("useLogSeverity — projection guard from the executed search", () => {
  beforeEach(() => {
    state.zoConfig = {};
    state.searchObj = freshSearchObj();
    recordSeverityRequest(null);
  });

  it("infers under SELECT * on a small stream", () => {
    const { rowSeverity } = withComposable();
    expect(rowSeverity(run({ message: "[ERROR] x" }))).toMatchObject({
      level: "error",
      source: "message",
    });
  });

  it("quick mode without the level field guards the row (J-A6)", () => {
    state.searchObj.meta.quickMode = true;
    state.searchObj.data.stream.interestingFieldList = ["_timestamp", "message"];
    const { rowSeverity } = withComposable();
    expect(rowSeverity(run({ message: "INFO ok" }))).toMatchObject({
      level: "unknown",
      notFetched: true,
    });
  });

  it("without a recorded dispatch, SQL mode reads the select list per run", () => {
    state.searchObj.meta.sqlMode = true;
    state.searchObj.data.query = 'SELECT _timestamp, message FROM "app"';
    const { rowSeverity } = withComposable();
    expect(rowSeverity(run({ message: "[ERROR] x" })).notFetched).toBe(true);
    state.searchObj.data.query = 'SELECT * FROM "app"';
    expect(rowSeverity(run({ message: "[ERROR] x" })).level).toBe("error");
  });

  it("without a recorded dispatch, keeps the projection until new hits arrive", () => {
    state.searchObj.meta.sqlMode = true;
    state.searchObj.data.query = 'SELECT * FROM "app"';
    const { rowSeverity } = withComposable();
    const row = run({ message: "[ERROR] x" });
    expect(rowSeverity(row).level).toBe("error");
    state.searchObj.data.query = 'SELECT message FROM "app"';
    expect(rowSeverity(row).level).toBe("error");
  });

  it("falls back to 500 fields and forced quick mode when /config lacks them", () => {
    state.searchObj = freshSearchObj(501);
    const { rowSeverity } = withComposable();
    expect(rowSeverity(run({ message: "[ERROR] x" })).notFetched).toBe(true);
  });

  it("uses /config quick-mode fields when present", () => {
    state.searchObj = freshSearchObj(501);
    state.zoConfig = { quick_mode_num_fields: 1000, quick_mode_force_enabled: true };
    const { rowSeverity } = withComposable();
    expect(rowSeverity(run({ message: "[ERROR] x" })).level).toBe("error");
    state.zoConfig = { quick_mode_num_fields: 500, quick_mode_force_enabled: false };
    expect(rowSeverity(run({ message: "[ERROR] x" })).level).toBe("error");
    state.zoConfig = { quick_mode_num_fields: 500, quick_mode_force_enabled: true };
    expect(rowSeverity(run({ message: "[ERROR] x" })).notFetched).toBe(true);
  });

  it("J-A9: a UDS that excludes the level field guards the row", () => {
    state.searchObj = freshSearchObj(3, ["message"]);
    const { rowSeverity } = withComposable();
    expect(rowSeverity(run({ message: "[ERROR] x" })).notFetched).toBe(true);
  });

  const parser = new Parser();
  const dispatch = () =>
    recordSeverityRequest(
      captureSeverityRequest(state.searchObj, !!state.searchObj.meta.quickMode, () =>
        parser.astify(state.searchObj.data.query),
      ),
    );

  it("F1: an edit while the request is in flight does not change the guard", () => {
    state.searchObj.meta.sqlMode = true;
    state.searchObj.data.query = 'SELECT message FROM "app"';
    dispatch();
    state.searchObj.data.query = 'SELECT * FROM "app"';
    const { rowSeverity } = withComposable();
    expect(rowSeverity(run({ message: "[ERROR] x" }))).toMatchObject({
      level: "unknown",
      notFetched: true,
    });
  });

  it("F1: a schema bump after an edit keeps the dispatched request and refreshes the schema", () => {
    state.searchObj.meta.sqlMode = true;
    state.searchObj.data.query = 'SELECT message FROM "app"';
    dispatch();
    const { rowSeverity } = withComposable();
    const row = run({ message: "[ERROR] x" });
    expect(rowSeverity(row).notFetched).toBe(true);
    state.searchObj.data.query = 'SELECT * FROM "app"';
    bumpSeveritySchemaGeneration();
    expect(rowSeverity(row).notFetched).toBe(true);
    state.searchObj.data.streamResults.list[0].schema = [
      { name: "_timestamp" },
      { name: "message" },
    ];
    bumpSeveritySchemaGeneration();
    expect(rowSeverity(row)).toMatchObject({ level: "error", source: "message" });
  });

  it("F1: quick mode and stream scope come from the dispatched request", () => {
    state.searchObj.meta.quickMode = true;
    state.searchObj.data.stream.interestingFieldList = ["_timestamp", "message"];
    dispatch();
    state.searchObj.meta.quickMode = false;
    state.searchObj.data.stream.interestingFieldList = ["_timestamp", "level", "message"];
    state.searchObj.data.stream.selectedStream = ["other"];
    const { rowSeverity } = withComposable();
    expect(rowSeverity(run({ message: "[ERROR] x" })).notFetched).toBe(true);
  });

  it("a new dispatch replaces the guard for the next results", () => {
    state.searchObj.meta.sqlMode = true;
    state.searchObj.data.query = 'SELECT message FROM "app"';
    dispatch();
    const { rowSeverity } = withComposable();
    expect(rowSeverity(run({ message: "[ERROR] x" })).notFetched).toBe(true);
    state.searchObj.data.query = 'SELECT * FROM "app"';
    dispatch();
    expect(rowSeverity(run({ message: "[ERROR] x" })).level).toBe("error");
  });

  const searchAroundReturning = async (hits: any[], body: Record<string, unknown> = {}) => {
    searchAroundMock.mockResolvedValueOnce({
      data: { from: 0, scan_size: 1, took: 1, hits },
    });
    let around!: ReturnType<typeof useSearchAround>;
    mount(
      defineComponent({
        setup() {
          around = useSearchAround();
          return () => h("div");
        },
      }),
      { global: { plugins: [i18n] } },
    );
    around.searchAroundData({ key: "1700000000000000", size: 10, body });
    await flushPromises();
    return state.searchObj.data.queryResults.hits;
  };

  it("F1: search-around rows are a wildcard read, not the last narrow search", async () => {
    state.searchObj.meta.sqlMode = true;
    state.searchObj.data.query = 'SELECT message FROM "app"';
    dispatch();
    const { rowSeverity } = withComposable();
    expect(rowSeverity(run({ message: "[ERROR] x" })).notFetched).toBe(true);
    const [row] = await searchAroundReturning([{ message: "[ERROR] x" }]);
    expect(rowSeverity(row)).toMatchObject({ level: "error", source: "message" });
  });

  it("F1: search-around ignores the editor's unexecuted select list", async () => {
    state.searchObj.meta.sqlMode = true;
    state.searchObj.data.query = 'SELECT * FROM "app"';
    dispatch();
    state.searchObj.data.query = 'SELECT message FROM "app"';
    const { rowSeverity } = withComposable();
    const [row] = await searchAroundReturning([{ message: "[ERROR] x" }]);
    expect(rowSeverity(row)).toMatchObject({ level: "error", source: "message" });
  });

  it("F1: quick mode of the last search does not guard search-around rows", async () => {
    state.searchObj.meta.quickMode = true;
    state.searchObj.data.stream.interestingFieldList = ["message"];
    dispatch();
    const { rowSeverity } = withComposable();
    const [row] = await searchAroundReturning([{ message: "[ERROR] x" }]);
    expect(rowSeverity(row)).toMatchObject({ level: "error", source: "message" });
  });

  it("F1: search-around on a wide stream keeps the truncation guard", async () => {
    state.searchObj = freshSearchObj(501);
    dispatch();
    const { rowSeverity } = withComposable();
    const [row] = await searchAroundReturning([{ message: "[ERROR] x" }]);
    expect(rowSeverity(row)).toMatchObject({ level: "unknown", notFetched: true });
  });

  it("F1: a multi-stream search-around reads the hit's own stream schema", async () => {
    state.searchObj.meta.sqlMode = true;
    state.searchObj.data.stream.selectedStream = ["app", "other"];
    state.searchObj.data.query = 'SELECT message FROM "app"';
    dispatch();
    const { rowSeverity } = withComposable();
    const [row] = await searchAroundReturning([{ message: "[ERROR] x" }], {
      _stream_name: "app",
    });
    expect(rowSeverity(row)).toMatchObject({ level: "error", source: "message" });
    expect(searchAroundMock.mock.calls.at(-1)[0].index).toBe("app");
  });

  it("F1: the next search's results drop the search-around binding", async () => {
    state.searchObj.meta.sqlMode = true;
    state.searchObj.data.query = 'SELECT message FROM "app"';
    const { rowSeverity } = withComposable();
    await searchAroundReturning([{ message: "[ERROR] x" }]);
    state.searchObj.data.query = 'SELECT * FROM "app"';
    dispatch();
    expect(rowSeverity(run({ message: "[ERROR] x" })).level).toBe("error");
  });

  it("bindSeverityRequest ignores a missing hits array", () => {
    const request = captureSeverityRequest(state.searchObj, false, () => null);
    expect(() => bindSeverityRequest(undefined, request)).not.toThrow();
  });
});
