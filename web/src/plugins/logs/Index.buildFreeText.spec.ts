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
import { mount, flushPromises } from "@vue/test-utils";

import Index from "@/plugins/logs/Index.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
vi.mock("@/stores", async () => {
  const { default: store } = await import("@/test/unit/helpers/store");
  return { default: store };
});
import router from "@/test/unit/helpers/router";

const { panelRuns, panelQueries, sentRequests, parserGate } = vi.hoisted(() => ({
  panelRuns: [] as unknown[][],
  panelQueries: [] as string[],
  sentRequests: [] as any[],
  parserGate: { wait: null as Promise<void> | null, calls: 0 },
}));

// Holds Build's WHERE parse open, so a test can act while the filter is not yet in the builder.
vi.mock("@/utils/query/sqlUtils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/query/sqlUtils")>();
  return {
    ...actual,
    parseWhereClauseToFilterChecked: async (whereClause: string) => {
      parserGate.calls++;
      if (parserGate.wait) await parserGate.wait;
      return actual.parseWhereClauseToFilterChecked(whereClause);
    },
  };
});

// The Build panel's only request path; every call is a chart search.
vi.mock("@/components/dashboards/PanelEditor/PanelEditor.vue", () => ({
  default: {
    name: "PanelEditor",
    template: '<div data-test="panel-editor" />',
    emits: ["queryGenerated"],
    // The real editor emits its interim builder query as soon as it mounts, before any filter is set.
    mounted(this: any) {
      this.$emit(
        "queryGenerated",
        'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "fts_a" GROUP BY x_axis_1',
      );
    },
    methods: {
      runQuery(this: any, ...args: unknown[]) {
        panelRuns.push(args);
        panelQueries.push(this.$parent.dashboardPanelData.data.queries[0].query);
      },
    },
  },
}));

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (payload: any) => {
      sentRequests.push(JSON.parse(JSON.stringify(payload.queryReq)));
      return Promise.resolve();
    },
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));

vi.mock("@/composables/useLogs/usePatterns", () => ({
  default: () => ({
    extractPatterns: vi.fn().mockResolvedValue(undefined),
    patternsState: { value: { patterns: null, loading: false, error: null, lastQuery: null } },
  }),
  patternsState: { value: { patterns: null, loading: false, error: null, lastQuery: null } },
}));

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

const ftsStream = {
  name: "fts_a",
  stream_type: "logs",
  schema: [
    { name: "_timestamp", type: "Int64" },
    { name: "body", type: "Utf8" },
    { name: "level", type: "Utf8" },
  ],
  settings: { full_text_search_keys: ["body"] },
};

// Mounting the whole page is slow on a loaded machine, so the budget is per test, not global.
describe(
  "Logs Index — Build tab with a text search it cannot hold (AC6.6)",
  { timeout: 30000 },
  () => {
    let wrapper: any;

    beforeEach(async () => {
      (store.state as any).logs = { isInitialized: true, logs: {} };
      vi.spyOn(store, "dispatch").mockResolvedValue(undefined as any);
      wrapper = mount(Index, {
        attachTo: "#app",
        global: { provide: { store }, plugins: [i18n, router] },
      });
      await flushPromises();
      panelRuns.length = 0;
      panelQueries.length = 0;
      sentRequests.length = 0;
      parserGate.calls = 0;
    });

    afterEach(() => {
      parserGate.wait = null;
      wrapper?.unmount();
      vi.restoreAllMocks();
    });

    const showBuild = (query: string) => {
      const { searchObj } = wrapper.vm;
      searchObj.data.streamResults = { list: [ftsStream] };
      searchObj.data.stream.streamLists = [{ label: "fts_a", value: "fts_a" }];
      searchObj.data.stream.selectedStream = ["fts_a"];
      searchObj.data.stream.selectedStreamFields = ftsStream.schema.map((f) => ({ name: f.name }));
      searchObj.meta.sqlMode = false;
      searchObj.data.query = query;
      searchObj.data.editorValue = query;
      searchObj.meta.logsVisualizeToggle = "build";
    };

    const openBuildWith = async (query: string) => {
      showBuild(query);
      await vi.waitFor(() =>
        expect(wrapper.find('[data-test="logs-build-free-text-notice"]').exists()).toBe(true),
      );
      await flushPromises();
    };

    const settled = async () => {
      await vi.waitFor(() => expect(wrapper.vm.autoRun.engine.hasPendingRequest()).toBe(false));
      await flushPromises();
    };

    it("disables Run, and a Run click or Ctrl+Enter sends no search", async () => {
      await openBuildWith("NOT timeout");
      expect(panelRuns).toEqual([]);
      expect(wrapper.vm.searchObj.data.query).toBe("NOT timeout");

      const runButton = wrapper.find('[data-test="logs-search-bar-visualize-refresh-btn"]');
      expect(runButton.exists()).toBe(true);
      expect(runButton.attributes("disabled")).toBeDefined();

      await runButton.trigger("click");
      wrapper.vm.searchBarRef.handleRunQueryFn();
      wrapper.vm.searchBarRef.handleRunQueryFn(true);
      await settled();

      expect(panelRuns).toEqual([]);
      expect(sentRequests).toEqual([]);
    });

    it("Run, Ctrl+Enter and refresh send nothing until the filter is in the builder, which then runs filtered", async () => {
      let release!: () => void;
      parserGate.wait = new Promise<void>((resolve) => (release = resolve));
      showBuild("timeout");
      await vi.waitFor(() => expect(parserGate.calls).toBe(1));
      await flushPromises();

      const runButton = wrapper.find('[data-test="logs-search-bar-visualize-refresh-btn"]');
      expect(runButton.attributes("disabled")).toBeDefined();
      await runButton.trigger("click");
      wrapper.vm.searchBarRef.handleRunQueryFn();
      wrapper.vm.searchBarRef.handleRunQueryFn(true);
      await settled();

      expect(panelRuns).toEqual([]);
      expect(sentRequests).toEqual([]);

      release();
      await vi.waitFor(() => expect(panelRuns.length).toBe(1));
      await settled();
      expect(panelQueries).toEqual([expect.stringMatching(/ WHERE match_all\('timeout'\) /)]);
      expect(sentRequests).toEqual([]);
    });

    it("a text search the builder can hold still runs on Run click", async () => {
      showBuild("timeout");
      await vi.waitFor(() => expect(panelRuns.length).toBe(1));
      expect(wrapper.find('[data-test="logs-build-free-text-notice"]').exists()).toBe(false);

      const runButton = wrapper.find('[data-test="logs-search-bar-visualize-refresh-btn"]');
      expect(runButton.attributes("disabled")).toBeUndefined();
      await runButton.trigger("click");
      await settled();

      await vi.waitFor(() => expect(panelRuns.length).toBe(2));
    });
  },
);
