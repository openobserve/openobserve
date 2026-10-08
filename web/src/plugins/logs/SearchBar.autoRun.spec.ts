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
import searchService from "@/services/search";

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

const PERSIST_REASON = "Run the query first: this action saves or shares what you ran";

describe("SearchBar — auto-run wiring (item 2)", () => {
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

  // The record a completed run leaves behind: its signature is the live one.
  const markExecuted = () => {
    wrapper!.vm.searchObj.meta.executed = {
      generation: 1,
      signature: wrapper!.vm.autoRun.readSignature(),
      req: {},
      complete: true,
    };
  };

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  describe("J7 / G1 gates at the real controls", () => {
    it("disables every persist or share action before the first run, with the reason", async () => {
      (config as any).isEnterprise = "true";
      await setup();
      const vm = wrapper!.vm;
      expect(vm.shareReason).toBe(PERSIST_REASON);
      expect(vm.saveViewReason).toBe(PERSIST_REASON);
      expect(vm.scheduleJobReason).toBe(PERSIST_REASON);
      expect(vm.visualizeReason).toBe(PERSIST_REASON);
      expect(vm.createAlertDisabledReason).toBe(PERSIST_REASON);
    });

    it("enables them once the current query has run, and disables them again when it goes stale", async () => {
      await setup();
      const vm = wrapper!.vm;
      markExecuted();
      await flushPromises();
      expect(vm.shareReason).toBeNull();
      expect(vm.saveViewReason).toBeNull();
      expect(vm.visualizeReason).toBeNull();
      expect(vm.createAlertDisabledReason).toBeNull();

      vm.searchObj.data.query = "level='error'";
      await flushPromises();
      expect(vm.shareReason).toBe(PERSIST_REASON);
      expect(vm.isDownloadDisabled).toBe(true);
    });

    it("refuses a partial (cancelled mid-stream) run", async () => {
      await setup();
      markExecuted();
      wrapper!.vm.searchObj.meta.executed.complete = false;
      await flushPromises();
      expect(wrapper!.vm.shareReason).toBe(PERSIST_REASON);
    });

    it("gates the save handlers as well as the buttons (2-U-2), incl. the s shortcut path", async () => {
      await setup();
      const dispatch = vi.spyOn(store, "dispatch");
      wrapper!.vm.fnSavedView();
      expect(dispatch).not.toHaveBeenCalledWith("setSavedViewDialog", true);
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "warning", message: PERSIST_REASON }),
      );
      markExecuted();
      await flushPromises();
      wrapper!.vm.fnSavedView();
      expect(dispatch).toHaveBeenCalledWith("setSavedViewDialog", true);
    });

    it("blocks the menu's Schedule search job while unrun, but the guard's job path stays open (G1-X1)", async () => {
      (config as any).isEnterprise = "true";
      await setup();
      const vm = wrapper!.vm;
      vm.createScheduleJob();
      expect(vm.searchSchedulerJob).toBe(false);
      vm.openGuardSearchJob({ query: { sql: "frozen" } });
      expect(vm.searchSchedulerJob).toBe(true);
    });

    it("submits the guard's frozen snapshot and says why a 403 failed", async () => {
      (config as any).isEnterprise = "true";
      await setup();
      const vm = wrapper!.vm;
      vm.searchObj.meta.jobId = "";
      vm.searchObj.meta.jobRecords = 100;
      scheduleSearch.mockRejectedValueOnce({ response: { status: 403, data: {} } });
      vm.openGuardSearchJob({ query: { sql: 'select * from "frozen"', size: 10 } });
      await vm.addJobScheduler();
      expect(scheduleSearch.mock.calls[0][0].query.query.sql).toBe('select * from "frozen"');
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "You do not have permission to create search jobs",
        }),
      );
    });

    it("shows the server's message for any other job failure", async () => {
      (config as any).isEnterprise = "true";
      await setup();
      const vm = wrapper!.vm;
      vm.searchObj.meta.jobId = "";
      vm.searchObj.meta.jobRecords = 100;
      scheduleSearch.mockRejectedValueOnce({
        response: { status: 500, data: { message: "queue full" } },
      });
      vm.openGuardSearchJob({ query: { sql: 'select * from "frozen"', size: 10 } });
      await vm.addJobScheduler();
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error", message: "queue full" }),
      );
    });
  });

  describe("J4 trigger sites dispatch through requestRun", () => {
    it("coalesces three facet includes inside 300 ms into one filter run (AC4.2)", async () => {
      const { searchObj, logs } = await setup();
      for (const term of ["a='1'", "b='2'", "c='3'"]) {
        searchObj.data.stream.addToFilter = term;
        await flushPromises();
      }
      expect(logs).not.toHaveBeenCalled();
      await wait(350);
      expect(logs).toHaveBeenCalledTimes(1);
      expect(logs.mock.calls[0][0]).toMatchObject({ reason: "filter", kind: "refinement" });
      expect(searchObj.data.query).toContain("c='3'");
    });

    it("merges typed-but-uncommitted text into a facet rewrite and never auto-runs it (AC4.4)", async () => {
      const { searchObj, logs } = await setup();
      wrapper!.vm.queryEditorRef = { getValue: () => "status=500", setValue: vi.fn() };
      wrapper!.vm.onEditorUserEdit();
      searchObj.data.stream.addToFilter = "level='error'";
      await flushPromises();
      await wait(350);
      expect(searchObj.data.query).toContain("status=500");
      expect(searchObj.data.query).toContain("level='error'");
      expect(logs).not.toHaveBeenCalled();
      expect(wrapper!.vm.showRunPendingDot).toBe(true);
    });

    it("runs a relative time change with Auto Run on, and not with it off (D1)", async () => {
      const { logs } = await setup({ liveMode: false });
      await wrapper!.vm.updateDateTime({
        valueType: "relative",
        relativeTimePeriod: "1h",
        startTime: 1,
        endTime: 2,
        userChangedValue: true,
      });
      await wait(10);
      expect(logs).not.toHaveBeenCalled();

      wrapper!.vm.searchObj.meta.liveMode = true;
      await wrapper!.vm.updateDateTime({
        valueType: "relative",
        relativeTimePeriod: "6h",
        startTime: 1,
        endTime: 2,
        userChangedValue: true,
      });
      await wait(10);
      expect(logs).toHaveBeenCalledTimes(1);
      expect(logs.mock.calls[0][0]).toMatchObject({ reason: "time" });
    });

    it("runs a histogram zoom as explicit even with Auto Run off (J4, #4295)", async () => {
      const { logs } = await setup({ liveMode: false });
      wrapper!.vm.markZoom();
      await wrapper!.vm.updateDateTime({
        valueType: "absolute",
        startTime: 10,
        endTime: 20,
        userChangedValue: false,
      });
      expect(logs).toHaveBeenCalledTimes(1);
      expect(logs.mock.calls[0][0]).toMatchObject({ reason: "zoom", kind: "explicit" });
    });

    it("leaves a zoom pending while the editor is dirty", async () => {
      const { logs, searchObj } = await setup();
      wrapper!.vm.onEditorUserEdit();
      wrapper!.vm.markZoom();
      await wrapper!.vm.updateDateTime({
        valueType: "absolute",
        startTime: 10,
        endTime: 20,
        userChangedValue: false,
      });
      expect(logs).not.toHaveBeenCalled();
      expect(searchObj.meta.runPending).toBe(true);
    });

    it("does not run a function applied while a saved view loads", async () => {
      const { logs } = await setup();
      const functionRuns = () =>
        logs.mock.calls.filter((call: any[]) => call[0].reasons.includes("function")).length;
      store.state.savedViewFlag = true;
      wrapper!.vm.populateFunctionImplementation({ name: "f", function: ".a = 1" }, false);
      await wait(350);
      expect(functionRuns()).toBe(0);
      store.state.savedViewFlag = false;
      wrapper!.vm.populateFunctionImplementation({ name: "f", function: ".a = 2" }, false);
      await vi.waitFor(() => expect(functionRuns()).toBe(1), { timeout: 3000 });
      expect(functionRuns()).toBe(1);
    });

    it("cancels the in-flight generation from the Cancel button in OSS too", async () => {
      (config as any).isEnterprise = "false";
      const { searchObj } = await setup();
      const generation = wrapper!.vm.autoRun.engine.newGeneration({
        lane: "grid",
        kind: "explicit",
        reason: "run",
        op: "full",
        signature: wrapper!.vm.autoRun.readSignature(),
      });
      searchObj.loading = true;
      await flushPromises();
      expect(wrapper!.vm.isGridInFlight).toBe(true);
      wrapper!.vm.cancelRun();
      expect(generation.cancelled).toBe(true);
      expect(searchObj.loading).toBe(false);
    });
  });

  describe("saved views and run-state hygiene (TRANSIENT_SEARCH_KEYS)", () => {
    it("applies a view saved before this change: its liveMode and download request never land (L-29)", async () => {
      await router.replace({ name: "logs", query: {} });
      const { searchObj, logs } = await setup();
      markExecuted();
      searchObj.meta.liveMode = true;
      const legacy = JSON.parse(JSON.stringify(wrapper!.vm.getSearchObj()));
      legacy.meta.liveMode = false;
      legacy.meta.executed = { generation: 99, signature: {}, req: {}, complete: true };
      legacy.data.customDownloadQueryObj = { query: { sql: "stale" } };
      legacy.data.stream.selectedStream = ["app_logs"];
      legacy.data.resultGrid = { ...(legacy.data.resultGrid ?? {}), colOrder: {}, colSizes: {} };
      getViewDetail.mockResolvedValueOnce({ status: 200, data: { data: legacy } });
      wrapper!.vm.dateTimeRef = { setSavedDate: vi.fn() };

      await wrapper!.vm.applySavedView({ view_id: "v1", view_name: "old" });
      await flushPromises();

      expect(searchObj.meta.liveMode).toBe(true);
      expect(searchObj.meta.executed).toBeNull();
      expect(searchObj.data.customDownloadQueryObj).toBeUndefined();
      expect(wrapper!.vm.autoRun.engine.isResultsStale()).toBe(false);
      await vi.waitFor(() => expect(logs).toHaveBeenCalled(), { timeout: 4000 });
      expect(logs.mock.calls.at(-1)[0]).toMatchObject({ reason: "saved-view", op: "full" });
    });

    const applyView = async (view: any) => {
      getViewDetail.mockResolvedValueOnce({ status: 200, data: { data: view } });
      wrapper!.vm.dateTimeRef = { setSavedDate: vi.fn() };
      await wrapper!.vm.applySavedView({ view_id: "v1", view_name: "v" });
      await flushPromises();
    };

    const viewOf = () => {
      const view = JSON.parse(JSON.stringify(wrapper!.vm.getSearchObj()));
      view.data.stream.selectedStream = ["app_logs"];
      view.data.resultGrid = { ...(view.data.resultGrid ?? {}), colOrder: {}, colSizes: {} };
      return view;
    };

    it("after a view apply with no run, Custom range says to run the query and never sends a reset request", async () => {
      await router.replace({ name: "logs", query: {} });
      const { searchObj } = await setup();
      markExecuted();
      searchObj.data.customDownloadQueryObj = { query: { sql: "x" } };
      expect(wrapper!.vm.customRangeReason).toBeNull();
      await applyView(viewOf());

      expect(searchObj.meta.executed).toBeNull();
      expect(wrapper!.vm.customRangeReason).toBe("Run the query to download");
      const search = vi.spyOn(searchService, "search");
      wrapper!.vm.downloadCustomInitialNumber = 1;
      wrapper!.vm.downloadRangeData();
      await flushPromises();
      expect(search).not.toHaveBeenCalled();
    });

    it("never saves run state, the Auto Run preference or the download request", async () => {
      await setup();
      const vm = wrapper!.vm;
      markExecuted();
      vm.searchObj.meta.autoRunBlocked = { reason: "time" };
      vm.searchObj.data.customDownloadQueryObj = { query: { sql: "x" } };
      const saved = vm.getSearchObj();
      expect(saved.meta.executed).toBeUndefined();
      expect(saved.meta.autoRunBlocked).toBeUndefined();
      expect(saved.meta.liveMode).toBeUndefined();
      expect(saved.meta.editorDirty).toBeUndefined();
      expect(saved.data.customDownloadQueryObj).toBeUndefined();
      expect(vm.searchObj.meta.executed).not.toBeNull();
    });
  });
});
