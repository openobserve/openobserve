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
import { nextTick } from "vue";
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

vi.mock("@/composables/useToolbarResponsive", async () => {
  const { ref } = await import("vue");
  return {
    useToolbarResponsive: () => ({
      toolbarLeftRef: ref(null),
      toolbarRightRef: ref(null),
      availableLeftWidth: ref(2000),
    }),
  };
});

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

const PERSIST_REASON = "Run the query first: this action saves or shares what you ran";
const UNRUN_NOTE = "Uses your query (not run yet)";
const EDITED_NOTE = "Uses your edited query (not run yet)";
const SHOWN_RESULTS_NOTE = "Downloads the shown results, not your edit";
const EXPECTED_NOTES: Record<string, string> = {
  "logs-search-bar-menu-create-saved-view-btn": EDITED_NOTE,
  "logs-search-bar-saved-views-menu-create": EDITED_NOTE,
  "logs-create-alert-btn": EDITED_NOTE,
  "search-scheduler-create-new-btn": EDITED_NOTE,
  "search-download-submenu-trigger": SHOWN_RESULTS_NOTE,
  "logs-search-bar-download-custom-range-btn": "Uses the query that last ran, not your edit",
};

describe("SearchBar — auto-run wiring (item 2)", () => {
  let wrapper: VueWrapper<any> | undefined;
  const originalIsEnterprise = config.isEnterprise;
  const originalIsCloud = config.isCloud;
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

  const markExecuted = () => {
    wrapper!.vm.searchObj.meta.executed = {
      generation: 1,
      signature: wrapper!.vm.autoRun.readSignature(),
      req: {},
      complete: true,
    };
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
    config.isCloud = originalIsCloud;
    store.state.zoConfig = originalZoConfig;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("J7 / G1 gates at the real controls", () => {
    it("before the first run, share and visualize need a run while editor-query actions carry a note", async () => {
      (config as any).isEnterprise = "true";
      await setup();
      const vm = wrapper!.vm;
      expect(vm.shareReason).toBe(PERSIST_REASON);
      expect(vm.visualizeReason).toBe("Run your query first");
      expect(vm.saveViewReason).toBeNull();
      expect(vm.scheduleJobReason).toBeNull();
      expect(vm.createAlertDisabledReason).toBeNull();
      expect(vm.saveViewNote).toBe(UNRUN_NOTE);
      expect(vm.scheduleJobNote).toBe(UNRUN_NOTE);
      expect(vm.createAlertNote).toBe(UNRUN_NOTE);
    });

    it("keeps shown-row export allowed in search-around while blocking whole-query export", async () => {
      await setup({ liveMode: false });
      markExecuted();
      wrapper!.vm.autoRun.invalidateExecuted("search-around");
      await flushPromises();
      expect(wrapper!.vm.isDownloadDisabled).toBe(false);
      expect(wrapper!.vm.downloadReason).toBeNull();
      expect(wrapper!.vm.customRangeReason).toBe(i18n.global.t("search.autoRunSearchAroundActive"));
    });

    it("ArrowDown on unavailable Download stays in the parent menu without opening CSV or JSON", async () => {
      await setup({ liveMode: false });
      await wrapper!.get('[data-test="logs-search-bar-more-options-btn"]').trigger("click");
      await flushPromises();
      const download = document.querySelector<HTMLElement>(
        '[data-test="search-download-submenu-trigger"]',
      )!;
      download.focus();
      download.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() =>
        expect(document.activeElement).toBe(
          document.querySelector('[data-test="logs-search-bar-download-custom-range-btn"]'),
        ),
      );
      expect(wrapper!.vm.showDownloadSubmenu).toBe(false);
      expect(document.querySelector('[data-test="search-download-csv-btn"]')).toBeNull();
      expect(document.querySelector('[data-test="search-download-json-btn"]')).toBeNull();
      expect(download.hasAttribute("aria-haspopup")).toBe(false);
      expect(download.hasAttribute("disabled")).toBe(false);
    });

    it("renders the enabled Download trigger as a native button, keeps it open with a note after an edit, and closes it once disabled", async () => {
      const { searchObj } = await setup({ liveMode: false });
      markExecuted();
      await wrapper!.get('[data-test="logs-search-bar-more-options-btn"]').trigger("click");
      await flushPromises();
      const download = document.querySelector<HTMLElement>(
        '[data-test="search-download-submenu-trigger"]',
      )!;
      expect(download.tagName).toBe("BUTTON");
      expect(download.getAttribute("role")).toBe("menuitem");
      download.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() =>
        expect(document.querySelector('[data-test="search-download-csv-btn"]')).not.toBeNull(),
      );
      searchObj.meta.editorDirty = true;
      searchObj.data.query = "level = 'error'";
      await flushPromises();
      expect(wrapper!.vm.isDownloadDisabled).toBe(false);
      expect(wrapper!.vm.downloadNote).toBe(SHOWN_RESULTS_NOTE);
      expect(document.querySelector('[data-test="search-download-csv-btn"]')).not.toBeNull();
      searchObj.meta.executed = null;
      await flushPromises();
      expect(wrapper!.vm.showDownloadSubmenu).toBe(false);
      expect(document.querySelector('[data-test="search-download-csv-btn"]')).toBeNull();
      expect(document.querySelector('[data-test="search-download-json-btn"]')).toBeNull();
    });

    it("ArrowDown from enabled Download reaches every later parent action and submenu keys return focus", async () => {
      config.isEnterprise = "true";
      config.isCloud = "false";
      await setup({ liveMode: false });
      store.state.zoConfig.search_inspector_enabled = true;
      markExecuted();
      await wrapper!.get('[data-test="logs-search-bar-more-options-btn"]').trigger("click");
      await flushPromises();
      const item = (id: string) => document.querySelector<HTMLElement>(`[data-test="${id}"]`)!;
      const key = (key: string) =>
        document.activeElement!.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
        );
      const download = item("search-download-submenu-trigger");
      download.focus();
      for (const id of [
        "logs-search-bar-download-custom-range-btn",
        "search-scheduler-create-new-btn",
        "search-scheduler-list-btn",
        "logs-create-alert-btn",
        "search-inspect-btn",
      ]) {
        key("ArrowDown");
        await vi.waitFor(() => expect(document.activeElement).toBe(item(id)));
        expect(document.querySelector('[data-test="search-download-csv-btn"]')).toBeNull();
        expect(document.querySelector('[data-test="search-download-json-btn"]')).toBeNull();
      }
      for (const [open, close] of [
        ["ArrowRight", "ArrowLeft"],
        ["Enter", "Escape"],
      ]) {
        download.focus();
        key(open);
        await vi.waitFor(() =>
          expect(document.activeElement).toBe(item("search-download-csv-btn")),
        );
        key("ArrowDown");
        await vi.waitFor(() =>
          expect(document.activeElement).toBe(item("search-download-json-btn")),
        );
        key(close);
        await vi.waitFor(() => expect(document.activeElement).toBe(download));
        await vi.waitFor(() =>
          expect(document.querySelector('[data-test="search-download-csv-btn"]')).toBeNull(),
        );
        expect(wrapper!.vm.showDownloadSubmenu).toBe(false);
        key("ArrowDown");
        await vi.waitFor(() =>
          expect(document.activeElement).toBe(item("logs-search-bar-download-custom-range-btn")),
        );
      }
    });

    it("keeps every editor-query and download entry enabled after an edit, each describing what it uses", async () => {
      (config as any).isEnterprise = "true";
      const { searchObj } = await setup({ liveMode: false });
      markExecuted();
      searchObj.data.query = "level = 'error'";
      searchObj.data.editorValue = searchObj.data.query;
      searchObj.meta.editorDirty = true;
      await flushPromises();
      if (!wrapper!.vm.isPinned("savedViews")) wrapper!.vm.togglePin("savedViews");
      await flushPromises();
      for (const [trigger, ids] of [
        ["logs-search-bar-utilities-menu-btn", ["logs-search-bar-menu-create-saved-view-btn"]],
        [
          "logs-search-bar-saved-views-pinned-list-btn",
          ["logs-search-bar-saved-views-menu-create"],
        ],
        [
          "logs-search-bar-more-options-btn",
          [
            "logs-create-alert-btn",
            "search-scheduler-create-new-btn",
            "search-download-submenu-trigger",
            "logs-search-bar-download-custom-range-btn",
          ],
        ],
      ] as [string, string[]][]) {
        await wrapper!.get(`[data-test="${trigger}"]`).trigger("click");
        await flushPromises();
        for (const testId of ids) {
          const element = document.querySelector<HTMLElement>(`[data-test="${testId}"]`)!;
          expect(element).not.toBeNull();
          expect(element.getAttribute("aria-disabled")).not.toBe("true");
          expect(element.hasAttribute("data-disabled")).toBe(false);
          const id = element.getAttribute("aria-describedby")!;
          expect(id).toBeTruthy();
          expect(document.getElementById(id)?.textContent).toContain(EXPECTED_NOTES[testId]);
        }
        document
          .querySelector<HTMLElement>('[role="menu"]')
          ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await flushPromises();
      }
      expect(scheduleSearch).not.toHaveBeenCalled();
      markExecuted();
      searchObj.meta.editorDirty = false;
      await flushPromises();
      expect(wrapper!.vm.saveViewReason).toBeNull();
      expect(wrapper!.vm.scheduleJobReason).toBeNull();
      expect(wrapper!.vm.createAlertDisabledReason).toBeNull();
      expect(wrapper!.vm.saveViewNote).toBeNull();
      expect(wrapper!.vm.downloadNote).toBeNull();
      expect(wrapper!.vm.customRangeNote).toBeNull();
    });

    it("enables them once the current query has run; when it goes stale only sharing needs a run", async () => {
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
      expect(vm.isDownloadDisabled).toBe(false);
      expect(vm.downloadNote).toBe(SHOWN_RESULTS_NOTE);
      expect(vm.saveViewReason).toBeNull();
      expect(vm.saveViewNote).toBe(EDITED_NOTE);
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
      expect(dispatch).toHaveBeenCalledWith("setSavedViewDialog", true);
      dispatch.mockClear();
      markExecuted();
      wrapper!.vm.autoRun.invalidateExecuted("search-around");
      await flushPromises();
      wrapper!.vm.fnSavedView();
      expect(dispatch).not.toHaveBeenCalledWith("setSavedViewDialog", true);
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "warning",
          message: i18n.global.t("search.autoRunSearchAroundActive"),
        }),
      );
    });

    it("opens the menu's Schedule search job while unrun, and the guard's job path stays open (G1-X1)", async () => {
      (config as any).isEnterprise = "true";
      await setup();
      const vm = wrapper!.vm;
      vm.createScheduleJob();
      expect(vm.searchSchedulerJob).toBe(true);
      vm.searchSchedulerJob = false;
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

  it("wires editor edits to display-only free-text previews without dispatching (AC-BW.8)", async () => {
    const { searchObj, logs } = await setup({ liveMode: false });
    vi.useFakeTimers();
    try {
      store.state.zoConfig.default_fts_keys = ["body"];
      searchObj.data.query = "timeout";
      searchObj.data.streamResults = {
        list: [
          {
            name: "app_logs",
            schema: [
              { name: "body", type: "Utf8" },
              { name: "level", type: "Utf8" },
            ],
            settings: {},
          },
        ],
      };
      await nextTick();
      vi.advanceTimersByTime(150);
      expect(searchObj.data.freeTextDecorations?.hover).toContain("match_all('timeout')");
      let editorText = "timeout AND level='x'";
      const setValue = vi.fn();
      wrapper!.vm.queryEditorRef = { getValue: () => editorText, setValue };
      wrapper!.vm.onEditorUserEdit();
      expect(searchObj.data.freeTextDecorations).toBeNull();
      editorText = "-debug";
      wrapper!.vm.onEditorUserEdit();
      vi.advanceTimersByTime(150);
      expect(searchObj.data.freeTextDecorations?.hover).toContain("NOT match_all('debug')");
      expect(searchObj.data.query).toBe("timeout");
      expect(editorText).toBe("-debug");
      expect(setValue).not.toHaveBeenCalled();
      expect(logs).not.toHaveBeenCalled();
    } finally {
      wrapper?.unmount();
      wrapper = undefined;
      vi.useRealTimers();
    }
  });

  describe("J4 trigger sites dispatch through requestRun", () => {
    it("coalesces three facet includes inside 300 ms into one filter run (AC4.2)", async () => {
      const { searchObj, logs } = await setup();
      vi.useFakeTimers();
      for (const term of ["a='1'", "b='2'", "c='3'"]) {
        searchObj.data.stream.addToFilter = term;
        await flushPromises();
      }
      expect(logs).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(350);
      expect(logs).toHaveBeenCalledTimes(1);
      expect(logs.mock.calls[0][0]).toMatchObject({ reason: "filter", kind: "refinement" });
      expect(searchObj.data.query).toContain("c='3'");
    });

    it("merges typed-but-uncommitted text into a facet rewrite and never auto-runs it (AC4.4)", async () => {
      const { searchObj, logs } = await setup();
      vi.useFakeTimers();
      wrapper!.vm.queryEditorRef = { getValue: () => "status=500", setValue: vi.fn() };
      wrapper!.vm.onEditorUserEdit();
      searchObj.data.stream.addToFilter = "level='error'";
      await flushPromises();
      await vi.advanceTimersByTimeAsync(350);
      expect(searchObj.data.query).toContain("status=500");
      expect(searchObj.data.query).toContain("level='error'");
      expect(logs).not.toHaveBeenCalled();
      expect(wrapper!.vm.showRunPendingDot).toBe(true);
    });

    it("runs a relative time change with Auto Run on, and not with it off (D1)", async () => {
      const { logs } = await setup({ liveMode: false });
      vi.useFakeTimers();
      await wrapper!.vm.updateDateTime({
        valueType: "relative",
        relativeTimePeriod: "1h",
        startTime: 1,
        endTime: 2,
        userChangedValue: true,
      });
      await vi.advanceTimersByTimeAsync(10);
      expect(logs).not.toHaveBeenCalled();

      wrapper!.vm.searchObj.meta.liveMode = true;
      await wrapper!.vm.updateDateTime({
        valueType: "relative",
        relativeTimePeriod: "6h",
        startTime: 1,
        endTime: 2,
        userChangedValue: true,
      });
      await vi.advanceTimersByTimeAsync(10);
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
      vi.useFakeTimers();
      const functionRuns = () =>
        logs.mock.calls.filter((call: any[]) => call[0].reasons.includes("function")).length;
      store.state.savedViewFlag = true;
      wrapper!.vm.populateFunctionImplementation({ name: "f", function: ".a = 1" }, false);
      await flushPromises();
      await vi.advanceTimersByTimeAsync(350);
      expect(functionRuns()).toBe(0);
      store.state.savedViewFlag = false;
      wrapper!.vm.populateFunctionImplementation({ name: "f", function: ".a = 2" }, false);
      await flushPromises();
      await vi.advanceTimersByTimeAsync(2500);
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
      expect(wrapper!.vm.customRangeReason).toBe("Run your query first");
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
