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
import { watch } from "vue";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { createRouter, createMemoryHistory } from "vue-router";
import SearchBar from "@/plugins/logs/SearchBar.vue";
import { resetLogsAutoRunForTests } from "@/composables/useLogs/logsAutoRun";

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

vi.mock("@/composables/useLogs/useStreamFields", async () => {
  const actual = await vi.importActual<any>("@/composables/useLogs/useStreamFields");
  return {
    ...actual,
    default: () => ({ ...actual.default(), extractFields: vi.fn(async () => undefined) }),
  };
});

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

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/logs", name: "logs", component: { template: "<div />" } }],
});

describe("SearchBar - applying a saved view that fails to load", () => {
  let wrapper: VueWrapper<any> | undefined;
  const originalZoConfig = { ...store.state.zoConfig };

  const setup = async () => {
    store.state.zoConfig = { ...originalZoConfig, web_url: "https://o2.example" };
    wrapper = mount(SearchBar, {
      global: { provide: { store }, plugins: [i18n, router], stubs: { QueryEditor: true } },
    });
    const { searchObj } = wrapper.vm;
    searchObj.meta.logsVisualizeToggle = "logs";
    searchObj.meta.sqlMode = true;
    searchObj.data.query = 'SELECT * FROM "app_logs"';
    searchObj.data.stream.selectedStream = ["app_logs"];
    searchObj.data.stream.streamLists = [{ label: "app_logs", value: "app_logs" }];
    searchObj.data.queryResults = { hits: [{ _timestamp: 1 }] };
    await flushPromises();
    return searchObj;
  };

  const viewFor = (stream: string, sqlMode: boolean) => {
    const legacy = JSON.parse(JSON.stringify(wrapper!.vm.getSearchObj()));
    legacy.data.stream.selectedStream = [stream];
    legacy.data.resultGrid = { ...(legacy.data.resultGrid ?? {}), colOrder: {}, colSizes: {} };
    legacy.meta.sqlMode = sqlMode;
    return { status: 200, data: { data: legacy } };
  };

  beforeEach(() => {
    resetLogsAutoRunForTests();
    toastMock.mockClear();
    getViewDetail.mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    store.state.zoConfig = originalZoConfig;
    vi.restoreAllMocks();
  });

  it("keeps SQL mode and the query when the view's stream no longer exists", async () => {
    const searchObj = await setup();
    const query = searchObj.data.query;
    getViewDetail.mockResolvedValueOnce(viewFor("deleted_stream", false));
    await wrapper!.vm.applySavedView({ view_id: "v1", view_name: "view" });
    await flushPromises();
    expect(searchObj.meta.sqlMode).toBe(true);
    expect(searchObj.data.query).toBe(query);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock.mock.calls[0][0].message).toContain("deleted_stream");
  });

  it("keeps SQL mode and shows the server message when the view itself is gone", async () => {
    const searchObj = await setup();
    getViewDetail.mockRejectedValueOnce({ response: { data: { message: "View not found" } } });
    await wrapper!.vm.applySavedView({ view_id: "v1", view_name: "view" });
    await flushPromises();
    expect(searchObj.meta.sqlMode).toBe(true);
    expect(toastMock.mock.calls[0][0].message).toBe("View not found");
  });

  it("still applies a good view: sqlMode comes from the view", async () => {
    const searchObj = await setup();
    wrapper!.vm.dateTimeRef = { setSavedDate: vi.fn() };
    getViewDetail.mockResolvedValueOnce(viewFor("app_logs", false));
    await wrapper!.vm.applySavedView({ view_id: "v1", view_name: "view" });
    await vi.waitFor(() => expect(searchObj.meta.sqlMode).toBe(false), { timeout: 4000 });
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("keeps a quick-mode view's filter when applied from SQL mode", async () => {
    const searchObj = await setup();
    wrapper!.vm.dateTimeRef = { setSavedDate: vi.fn() };
    // Mirrors the fullSQLMode watcher in Index.vue.
    watch(
      () => searchObj.meta.sqlMode,
      (on: boolean) => {
        if (!on) {
          searchObj.data.query = "";
          searchObj.data.editorValue = "";
        }
      },
    );
    const view = viewFor("app_logs", false);
    view.data.data.data.query = "status = 500";
    getViewDetail.mockResolvedValueOnce(view);
    await wrapper!.vm.applySavedView({ view_id: "v1", view_name: "view" });
    await vi.waitFor(() => expect(searchObj.meta.sqlMode).toBe(false), { timeout: 4000 });
    await flushPromises();
    expect(searchObj.data.query).toBe("status = 500");
  });
});
