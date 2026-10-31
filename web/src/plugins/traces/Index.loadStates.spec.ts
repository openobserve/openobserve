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
import { defineComponent, h, KeepAlive, nextTick, reactive, ref } from "vue";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import Index from "@/plugins/traces/Index.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

const streamList = {
  list: [
    {
      name: "default",
      stream_type: "traces",
      stats: { doc_time_min: 1, doc_time_max: 2, doc_num: 1 },
      schema: [{ name: "trace_id", type: "Utf8" }],
      settings: { partition_keys: {}, full_text_search_keys: [], max_query_range: 0 },
    },
  ],
};

const freshSearchObj = () => ({
  organizationIdentifier: "default",
  loading: false,
  loadingStream: false,
  searchApplied: false,
  runQuery: false,
  config: { splitterModel: 20, lastSplitterPosition: 20, splitterLimit: [0, 40] },
  meta: {
    showFields: true,
    showQuery: true,
    showHistogram: true,
    sqlMode: false,
    searchMode: "traces",
    resultGrid: {
      rowsPerPage: 25,
      sortBy: "start_time",
      sortOrder: "desc",
      showPagination: false,
      navigation: {
        currentRowIndex: 0,
        selectionActive: false,
        pendingPageSelection: null,
        lastOpenedId: null,
      },
    },
    liveMode: false,
    serviceColors: {},
    metricsRangeFilters: new Map(),
  },
  data: {
    query: "",
    editorValue: "",
    errorMsg: "",
    errorCode: 0,
    errorDetail: "",
    stream: {
      streamLists: [] as any[],
      selectedStream: { label: "", value: "" },
      selectedStreamFields: [] as any[],
      selectedFields: [] as string[],
      functions: [],
    },
    streamResults: { list: [] as any[] },
    queryResults: { hits: [] } as any,
    sortedQueryResults: [],
    histogram: { layout: {}, data: [] },
    resultGrid: { currentPage: 0, columns: [], pageRequest: null, pageLoad: null },
    datetime: {
      startTime: 1700000000000000,
      endTime: 1700000900000000,
      relativeTimePeriod: "15m",
      type: "relative",
    },
    queryPayload: null as any,
  },
});

const searchObj = reactive(freshSearchObj());

const {
  mockGetStreams,
  mockGetStream,
  mockFetch,
  mockCancel,
  mockLoadTracesParser,
  mockTakeLanding,
  mockRecordRecent,
} = vi.hoisted(() => ({
  mockGetStreams: vi.fn(),
  mockGetStream: vi.fn(),
  mockFetch: vi.fn(),
  mockCancel: vi.fn(),
  mockLoadTracesParser: vi.fn(),
  mockTakeLanding: vi.fn(),
  mockRecordRecent: vi.fn(),
}));

vi.mock("@/aws-exports", () => ({ default: { isCloud: "false", isEnterprise: "true" } }));

vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj,
    resetSearchObj: vi.fn(),
    getUrlQueryParams: vi.fn(() => ({})),
    copyTracesUrl: vi.fn(),
    formatTracesMetaData: vi.fn((hits) => hits),
    setServiceColors: vi.fn(),
    loadLocalLogFilterField: vi.fn(),
    updatedLocalLogFilterField: vi.fn(),
    loadTracesParser: mockLoadTracesParser,
    tracesParser: { value: { astify: vi.fn(() => ({ where: null })) } },
  }),
}));

vi.mock("@/utils/streamPersist", () => ({
  saveTracesStream: vi.fn(),
  restoreTracesStream: vi.fn(() => ""),
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: mockGetStreams,
    getStream: mockGetStream,
  }),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({ showErrorNotification: vi.fn() }),
}));

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: mockFetch,
    cancelStreamQueryBasedOnRequestId: mockCancel,
  }),
}));

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

vi.mock("@/utils/queryHistory/routes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/queryHistory/routes")>()),
  takeRecentLanding: mockTakeLanding,
}));

vi.mock("@/composables/queryHistory/useRecentSearches", () => ({
  useRecentSearches: () => ({ record: mockRecordRecent }),
}));

const stubs = {
  "search-bar": true,
  "index-list": true,
  "search-result": { template: "<div />", methods: { getDashboardData: () => {} } },
  "service-graph": true,
  "services-catalog": true,
  SanitizedHtmlRenderer: true,
  TracesNoDataState: true,
  FirstDataPanel: { template: '<div data-test="first-data-panel"><slot layout="full" /></div>' },
};
const globalOptions = { plugins: [i18n, router], provide: { store }, stubs };

const routeSpy = vi.spyOn(router, "currentRoute", "get");
const setRouteQuery = (query: Record<string, string>) =>
  routeSpy.mockReturnValue({ value: { query, name: "traces", path: "/traces" } } as any);

const callsOfType = (kind: "main" | "count") =>
  mockFetch.mock.calls.filter(([req]) => {
    // The count query is the only one that asks for a single row.
    const isCount = req.queryReq?.query?.size === 1;
    return kind === "count" ? isCount : !isCount;
  });
const lastCall = (kind: "main" | "count") => callsOfType(kind).at(-1)!;

const keptAliveParents: VueWrapper<any>[] = [];
const mountKeptAlive = () => {
  const show = ref(true);
  const Parent = defineComponent({
    setup: () => () =>
      h(KeepAlive, null, {
        default: () => (show.value ? h(Index) : h("div", { key: "elsewhere" })),
      }),
  });
  const parent = mount(Parent, { attachTo: node, global: globalOptions });
  keptAliveParents.push(parent);
  return { show };
};

describe("Traces page load states", () => {
  let wrapper: VueWrapper<any> | undefined;

  beforeEach(() => {
    Object.assign(searchObj, freshSearchObj());
    mockGetStreams.mockResolvedValue(streamList);
    mockGetStream.mockImplementation((name: string) =>
      Promise.resolve(streamList.list.find((s) => s.name === name)),
    );
    mockLoadTracesParser.mockResolvedValue(undefined);
    mockTakeLanding.mockReset().mockReturnValue(null);
    vi.spyOn(router, "push").mockResolvedValue(undefined as any);
    vi.spyOn(router, "replace").mockResolvedValue(undefined as any);
    setRouteQuery({});
  });

  afterEach(async () => {
    wrapper?.unmount();
    wrapper = undefined;
    keptAliveParents.splice(0).forEach((parent) => parent.unmount());
    await flushPromises();
    vi.clearAllMocks();
  });

  it("registers as AppTraces, the name MainLayout's keep-alive list matches", () => {
    expect((Index as any).name).toBe("AppTraces");
  });

  describe("no false onboarding on a cold load", () => {
    it("shows the loading state, not the no-streams onboarding, while the parser loads", async () => {
      mockLoadTracesParser.mockReturnValue(new Promise(() => {}));
      wrapper = mount(Index, { attachTo: node, global: globalOptions });
      await flushPromises();

      expect(wrapper.find('[data-test="traces-search-loading"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="traces-no-streams-in-org-text"]').exists()).toBe(false);
      expect(mockGetStreams).not.toHaveBeenCalled();
    });

    it("shows the onboarding once the stream list settles with no streams", async () => {
      mockGetStreams.mockResolvedValue({ list: [] });
      wrapper = mount(Index, { attachTo: node, global: globalOptions });
      await vi.waitFor(() => expect(searchObj.loadingStream).toBe(false));
      await nextTick();

      expect(wrapper.find('[data-test="traces-no-streams-in-org-text"]').exists()).toBe(true);
    });

    it("still loads the stream list when the parser fails to load", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      mockLoadTracesParser.mockRejectedValue(new Error("chunk"));
      wrapper = mount(Index, { attachTo: node, global: globalOptions });
      await vi.waitFor(() => expect(searchObj.loadingStream).toBe(false));

      expect(mockGetStreams).toHaveBeenCalledTimes(1);
    });
  });

  describe("span/trace count while the count query runs", () => {
    const mountSearching = async () => {
      setRouteQuery({ stream: "default" });
      wrapper = mount(Index, { attachTo: node, global: globalOptions });
      await vi.waitFor(() => expect(callsOfType("main")).toHaveLength(1));
    };
    const countHits = (n: number) => ({
      content: { results: { hits: [{ trace_count: n, span_count: n, error_count: 1 }] } },
    });

    it("keeps the count pending instead of 0 until the count query answers", async () => {
      await mountSearching();
      expect(searchObj.data.queryResults.total).toBeNull();
      expect(searchObj.data.queryResults.countPending).toBe(true);

      lastCall("main")[1].complete(null);
      expect(searchObj.data.queryResults.countPending).toBe(true);

      lastCall("count")[1].data(null, countHits(42));
      lastCall("count")[1].complete(null);
      expect(searchObj.data.queryResults.total).toBe(42);
      expect(searchObj.data.queryResults.countPending).toBe(false);
    });

    it("settles the count when the count query fails", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await mountSearching();
      lastCall("main")[1].complete(null);
      lastCall("count")[1].error(null, new Error("boom"));

      expect(searchObj.data.queryResults.countPending).toBe(false);
      expect(searchObj.data.queryResults.total).toBeNull();
    });

    it("does not let a superseded search's count land on the new results", async () => {
      await mountSearching();
      lastCall("main")[1].complete(null);
      const staleCount = lastCall("count")[1];

      await wrapper!.vm.getQueryData();
      staleCount.data(null, countHits(999));
      staleCount.complete(null);

      expect(searchObj.data.queryResults.total).toBeNull();
      expect(searchObj.data.queryResults.countPending).toBe(true);
    });

    it("clears the pending count when the user cancels the search", async () => {
      await mountSearching();
      wrapper!.vm.cancelSearch();

      expect(searchObj.data.queryResults.countPending).toBe(false);
    });
  });

  describe("kept alive behind a trace detail page", () => {
    const settleSearch = async () => {
      await vi.waitFor(() => expect(callsOfType("main")).toHaveLength(1));
      lastCall("main")[1].complete(null);
      lastCall("count")[1].complete(null);
    };
    const leaveAndReturn = async (show: { value: boolean }, query?: Record<string, string>) => {
      show.value = false;
      await flushPromises();
      if (query) setRouteQuery(query);
      show.value = true;
      await flushPromises();
    };

    it("loads once on the first mount", async () => {
      setRouteQuery({ stream: "default" });
      mountKeptAlive();
      await settleSearch();
      await flushPromises();

      expect(mockGetStreams).toHaveBeenCalledTimes(1);
      expect(callsOfType("main")).toHaveLength(1);
    });

    it("re-runs nothing when Back returns to the same URL", async () => {
      setRouteQuery({ stream: "default", period: "15m" });
      const { show } = mountKeptAlive();
      await settleSearch();
      mockGetStreams.mockClear();
      mockFetch.mockClear();

      await leaveAndReturn(show);

      expect(mockGetStreams).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    describe("returning after time has passed", () => {
      let nowSpy: ReturnType<typeof vi.spyOn> | undefined;
      afterEach(() => nowSpy?.mockRestore());

      const returnAfter = async (query: Record<string, string>, ageMs: number) => {
        setRouteQuery(query);
        const { show } = mountKeptAlive();
        await settleSearch();
        mockFetch.mockClear();
        nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + ageMs);
        await leaveAndReturn(show);
      };

      it("re-runs a relative range once when its results are minutes old", async () => {
        await returnAfter({ stream: "default", period: "15m" }, 2 * 60_000);
        expect(callsOfType("main")).toHaveLength(1);
      });

      it("keeps a relative range's results that are seconds old", async () => {
        await returnAfter({ stream: "default", period: "15m" }, 10_000);
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it("never re-runs an absolute range", async () => {
        await returnAfter(
          { stream: "default", from: "1700000000000000", to: "1700000900000000" },
          10 * 60_000,
        );
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });

    it("refreshes when it returns to a different URL", async () => {
      setRouteQuery({ stream: "default", period: "15m" });
      const { show } = mountKeptAlive();
      await settleSearch();
      mockGetStreams.mockClear();
      mockFetch.mockClear();

      await leaveAndReturn(show, { stream: "default", period: "1h" });

      expect(mockGetStreams).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(callsOfType("main")).toHaveLength(1));
    });

    it("cancels a search in flight when it leaves and runs it again on return", async () => {
      setRouteQuery({ stream: "default" });
      const { show } = mountKeptAlive();
      await vi.waitFor(() => expect(callsOfType("main")).toHaveLength(1));
      const inFlightId = lastCall("main")[0].traceId;

      show.value = false;
      await flushPromises();
      expect(mockCancel).toHaveBeenCalledWith(expect.objectContaining({ trace_id: inFlightId }));
      expect(searchObj.loading).toBe(false);

      mockFetch.mockClear();
      show.value = true;
      await flushPromises();
      expect(callsOfType("main")).toHaveLength(1);
    });

    it("re-fetches only the count when it left while the count was running", async () => {
      setRouteQuery({ stream: "default" });
      const { show } = mountKeptAlive();
      await vi.waitFor(() => expect(callsOfType("main")).toHaveLength(1));
      lastCall("main")[1].complete(null);
      mockFetch.mockClear();

      await leaveAndReturn(show);

      expect(callsOfType("main")).toHaveLength(0);
      expect(callsOfType("count")).toHaveLength(1);
    });

    const deferred = <T>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((r) => (resolve = r));
      return { promise, resolve };
    };

    it("starts nothing when it leaves while the parser loads, and finishes loading on return", async () => {
      setRouteQuery({ stream: "default" });
      const parser = deferred<void>();
      mockLoadTracesParser.mockReturnValueOnce(parser.promise);
      const { show } = mountKeptAlive();
      await flushPromises();

      show.value = false;
      await flushPromises();
      parser.resolve();
      await flushPromises();

      expect(mockGetStreams).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();

      show.value = true;
      await flushPromises();
      await vi.waitFor(() => expect(callsOfType("main")).toHaveLength(1));
      expect(mockGetStreams).toHaveBeenCalledTimes(1);
      expect(searchObj.data.stream.selectedStream.value).toBe("default");
    });

    it("applies no stream list and starts no search when it leaves while the stream list loads", async () => {
      setRouteQuery({ stream: "default" });
      const streams = deferred<typeof streamList>();
      mockGetStreams.mockReturnValueOnce(streams.promise);
      const { show } = mountKeptAlive();
      await vi.waitFor(() => expect(mockGetStreams).toHaveBeenCalledTimes(1));

      show.value = false;
      await flushPromises();
      streams.resolve(streamList);
      await flushPromises();

      expect(mockFetch).not.toHaveBeenCalled();
      expect(searchObj.data.stream.streamLists).toEqual([]);
      expect(searchObj.data.streamResults.list).toEqual([]);

      show.value = true;
      await flushPromises();
      await vi.waitFor(() => expect(callsOfType("main")).toHaveLength(1));
      expect(mockGetStreams).toHaveBeenCalledTimes(2);
      expect(searchObj.data.stream.selectedStream.value).toBe("default");
    });

    it("runs a recent-search restore on return when it left while the stream list loaded", async () => {
      setRouteQuery({ stream: "default" });
      // The router hands a landing out once, so only the first load can claim it.
      mockTakeLanding.mockReturnValueOnce({ run: true });
      const streams = deferred<typeof streamList>();
      mockGetStreams.mockReturnValueOnce(streams.promise);
      const { show } = mountKeptAlive();
      await vi.waitFor(() => expect(mockGetStreams).toHaveBeenCalledTimes(1));

      show.value = false;
      await flushPromises();
      streams.resolve(streamList);
      await flushPromises();
      expect(mockFetch).not.toHaveBeenCalled();

      show.value = true;
      await flushPromises();
      await vi.waitFor(() => expect(callsOfType("main")).toHaveLength(1));
      lastCall("main")[1].complete(null);
      await flushPromises();

      // Only the restore's run is recorded; the default auto-run on a landing is not.
      expect(mockRecordRecent).toHaveBeenCalledTimes(1);
    });

    it("runs a newer restore over one it left mid-load", async () => {
      setRouteQuery({ stream: "default" });
      mockTakeLanding.mockReturnValueOnce({ run: false });
      const streams = deferred<typeof streamList>();
      mockGetStreams.mockReturnValueOnce(streams.promise);
      const { show } = mountKeptAlive();
      await vi.waitFor(() => expect(mockGetStreams).toHaveBeenCalledTimes(1));

      show.value = false;
      await flushPromises();
      streams.resolve(streamList);
      await flushPromises();
      mockTakeLanding.mockReturnValueOnce({ run: true });
      show.value = true;
      await flushPromises();
      await vi.waitFor(() => expect(callsOfType("main")).toHaveLength(1));
      lastCall("main")[1].complete(null);
      await flushPromises();

      expect(mockRecordRecent).toHaveBeenCalledTimes(1);
    });

    it("writes no field or schema state when it leaves while the stream schema loads", async () => {
      setRouteQuery({ stream: "default" });
      const schema = deferred<(typeof streamList.list)[number]>();
      mockGetStream.mockReturnValueOnce(schema.promise);
      const { show } = mountKeptAlive();
      await vi.waitFor(() => expect(mockGetStream).toHaveBeenCalledTimes(1));

      show.value = false;
      await flushPromises();
      schema.resolve({
        ...streamList.list[0],
        settings: { ...streamList.list[0].settings, max_query_range: 6 },
      });
      await flushPromises();

      expect(searchObj.data.stream.selectedStreamFields).toEqual([]);
      expect((searchObj.data.datetime as any).queryRangeRestrictionInHour).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();

      show.value = true;
      await flushPromises();
      await vi.waitFor(() => expect(callsOfType("main")).toHaveLength(1));
      expect(searchObj.data.stream.selectedStreamFields.length).toBeGreaterThan(0);
    });

    it("starts no search when it leaves during a filter handoff's stream load", async () => {
      setRouteQuery({ stream: "default" });
      const { show } = mountKeptAlive();
      await settleSearch();
      mockFetch.mockClear();
      const streams = deferred<typeof streamList>();
      mockGetStreams.mockReturnValueOnce(streams.promise);

      show.value = false;
      await flushPromises();
      setRouteQuery({ stream: "default", filter: "service_name='api'" });
      show.value = true;
      await vi.waitFor(() => expect(mockGetStreams).toHaveBeenCalledTimes(2));
      show.value = false;
      await flushPromises();
      streams.resolve(streamList);
      await flushPromises();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("starts nothing when it unmounts while the parser loads", async () => {
      setRouteQuery({ stream: "default" });
      const parser = deferred<void>();
      mockLoadTracesParser.mockReturnValueOnce(parser.promise);
      wrapper = mount(Index, { attachTo: node, global: globalOptions });
      await flushPromises();

      wrapper.unmount();
      wrapper = undefined;
      parser.resolve();
      await flushPromises();

      expect(mockGetStreams).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("drops a late batch from a search cancelled by leaving the page", async () => {
      setRouteQuery({ stream: "default" });
      wrapper = mount(Index, { attachTo: node, global: globalOptions });
      await vi.waitFor(() => expect(callsOfType("main")).toHaveLength(1));
      const lateBatch = lastCall("main")[1].data;

      wrapper.unmount();
      wrapper = undefined;
      lateBatch(null, {
        type: "search_response_hits",
        content: { results: { hits: [{ trace_id: "other-org-trace" }] } },
      });

      expect(searchObj.data.queryResults.hits).toEqual([]);
    });
  });
});
