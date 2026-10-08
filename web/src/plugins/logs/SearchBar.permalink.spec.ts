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

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { createRouter, createMemoryHistory } from "vue-router";
import config from "@/aws-exports";
import SearchBar from "@/plugins/logs/SearchBar.vue";
import { resetLogsAutoRunForTests } from "@/composables/useLogs/logsAutoRun";
import {
  activePermalink,
  columnsFromUrl,
  resetPermalinkForTests,
} from "@/composables/useLogs/useLogPermalink";

const { scheduleSearch, toastMock, getViewDetail } = vi.hoisted(() => ({
  scheduleSearch: vi.fn(),
  toastMock: vi.fn(),
  getViewDetail: vi.fn(),
}));

vi.mock("@/services/saved_views", async () => {
  const actual = await vi.importActual<any>("@/services/saved_views");
  return { default: { ...actual.default, getViewDetail } };
});

vi.mock("@/services/search", async () => {
  const actual = await vi.importActual<any>("@/services/search");
  return { default: { ...actual.default, schedule_search: scheduleSearch } };
});

vi.mock("@/lib/feedback/Toast/useToast", async () => {
  const actual = await vi.importActual<any>("@/lib/feedback/Toast/useToast");
  return { ...actual, toast: toastMock };
});

// Field extraction fetches schemas; the apply path only needs it to resolve.
vi.mock("@/composables/useLogs/useStreamFields", async () => {
  const actual = await vi.importActual<any>("@/composables/useLogs/useStreamFields");
  return {
    ...actual,
    default: () => ({ ...actual.default(), extractFields: vi.fn(async () => undefined) }),
  };
});

// The apply path re-reads the stream list; a fixed readable list keeps it off the network.
vi.mock("@/composables/useStreams", async () => {
  const actual = await vi.importActual<any>("@/composables/useStreams");
  return {
    ...actual,
    default: (...args: any[]) => ({
      ...actual.default(...args),
      getStreams: vi.fn(async () => ({ list: [{ name: "app_logs", schema: [] }] })),
      getStream: vi.fn(async () => ({ name: "app_logs", schema: [], settings: {} })),
    }),
  };
});

// A light in-memory router: the app router lazy-loads real pages on navigation.
const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/logs", name: "logs", component: { template: "<div />" } }],
});

describe("SearchBar — 4c line links and URL timing", () => {
  let wrapper: VueWrapper<any> | undefined;
  const originalIsEnterprise = config.isEnterprise;
  const originalZoConfig = { ...store.state.zoConfig };

  const mountSearchBar = () =>
    mount(SearchBar, {
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: { QueryEditor: true },
      },
    });

  const setup = async (opts: { aqe?: boolean; liveMode?: boolean } = {}) => {
    store.state.zoConfig = {
      ...originalZoConfig,
      auto_query_enabled: opts.aqe ?? true,
      query_on_stream_selection: true,
      web_url: "https://o2.example",
    };
    wrapper = mountSearchBar();
    const { searchObj } = wrapper.vm;
    searchObj.meta.logsVisualizeToggle = "logs";
    searchObj.meta.sqlMode = false;
    searchObj.meta.liveMode = opts.liveMode ?? true;
    searchObj.meta.editorDirty = false;
    searchObj.meta.runPending = false;
    searchObj.meta.executed = null;
    searchObj.meta.pendingExecution = null;
    searchObj.meta.autoRunBlocked = null;
    searchObj.data.query = "";
    searchObj.data.editorValue = "";
    searchObj.data.stream.selectedStream = ["app_logs"];
    searchObj.data.stream.streamLists = [{ label: "app_logs", value: "app_logs" }];
    searchObj.data.datetime = { type: "relative", relativeTimePeriod: "15m" };
    searchObj.data.queryResults = { hits: [{ _timestamp: 1 }] };
    await flushPromises();
    const logs = vi.fn();
    wrapper.vm.autoRun.setExecutors({ logs, patterns: vi.fn(), histogram: vi.fn() });
    return { searchObj, logs };
  };

  beforeEach(() => {
    resetLogsAutoRunForTests();
    toastMock.mockClear();
    scheduleSearch.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    (config as any).isEnterprise = originalIsEnterprise;
    store.state.zoConfig = originalZoConfig;
    vi.restoreAllMocks();
  });

  describe("4c line links and URL timing at the search bar", () => {
    const openPermalink = () => {
      activePermalink.value = {
        org: "default",
        link: { stream: "app_logs", ts: 5 },
        generation: 1,
        multiStream: false,
        regions: [],
        clusters: [],
        outcome: null,
      };
    };

    beforeEach(() => resetPermalinkForTests());

    it("a picked time ends an opened line link; the picker's own restore emission does not (C5 step 6b)", async () => {
      await setup({ liveMode: false });
      openPermalink();
      await wrapper!.vm.updateDateTime({
        valueType: "relative",
        relativeTimePeriod: "15m",
        startTime: 1,
        endTime: 2,
        userChangedValue: false,
      });
      expect(activePermalink.value).not.toBeNull();
      await wrapper!.vm.updateDateTime({
        valueType: "relative",
        relativeTimePeriod: "1h",
        startTime: 1,
        endTime: 2,
        userChangedValue: true,
      });
      expect(activePermalink.value).toBeNull();
    });

    it("applying a saved view ends the line link and the link's columns, and writes no URL before its run (J-C17, J-C28)", async () => {
      await router.replace({ name: "logs", query: { stream: "app_logs", period: "15m" } });
      const { searchObj, logs } = await setup();
      activePermalink.value = {
        org: "default",
        link: { stream: "app_logs", ts: 5 },
        generation: 1,
        multiStream: false,
        regions: [],
        clusters: [],
        outcome: null,
      };
      columnsFromUrl.value = true;
      const legacy = JSON.parse(JSON.stringify(wrapper!.vm.getSearchObj()));
      legacy.data.stream.selectedStream = ["app_logs"];
      legacy.data.resultGrid = { ...(legacy.data.resultGrid ?? {}), colOrder: {}, colSizes: {} };
      getViewDetail.mockResolvedValueOnce({ status: 200, data: { data: legacy } });
      wrapper!.vm.dateTimeRef = { setSavedDate: vi.fn() };
      const push = vi.spyOn(router, "push");
      await wrapper!.vm.applySavedView({ view_id: "v2", view_name: "view" });
      expect(activePermalink.value).toBeNull();
      expect(columnsFromUrl.value).toBe(false);
      await vi.waitFor(() => expect(logs).toHaveBeenCalled(), { timeout: 4000 });
      await flushPromises();
      expect(push).not.toHaveBeenCalled();
      expect(JSON.stringify(wrapper!.vm.getSearchObj())).not.toContain("columnsFromUrl");
      expect(searchObj.meta.logsVisualizeToggle).toBe("logs");
    });
    it("keeps a link's µs window when the picker only echoes it in whole seconds; a user pick still wins (C3, found on page)", async () => {
      const { searchObj } = await setup({ liveMode: false });
      const start = 1_700_000_000_123_456;
      const end = 1_700_000_100_654_321;
      const echo = (extra: Record<string, unknown>) =>
        wrapper!.vm.updateDateTime({
          valueType: "absolute",
          startTime: 1_700_000_000_000_000,
          endTime: 1_700_000_100_000_000,
          userChangedValue: false,
          ...extra,
        });
      searchObj.data.datetime = { type: "absolute", startTime: start, endTime: end };
      await echo({});
      expect([searchObj.data.datetime.startTime, searchObj.data.datetime.endTime]).toEqual([
        start,
        end,
      ]);
      await echo({ endTime: 1_700_000_200_000_000 });
      expect(searchObj.data.datetime.endTime).toBe(1_700_000_200_000_000);
      searchObj.data.datetime = { type: "absolute", startTime: start, endTime: end };
      await echo({ userChangedValue: true });
      expect(searchObj.data.datetime.startTime).toBe(1_700_000_000_000_000);
    });

    it("switching mode is a view-state replace, never a new history entry", async () => {
      await router.replace({ name: "logs", query: { stream: "app_logs", period: "15m" } });
      await setup();
      const push = vi.spyOn(router, "push");
      const replace = vi.spyOn(router, "replace");
      await wrapper!.vm.onLogsVisualizeToggleUpdate("patterns");
      await flushPromises();
      expect(push).not.toHaveBeenCalled();
      expect(replace).toHaveBeenCalled();
      expect(router.currentRoute.value.query).toMatchObject({
        stream: "app_logs",
        period: "15m",
        logs_visualize_toggle: "patterns",
      });
    });
  });
});
