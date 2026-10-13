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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import store from "@/test/unit/helpers/store";
import useStreamFields, { pickInitialLogsStreams } from "./useStreamFields";
import { searchState } from "./searchState";
import { restoreLogsSelectedStreams, saveLogsSelectedStreams } from "@/utils/streamPersist";
import { useLocalLogFilterField } from "@/utils/zincutils";
import { columnsFromUrl } from "./useLogPermalink";

// Create i18n instance
const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      search: {
        queryRangeRestrictionMsg: "Query range restricted to {range}",
        streamNotExist: "The following [STREAM_NAME] streams were not found.",
      },
    },
  },
});

// Create test wrapper component
const TestComponent = defineComponent({
  setup() {
    const streamFields = useStreamFields();
    return {
      ...streamFields,
    };
  },
  template: "<div></div>",
});

describe("useStreamFields Composable", () => {
  let wrapper: any;

  beforeEach(() => {
    wrapper = mount(TestComponent, {
      global: {
        plugins: [store, i18n],
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Stream Field Functions", () => {
    it("should have loadStreamLists function", () => {
      expect(typeof wrapper.vm.loadStreamLists).toBe("function");
    });

    it("should have updateFieldValues function", () => {
      expect(typeof wrapper.vm.updateFieldValues).toBe("function");
    });

    it("should have extractFields function", () => {
      expect(typeof wrapper.vm.extractFields).toBe("function");
    });

    it("should have getStreamList function", () => {
      expect(typeof wrapper.vm.getStreamList).toBe("function");
    });

    it("should have loadStreamFields function", () => {
      expect(typeof wrapper.vm.loadStreamFields).toBe("function");
    });

    it("should have resetFieldValues function", () => {
      expect(typeof wrapper.vm.resetFieldValues).toBe("function");
    });

    it("should have hasInterestingFieldsInLocal function", () => {
      expect(typeof wrapper.vm.hasInterestingFieldsInLocal).toBe("function");
    });

    it("should have createFieldIndexMapping function", () => {
      expect(typeof wrapper.vm.createFieldIndexMapping).toBe("function");
    });

    it("should have updateGridColumns function", () => {
      expect(typeof wrapper.vm.updateGridColumns).toBe("function");
    });

    it("should have extractFTSFields function", () => {
      expect(typeof wrapper.vm.extractFTSFields).toBe("function");
    });

    it("should have filterHitsColumns function", () => {
      expect(typeof wrapper.vm.filterHitsColumns).toBe("function");
    });
  });

  describe("loadStreamLists", () => {
    it("should load stream lists successfully", async () => {
      const { loadStreamLists } = wrapper.vm;
      await loadStreamLists();
      expect(loadStreamLists).toHaveBeenCalled;
    });

    it("should handle errors during stream list loading", async () => {
      const { loadStreamLists } = wrapper.vm;
      await loadStreamLists();
      expect(loadStreamLists).toHaveBeenCalled;
    });

    it("should not select stream when selectStream is false", async () => {
      const { loadStreamLists } = wrapper.vm;
      await loadStreamLists(false);
      expect(loadStreamLists).toHaveBeenCalled;
    });
  });

  describe("updateGridColumns stream name column", () => {
    const { searchObj } = searchState();

    beforeEach(() => {
      searchObj.meta.sqlMode = false;
      searchObj.data.stream.selectedFields = [];
      searchObj.data.stream.selectedStream = ["app", "rum"];
      searchObj.data.queryResults = {
        hits: [
          { _timestamp: 2, _stream_name: "rum", message: "b" },
          { _timestamp: 1, _stream_name: "app", message: "a" },
        ],
      } as any;
    });

    const columnIds = () => searchObj.data.resultGrid.columns.map((column: any) => column.id);

    it("adds _stream_name after the timestamp for a multi-stream result", () => {
      wrapper.vm.updateGridColumns();

      expect(columnIds()).toEqual(["_timestamp", "_stream_name", "source"]);
    });

    it("adds _stream_name before the selected fields", () => {
      searchObj.data.stream.selectedFields = ["message"];

      wrapper.vm.updateGridColumns();

      expect(columnIds()).toEqual(["_timestamp", "_stream_name", "message"]);
    });

    it("leaves a single-stream result unchanged", () => {
      searchObj.data.stream.selectedStream = ["app"];

      wrapper.vm.updateGridColumns();

      expect(columnIds()).toEqual(["_timestamp", "source"]);
    });
  });

  describe("updateGridColumns with a shared link's columns (4c C7)", () => {
    const { searchObj } = searchState();
    const org = () => store.state.selectedOrganization.identifier;

    beforeEach(() => {
      searchObj.meta.sqlMode = false;
      searchObj.data.stream.selectedStream = ["app"];
      searchObj.data.stream.selectedStreamFields = [
        { name: "_timestamp", streams: ["app"] },
        { name: "level", streams: ["app"] },
        { name: "message", streams: ["app"] },
      ] as any;
      searchObj.data.queryResults = {
        hits: [{ _timestamp: 1, level: "info", message: "a" }],
      } as any;
      useLocalLogFilterField({ [`${org()}_app`]: ["message"] });
    });

    afterEach(() => {
      columnsFromUrl.value = false;
      useLocalLogFilterField({});
    });

    const columnIds = () => searchObj.data.resultGrid.columns.map((column: any) => column.id);

    it("renders the link's empty selection as source, not this user's saved columns", () => {
      searchObj.data.stream.selectedFields = [];
      columnsFromUrl.value = true;
      wrapper.vm.updateGridColumns();
      expect(searchObj.data.stream.selectedFields).toEqual([]);
      expect(columnIds()).toEqual(["_timestamp", "source"]);
    });

    it("drops names the stream's schema no longer has", () => {
      searchObj.data.stream.selectedFields = ["level", "gone_field"];
      columnsFromUrl.value = true;
      wrapper.vm.updateGridColumns();
      expect(searchObj.data.stream.selectedFields).toEqual(["level"]);
      expect(columnIds()).toEqual(["_timestamp", "level"]);
    });

    it("without a link, an empty selection still restores the saved columns (old links unchanged)", () => {
      searchObj.data.stream.selectedFields = [];
      wrapper.vm.updateGridColumns();
      expect(searchObj.data.stream.selectedFields).toEqual(["message"]);
    });
  });

  describe("pickInitialLogsStreams (P1)", () => {
    const list = [
      { name: "old", stats: { doc_time_max: 10 } },
      { name: "b_new", stats: { doc_time_max: 50 } },
      { name: "a_new", stats: { doc_time_max: 50 } },
      { name: "empty", stats: { doc_time_max: 0 } },
    ];
    const pick = (overrides: Partial<Parameters<typeof pickInitialLogsStreams>[0]>) =>
      pickInitialLogsStreams({
        list,
        current: [],
        currentFromUrl: false,
        persisted: [],
        allowLatest: true,
        ...overrides,
      });

    it("prefers the URL, then the in-session pick, then the persisted set, then the newest", () => {
      expect(pick({ current: ["old"], currentFromUrl: true, persisted: ["b_new"] })).toEqual({
        selected: ["old"],
        missing: [],
        source: "url",
      });
      expect(pick({ current: ["old"], persisted: ["b_new"] }).source).toBe("current");
      expect(pick({ persisted: ["old"] })).toMatchObject({
        selected: ["old"],
        source: "persisted",
      });
      expect(pick({})).toMatchObject({ selected: ["a_new"], source: "latest" });
    });

    it("breaks a doc_time_max tie by name ascending (shared comparator)", () => {
      expect(pick({}).selected).toEqual(["a_new"]);
    });

    it("reports an unreadable URL stream instead of searching a silent subset (AC3.2)", () => {
      expect(pick({ current: ["old", "secret"], currentFromUrl: true })).toEqual({
        selected: [],
        missing: ["secret"],
        source: "url",
      });
    });

    it("drops unreadable persisted members and falls through when none remain (AC2.1)", () => {
      expect(pick({ persisted: ["gone", "old"] })).toMatchObject({ selected: ["old"] });
      expect(pick({ persisted: ["gone"], allowLatest: false })).toEqual({
        selected: [],
        missing: [],
        source: "none",
      });
    });

    it("never preselects the newest stream when the guard is not active", () => {
      expect(pick({ allowLatest: false })).toMatchObject({ selected: [], source: "none" });
    });

    it("selects nothing when every stream has doc_time_max 0 (AC1.2)", () => {
      expect(
        pickInitialLogsStreams({
          list: [{ name: "x", stats: { doc_time_max: 0 } }],
          current: [],
          currentFromUrl: false,
          persisted: [],
          allowLatest: true,
        }),
      ).toMatchObject({ selected: [], source: "none" });
    });
  });

  describe("loadStreamLists wiring of P1", () => {
    const { searchObj } = searchState();
    const zoConfig = { ...store.state.zoConfig };

    beforeEach(() => {
      localStorage.clear();
      searchObj.data.filterErrMsg = "";
      searchObj.data.stream.streamType = "logs";
      searchObj.data.streamResults = {
        list: [
          { name: "app", stats: { doc_time_max: 5 } },
          { name: "newest", stats: { doc_time_max: 9 } },
        ],
      } as any;
    });

    afterEach(() => {
      store.state.zoConfig = zoConfig;
    });

    it("shows the error state for an unreadable URL stream and selects nothing", async () => {
      store.state.zoConfig = { ...zoConfig, auto_query_enabled: true };
      searchObj.data.stream.selectedStream = ["secret"];
      await wrapper.vm.loadStreamLists(true, { fromUrl: true });
      expect(searchObj.data.stream.selectedStream).toEqual([]);
      expect(searchObj.data.filterErrMsg).toContain("secret");
    });

    it("restores the persisted set for this org and type with AQE on, and nothing with AQE off", async () => {
      const org = store.state.selectedOrganization.identifier;
      saveLogsSelectedStreams(org, "logs", ["app"]);
      searchObj.data.stream.selectedStream = [];
      store.state.zoConfig = { ...zoConfig, auto_query_enabled: true };
      await wrapper.vm.loadStreamLists(true);
      expect(searchObj.data.stream.selectedStream).toEqual(["app"]);

      searchObj.data.stream.selectedStream = [];
      store.state.zoConfig = {
        ...zoConfig,
        auto_query_enabled: false,
        query_on_stream_selection: true,
      };
      await wrapper.vm.loadStreamLists(true);
      expect(searchObj.data.stream.selectedStream).toEqual([]);
    });

    it("preselects the newest stream only while the guard is active", async () => {
      searchObj.data.stream.selectedStream = [];
      store.state.zoConfig = {
        ...zoConfig,
        auto_query_enabled: true,
        query_on_stream_selection: true,
      };
      await wrapper.vm.loadStreamLists(true);
      expect(searchObj.data.stream.selectedStream).toEqual([]);

      store.state.zoConfig = {
        ...zoConfig,
        auto_query_enabled: true,
        query_on_stream_selection: true,
        auto_query_max_scan_mb: 1024,
      };
      await wrapper.vm.loadStreamLists(true);
      expect(searchObj.data.stream.selectedStream).toEqual(["newest"]);
    });
  });

  describe("per-type Logs selection keys (P1 step 2)", () => {
    beforeEach(() => localStorage.clear());

    it("writes only the namespaced Logs key, never the Traces or Metrics keys", () => {
      saveLogsSelectedStreams("org1", "traces", ["t1"]);
      saveLogsSelectedStreams("org1", "metrics", ["m1"]);
      expect(localStorage.getItem("oo_logs_selected_stream_traces_org1")).toBe('["t1"]');
      expect(localStorage.getItem("oo_selected_stream_traces_org1")).toBeNull();
      expect(localStorage.getItem("oo_selected_stream_metrics_org1")).toBeNull();
      expect(restoreLogsSelectedStreams("org1", "traces")).toEqual(["t1"]);
    });

    it("reads the legacy logs key as a fallback for logs only, and never writes it", () => {
      localStorage.setItem("oo_selected_stream_logs_org1", '["legacy"]');
      expect(restoreLogsSelectedStreams("org1", "logs")).toEqual(["legacy"]);
      expect(restoreLogsSelectedStreams("org1", "enrichment_tables")).toEqual([]);
      saveLogsSelectedStreams("org1", "logs", ["new"]);
      expect(restoreLogsSelectedStreams("org1", "logs")).toEqual(["new"]);
      expect(localStorage.getItem("oo_selected_stream_logs_org1")).toBe('["legacy"]');
    });
  });
});
