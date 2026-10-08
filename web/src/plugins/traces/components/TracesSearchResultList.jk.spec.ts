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

// The real OTable renders the rows here, so the list's J/K selection, focus and highlight are what a user gets.

import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { recordPageLoad, recordPageRequest } from "@/utils/pageCrossing";
import QueryErrorState from "@/components/common/QueryErrorState.vue";
import { tracesRowNavAnnouncement } from "@/plugins/traces/composables/tracesRowNav";

const state = vi.hoisted(() => ({ searchObj: null as any }));

// Reactive like the real traces searchObj, so the highlight re-renders when the selection moves.
vi.mock("@/composables/useTraces", async () => {
  const { reactive } = await import("vue");
  state.searchObj = reactive({
    meta: {
      refreshInterval: 0,
      resultGrid: {
        navigation: {
          currentRowIndex: 0 as number | null,
          selectionActive: false,
          pendingPageSelection: null as any,
          lastOpenedId: null as string | null,
        },
      },
    },
    data: {
      errorMsg: "",
      queryResults: { hits: [] as any[] },
      stream: { selectedStreamFields: [], selectedFields: [], addToFilter: "" },
      resultGrid: { columns: [] as any[], pageRequest: null as any, pageLoad: null as any },
    },
  });
  return {
    default: () => ({ searchObj: state.searchObj, updatedLocalLogFilterField: vi.fn() }),
    DEFAULT_TRACE_COLUMNS: { traces: ["operation_name"], spans: ["operation_name"] },
  };
});

import TracesSearchResultList from "./TracesSearchResultList.vue";

// Mirrors traces Index + SearchResult: hits come from the shared searchObj, an error replaces the list, and the page renders the live region.
const Host = defineComponent({
  props: { listProps: { type: Object, required: true } },
  setup(props) {
    return () =>
      h("div", [
        state.searchObj.data.errorMsg
          ? h("div", { "data-test": "traces-search-error-message" }, [
              h(QueryErrorState, { errorMsg: state.searchObj.data.errorMsg, size: "hero" }),
            ])
          : h(TracesSearchResultList, {
              ...props.listProps,
              hits: state.searchObj.data.queryResults.hits,
            }),
        h(
          "div",
          { "aria-live": "polite", "data-test": "traces-row-nav-live" },
          tracesRowNavAnnouncement.value,
        ),
      ]);
  },
});

describe("TracesSearchResultList J/K (mounted with the real OTable)", () => {
  let wrapper: VueWrapper;
  let listProps: Record<string, unknown>;

  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  describe("J/K row selection (4a §3.4)", () => {
    const traces = (page: number, n = 5) =>
      Array.from({ length: n }, (_, i) => ({
        trace_id: `p${page}-t${i}`,
        operation_name: `op ${page}-${i}`,
        service_name: "svc",
        duration: 1,
        spans: 1,
        errors: 0,
        start_time: 1,
      }));
    const navigation = () => state.searchObj.meta.resultGrid.navigation;
    const region = () =>
      document.querySelector('[data-test="traces-row-nav-live"]')?.textContent?.trim();
    const row = (n: number) =>
      document.querySelector<HTMLElement>(
        `[data-test="traces-search-result-list"] [data-test="o2-table-row-${n}"]`,
      );
    const activeRows = () =>
      Array.from(
        document.querySelectorAll('[data-test="traces-search-result-list"] [data-active-row]'),
      );

    let crossings: number[];

    beforeEach(() => {
      // jsdom has no scrollIntoView; the browser's is a no-op for this assertion.
      HTMLElement.prototype.scrollIntoView = vi.fn();
      crossings = [];
      state.searchObj.meta.refreshInterval = 0;
      Object.assign(navigation(), {
        currentRowIndex: 0,
        selectionActive: false,
        pendingPageSelection: null,
        lastOpenedId: null,
      });
      state.searchObj.data.resultGrid.pageRequest = null;
      state.searchObj.data.resultGrid.pageLoad = null;
      state.searchObj.data.resultGrid.columns = [{ id: "operation_name" }];
      state.searchObj.data.errorMsg = "";
      tracesRowNavAnnouncement.value = "";
    });

    // The parent's cross-page handler sends the page request synchronously, like traces Index.vue.
    // jsdom has no layout, so the delegated scroller reports a size for the virtualizer to fill.
    const scroller = () => {
      const el = document.createElement("div");
      el.getBoundingClientRect = () =>
        ({ top: 0, left: 0, right: 1000, bottom: 2000, width: 1000, height: 2000 }) as DOMRect;
      Object.defineProperty(el, "clientHeight", { value: 2000 });
      Object.defineProperty(el, "offsetHeight", { value: 2000 });
      Object.defineProperty(el, "offsetWidth", { value: 1000 });
      document.body.appendChild(el);
      return el;
    };

    const mountList = async (
      props: Record<string, unknown> = {},
      sends = true,
      hits: any[] = traces(1),
    ) => {
      state.searchObj.data.queryResults.hits = hits;
      listProps = reactive({
        scrollEl: scroller(),
        loading: false,
        total: 15,
        rowsPerPage: 5,
        currentPage: 1,
        showPagination: true,
        ...props,
        "onCross-page": (page: number) => {
          crossings.push(page);
          if (!sends) return;
          listProps.currentPage = page;
          recordPageRequest(navigation(), state.searchObj.data.resultGrid, `req-${page}`);
        },
      });
      wrapper = mount(Host, {
        attachTo: document.body,
        props: { listProps },
        global: { plugins: [i18n, store] },
      });
      await flushPromises();
      await vi.waitFor(() => expect(row(hits.length - 1)).not.toBeNull());
    };

    const list = () => wrapper.findComponent(TracesSearchResultList).vm as any;

    const step = async (direction: 1 | -1, repeat = false) => {
      list().stepTraceRow(direction, repeat);
      await flushPromises();
    };

    // The worker can deliver the last hits and the completion together, so nothing re-renders between them.
    const completePage = (requestId: string, hits: any[]) => {
      state.searchObj.data.queryResults.hits = hits;
      recordPageLoad(state.searchObj.data.resultGrid, { requestId, ok: true, reason: "done" });
    };

    it("J selects and focuses row 0 without opening it, then J J J K lands on row 2 (AC6.1)", async () => {
      await mountList();
      await step(1);
      expect(row(0)?.getAttribute("aria-current")).toBe("true");
      expect(document.activeElement).toBe(row(0));
      expect(wrapper.emitted("row-click")).toBeUndefined();
      await vi.waitFor(() => expect(region()).toBe("Trace 1 of 5, page 1"));

      await step(1);
      await step(1);
      await step(1);
      await step(-1);
      expect(activeRows().map((el) => el.getAttribute("data-test"))).toEqual(["o2-table-row-2"]);
      expect(document.activeElement).toBe(row(2));
    });

    it("J on the last row crosses through its own request and selects the next page's row 0 (AC6.3)", async () => {
      await mountList();
      for (let i = 0; i < 5; i++) await step(1);
      expect(document.activeElement).toBe(row(4));
      await step(1);
      expect(crossings).toEqual([2]);
      expect(navigation().pendingPageSelection).toEqual({
        page: 2,
        position: "first",
        requestId: "req-2",
      });
      await step(1);
      expect(crossings).toEqual([2]);

      completePage("req-2", traces(2));
      await flushPromises();
      await vi.waitFor(() => expect(document.activeElement).toBe(row(0)));
      expect(navigation().pendingPageSelection).toBeNull();
      expect(navigation().selectionActive).toBe(true);
      await vi.waitFor(() => expect(region()).toBe("Trace 1 of 5, page 2"));
    });

    it("K across a page edge selects the last row of the longer page it lands on", async () => {
      await mountList({ total: 30, rowsPerPage: 25, currentPage: 2 });
      await step(1);
      await step(-1);
      expect(crossings).toEqual([1]);
      expect(navigation().pendingPageSelection).toMatchObject({ page: 1, position: "last" });

      completePage("req-1", traces(1, 25));
      expect(navigation().currentRowIndex).toBe(24);
      await flushPromises();
      await vi.waitFor(() => expect(document.activeElement).toBe(row(24)));
      expect(activeRows().map((el) => el.getAttribute("data-test"))).toEqual(["o2-table-row-24"]);
      await vi.waitFor(() => expect(region()).toBe("Trace 25 of 25, page 1"));
    });

    it("a crossing onto an empty page says so and clears the selection", async () => {
      await mountList();
      for (let i = 0; i < 6; i++) await step(1);
      expect(crossings).toEqual([2]);

      completePage("req-2", []);
      await flushPromises();
      expect(navigation().pendingPageSelection).toBeNull();
      expect(navigation().selectionActive).toBe(false);
      expect(navigation().currentRowIndex).toBeNull();
      await vi.waitFor(() => expect(region()).toBe("Page 2 has no results"));
    });

    it("a held J never crosses", async () => {
      await mountList();
      for (let i = 0; i < 5; i++) await step(1, i > 0);
      await step(1, true);
      expect(crossings).toEqual([]);
      await vi.waitFor(() => expect(region()).toBe("Last result"));
    });

    it("a crossing whose request was never sent fails at once and J works again (AC6.5)", async () => {
      await mountList({}, false);
      for (let i = 0; i < 5; i++) await step(1);
      await step(1);
      expect(crossings).toEqual([2]);
      expect(navigation().pendingPageSelection).toBeNull();
      expect(navigation().selectionActive).toBe(false);
      await vi.waitFor(() => expect(region()).toBe("Couldn't load page 2"));
      // Not stuck: focus is still on the last row, so the next J tries the crossing again.
      await step(1);
      expect(crossings).toEqual([2, 2]);
    });

    it("a failed page clears the selection without rolling the page back", async () => {
      await mountList();
      for (let i = 0; i < 6; i++) await step(1);
      recordPageLoad(state.searchObj.data.resultGrid, {
        requestId: "req-2",
        ok: false,
        reason: "error",
      });
      await flushPromises();
      expect(navigation().pendingPageSelection).toBeNull();
      expect(activeRows()).toEqual([]);
      expect(listProps.currentPage).toBe(2);
      await vi.waitFor(() => expect(region()).toBe("Couldn't load page 2"));
    });

    it("announces a failed page after the error state replaces the list (Index's error order)", async () => {
      await mountList();
      for (let i = 0; i < 6; i++) await step(1);
      recordPageLoad(state.searchObj.data.resultGrid, {
        requestId: "req-2",
        ok: false,
        reason: "error",
      });
      state.searchObj.data.errorMsg = "boom";
      await flushPromises();
      expect(wrapper.findComponent(TracesSearchResultList).exists()).toBe(false);
      expect(
        document.querySelector(
          '[data-test="traces-search-error-message"] [data-test="query-error-state"]',
        ),
      ).not.toBeNull();
      expect(navigation().pendingPageSelection).toBeNull();
      await vi.waitFor(() => expect(region()).toBe("Couldn't load page 2"));
    });

    it("auto-refresh keeps the list on its page and says why", async () => {
      state.searchObj.meta.refreshInterval = 10;
      await mountList();
      for (let i = 0; i < 6; i++) await step(1);
      expect(crossings).toEqual([]);
      await vi.waitFor(() =>
        expect(region()).toBe("Auto-refresh is on; turn it off to change pages"),
      );
    });

    it("announces spans in spans mode", async () => {
      await mountList({ searchMode: "spans" });
      await step(1);
      await vi.waitFor(() => expect(region()).toBe("Span 1 of 5, page 1"));
    });

    it("K with nothing selected does nothing", async () => {
      await mountList();
      await step(-1);
      expect(activeRows()).toEqual([]);
    });
  });
});
