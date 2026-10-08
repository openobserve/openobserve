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

// Mounted J/K journeys (4a §9): the real SearchResult, ODrawer (reka-ui), DetailTable and OTable,
// the real shortcut manager, and the real pagination dispatch down to the streaming transport.

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import SearchResult from "@/plugins/logs/SearchResult.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { readLogsSignature, resetLogsAutoRunForTests } from "@/composables/useLogs/logsAutoRun";
import { useSearchBar } from "@/composables/useLogs/useSearchBar";
import { searchState } from "@/composables/useLogs/searchState";
import { logsRowNavAnnouncement } from "@/composables/useLogs/logsRowNav";
import { useShortcuts, resetManager } from "@/lib/vue-shortcut-manager";
import StreamService from "@/services/stream";
import streamsModule from "@/stores/streams";

const transport = vi.hoisted(() => ({
  sent: [] as { payload: any; handlers: any }[],
}));

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => ({
    push: vi.fn(),
    currentRoute: { value: { name: "logs", query: {}, path: "/logs" } },
  }),
}));

// The streaming transport is the only stub: everything above it is the production path.
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (payload: any, handlers: any) => {
      transport.sent.push({ payload, handlers });
      return Promise.resolve();
    },
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));

const rows = (page: number) =>
  [0, 1, 2].map((i) => ({
    _timestamp: 1_700_000_000_000_000 - (page * 10 + i),
    message: `p${page}-row${i}`,
    _stream_name: "app",
  }));

const hostApi: { getQueryData: (isPagination?: boolean) => Promise<unknown> } = {
  getQueryData: async () => undefined,
};

// Mirrors Index.vue (which also renders logs-row-nav-live): the paginator's update:scroll runs the real pagination query, and J/K step rows.
const Host = defineComponent({
  setup() {
    const { getQueryData } = useSearchBar(i18n.global.t as any);
    const result = ref<any>(null);
    hostApi.getQueryData = getQueryData;
    useShortcuts([
      { id: "logsNextRow", handler: (e) => result.value?.stepLogRow(1, !!e?.repeat) },
      { id: "logsPrevRow", handler: (e) => result.value?.stepLogRow(-1, !!e?.repeat) },
    ]);
    // Like Index.vue, a search error replaces the results with the error state.
    return () => [
      searchState().searchObj.data.errorMsg
        ? h("div", { "data-test": "logs-error-state-stub" })
        : h(SearchResult, {
            ref: result,
            expandedLogs: [],
            "onUpdate:scroll": () => getQueryData(true),
          }),
      h(
        "div",
        {
          class: "sr-only",
          "aria-live": "polite",
          "aria-atomic": "true",
          "data-test": "logs-row-nav-live",
        },
        logsRowNavAnnouncement.value,
      ),
    ];
  },
});

const press = async (key: string, init: KeyboardEventInit = {}) => {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  await flushPromises();
};

const resultsRow = (n: number) =>
  document.querySelector<HTMLElement>(
    `[data-test="logs-search-result-logs-table"] [data-test="o2-table-row-${n}"]`,
  );

const drawer = () =>
  document.querySelector<HTMLElement>('[data-test="logs-search-result-detail-dialog"]');

const drawerText = () =>
  document.querySelector('[data-test="log-detail-json-content"]')?.textContent ?? "";

const activeRows = () =>
  Array.from(
    document.querySelectorAll('[data-test="logs-search-result-logs-table"] [data-active-row]'),
  ).map((el) => el.getAttribute("data-test"));

const lastSent = () => transport.sent[transport.sent.length - 1];

// Streams one page through the real response handlers: metadata, hits, then completion.
const deliverPage = async (hits: any[]) => {
  const { payload, handlers } = lastSent();
  handlers.data(payload, {
    type: "search_response_metadata",
    content: { results: { total: 9, hits: [] } },
  });
  handlers.data(payload, { type: "search_response_hits", content: { results: { hits } } });
  handlers.complete(payload, {});
  await flushPromises();
};

describe("SearchResult J/K navigation (mounted, 4a)", { timeout: 30000 }, () => {
  let wrapper: any;
  const { searchObj } = searchState();

  beforeEach(async () => {
    resetLogsAutoRunForTests(store as any);
    resetManager();
    logsRowNavAnnouncement.value = "";
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
    searchObj.meta.resultGrid.rowsPerPage = 3;
    searchObj.meta.resultGrid.navigation = {
      currentRowIndex: 0,
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
      startTime: 1_699_999_000_000_000,
      endTime: 1_700_000_100_000_000,
    };
    searchObj.data.resultGrid.columns = [{ id: "message", header: "message" }];
    searchObj.data.resultGrid.currentPage = 1;
    searchObj.data.resultGrid.hitsSettled = true;
    searchObj.data.resultGrid.pageRequest = null;
    searchObj.data.resultGrid.pageLoad = null;
    searchObj.data.searchAround.indexTimestamp = -1;
    searchObj.data.errorMsg = "";
    searchObj.data.queryResults = {
      hits: rows(1),
      total: 9,
      pagination: [{}, {}, {}],
    };
    wrapper = mount(Host, {
      attachTo: document.body,
      global: { provide: { store }, plugins: [i18n] },
    });
    await vi.waitFor(() => expect(resultsRow(2)).not.toBeNull());
    (document.activeElement as HTMLElement | null)?.blur?.();
  });

  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("J opens row 0 with focus on the drawer panel, then J J K keeps one live region node (AC1.1, AC1.2, AC1.4)", async () => {
    await press("j");
    await vi.waitFor(() => expect(drawerText()).toContain("p1-row0"));
    expect(activeRows()).toEqual(["o2-table-row-0"]);
    expect(resultsRow(0)?.getAttribute("aria-current")).toBe("true");
    await vi.waitFor(() =>
      expect(document.activeElement?.hasAttribute("data-o2-drawer")).toBe(true),
    );
    const region = document.querySelector('[data-test="logs-detail-nav-live"]');

    await press("j");
    await press("j");
    await press("k");
    await vi.waitFor(() => expect(drawerText()).toContain("p1-row1"));
    expect(activeRows()).toEqual(["o2-table-row-1"]);
    await vi.waitFor(() => expect(region?.textContent?.trim()).toBe("Log 2 of 3, page 1"));
    expect(document.querySelector('[data-test="logs-detail-nav-live"]')).toBe(region);
    expect(drawer()?.textContent).toContain("Log 2 of 3 · Page 1");
  });

  it("a reopened drawer, whose DetailTable mounts at once, still focuses the panel, not a combobox (AC1.2)", async () => {
    await press("j");
    await vi.waitFor(() => expect(drawerText()).toContain("p1-row0"));
    await press("Escape");
    await vi.waitFor(() => expect(drawer()).toBeNull());
    await press("j");
    await vi.waitFor(() => expect(drawerText()).toContain("p1-row1"));
    await vi.waitFor(() =>
      expect(document.activeElement?.hasAttribute("data-o2-drawer")).toBe(true),
    );
    expect(document.activeElement?.getAttribute("role")).not.toBe("combobox");
  });

  it("Esc returns focus to the open row and keeps its highlight (AC1.3)", async () => {
    await press("j");
    await press("j");
    await vi.waitFor(() => expect(drawerText()).toContain("p1-row1"));
    await press("Escape");
    await vi.waitFor(() => expect(drawer()).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(resultsRow(1)));
    expect(activeRows()).toEqual(["o2-table-row-1"]);
  });

  it("after clicking Next the panel is refocused, so J still steps", async () => {
    await press("j");
    await vi.waitFor(() => expect(drawerText()).toContain("p1-row0"));
    const next = document.querySelector<HTMLElement>('[data-test="log-detail-next-detail-btn"]')!;
    next.focus();
    next.click();
    await flushPromises();
    await vi.waitFor(() => expect(drawerText()).toContain("p1-row1"));
    await press("j");
    await vi.waitFor(() => expect(drawerText()).toContain("p1-row2"));
  });

  it("keeps the Table tab across steps (AC1.6)", async () => {
    await press("j");
    await vi.waitFor(() => expect(drawerText()).toContain("p1-row0"));
    // reka's TabsTrigger activates on mousedown, not click.
    document
      .querySelector<HTMLElement>('[data-test="log-detail-table-tab"]')
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await flushPromises();
    expect(
      document.querySelector('[data-test="log-detail-table-tab"]')?.getAttribute("data-state"),
    ).toBe("active");
    await vi.waitFor(() =>
      expect(document.querySelector('[data-test="log-detail-table-content"]')).not.toBeNull(),
    );
    await press("j");
    await vi.waitFor(() =>
      expect(wrapper.findComponent(SearchResult).vm.detailRow.message).toBe("p1-row1"),
    );
    expect(
      document.querySelector('[data-test="log-detail-table-tab"]')?.getAttribute("data-state"),
    ).toBe("active");
  });

  it("crosses to page 2 through its own request, then Esc focuses page 2 row 0 (J2, AC2.1, AC2.2)", async () => {
    await press("j");
    await press("j");
    await press("j");
    await vi.waitFor(() => expect(drawerText()).toContain("p1-row2"));
    const sentBefore = transport.sent.length;

    await press("j");
    expect(transport.sent.length).toBe(sentBefore + 1);
    const { payload } = lastSent();
    expect(payload.isPagination).toBe(true);
    expect(searchObj.meta.resultGrid.navigation.pendingPageSelection).toEqual({
      page: 2,
      position: "first",
      requestId: payload.traceId,
    });
    expect(searchObj.data.resultGrid.currentPage).toBe(2);
    expect(drawer()).not.toBeNull();
    expect(document.querySelector('[data-test="log-detail-page-loading"]')).not.toBeNull();
    expect(drawer()?.textContent).toContain("Loading page 2…");
    const next = document.querySelector('[data-test="log-detail-next-detail-btn"]')!;
    expect(next.hasAttribute("disabled")).toBe(true);

    await deliverPage(rows(2));
    await vi.waitFor(() => expect(drawerText()).toContain("p2-row0"));
    expect(activeRows()).toEqual(["o2-table-row-0"]);
    expect(searchObj.meta.resultGrid.navigation.pendingPageSelection).toBeNull();

    await press("Escape");
    await vi.waitFor(() => expect(drawer()).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(resultsRow(0)));
  });

  it("K on row 0 of page 2 crosses back to the last row of page 1 (AC2.3)", async () => {
    searchObj.data.resultGrid.currentPage = 2;
    searchObj.data.queryResults = { hits: rows(2), total: 9, pagination: [{}, {}, {}] };
    await flushPromises();
    await press("j");
    await vi.waitFor(() => expect(drawerText()).toContain("p2-row0"));

    await press("k");
    expect(lastSent().payload.isPagination).toBe(true);
    await deliverPage(rows(1));
    await vi.waitFor(() => expect(drawerText()).toContain("p1-row2"));
    expect(activeRows()).toEqual(["o2-table-row-2"]);
  });

  it("a held J walks to the last row but never crosses (AC2.5)", async () => {
    await press("j");
    await press("j", { repeat: true });
    await press("j", { repeat: true });
    const sentBefore = transport.sent.length;
    await press("j", { repeat: true });
    await press("j", { repeat: true });
    expect(transport.sent.length).toBe(sentBefore);
    await vi.waitFor(() => expect(drawerText()).toContain("p1-row2"));
  });

  it("a failed page closes the drawer, announces outside it and clears the selection (AC2.6)", async () => {
    await press("j");
    await press("j");
    await press("j");
    await press("j");
    const { payload, handlers } = lastSent();
    // The server answers the page with an error status, as the Playwright route does.
    handlers.error(payload, { content: { message: "boom", code: 500 } });
    await flushPromises();

    await vi.waitFor(() => expect(drawer()).toBeNull());
    await vi.waitFor(() =>
      expect(document.querySelector('[data-test="logs-row-nav-live"]')?.textContent?.trim()).toBe(
        "Couldn't load page 2",
      ),
    );
    // The failure also swaps the results for the error state, as in Index.vue; the region outside still speaks.
    expect(document.querySelector('[data-test="logs-error-state-stub"]')).not.toBeNull();
    expect(searchObj.meta.resultGrid.navigation).toMatchObject({
      selectionActive: false,
      currentRowIndex: null,
      pendingPageSelection: null,
    });
    expect(searchObj.data.resultGrid.currentPage).toBe(2);
  });

  it("an empty next page closes the drawer and says so (AC2.7)", async () => {
    await press("j");
    await press("j");
    await press("j");
    await press("j");
    await deliverPage([]);
    await vi.waitFor(() => expect(drawer()).toBeNull());
    await vi.waitFor(() =>
      expect(document.querySelector('[data-test="logs-row-nav-live"]')?.textContent?.trim()).toBe(
        "Page 2 has no results",
      ),
    );
  });

  it("Esc during the load cancels the crossing; the page lands with nothing reopened (AC2.8, AC2.15)", async () => {
    await press("j");
    await press("j");
    await press("j");
    await press("j");
    await press("Escape");
    await vi.waitFor(() => expect(drawer()).toBeNull());
    expect(searchObj.meta.resultGrid.navigation.pendingPageSelection).toBeNull();
    // No row is open any more, so focus falls back to the results scroller (AC2.15).
    await vi.waitFor(() => expect(document.activeElement?.getAttribute("tabindex")).toBe("-1"));
    await deliverPage(rows(2));
    expect(drawer()).toBeNull();
    expect(activeRows()).toEqual([]);
    await press("j");
    await vi.waitFor(() => expect(drawerText()).toContain("p2-row0"));
  });

  it("a mouse page change clears the highlight, and the next J opens row 0 (AC2.13)", async () => {
    await press("j");
    await press("j");
    await press("Escape");
    await vi.waitFor(() => expect(drawer()).toBeNull());
    expect(activeRows()).toEqual(["o2-table-row-1"]);

    wrapper.findComponent(SearchResult).vm.changePage(2);
    await flushPromises();
    expect(activeRows()).toEqual([]);
    await deliverPage(rows(2));
    (document.activeElement as HTMLElement | null)?.blur?.();
    await press("j");
    await vi.waitFor(() => expect(drawerText()).toContain("p2-row0"));
  });

  it("the last row of the last page is an edge: no request, 'Last result' (AC2.4)", async () => {
    searchObj.data.resultGrid.currentPage = 3;
    await flushPromises();
    await press("j");
    await press("j");
    await press("j");
    const sentBefore = transport.sent.length;
    await press("j");
    expect(transport.sent.length).toBe(sentBefore);
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-test="logs-detail-nav-live"]')?.textContent?.trim(),
      ).toBe("Last result"),
    );
    const next = document.querySelector('[data-test="log-detail-next-detail-btn"]')!;
    expect(next.hasAttribute("disabled")).toBe(true);
  });

  it("a row clicked while a crossing loads supersedes it; the landed page runs the row match instead (AC2.14)", async () => {
    await press("j");
    await press("j");
    await press("j");
    await press("Escape");
    await vi.waitFor(() => expect(document.activeElement).toBe(resultsRow(2)));
    await press("j");
    expect(searchObj.meta.resultGrid.navigation.pendingPageSelection?.page).toBe(2);
    expect(drawer()).toBeNull();

    resultsRow(1)!.click();
    await flushPromises();
    await vi.waitFor(() => expect(drawerText()).toContain("p1-row1"));
    expect(searchObj.meta.resultGrid.navigation.pendingPageSelection).toBeNull();

    await deliverPage(rows(2));
    expect(drawerText()).toContain("p1-row1");
    expect(activeRows()).toEqual([]);
    const next = document.querySelector('[data-test="log-detail-next-detail-btn"]')!;
    const prev = document.querySelector('[data-test="log-detail-previous-detail-btn"]')!;
    expect(next.hasAttribute("disabled")).toBe(true);
    expect(prev.hasAttribute("disabled")).toBe(true);
    expect(wrapper.findComponent({ name: "SearchDetail" }).vm.nextTooltip).toBe("Results changed");
  });

  it("a run that completes after the drawer opened keeps it on the matched row (AC3.6)", async () => {
    hostApi.getQueryData(false);
    await flushPromises();
    const run = lastSent();
    expect(run.payload.isPagination).toBe(false);
    run.handlers.data(run.payload, {
      type: "search_response_metadata",
      content: { results: { total: 3, hits: [] } },
    });
    run.handlers.data(run.payload, {
      type: "search_response_hits",
      content: { results: { hits: rows(1).slice(0, 2) } },
    });
    await flushPromises();
    resultsRow(1)!.click();
    await vi.waitFor(() => expect(drawerText()).toContain("p1-row1"));

    // A later chunk is re-sorted by order_by_metadata, so a newer row lands on top and the opened record moves to index 2.
    searchObj.data.queryResults.order_by_metadata = [["_timestamp", "desc"]];
    const newer = { _timestamp: 1_700_000_000_000_001, message: "newest", _stream_name: "app" };
    run.handlers.data(run.payload, {
      type: "search_response_hits",
      content: { results: { hits: [newer] } },
    });
    run.handlers.complete(run.payload, {});
    await flushPromises();

    expect(searchObj.meta.resultGrid.navigation.currentRowIndex).toBe(2);
    expect(activeRows()).toEqual(["o2-table-row-2"]);
    expect(drawerText()).toContain("p1-row1");
  });

  it("stale results keep J/K inside the page but block the edge with the run hint (AC5.7)", async () => {
    await press("j");
    await vi.waitFor(() => expect(drawerText()).toContain("p1-row0"));
    searchObj.meta.executed = {
      generation: 1,
      signature: readLogsSignature(searchObj as any),
      req: {},
      complete: true,
    };
    searchObj.meta.editorDirty = true;
    await flushPromises();
    await press("j");
    await press("j");
    await vi.waitFor(() => expect(drawerText()).toContain("p1-row2"));
    const sentBefore = transport.sent.length;
    await press("j");
    expect(transport.sent.length).toBe(sentBefore);
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-test="logs-detail-nav-live"]')?.textContent?.trim(),
      ).toBe("Run the query to update results"),
    );
    const next = document.querySelector('[data-test="log-detail-next-detail-btn"]')!;
    expect(next.hasAttribute("disabled")).toBe(true);
    expect(wrapper.findComponent({ name: "SearchDetail" }).vm.nextTooltip).toBe(
      "Run the query to update results",
    );
    searchObj.meta.editorDirty = false;
  });

  it("auto-refresh keeps live mode on page 1: the edge says why (AC5.5)", async () => {
    searchObj.meta.refreshInterval = 10;
    await press("j");
    await press("j");
    await press("j");
    const sentBefore = transport.sent.length;
    await press("j");
    expect(transport.sent.length).toBe(sentBefore);
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-test="logs-detail-nav-live"]')?.textContent?.trim(),
      ).toBe("Auto-refresh is on; turn it off to change pages"),
    );
  });

  it("a page request that is never sent fails at once with the toast, and J works again (AC2.12)", async () => {
    await press("j");
    await press("j");
    await press("j");
    searchObj.data.stream.selectedStream = [];
    const sentBefore = transport.sent.length;
    await press("j");
    expect(transport.sent.length).toBe(sentBefore);
    expect(searchObj.meta.resultGrid.navigation.pendingPageSelection).toBeNull();
    await vi.waitFor(() => expect(drawer()).toBeNull());
    await vi.waitFor(() =>
      expect(document.querySelector('[data-test="logs-row-nav-live"]')?.textContent?.trim()).toBe(
        "Couldn't load page 2",
      ),
    );
    searchObj.data.stream.selectedStream = ["app"];
    await press("j");
    await vi.waitFor(() => expect(drawer()).not.toBeNull());
  });

  it("results still streaming keep J and both buttons inert (AC3.5)", async () => {
    await press("j");
    await vi.waitFor(() => expect(drawerText()).toContain("p1-row0"));
    searchObj.data.resultGrid.hitsSettled = false;
    await flushPromises();
    await press("j");
    expect(drawerText()).toContain("p1-row0");
    const next = document.querySelector('[data-test="log-detail-next-detail-btn"]')!;
    expect(next.hasAttribute("disabled")).toBe(true);
    expect(wrapper.findComponent({ name: "SearchDetail" }).vm.nextTooltip).toBe("Loading results…");
    searchObj.data.resultGrid.hitsSettled = true;
    await flushPromises();
    await press("j");
    await vi.waitFor(() => expect(drawerText()).toContain("p1-row1"));
  });

  it("J does nothing while the drawer is on a correlated tab (AC1.8, guard 6)", async () => {
    const vm = wrapper.findComponent(SearchResult).vm;
    vm.openDetail({ index: 0 }, { tab: "correlated-logs" });
    await flushPromises();
    expect(vm.detailActiveTab).toBe("correlated-logs");
    await press("j");
    expect(vm.detailRow.message).toBe("p1-row0");
    expect(searchObj.meta.resultGrid.navigation.currentRowIndex).toBe(0);
  });

  describe("schema requests (user report 2026-10-07)", () => {
    const schemaOf = (name: string) => ({
      data: {
        name,
        stream_type: "logs",
        schema: [
          { name: "_timestamp", type: "Int64" },
          { name: "message", type: "Utf8" },
        ],
        settings: {},
      },
    });
    let schemaSpy: any;
    let helperStreamsModule: any = null;

    beforeEach(() => {
      // The app store's streams module replaces the helper's stub, so the real useStreams cache and mapping run.
      helperStreamsModule = (store as any)._modules.get(["streams"])?._rawModule ?? null;
      if (helperStreamsModule) (store as any).unregisterModule("streams");
      (store as any).registerModule("streams", streamsModule);
      vi.spyOn(StreamService, "nameList").mockResolvedValue({
        data: { list: [{ name: "app", stream_type: "logs", settings: {}, stats: {} }] },
      } as any);
      schemaSpy = vi
        .spyOn(StreamService, "schema")
        .mockImplementation(async (_org: string, name: string) => schemaOf(name) as any);
      // The executed query's first page already loaded this stream's schema.
      searchObj.data.streamResults = {
        list: [{ name: "app", stream_type: "logs", ...schemaOf("app").data }],
      };
    });

    afterEach(() => {
      vi.restoreAllMocks();
      (store as any).unregisterModule("streams");
      if (helperStreamsModule) (store as any).registerModule("streams", helperStreamsModule);
    });

    it("a page crossing sends exactly one search and no schema request", async () => {
      await press("j");
      await press("j");
      await press("j");
      const sentBefore = transport.sent.length;
      const fieldsBefore = searchObj.data.stream.selectedStreamFields;
      await press("j");
      await deliverPage(rows(2));
      await vi.waitFor(() => expect(drawerText()).toContain("p2-row0"));
      // extractFields replaces the field list once it has its schema, whichever way it got it.
      await vi.waitFor(() =>
        expect(searchObj.data.stream.selectedStreamFields).not.toBe(fieldsBefore),
      );
      await flushPromises();
      expect(transport.sent.length).toBe(sentBefore + 1);
      expect(transport.sent.at(-1)!.payload.isPagination).toBe(true);
      expect(schemaSpy).not.toHaveBeenCalled();
    });

    it("a new run still reads the stream schema", async () => {
      hostApi.getQueryData(false);
      await flushPromises();
      await deliverPage(rows(1));
      await new Promise((r) => setTimeout(r, 300));
      process.stdout.write(
        "DBG " +
          JSON.stringify({
            logs: (store.state as any).streams?.logs?.list?.map((x: any) => x.name),
            map: (store.state as any).streams?.streamsIndexMapping,
            nl: (StreamService.nameList as any).mock?.calls?.length,
            err: searchObj.data.errorMsg,
            org: (store.state as any).selectedOrganization?.identifier,
          }) +
          "\n",
      );
      await vi.waitFor(() =>
        expect(schemaSpy).toHaveBeenCalledWith(expect.any(String), "app", "logs"),
      );
    });
  });

  it("J opens nothing outside Logs mode (AC5.1)", async () => {
    for (const mode of ["patterns", "visualize", "drilldown", "build"]) {
      searchObj.meta.logsVisualizeToggle = mode;
      await press("j");
      expect(searchObj.meta.showDetailTab).toBe(false);
    }
    searchObj.meta.logsVisualizeToggle = "logs";
  });

  it("does nothing while another dialog is open (AC5.6)", async () => {
    const other = document.createElement("div");
    other.setAttribute("role", "dialog");
    other.setAttribute("data-state", "open");
    document.body.appendChild(other);
    await press("j");
    expect(drawer()).toBeNull();
    other.remove();
  });
});
