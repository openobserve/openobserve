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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import SearchResult from "@/plugins/logs/SearchResult.vue";
import LogsPermalinkBanner from "@/plugins/logs/LogsPermalinkBanner.vue";
import LogsPermalinkDrawer from "@/plugins/logs/LogsPermalinkDrawer.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import searchService from "@/services/search";
import { resetLogsAutoRunForTests } from "@/composables/useLogs/logsAutoRun";
import { useSearchBar } from "@/composables/useLogs/useSearchBar";
import { searchState } from "@/composables/useLogs/searchState";
import { resetManager } from "@/lib/vue-shortcut-manager";
import {
  activePermalink,
  columnsFromUrl,
  resetPermalinkForTests,
} from "@/composables/useLogs/useLogPermalink";
import {
  beginPermalinkFromUrl,
  resolveActivePermalink,
} from "@/composables/useLogs/permalinkResolve";
import { bindLogsUrlRouter, resetLogsUrlForTests } from "@/composables/useLogs/useLogsUrl";
import { fingerprintRecord } from "@/utils/logs/logPermalink";

const transport = vi.hoisted(() => ({ sent: [] as { payload: any; handlers: any }[] }));
const nav = vi.hoisted(() => ({ router: null as any }));

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => nav.router,
}));

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (payload: any, handlers: any) => {
      transport.sent.push({ payload, handlers });
      return Promise.resolve();
    },
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));

const TS = 1_700_000_000_000_050;
const line = { _timestamp: TS, level: "error", message: "payment declined id=7f3" };
const twin = { _timestamp: TS, level: "error", message: "card expired" };
const filler = (i: number) => ({ _timestamp: TS + 1000 - i, level: "info", message: `row-${i}` });

const linkQuery = (extra: Record<string, unknown> = {}) => ({
  stream: "app",
  from: String(TS - 1_000_000),
  to: String(TS + 1_000_000),
  org_identifier: "default",
  log_stream: "app",
  log_ts: String(TS),
  ...extra,
});

const makeRouter = (query: Record<string, unknown>) => {
  const currentRoute = ref<any>({ name: "logs", path: "/logs", query });
  return {
    currentRoute,
    push: vi.fn(async (to: any) => {
      currentRoute.value = { name: "logs", path: "/logs", query: to.query };
    }),
    replace: vi.fn(async (to: any) => {
      currentRoute.value = { name: "logs", path: "/logs", query: to.query };
    }),
  };
};

const hostApi: { getQueryData: (isPagination?: boolean, options?: any) => Promise<unknown> } = {
  getQueryData: async () => undefined,
};

const Host = defineComponent({
  setup() {
    const { getQueryData } = useSearchBar(i18n.global.t as any);
    hostApi.getQueryData = getQueryData;
    return () => [
      h(LogsPermalinkBanner),
      searchState().searchObj.data.errorMsg
        ? h("div", { "data-test": "logs-error-state-stub" })
        : h(SearchResult, { expandedLogs: [], "onUpdate:scroll": () => getQueryData(true) }),
      h(LogsPermalinkDrawer),
    ];
  },
});

const q = (selector: string) => document.querySelector<HTMLElement>(selector);
const row = (n: number) =>
  q(`[data-test="logs-search-result-logs-table"] [data-test="o2-table-row-${n}"]`);
const gridDrawer = () => q('[data-test="logs-search-result-detail-dialog"]');
const pageDrawer = () => q('[data-test="logs-permalink-detail-dialog"]');
const drawerText = () => q('[data-test="log-detail-json-content"]')?.textContent ?? "";
const banner = () => q('[data-test="logs-permalink-banner"]');
const lastSent = () => transport.sent[transport.sent.length - 1];

const deliverPage = async (hits: any[]) => {
  const { payload, handlers } = lastSent();
  handlers.data(payload, {
    type: "search_response_metadata",
    content: { results: { total: hits.length, hits: [] } },
  });
  handlers.data(payload, { type: "search_response_hits", content: { results: { hits } } });
  handlers.complete(payload, {});
  await flushPromises();
};

const resolveWith = (hits: unknown[]) =>
  vi
    .spyOn(searchService, "search")
    .mockImplementation(
      async () => ({ status: 200, data: { hits, is_partial: false, function_error: [] } }) as any,
    );

describe("line link open (mounted, 4c C5)", { timeout: 30000 }, () => {
  let wrapper: any;
  const { searchObj } = searchState();

  const openLink = async (query: Record<string, unknown>) => {
    nav.router = makeRouter(query);
    bindLogsUrlRouter(nav.router);
    const token = beginPermalinkFromUrl(query, "default") ?? undefined;
    wrapper = mount(Host, {
      attachTo: document.body,
      global: { provide: { store }, plugins: [i18n] },
    });
    await flushPromises();
    return token;
  };

  beforeEach(() => {
    resetLogsAutoRunForTests(store as any);
    resetManager();
    resetPermalinkForTests();
    resetLogsUrlForTests();
    transport.sent.length = 0;
    HTMLElement.prototype.scrollTo = vi.fn();
    HTMLElement.prototype.scrollIntoView = vi.fn();
    searchObj.communicationMethod = "streaming";
    searchObj.loading = false;
    searchObj.meta.logsVisualizeToggle = "logs";
    searchObj.meta.refreshInterval = 0;
    searchObj.meta.jobId = "";
    searchObj.meta.sqlMode = false;
    searchObj.meta.showDetailTab = false;
    searchObj.meta.resultGrid.showPagination = true;
    searchObj.meta.resultGrid.rowsPerPage = 50;
    searchObj.meta.resultGrid.navigation = {
      currentRowIndex: null,
      selectionActive: false,
      pendingPageSelection: null,
    };
    searchObj.meta.executed = null;
    searchObj.meta.editorDirty = false;
    searchObj.data.stream.streamLists = [{ label: "app", value: "app" }];
    searchObj.data.stream.selectedStream = ["app"];
    searchObj.data.stream.streamType = "logs";
    searchObj.data.stream.selectedStreamFields = [
      { name: "_timestamp", streams: ["app"] },
      { name: "message", streams: ["app"] },
    ];
    searchObj.data.query = "";
    searchObj.data.datetime = {
      type: "absolute",
      startTime: TS - 1_000_000,
      endTime: TS + 1_000_000,
    };
    searchObj.data.resultGrid.columns = [{ id: "message", header: "message" }];
    searchObj.data.resultGrid.currentPage = 1;
    searchObj.data.resultGrid.hitsSettled = true;
    searchObj.data.resultGrid.pageRequest = null;
    searchObj.data.resultGrid.pageLoad = null;
    searchObj.data.searchAround.indexTimestamp = -1;
    searchObj.data.errorMsg = "";
    searchObj.data.queryResults = { hits: [], total: 0, pagination: [{}] };
  });

  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("opens the exact line in the drawer on the resolve, keeps it through the init search, then highlights its row (J-C2, J-C5, J-C10)", async () => {
    resolveWith([twin, line]);
    const token = await openLink(linkQuery({ log_fp: fingerprintRecord(line) }));
    await hostApi.getQueryData(false, { origin: token });
    await resolveActivePermalink();
    await vi.waitFor(() => expect(drawerText()).toContain("payment declined id=7f3"));
    expect(drawerText()).not.toContain("card expired");
    expect(banner()?.getAttribute("data-state")).toBe("found");
    expect(q('[data-test="log-detail-next-detail-btn"]')?.hasAttribute("disabled")).toBe(true);

    await deliverPage([filler(0), twin, line, filler(1)]);
    await vi.waitFor(() => expect(row(2)?.classList.contains("o2-log-permalink-row")).toBe(true));
    expect(row(2)?.getAttribute("aria-current")).toBe("true");
    expect(document.querySelectorAll(".o2-log-permalink-row")).toHaveLength(1);
    expect(gridDrawer()).not.toBeNull();
    expect(q('[data-test="log-detail-next-detail-btn"]')?.hasAttribute("disabled")).toBe(false);
  });

  it("the init search sent after the drawer opened keeps it open; a later user search closes it (C5 step 5)", async () => {
    resolveWith([line]);
    const token = await openLink(linkQuery());
    await resolveActivePermalink();
    await vi.waitFor(() => expect(gridDrawer()).not.toBeNull());
    await hostApi.getQueryData(false, { origin: token });
    await flushPromises();
    expect(searchObj.meta.showDetailTab).toBe(true);
    expect(activePermalink.value).not.toBeNull();
    await deliverPage([line]);
    await vi.waitFor(() => expect(row(0)?.classList.contains("o2-log-permalink-row")).toBe(true));
  });

  it("a link's columns stay as given after the run: the FTS default does not replace them (C7)", async () => {
    store.state.zoConfig = { ...store.state.zoConfig, default_fts_keys: ["message"] };
    await openLink({ stream: "app" });
    searchObj.meta.searchApplied = true;
    searchObj.data.stream.selectedFields = [];
    columnsFromUrl.value = true;
    searchObj.loading = true;
    await flushPromises();
    searchObj.data.queryResults = { hits: [filler(0)], total: 1, pagination: [{}] };
    searchObj.loading = false;
    await flushPromises();
    expect(searchObj.data.stream.selectedFields).toEqual([]);
    columnsFromUrl.value = false;
    searchObj.loading = true;
    await flushPromises();
    searchObj.loading = false;
    await flushPromises();
    expect(searchObj.data.stream.selectedFields).toEqual(["message"]);
  });

  it("maps at once when the search finished before the resolve (J-C10, other order)", async () => {
    resolveWith([line]);
    const token = await openLink(linkQuery({ log_fp: fingerprintRecord(line) }));
    await hostApi.getQueryData(false, { origin: token });
    searchObj.meta.executed = { complete: true } as any;
    await deliverPage([filler(0), line]);
    await resolveActivePermalink();
    await vi.waitFor(() => expect(row(1)?.classList.contains("o2-log-permalink-row")).toBe(true));
    expect(drawerText()).toContain("payment declined id=7f3");
  });

  it("a line not on the loaded page stays detached with Prev/Next disabled: not in the current page", async () => {
    resolveWith([line]);
    const token = await openLink(linkQuery());
    await hostApi.getQueryData(false, { origin: token });
    await deliverPage([filler(0), filler(1)]);
    await resolveActivePermalink();
    await vi.waitFor(() => expect(drawerText()).toContain("payment declined id=7f3"));
    const wrapperResult = wrapper.findComponent(SearchResult).vm;
    expect(wrapperResult.navDisabledReason).toBe("notInPage");
    expect(q('[data-test="log-detail-previous-detail-btn"]')?.hasAttribute("disabled")).toBe(true);
    expect(document.querySelectorAll(".o2-log-permalink-row")).toHaveLength(0);
  });

  it("closing the drawer drops log_* at once with a replace, never a push (AC-C2.4)", async () => {
    resolveWith([line]);
    await openLink(linkQuery());
    await resolveActivePermalink();
    await vi.waitFor(() => expect(gridDrawer()).not.toBeNull());
    q(
      '[data-test="log-detail-dialog-close-btn"], [data-test="o-drawer-close-btn"], button[aria-label="Close drawer"]',
    )?.click();
    await flushPromises();
    await vi.waitFor(() => expect(activePermalink.value).toBeNull());
    expect(nav.router.replace).toHaveBeenCalled();
    expect(nav.router.currentRoute.value.query.log_ts).toBeUndefined();
    expect(nav.router.currentRoute.value.query.stream).toBe("app");
    expect(nav.router.push).not.toHaveBeenCalled();
    expect(banner()?.getAttribute("data-state")).toBe("found");
  });

  it("a user Run closes the shared line and ends the permalink (J-C10 tail)", async () => {
    resolveWith([line]);
    const token = await openLink(linkQuery());
    await hostApi.getQueryData(false, { origin: token });
    await resolveActivePermalink();
    await vi.waitFor(() => expect(gridDrawer()).not.toBeNull());
    await hostApi.getQueryData(false);
    await flushPromises();
    expect(searchObj.meta.showDetailTab).toBe(false);
    expect(activePermalink.value).toBeNull();
    expect(nav.router.currentRoute.value.query.log_ts).toBeUndefined();
  });

  it("the drawer survives an errored init search: the page-level drawer shows the line (AC-C2.5)", async () => {
    resolveWith([line]);
    const token = await openLink(linkQuery());
    await hostApi.getQueryData(false, { origin: token });
    searchObj.data.errorMsg = "boom";
    await flushPromises();
    expect(q('[data-test="logs-error-state-stub"]')).not.toBeNull();
    await resolveActivePermalink();
    await vi.waitFor(() => expect(pageDrawer()).not.toBeNull());
    expect(drawerText()).toContain("payment declined id=7f3");
    expect(q('[data-test="log-detail-next-detail-btn"]')?.hasAttribute("disabled")).toBe(true);
    expect(q('[data-test="log-detail-copy-line-link-btn"]')?.getAttribute("aria-disabled")).toBe(
      "true",
    );
  });

  it("a row click while the resolve is pending keeps the user's row (J-C19)", async () => {
    let answer: (value: unknown) => void = () => undefined;
    vi.spyOn(searchService, "search").mockReturnValue(new Promise((r) => (answer = r)) as any);
    const token = await openLink(linkQuery());
    await hostApi.getQueryData(false, { origin: token });
    await deliverPage([filler(0), filler(1), filler(2)]);
    const pending = resolveActivePermalink();
    row(2)?.click();
    await vi.waitFor(() => expect(drawerText()).toContain("row-2"));
    answer({ status: 200, data: { hits: [line], is_partial: false } });
    await pending;
    await flushPromises();
    expect(drawerText()).toContain("row-2");
    expect(drawerText()).not.toContain("payment declined");
    expect(activePermalink.value).toBeNull();
  });

  it("the row context menu offers Copy link to this log line right after Copy, disabled until the query has run (C6, G1)", async () => {
    await openLink({ stream: "app" });
    await hostApi.getQueryData(false);
    await deliverPage([filler(0), line]);
    const cell = row(1)?.querySelector("td[data-test^='o2-table-cell-']");
    cell?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 40 }));
    await flushPromises();
    await vi.waitFor(() =>
      expect(q('[data-test="log-context-menu-copy-line-link"]')).not.toBeNull(),
    );
    const items = Array.from(document.querySelectorAll('[role="menuitem"]')).map((el) =>
      el.getAttribute("data-test"),
    );
    expect(items.indexOf("log-context-menu-copy-line-link")).toBe(
      items.indexOf("log-context-menu-copy-value") + 1,
    );
    expect(q('[data-test="log-context-menu-copy-line-link"]')?.getAttribute("aria-disabled")).toBe(
      "true",
    );
  });

  it("an ambiguous timestamp link highlights every loaded row at that µs, without a drawer or open row (J-C9, S-C3)", async () => {
    resolveWith([line, twin]);
    const token = await openLink(linkQuery());
    await hostApi.getQueryData(false, { origin: token });
    await deliverPage([filler(0), line, twin, filler(1)]);
    await resolveActivePermalink();
    await vi.waitFor(() => expect(banner()?.getAttribute("data-state")).toBe("ambiguous"));
    expect(banner()?.textContent).toContain("2 lines at this timestamp");
    const matches = Array.from(document.querySelectorAll(".o2-log-permalink-match")).map((el) =>
      el.getAttribute("data-test"),
    );
    expect(matches).toEqual(["o2-table-row-1", "o2-table-row-2"]);
    expect(gridDrawer()).toBeNull();
    expect(document.querySelector('[aria-current="true"]')).toBeNull();
    expect(q('[data-test="logs-permalink-banner-show-lines"]')).not.toBeNull();
  });
});
