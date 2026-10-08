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

const { sent, aborted } = vi.hoisted(() => ({
  sent: [] as { payload: any; handlers: any }[],
  aborted: [] as string[],
}));

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (payload: any, handlers: any) => {
      sent.push({ payload, handlers });
      return Promise.resolve();
    },
    cancelStreamQueryBasedOnRequestId: ({ trace_id }: { trace_id: string }) => {
      aborted.push(trace_id);
    },
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

const appStream = {
  name: "app",
  stream_type: "logs",
  schema: [
    { name: "_timestamp", type: "Int64" },
    { name: "message", type: "Utf8" },
  ],
  settings: {},
};

const hits = [
  { _timestamp: 1_700_000_000_000_002, message: "second" },
  { _timestamp: 1_700_000_000_000_001, message: "first" },
];

describe(
  "Logs Index: a search cancelled before its first chunk (item 2 early cancel)",
  { timeout: 30000 },
  () => {
    let wrapper: any;

    const searchHits = () => sent.filter((s) => s.payload.type === "search");
    const runButton = () => wrapper.find('[data-test="logs-search-bar-refresh-btn"]');
    const deliver = async (rows: unknown[]) => {
      const { payload, handlers } = searchHits()[searchHits().length - 1];
      handlers.data(payload, {
        type: "search_response_metadata",
        content: { results: { total: rows.length, hits: [] } },
      });
      handlers.data(payload, {
        type: "search_response_hits",
        content: { results: { hits: rows } },
      });
      handlers.complete(payload, {});
      await flushPromises();
    };

    beforeEach(async () => {
      (store.state as any).logs = { isInitialized: true, logs: {} };
      vi.spyOn(store, "dispatch").mockResolvedValue(undefined as any);
      wrapper = mount(Index, {
        attachTo: "#app",
        global: { provide: { store }, plugins: [i18n, router] },
      });
      await flushPromises();
      sent.length = 0;
      aborted.length = 0;
      const { searchObj } = wrapper.vm;
      searchObj.data.streamResults = { list: [appStream] };
      searchObj.data.stream.streamLists = [{ label: "app", value: "app" }];
      searchObj.data.stream.selectedStream = ["app"];
      searchObj.data.stream.selectedStreamFields = appStream.schema.map((f) => ({
        name: f.name,
        streams: ["app"],
      }));
      searchObj.meta.sqlMode = false;
      searchObj.meta.showHistogram = false;
      searchObj.meta.logsVisualizeToggle = "logs";
      searchObj.meta.refreshInterval = 0;
      searchObj.meta.jobId = "";
      searchObj.data.query = "";
      searchObj.data.editorValue = "";
      searchObj.data.errorMsg = "";
      searchObj.data.filterErrMsg = "";
      await flushPromises();
    });

    afterEach(() => {
      wrapper?.unmount();
      vi.restoreAllMocks();
    });

    it("Cancel on the Run button before any result shows Search cancelled, never No events found", async () => {
      await runButton().trigger("click");
      await vi.waitFor(() => expect(searchHits()).toHaveLength(1));
      await vi.waitFor(() => expect(runButton().text()).toBe("Cancel query"));

      await runButton().trigger("click");
      await flushPromises();

      expect(aborted).toContain(searchHits()[0].payload.traceId);
      const cancelled = wrapper.find('[data-test="logs-search-cancelled-state"]');
      expect(cancelled.exists()).toBe(true);
      expect(cancelled.text()).toContain("Search cancelled");
      expect(cancelled.text()).toContain("No results were loaded");
      expect(wrapper.find('[data-test="logs-search-no-events-found-text"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain("No events found");
    });

    it("the cancelled state's Run query action runs the query again", async () => {
      await runButton().trigger("click");
      await vi.waitFor(() => expect(searchHits()).toHaveLength(1));
      await vi.waitFor(() => expect(runButton().text()).toBe("Cancel query"));
      await runButton().trigger("click");
      await flushPromises();

      await wrapper.find('[data-test="logs-search-cancelled-state"] button').trigger("click");
      await vi.waitFor(() => expect(searchHits()).toHaveLength(2));
      await deliver(hits);
      expect(wrapper.find('[data-test="logs-search-cancelled-state"]').exists()).toBe(false);
    });

    it("a search that finds nothing still says No events found", async () => {
      await runButton().trigger("click");
      await vi.waitFor(() => expect(searchHits()).toHaveLength(1));
      await deliver([]);
      await vi.waitFor(() =>
        expect(wrapper.find('[data-test="logs-search-no-events-found-text"]').exists()).toBe(true),
      );
      expect(wrapper.find('[data-test="logs-search-cancelled-state"]').exists()).toBe(false);
    });

    it("cancelling a page run keeps the earlier rows and notes the cancel", async () => {
      await runButton().trigger("click");
      await vi.waitFor(() => expect(searchHits()).toHaveLength(1));
      await deliver(hits);
      await vi.waitFor(() => expect(wrapper.vm.searchObj.loading).toBe(false));

      wrapper.vm.autoRun.engine.requestRun("pagination");
      await vi.waitFor(() => expect(searchHits()).toHaveLength(2));
      await vi.waitFor(() => expect(runButton().text()).toBe("Cancel query"));
      await runButton().trigger("click");
      await flushPromises();

      expect(wrapper.find('[data-test="logs-search-cancelled-notice"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="logs-search-cancelled-state"]').exists()).toBe(false);
      expect(wrapper.vm.searchObj.data.queryResults.hits).toHaveLength(2);
      expect(wrapper.text()).not.toContain("No events found");
    });

    it.each([false, true])(
      "cancelling after metadata and before hits shows cancellation with retained rows=%s",
      async (retainedRows) => {
        await runButton().trigger("click");
        await vi.waitFor(() => expect(searchHits()).toHaveLength(1));
        if (retainedRows) {
          await deliver(hits);
          await vi.waitFor(() => expect(wrapper.vm.searchObj.loading).toBe(false));
          wrapper.vm.autoRun.engine.requestRun("pagination");
          await vi.waitFor(() => expect(searchHits()).toHaveLength(2));
        }
        const { payload, handlers } = searchHits().at(-1)!;
        handlers.data(payload, {
          type: "search_response_metadata",
          content: { results: { total: 2, hits: [] } },
        });
        await flushPromises();
        expect(wrapper.vm.searchObj.meta.executed?.complete).toBe(false);
        await vi.waitFor(() => expect(runButton().text()).toBe("Cancel query"));
        await runButton().trigger("click");
        await flushPromises();

        expect(aborted).toContain(payload.traceId);
        expect(wrapper.vm.searchObj.meta.runOutcome.logs).toBe("partial");
        expect(wrapper.vm.searchObj.data.queryResults.hits).toEqual(retainedRows ? hits : []);
        expect(wrapper.find('[data-test="logs-search-cancelled-state"]').exists()).toBe(
          !retainedRows,
        );
        expect(wrapper.find('[data-test="logs-search-cancelled-notice"]').exists()).toBe(
          retainedRows,
        );
        expect(wrapper.text()).toContain("Search cancelled");
        expect(wrapper.text()).not.toContain("No events found");

        await runButton().trigger("click");
        await vi.waitFor(() => expect(searchHits()).toHaveLength(retainedRows ? 3 : 2));
        expect(wrapper.vm.searchObj.meta.runCancelled.logs).toBe(false);
        await deliver(hits);
        expect(wrapper.find('[data-test="logs-search-cancelled-state"]').exists()).toBe(false);
        expect(wrapper.find('[data-test="logs-search-cancelled-notice"]').exists()).toBe(false);
      },
    );

    it("a partial failure after metadata is not shown as a cancellation", async () => {
      await runButton().trigger("click");
      await vi.waitFor(() => expect(searchHits()).toHaveLength(1));
      const { payload, handlers } = searchHits()[0];
      handlers.data(payload, {
        type: "search_response_metadata",
        content: { results: { total: 2, hits: [] } },
      });
      handlers.error(payload, { content: { message: "boom", code: 500 } });
      await flushPromises();

      expect(wrapper.vm.searchObj.meta.runOutcome.logs).toBe("partial");
      expect(wrapper.vm.searchObj.meta.runCancelled.logs).toBe(false);
      expect(wrapper.find('[data-test="logs-search-cancelled-state"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="logs-search-cancelled-notice"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain("Search cancelled");
    });

    it("cancellation after hits shows the loaded rows without calling them earlier results", async () => {
      await runButton().trigger("click");
      await vi.waitFor(() => expect(searchHits()).toHaveLength(1));
      const { payload, handlers } = searchHits()[0];
      handlers.data(payload, {
        type: "search_response_metadata",
        content: { results: { total: 2, hits: [] } },
      });
      handlers.data(payload, {
        type: "search_response_hits",
        content: { results: { hits } },
      });
      await flushPromises();
      await vi.waitFor(() => expect(runButton().text()).toBe("Cancel query"));
      await runButton().trigger("click");
      await flushPromises();

      expect(wrapper.vm.searchObj.meta.runOutcome.logs).toBe("partial");
      expect(wrapper.vm.searchObj.data.queryResults.hits).toEqual(hits);
      const notice = wrapper.find('[data-test="logs-search-cancelled-notice"]');
      expect(notice.exists()).toBe(true);
      expect(notice.text()).toContain("Search cancelled");
      expect(notice.text()).not.toContain("earlier results");
      expect(wrapper.find('[data-test="logs-search-cancelled-state"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain("No events found");
    });

    it("cancellation with retained rows and a dirty editor shows both notices", async () => {
      await runButton().trigger("click");
      await vi.waitFor(() => expect(searchHits()).toHaveLength(1));
      await deliver(hits);
      await vi.waitFor(() => expect(wrapper.vm.searchObj.loading).toBe(false));
      wrapper.vm.autoRun.engine.requestRun("pagination");
      await vi.waitFor(() => expect(searchHits()).toHaveLength(2));
      wrapper.vm.searchObj.data.editorValue = "message = 'unrun'";
      wrapper.vm.autoRun.engine.markEditorDirty();
      await vi.waitFor(() => expect(runButton().text()).toBe("Cancel query"));
      await runButton().trigger("click");
      await flushPromises();

      expect(wrapper.vm.searchObj.meta.editorDirty).toBe(true);
      expect(wrapper.vm.searchObj.data.queryResults.hits).toEqual(hits);
      expect(wrapper.find('[data-test="logs-search-results-stale"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="logs-search-cancelled-notice"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="logs-search-cancelled-state"]').exists()).toBe(false);
    });
  },
);
