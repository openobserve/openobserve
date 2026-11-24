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

vi.mock("@/components/dashboards/PanelEditor/PanelEditor.vue", () => ({
  default: {
    name: "PanelEditor",
    template: '<div data-test="panel-editor" />',
    emits: ["queryGenerated", "customQueryModeChanged"],
    mounted(this: any) {
      this.$emit(
        "queryGenerated",
        'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "fts_a" GROUP BY x_axis_1',
      );
    },
    methods: {
      switchMode(this: any, isCustom: boolean) {
        this.$parent.dashboardPanelData.data.queries[0].customQuery = isCustom;
        this.$emit("customQueryModeChanged", isCustom);
      },
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
    { name: "code", type: "Int64" },
    { name: "is_error", type: "Boolean" },
  ],
  settings: { full_text_search_keys: ["body"] },
};

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

    describe("a filter the builder cannot chart", () => {
      const where = "NOT (level = 'info')";
      const openIncomplete = async () => {
        showBuild(where);
        await vi.waitFor(
          () =>
            expect(wrapper.find('[data-test="logs-build-incomplete-filter-notice"]').exists()).toBe(
              true,
            ),
          { timeout: 15000 },
        );
        await flushPromises();
      };

      const toCustom = async () => {
        wrapper.vm.buildQueryPageRef.panelEditorRef.switchMode(true);
        await flushPromises();
      };

      it("keeps the Search query when switching Builder to Custom and seeds the chart query", async () => {
        await openIncomplete();
        await toCustom();

        const { searchObj, buildDashboardPanelData } = wrapper.vm;
        expect(searchObj.data.query).toBe(where);
        expect(searchObj.data.editorValue).toBe(where);
        expect(buildDashboardPanelData.data.queries[0].query).toBe(
          `SELECT histogram(_timestamp) as x_axis_1, count(_timestamp) as y_axis_1 FROM "fts_a" WHERE ${where}\nGROUP BY x_axis_1 ORDER BY x_axis_1`,
        );
      });

      const histogramFrom = (from: string) =>
        `SELECT histogram(_timestamp) as x_axis_1, count(_timestamp) as y_axis_1 FROM ${from} WHERE ${where}\nGROUP BY x_axis_1 ORDER BY x_axis_1`;

      it("quotes a stream name that contains a double quote in the seed", async () => {
        await openIncomplete();
        wrapper.vm.searchObj.data.stream.selectedStream = ['we"ird'];
        await toCustom();

        expect(wrapper.vm.buildDashboardPanelData.data.queries[0].query).toBe(
          histogramFrom('"we""ird"'),
        );
        expect(wrapper.vm.searchObj.data.query).toBe(where);
      });

      it("seeds nothing and keeps Search when several streams are selected", async () => {
        await openIncomplete();
        wrapper.vm.searchObj.data.stream.selectedStream = ["fts_a", "fts_b"];
        wrapper.vm.buildDashboardPanelData.data.queries[0].query = "";
        await toCustom();

        expect(wrapper.vm.buildDashboardPanelData.data.queries[0].query).toBe("");
        expect(wrapper.vm.searchObj.data.query).toBe(where);
        expect(wrapper.vm.searchObj.data.editorValue).toBe(where);
      });

      it("seeds the custom query with the Search SQL in SQL mode and keeps Search", async () => {
        await openIncomplete();
        const sql = `SELECT * FROM "fts_a" WHERE ${where}`;
        const { searchObj } = wrapper.vm;
        searchObj.meta.sqlMode = true;
        searchObj.data.query = sql;
        searchObj.data.editorValue = sql;
        await flushPromises();
        await toCustom();

        expect(wrapper.vm.buildDashboardPanelData.data.queries[0].query).toBe(sql);
        expect(searchObj.data.query).toBe(sql);
        expect(searchObj.data.editorValue).toBe(sql);
      });

      it("puts a trailing line comment before GROUP BY on its own line", async () => {
        const commented = "NOT (level = 'info') -- keep";
        showBuild(commented);
        await vi.waitFor(() =>
          expect(wrapper.find('[data-test="logs-build-incomplete-filter-notice"]').exists()).toBe(
            true,
          ),
        );
        await toCustom();

        expect(wrapper.vm.buildDashboardPanelData.data.queries[0].query).toBe(
          `SELECT histogram(_timestamp) as x_axis_1, count(_timestamp) as y_axis_1 FROM "fts_a" WHERE ${commented}\nGROUP BY x_axis_1 ORDER BY x_axis_1`,
        );
      });

      it("hides the notice once the panel is in Custom mode", async () => {
        await openIncomplete();
        await toCustom();

        expect(wrapper.find('[data-test="logs-build-incomplete-filter-notice"]').exists()).toBe(
          false,
        );
      });

      it("keeps the Search query when SQL mode is toggled", async () => {
        await openIncomplete();
        wrapper.vm.searchObj.meta.sqlMode = true;
        await flushPromises();
        wrapper.vm.searchObj.meta.sqlMode = false;
        await flushPromises();

        expect(wrapper.vm.searchObj.data.query).toBe(where);
        expect(wrapper.vm.searchObj.data.editorValue).toBe(where);
      });
    });

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

    it.each(["code=500 -404 AND is_error", "code=500 AND is_error -404"])(
      "never sends a held filter to the refused SQL toggle: %s",
      async (query) => {
        await openBuildWith(query);
        const notice = wrapper.find('[data-test="logs-build-free-text-notice"]').text();
        expect(notice).toContain("Search query is empty or invalid.");
        expect(notice).not.toContain("edit it in SQL");
        const runButton = wrapper.find('[data-test="logs-search-bar-visualize-refresh-btn"]');
        expect(runButton.attributes("disabled")).toBeDefined();
        expect(panelRuns).toEqual([]);
      },
    );

    it("keeps the edit-in-SQL notice for a text filter the SQL toggle accepts", async () => {
      await openBuildWith("NOT timeout");
      expect(wrapper.find('[data-test="logs-build-free-text-notice"]').text()).toContain(
        "edit it in SQL",
      );
    });

    it("blocks an unsupported negated mix without issuing an unfiltered chart", async () => {
      await openBuildWith("error AND code=500 AND -debug");
      const runButton = wrapper.find('[data-test="logs-search-bar-visualize-refresh-btn"]');
      expect(runButton.attributes("disabled")).toBeDefined();
      await runButton.trigger("click");
      wrapper.vm.searchBarRef.handleRunQueryFn();
      wrapper.vm.searchBarRef.handleRunQueryFn(true);
      await settled();
      expect(panelRuns).toEqual([]);
      expect(panelQueries).toEqual([]);
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

    it("an unrun text and predicate mix builds and runs the rendered filter", async () => {
      showBuild("error AND code=500");
      await vi.waitFor(() => expect(panelRuns.length).toBe(1));
      expect(panelQueries[0]).toMatch(/match_all\('error'\)/);
      expect(panelQueries[0]).toMatch(/code\s*=\s*500/);
      await wrapper.find('[data-test="logs-search-bar-visualize-refresh-btn"]').trigger("click");
      await settled();
      await vi.waitFor(() => expect(panelRuns.length).toBe(2));
      expect(panelQueries[1]).toMatch(/match_all\('error'\)/);
      expect(panelQueries[1]).toMatch(/code\s*=\s*500/);
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
