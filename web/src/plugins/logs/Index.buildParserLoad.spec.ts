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

const { panelRuns, panelQueries, sentRequests, parserLoad } = vi.hoisted(() => ({
  panelRuns: [] as unknown[][],
  panelQueries: [] as string[],
  sentRequests: [] as any[],
  parserLoad: { fail: true, attempts: 0 },
}));

vi.mock("@/composables/useParser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/useParser")>();
  return {
    default: () => ({
      sqlParser: async () => {
        parserLoad.attempts++;
        if (parserLoad.fail) throw new Error("Failed to fetch dynamically imported module");
        return actual.default().sqlParser();
      },
    }),
  };
});

vi.mock("@/components/dashboards/PanelEditor/PanelEditor.vue", () => ({
  default: {
    name: "PanelEditor",
    template: '<div data-test="panel-editor" />',
    emits: ["queryGenerated"],
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

describe(
  "Logs Index — Build when the SQL parser cannot load (U3 open item, L-25)",
  { timeout: 30000 },
  () => {
    let wrapper: any;

    beforeEach(async () => {
      parserLoad.fail = true;
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
    });

    afterEach(() => {
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

    const settled = async () => {
      await vi.waitFor(() => expect(wrapper.vm.autoRun.engine.hasPendingRequest()).toBe(false));
      await flushPromises();
    };

    it("shows the parser error with Retry, keeps every run blocked, and Retry recovers", async () => {
      showBuild("level = 'error'");
      const notice = () => wrapper.find('[data-test="logs-build-parser-error"]');
      await vi.waitFor(() => expect(notice().exists()).toBe(true));
      expect(notice().text()).toContain("Couldn't load the query parser");

      const runButton = wrapper.find('[data-test="logs-search-bar-visualize-refresh-btn"]');
      expect(runButton.attributes("disabled")).toBeDefined();
      await runButton.trigger("click");
      wrapper.vm.searchBarRef.handleRunQueryFn();
      wrapper.vm.searchBarRef.handleRunQueryFn(true);
      await settled();
      expect(panelRuns).toEqual([]);
      expect(sentRequests).toEqual([]);
      expect(wrapper.vm.searchObj.data.query).toBe("level = 'error'");

      parserLoad.fail = false;
      const attempts = parserLoad.attempts;
      await notice().find('[data-test="logs-build-parser-retry"]').trigger("click");
      await vi.waitFor(() => expect(panelRuns.length).toBe(1));
      expect(parserLoad.attempts).toBeGreaterThan(attempts);
      expect(panelQueries).toEqual([expect.stringMatching(/WHERE .*level.*'error'/)]);
      await vi.waitFor(() => expect(notice().exists()).toBe(false));
      expect(sentRequests).toEqual([]);
    });
  },
);
