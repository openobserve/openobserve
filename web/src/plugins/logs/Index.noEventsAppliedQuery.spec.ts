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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

import Index from "@/plugins/logs/Index.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { resetLogsAutoRunForTests } from "@/composables/useLogs/logsAutoRun";

vi.mock("@/stores", async () => ({ default: (await import("@/test/unit/helpers/store")).default }));

const { sent } = vi.hoisted(() => ({ sent: [] as { payload: any; handlers: any }[] }));

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (payload: any, handlers: any) => {
      sent.push({ payload, handlers });
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

const nowUs = Date.now() * 1000;
const appStream = {
  name: "app",
  stream_type: "logs",
  schema: [
    { name: "_timestamp", type: "Int64" },
    { name: "level", type: "Utf8" },
  ],
  settings: {},
  stats: { doc_time_min: nowUs - 60_000_000, doc_time_max: nowUs - 1_000_000 },
};

describe("Logs Index: the no-events copy follows the query that ran", { timeout: 30000 }, () => {
  let wrapper: any;

  const searchHits = () => sent.filter((s) => s.payload.type === "search");
  const runButton = () => wrapper.find('[data-test="logs-search-bar-refresh-btn"]');
  const noEvents = () => wrapper.find('[data-test="logs-search-no-events-found-text"]');
  const deliverNothing = async () => {
    const { payload, handlers } = searchHits()[searchHits().length - 1];
    handlers.data(payload, {
      type: "search_response_metadata",
      content: { results: { total: 0, hits: [] } },
    });
    handlers.data(payload, { type: "search_response_hits", content: { results: { hits: [] } } });
    handlers.complete(payload, {});
    await flushPromises();
  };
  const runFilter = async (query: string) => {
    const { searchObj } = wrapper.vm;
    searchObj.data.query = query;
    searchObj.data.editorValue = query;
    await flushPromises();
    await runButton().trigger("click");
    await vi.waitFor(() => expect(searchHits()).toHaveLength(1));
    await deliverNothing();
    await vi.waitFor(() => expect(noEvents().exists()).toBe(true));
  };
  const editWithoutRunning = async (query: string) => {
    const { searchObj } = wrapper.vm;
    searchObj.data.query = query;
    searchObj.data.editorValue = query;
    wrapper.vm.autoRun.engine.markEditorDirty();
    await flushPromises();
  };

  beforeEach(async () => {
    resetLogsAutoRunForTests();
    (store.state as any).logs = { isInitialized: true, logs: {} };
    vi.spyOn(store, "dispatch").mockResolvedValue(undefined as any);
    wrapper = mount(Index, {
      attachTo: "#app",
      global: { provide: { store }, plugins: [i18n, router] },
    });
    await flushPromises();
    sent.length = 0;
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
    searchObj.data.errorMsg = "";
    searchObj.data.filterErrMsg = "";
    searchObj.data.datetime.type = "relative";
    searchObj.data.datetime.relativeTimePeriod = "1d";
    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
  });

  it("removing the filter of a 0-row run without running keeps the Nothing matched copy", async () => {
    await runFilter("level = 'nomatch'");
    expect(noEvents().text()).toContain("Nothing matched");

    await editWithoutRunning("");

    expect(noEvents().text()).toContain("Nothing matched");
    expect(noEvents().text()).not.toContain("doesn't contain any data");
    expect(wrapper.find('[data-test="logs-no-events-jump-to-data-card"]').exists()).toBe(false);
  });

  it("adding a filter to a 0-row unfiltered run without running keeps the jump-to-data copy", async () => {
    await runFilter("");
    expect(noEvents().text()).toContain("doesn't contain any data");

    await editWithoutRunning("level = 'error'");

    expect(noEvents().text()).toContain("doesn't contain any data");
    expect(wrapper.find('[data-test="logs-no-events-jump-to-data-card"]').exists()).toBe(true);
  });
});
