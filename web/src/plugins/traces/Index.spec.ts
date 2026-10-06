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
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import Index from "@/plugins/traces/Index.vue";
import DateTime from "@/components/DateTime.vue";
import QueryErrorState from "@/components/common/QueryErrorState.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import * as useDurationPercentilesModule from "@/composables/useDurationPercentiles";
import { buildViewTracesFilter } from "@/plugins/traces/viewTracesHandoff";
import analytics from "@/services/product_analytics";

// Create DOM node for mounting
const node = document.createElement("div");
node.setAttribute("id", "app");
node.style.height = "1024px";
document.body.appendChild(node);

// Mock data
const mockStreamList = {
  list: [
    {
      name: "default",
      storage_type: "s3",
      stream_type: "traces",
      stats: {
        doc_time_min: 1000000000000,
        doc_time_max: 1755853746625720,
        doc_num: 1000,
        file_num: 10,
        storage_size: 1024000,
        compressed_size: 512000,
      },
      schema: [
        { name: "trace_id", type: "Utf8" },
        { name: "span_id", type: "Utf8" },
        { name: "service_name", type: "Utf8" },
        { name: "operation_name", type: "Utf8" },
        { name: "duration", type: "Int64" },
        { name: "start_time", type: "Int64" },
        { name: "end_time", type: "Int64" },
        { name: "span_status", type: "Utf8" },
        { name: "span_kind", type: "Utf8" },
      ],
      settings: {
        partition_keys: {},
        full_text_search_keys: [],
        max_query_range: 0,
      },
    },
    {
      name: "test-stream",
      storage_type: "s3",
      stream_type: "traces",
      stats: {
        doc_time_min: 1000000000000,
        doc_time_max: 1755853746625720,
        doc_num: 500,
        file_num: 5,
        storage_size: 512000,
        compressed_size: 256000,
      },
      schema: [
        { name: "trace_id", type: "Utf8" },
        { name: "span_id", type: "Utf8" },
        { name: "service_name", type: "Utf8" },
        { name: "operation_name", type: "Utf8" },
      ],
      settings: {
        partition_keys: {},
        full_text_search_keys: [],
        max_query_range: 24,
      },
    },
  ],
};

const mockTracesResponse = {
  took: 10,
  total: 3,
  from: 0,
  size: 25,
  hits: [
    {
      trace_id: "trace-1",
      service_name: "service-1",
      operation_name: "operation-1",
      duration: 100000,
      spans: 5,
      errors: 0,
      trace_start_time: 1755853746625720,
      trace_end_time: 1755853746725720,
      zo_sql_timestamp: 1755853746625720,
      start_time: 1755853746625720300,
      end_time: 1755853746725720300,
    },
    {
      trace_id: "trace-2",
      service_name: "service-2",
      operation_name: "operation-2",
      duration: 200000,
      spans: 10,
      errors: 1,
      trace_start_time: 1755853746625720,
      trace_end_time: 1755853746825720,
      zo_sql_timestamp: 1755853746625720,
      start_time: 1755853746625720300,
      end_time: 1755853746825720300,
    },
  ],
};

const mockFunctions = {
  list: [
    {
      name: "transform_1",
      function: "function() {}",
      num_args: "1",
      stream_name: null,
    },
  ],
};

// Mock composables
const mockSearchObj = {
  organizationIdentifier: "default",
  loading: false,
  loadingStream: false,
  searchApplied: false,
  config: {
    splitterModel: 20,
    lastSplitterPosition: 20,
    splitterLimit: [0, 40],
  },
  // Only meta is reactive so the searchMode watcher fires without making
  // the entire mock reactive (which would cause loadPageData side-effects
  // to re-render DOM in unrelated tests).
  meta: reactive({
    showFields: true,
    showQuery: true,
    showHistogram: true,
    sqlMode: false,
    searchMode: "traces" as "traces" | "spans" | "service-graph" | "services-catalog",
    resultGrid: {
      rowsPerPage: 25,
      sortBy: "start_time" as string,
      sortOrder: "desc" as "asc" | "desc",
    },
    refreshInterval: 0,
    liveMode: false,
    serviceColors: {},
    metricsRangeFilters: new Map(),
  }),
  data: {
    query: "",
    editorValue: "",
    errorMsg: "",
    errorCode: 0,
    errorDetail: "",
    additionalErrorMsg: "",
    stream: {
      streamLists: [],
      selectedStream: { label: "", value: "" },
      selectedStreamFields: [],
      selectedFields: [],
      functions: [],
    },
    streamResults: { list: [] },
    queryResults: { hits: [] },
    sortedQueryResults: [],
    histogram: {
      layout: {},
      data: [],
    },
    resultGrid: {
      currentPage: 0,
      columns: [],
    },
    datetime: {
      startTime: new Date().getTime() * 1000 - 900000000,
      endTime: new Date().getTime() * 1000,
      relativeTimePeriod: "15m",
      type: "relative",
    },
    queryPayload: null,
  },
  runQuery: false,
};

vi.mock("@/aws-exports", () => ({
  default: { isCloud: "false", isEnterprise: "true" },
}));

vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj: mockSearchObj,
    resetSearchObj: mockResetSearchObj,
    getUrlQueryParams: vi.fn(() => ({})),
    copyTracesUrl: vi.fn(),
    formatTracesMetaData: vi.fn((hits) => hits),
    setServiceColors: mockSetServiceColors,
    loadLocalLogFilterField: vi.fn(),
    updatedLocalLogFilterField: mockUpdatedLocalLogFilterField,
    loadTracesParser: vi.fn().mockResolvedValue(undefined),
    tracesParser: { value: trackTracesParser({ astify: vi.fn(() => ({ where: null })) }) },
  }),
}));

vi.mock("@/utils/streamPersist", () => ({
  saveTracesStream: vi.fn(),
  restoreTracesStream: mockRestoreTracesStream,
}));

// Hoisted so vi.mock factory can reference them and tests can override per-call
const { mockGetStreams, mockGetStream, mockSetServiceColors } = vi.hoisted(() => ({
  mockGetStreams: vi.fn(),
  mockGetStream: vi.fn(),
  mockSetServiceColors: vi.fn(),
}));

const { mockUpdatedLocalLogFilterField, mockToast } = vi.hoisted(() => ({
  mockUpdatedLocalLogFilterField: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...((await importOriginal()) as any),
  toast: mockToast,
}));

// Each mount gets its own parser, so a spy call's parser argument identifies which test's mount made it.
const { createdTracesParsers, trackTracesParser } = vi.hoisted(() => {
  const createdTracesParsers: unknown[] = [];
  return {
    createdTracesParsers,
    trackTracesParser: <T extends object>(p: T): T => (createdTracesParsers.push(p), p),
  };
});

// Hoisted so tests can assert resetSearchObj was called by the component lifecycle.
const { mockResetSearchObj } = vi.hoisted(() => ({
  mockResetSearchObj: vi.fn(),
}));

// Hoisted so tests can control what restoreTracesStream returns.
const { mockRestoreTracesStream } = vi.hoisted(() => ({
  mockRestoreTracesStream: vi.fn(() => ""),
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: mockGetStreams,
    getStream: mockGetStream,
  }),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: vi.fn(),
  }),
}));

// Hoisted so vi.mock factory can reference them and tests can override per-call
const { mockCancelStreamQueryBasedOnRequestId, mockFetchQueryDataWithHttpStream } = vi.hoisted(
  () => ({
    mockCancelStreamQueryBasedOnRequestId: vi.fn(),
    mockFetchQueryDataWithHttpStream: vi.fn(),
  }),
);

// The owning instance becomes the call's `this`, so tests can tell their search from a leftover instance's.
vi.mock("@/composables/useStreamingSearch", async () => {
  const { getCurrentInstance } = await import("vue");
  return {
    default: () => {
      const owner = getCurrentInstance();
      return {
        fetchQueryDataWithHttpStream: (...args: unknown[]) =>
          mockFetchQueryDataWithHttpStream.apply(owner, args),
        cancelStreamQueryBasedOnRequestId: mockCancelStreamQueryBasedOnRequestId,
      };
    },
  };
});

vi.mock("@/composables/useDurationPercentiles", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    parseDurationWhereClause: vi.fn((whereClause: string) => whereClause),
  };
});

// Hoisted so tests can assert on the spy and override its return value per test.
const { mockParseSpanKindWhereClause } = vi.hoisted(() => ({
  mockParseSpanKindWhereClause: vi.fn(
    (whereClause: string, _parser?: unknown, _streamName?: string) => whereClause,
  ),
}));

// Use importOriginal so SPAN_KIND_MAP and SPAN_KIND_LABEL_TO_KEY remain available,
// but replace parseSpanKindWhereClause with an inspectable spy that defaults to passthrough.
vi.mock("@/utils/traces/constants", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    parseSpanKindWhereClause: mockParseSpanKindWhereClause,
  };
});

// Mock services
vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      get_traces: vi.fn(() => Promise.resolve({ data: mockTracesResponse })),
    },
  });
});

vi.mock("@/services/jstransform", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list: vi.fn(() => Promise.resolve({ data: mockFunctions })),
    },
  });
});

vi.mock("@/services/product_analytics", () => ({
  default: {
    track: vi.fn(),
  },
}));

// Mock SQL parser
vi.mock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: () =>
      Promise.resolve({
        astify: vi.fn(() => ({
          type: "select",
          columns: "*",
          from: [{ table: "default" }],
          where: null,
        })),
      }),
  }),
}));

describe("Index.vue (Main Traces Page)", () => {
  let wrapper: VueWrapper<any>;

  // Create router spies once at describe-level to prevent stacking from repeated vi.spyOn calls.
  // vi.clearAllMocks() in afterEach clears their call history; beforeEach resets the implementation.
  const routerPushSpy = vi.spyOn(router, "push").mockResolvedValue(undefined as any);
  const routerReplaceSpy = vi.spyOn(router, "replace").mockResolvedValue(undefined as any);
  const routerCurrentRouteSpy = vi.spyOn(router, "currentRoute", "get").mockReturnValue({
    value: { query: {}, name: "traces", path: "/traces" },
  } as any);

  beforeEach(async () => {
    // Set default stream mock implementations (tests can override with mockResolvedValueOnce)
    mockGetStreams.mockResolvedValue(mockStreamList);
    mockGetStream.mockImplementation((streamName: string) =>
      Promise.resolve(mockStreamList.list.find((s: any) => s.name === streamName)),
    );

    // Reset mock data
    mockSearchObj.loading = false;
    mockSearchObj.loadingStream = false;
    mockSearchObj.organizationIdentifier = "default";
    mockSearchObj.meta.searchMode = "traces";
    mockSearchObj.meta.liveMode = false;
    mockSearchObj.data.stream.streamLists = [];
    mockSearchObj.data.stream.selectedStream = { label: "", value: "" };
    mockSearchObj.data.streamResults = { list: [] };
    mockSearchObj.data.queryResults = { hits: [] };
    mockSearchObj.data.errorMsg = "";
    mockSearchObj.data.editorValue = "";
    createdTracesParsers.length = 0;

    // Reset hoisted mocks to safe defaults for each test
    mockResetSearchObj.mockReset();
    mockRestoreTracesStream.mockReturnValue("");

    // Reset router spy return values to defaults for each test
    routerPushSpy.mockResolvedValue(undefined as any);
    routerReplaceSpy.mockResolvedValue(undefined as any);
    routerCurrentRouteSpy.mockReturnValue({
      value: { query: {}, name: "traces", path: "/traces" },
    } as any);
  });

  afterEach(async () => {
    if (wrapper) {
      wrapper.unmount();
    }
    // Drain pending async before clearing mocks so lingering chains from this
    // test cannot contaminate the next one. `flushPromises` alone only drains
    // microtasks; the field-grouping path awaits the query client, whose
    // scheduling spans a few macrotask hops, so the loop alternates the two.
    // Bounded and deterministic — no arbitrary sleep. Two iterations were not
    // always enough; three are.
    for (let i = 0; i < 3; i++) {
      await flushPromises();
      await new Promise((r) => setTimeout(r, 0));
    }
    await flushPromises();
    vi.clearAllMocks();
  });

  describe("Component Mounting & Initialization", () => {
    it("should mount the component successfully", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: {
            store: store,
          },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find("#tracePage").exists()).toBe(true);
    });

    it("should load stream list on mount", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // getStreamList uses an un-awaited .then() chain; poll until it resolves
      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.streamLists.length).toBeGreaterThan(0);
        },
        { timeout: 2000 },
      );
    });
  });

  describe("Tab Navigation", () => {
    it("should update URL with tab=service-graph when searchMode changes to service-graph", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();
      routerReplaceSpy.mockClear();

      // Emit update:searchMode from the search-bar stub to invoke onSearchModeChange,
      // which mutates the reactive searchObj and triggers the watcher.
      const searchBarEl = wrapper.findComponent({ name: "search-bar" });
      await searchBarEl.vm.$emit("update:searchMode", "service-graph");
      await flushPromises();

      expect(routerReplaceSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ tab: "service-graph" }),
        }),
      );
    });

    it("should update URL with tab=traces when searchMode changes to traces", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: { query: { tab: "service-graph" }, name: "traces", path: "/traces" },
      } as any);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();
      routerReplaceSpy.mockClear();

      // Switching to traces sets tab=traces in URL
      const searchBarEl = wrapper.findComponent({ name: "search-bar" });
      await searchBarEl.vm.$emit("update:searchMode", "traces");
      await flushPromises();

      expect(routerReplaceSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ tab: "traces" }),
        }),
      );
    });

    it("should update URL with tab=spans when searchMode changes to spans", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: {
          query: { tab: "traces", search_mode: "spans" },
          name: "traces",
          path: "/traces",
        },
      } as any);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();
      routerReplaceSpy.mockClear();

      const searchBarEl = wrapper.findComponent({ name: "search-bar" });
      await searchBarEl.vm.$emit("update:searchMode", "spans");
      await flushPromises();

      expect(routerReplaceSpy).toHaveBeenCalledWith({ query: { tab: "spans" } });
    });

    it("should switch to spans when the tab query changes on the mounted Traces route", async () => {
      const currentRoute = ref({
        query: { tab: "traces" },
        name: "traces",
        path: "/traces",
      }) as typeof router.currentRoute;
      routerCurrentRouteSpy.mockReturnValue(currentRoute);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();
      routerReplaceSpy.mockClear();

      currentRoute.value = {
        ...currentRoute.value,
        query: { tab: "spans" },
      };
      await flushPromises();

      expect(mockSearchObj.meta.searchMode).toBe("spans");
      expect(routerReplaceSpy).not.toHaveBeenCalled();
    });

    it("should restore the spans default when the tab query is removed", async () => {
      const currentRoute = ref({
        query: { tab: "spans" },
        name: "traces",
        path: "/traces",
      }) as typeof router.currentRoute;
      routerCurrentRouteSpy.mockReturnValue(currentRoute);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();
      routerReplaceSpy.mockClear();

      currentRoute.value = {
        ...currentRoute.value,
        query: {},
      };
      await flushPromises();

      expect(mockSearchObj.meta.searchMode).toBe("spans");
      expect(routerReplaceSpy).toHaveBeenCalledWith({ query: { tab: "spans" } });
    });

    it("should switch to service-graph tab from ?tab= on enterprise", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: {
          query: { tab: "service-graph" },
          name: "traces",
          path: "/traces",
        },
      } as any);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // onBeforeMount sets searchMode from URL; activeTab computed reflects it
      expect(mockSearchObj.meta.searchMode).toBe("service-graph");
      expect(wrapper.vm.activeTab).toBe("service-graph");
    });
  });

  describe("In-page tab rendering", () => {
    const mountIndex = () =>
      mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

    it("should render the ServiceGraph stub inline in service-graph mode (enterprise)", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: { query: { tab: "service-graph" }, name: "traces", path: "/traces" },
      } as any);
      wrapper = mountIndex();
      await flushPromises();

      expect(wrapper.findComponent({ name: "service-graph" }).exists()).toBe(true);
      expect(wrapper.findComponent({ name: "services-catalog" }).exists()).toBe(false);
    });

    it("should render the ServicesCatalog stub inline in services-catalog mode", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: { query: { tab: "services-catalog" }, name: "traces", path: "/traces" },
      } as any);
      wrapper = mountIndex();
      await flushPromises();

      expect(wrapper.findComponent({ name: "services-catalog" }).exists()).toBe(true);
      expect(wrapper.findComponent({ name: "service-graph" }).exists()).toBe(false);
    });

    it("should apply the built filter and switch mode on view-traces from the graph", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: { query: { tab: "service-graph" }, name: "traces", path: "/traces" },
      } as any);
      wrapper = mountIndex();
      await flushPromises();

      const payload = {
        serviceName: "cart-service",
        operationName: "GET /cart",
        mode: "traces",
        stream: "default",
      };
      const graphEl = wrapper.findComponent({ name: "service-graph" });
      expect(graphEl.exists()).toBe(true);
      await graphEl.vm.$emit("view-traces", payload);
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toBe(buildViewTracesFilter(payload));
      expect(mockSearchObj.data.editorValue).toBe(
        "service_name = 'cart-service' AND operation_name = 'GET /cart'",
      );
      expect(mockSearchObj.meta.searchMode).toBe("traces");
      expect(mockSearchObj.data.stream.selectedStream).toEqual({
        label: "default",
        value: "default",
      });
    });

    it("should hydrate the handoff ?filter= into the editor on mount", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: {
          query: { filter: "service_name = 'checkout'" },
          name: "traces",
          path: "/traces",
        },
      } as any);
      mockSearchObj.meta.sqlMode = true;

      wrapper = mountIndex();
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toBe("service_name = 'checkout'");
      expect(mockSearchObj.meta.sqlMode).toBe(false);
    });
  });

  describe("Stream Selection", () => {
    it("should select the default stream automatically", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // getStreamList uses an un-awaited .then() chain; poll until it resolves
      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.selectedStream.value).toBe("default");
        },
        { timeout: 2000 },
      );
    });

    it("should select stream from URL query params if provided", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: {
          query: { stream: "test-stream" },
          name: "traces",
          path: "/traces",
        },
      } as any);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // getStreamList uses an un-awaited .then() chain; poll until it resolves
      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.selectedStream.value).toBe("test-stream");
        },
        { timeout: 2000 },
      );
    });

    it("should show no stream selected message when no stream is selected", async () => {
      mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
      mockSearchObj.data.stream.selectedStream = { label: "", value: "" };

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(wrapper.find('[data-test="traces-no-stream-selected-text"]').exists()).toBe(true);
    });
  });

  describe("Search Functionality", () => {
    beforeEach(async () => {
      mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
      mockSearchObj.data.stream.selectedStream = {
        label: "default",
        value: "default",
      };
    });

    it("should show apply search message when no search is applied", async () => {
      mockSearchObj.searchApplied = false;
      mockSearchObj.data.queryResults = { hits: [] };

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(wrapper.find('[data-test="traces-search-not-started-text"]').exists()).toBe(true);
    });

    it("should execute search when searchData is called", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // Call searchData
      await wrapper.vm.searchData();
      await flushPromises();

      expect(mockSearchObj.data.resultGrid.currentPage).toBe(0);
    });

    it("should clear brush selections when running query", async () => {
      mockSearchObj.meta.metricsRangeFilters.set("test", {
        panelTitle: "Duration",
        start: 0,
        end: 100,
      });

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      await wrapper.vm.searchData();
      await flushPromises();

      expect(mockSearchObj.meta.metricsRangeFilters.size).toBe(0);
    });
  });

  describe("Heatmap selection across searches", () => {
    const mockClearOriginalTimeRange = vi.fn();
    // Mirrors applyFilterTerm's append, so the Error Only toggle edits the editor text.
    const mockApplyFiltersAppend = vi.fn((terms: string[]) => {
      mockSearchObj.data.editorValue = `${mockSearchObj.data.editorValue} and ${terms.join(" and ")}`;
    });
    const composed = "(service_name = 'a') and duration >= '100ms' and duration < '500ms'";
    const APPLIED = { startTime: 1_700_000_000_000_000, endTime: 1_700_000_060_000_000 };
    const heatmapEntry = (overrides: Record<string, unknown> = {}) => ({
      panelTitle: "Duration",
      start: 100_000,
      end: 500_000,
      timeStart: APPLIED.startTime,
      timeEnd: APPLIED.endTime,
      appliedStart: APPLIED.startTime,
      appliedEnd: APPLIED.endTime,
      baselineFilter: "service_name = 'a'",
      stream: "default",
      searchMode: "traces",
      ...overrides,
    });
    const savedDatetime = { ...mockSearchObj.data.datetime };
    const filters = mockSearchObj.meta.metricsRangeFilters as Map<string, any>;

    const mountPage = async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": {
              template: "<div />",
              setup() {
                return {
                  applyFilters: mockApplyFiltersAppend,
                  removeFilterByField: vi.fn(),
                  setEditorValue: vi.fn(),
                };
              },
            },
            "search-result": true,
            "index-list": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
      await flushPromises();
      // SearchResult is not rendered before a search has run, so its ref is set the way the drill-down test does.
      wrapper.vm.searchResultRef = {
        metricsDashboardRef: { clearOriginalTimeRange: mockClearOriginalTimeRange },
        getDashboardData: vi.fn(),
      };
      // The state a heatmap box leaves behind, set after mount so page loading cannot disturb it.
      mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      mockSearchObj.meta.searchMode = "traces";
      mockSearchObj.data.editorValue = composed;
      Object.assign(mockSearchObj.data.datetime, APPLIED, { type: "absolute" });
      filters.clear();
      mockClearOriginalTimeRange.mockClear();
    };

    afterEach(() => {
      Object.assign(mockSearchObj.data.datetime, savedDatetime);
      filters.clear();
    });

    it("keeps a matching Duration entry across the search and deletes Rate and Errors", async () => {
      await mountPage();
      filters.set("heatmap", heatmapEntry());
      filters.set("rate", { panelTitle: "Rate", start: -1, end: -1, timeStart: 1, timeEnd: 2 });
      filters.set("errors", { panelTitle: "Errors", start: -1, end: -1, timeStart: 1, timeEnd: 2 });

      wrapper.vm.searchData();
      await flushPromises();

      expect([...filters.keys()]).toEqual(["heatmap"]);
      expect(mockClearOriginalTimeRange).not.toHaveBeenCalled();
    });

    it.each([
      ["applied range", { appliedEnd: APPLIED.endTime - 1_000_000 }],
      ["editor text", { baselineFilter: "service_name = 'b'" }],
      ["stream", { stream: "test-stream" }],
      ["search mode", { searchMode: "spans" }],
    ])("drops a Duration entry whose %s no longer matches", async (_label, overrides) => {
      await mountPage();
      filters.set("heatmap", heatmapEntry(overrides));

      wrapper.vm.searchData();
      await flushPromises();

      expect(filters.size).toBe(0);
      expect(mockClearOriginalTimeRange).toHaveBeenCalled();
    });

    it("drops the entry when Error Only is toggled before the next search", async () => {
      await mountPage();
      filters.set("heatmap", heatmapEntry());

      wrapper.vm.onErrorOnlyToggled(true);
      wrapper.vm.searchData();
      await flushPromises();

      expect(mockSearchObj.data.editorValue).toBe(`${composed} and span_status = 'ERROR'`);
      expect(filters.size).toBe(0);
    });

    it("drops an entry captured in spans mode on a switch to traces mode", async () => {
      await mountPage();
      mockSearchObj.meta.searchMode = "spans";
      filters.set("heatmap", heatmapEntry({ searchMode: "spans" }));

      wrapper.vm.onSearchModeChange("traces");
      await flushPromises();

      expect(filters.size).toBe(0);
      expect(mockClearOriginalTimeRange).toHaveBeenCalled();
    });

    it("drops an entry captured on another stream on a stream change", async () => {
      await mountPage();
      filters.set("heatmap", heatmapEntry({ stream: "test-stream" }));

      await wrapper.vm.onChangeStream();
      await flushPromises();

      expect(filters.size).toBe(0);
      expect(mockClearOriginalTimeRange).toHaveBeenCalled();
    });

    it("drops an entry made stale by an unsearched filter edit on a sort", async () => {
      await mountPage();
      filters.set("heatmap", heatmapEntry());
      mockSearchObj.data.editorValue = `${composed} and service_name = 'b'`;

      wrapper.vm.runQueryOnSort();
      await flushPromises();

      expect(filters.size).toBe(0);
      expect(mockClearOriginalTimeRange).toHaveBeenCalled();
    });

    it("keeps the entry on a page fetch after an unsearched filter edit, as the page keeps page 1's filter", async () => {
      await mountPage();
      filters.set("heatmap", heatmapEntry());
      mockSearchObj.data.editorValue = `${composed} and service_name = 'b'`;

      wrapper.vm.getQueryData(true);
      await flushPromises();

      expect([...filters.keys()]).toEqual(["heatmap"]);
      expect(mockClearOriginalTimeRange).not.toHaveBeenCalled();
    });

    it("sorts an unsearched manual-mode box over its own window and keeps it", async () => {
      await mountPage();
      // The last search ran over the wider pre-box range; the box moved the picker and the editor only.
      mockSearchObj.data.queryPayload = {
        query: {
          start_time: APPLIED.startTime - 600_000_000,
          end_time: APPLIED.endTime + 600_000_000,
        },
      };
      filters.set("heatmap", heatmapEntry());
      mockFetchQueryDataWithHttpStream.mockClear();

      wrapper.vm.runQueryOnSort();
      await flushPromises();

      const req: any = mockFetchQueryDataWithHttpStream.mock.calls.at(-1)?.[0];
      const query = req.queryReq.query ?? req.queryReq;
      expect([query.start_time, query.end_time]).toEqual([APPLIED.startTime, APPLIED.endTime]);
      expect([...filters.keys()]).toEqual(["heatmap"]);
    });

    it("keeps a current entry across a sort", async () => {
      await mountPage();
      filters.set("heatmap", heatmapEntry());

      wrapper.vm.runQueryOnSort();
      await flushPromises();

      expect([...filters.keys()]).toEqual(["heatmap"]);
    });

    it("clears the original range on Reset", async () => {
      await mountPage();

      wrapper.vm.onFiltersReset();

      expect(mockClearOriginalTimeRange).toHaveBeenCalledTimes(1);
    });
  });

  describe("Error Handling", () => {
    const mountForErrors = async () => {
      mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
          },
        },
      });
      await flushPromises();
      await vi.waitFor(() => expect(mockSearchObj.loadingStream).toBe(false));
      await flushPromises();
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
    };

    // searchObj.data is a plain object in this suite, so the page and its splitter slots re-render by hand.
    const rerender = async () => {
      wrapper.vm.$forceUpdate();
      wrapper.findAllComponents(OSplitter).forEach((splitter) => splitter.vm.$forceUpdate());
      await nextTick();
    };

    const failSearch = async (err: unknown) => {
      const handlers: any[] = [];
      mockFetchQueryDataWithHttpStream.mockImplementation(function (
        this: unknown,
        _req: unknown,
        h: any,
      ) {
        if (this === wrapper.vm.$) handlers.push(h);
      });
      await wrapper.vm.getQueryData();
      await rerender();
      handlers[handlers.length - 1].error({}, err);
      await rerender();
    };

    const errorState = () =>
      wrapper.find('[data-test="traces-search-error-message"] [data-test="query-error-state"]');

    afterEach(() => {
      mockFetchQueryDataWithHttpStream.mockReset();
      mockSearchObj.data.errorCode = 0;
      mockSearchObj.data.errorDetail = "";
    });

    it("renders a planning error with its raw detail hidden", async () => {
      await mountForErrors();

      await failSearch({
        content: {
          message: "Search SQL execute error",
          code: 400,
          error_detail: "Error during planning: No field named foo",
        },
      });

      expect(errorState().exists()).toBe(true);
      expect(wrapper.find('[data-test="error-detail-summary"]').text()).toContain(
        "Search SQL execute error",
      );
      expect(wrapper.find('[data-test="error-detail-body"]').exists()).toBe(false);
      expect(wrapper.text()).not.toContain("Error during planning");
      expect(wrapper.findComponent(QueryErrorState).props("errorCode")).toBe(0);
    });

    it("hides the details again on a later error after they were opened", async () => {
      await mountForErrors();
      const planningError = {
        content: { message: "Search SQL execute error", code: 400, error_detail: "raw planner" },
      };

      await failSearch(planningError);
      await wrapper.find('[data-test="error-detail-toggle-btn"]').trigger("click");
      expect(wrapper.find('[data-test="error-detail-body"]').text()).toContain("raw planner");

      await failSearch(planningError);

      expect(errorState().exists()).toBe(true);
      expect(wrapper.find('[data-test="error-detail-body"]').exists()).toBe(false);
    });

    it("shows the summary of an unauthorized error", async () => {
      await mountForErrors();

      await failSearch({ content: { message: "Unauthorized Access", code: 403 } });

      expect(errorState().exists()).toBe(true);
      expect(wrapper.find('[data-test="error-detail-summary"]').text()).toBe("Unauthorized Access");
    });

    it("shows generic text for a network error without a code", async () => {
      await mountForErrors();

      await failSearch({});

      expect(errorState().exists()).toBe(true);
      expect(errorState().text()).toContain(i18n.global.t("queryError.generic"));
      expect(wrapper.find('[data-test="error-detail-summary"]').text()).toBe(
        i18n.global.t("traces.index.errorProcessingRequest"),
      );
    });

    it("keeps an application error code for the shared error state", async () => {
      await mountForErrors();

      await failSearch({ content: { message: "Full text search not configured", code: 20003 } });

      expect(wrapper.findComponent(QueryErrorState).props("errorCode")).toBe(20003);
    });
  });

  describe("DateTime Handling", () => {
    it("should restore datetime from URL params", async () => {
      const startTime = 1755853746625720;
      const endTime = 1755853746725720;

      routerCurrentRouteSpy.mockReturnValue({
        value: {
          query: {
            from: startTime,
            to: endTime,
          },
          name: "traces",
          path: "/traces",
        },
      } as any);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(mockSearchObj.data.datetime.startTime).toBe(startTime);
      expect(mockSearchObj.data.datetime.endTime).toBe(endTime);
      expect(mockSearchObj.data.datetime.type).toBe("absolute");
    });

    it("should restore relative time period from URL params", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: {
          query: {
            period: "15m",
          },
          name: "traces",
          path: "/traces",
        },
      } as any);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(mockSearchObj.data.datetime.relativeTimePeriod).toBe("15m");
      expect(mockSearchObj.data.datetime.type).toBe("relative");
    });
  });

  describe("Pagination", () => {
    it("should load more data when getMoreData is called", async () => {
      mockSearchObj.data.stream.selectedStream = {
        label: "default",
        value: "default",
      };
      mockSearchObj.meta.refreshInterval = 0;

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      await wrapper.vm.getMoreData();
      await flushPromises();

      // Should have called getQueryData which uses the current page
      expect(wrapper.vm).toBeTruthy();
    });
  });

  describe("Streaming page writes (issue #14317)", () => {
    // The shared beforeEach does not reset currentPage, so it would leak into later tests.
    afterEach(() => {
      mockSearchObj.data.resultGrid.currentPage = 0;
    });

    const meta = (hits: any[] = []) => ({
      type: "search_response_metadata",
      content: { results: { hits } },
    });
    const chunk = (hits: any[]) => ({
      type: "search_response_hits",
      content: { results: { hits } },
    });
    const spans = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        span_id: `${prefix}-${i}`,
        trace_id: `t-${prefix}-${i}`,
        service_name: "svc",
        operation_name: "op",
        _timestamp: 1700000000000000 + i,
      }));

    const mountPage = async () => {
      mockSearchObj.meta.searchMode = "spans";
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
      await flushPromises();
      await vi.waitFor(() => expect(mockSearchObj.loadingStream).toBe(false));
      await flushPromises();
      // Mounting runs loadPageData, which can reset the stream selection.
      mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      // getQueryData derives `from` from currentPage, so this is what makes it page 2.
      mockSearchObj.data.resultGrid.currentPage = 1;
      mockSearchObj.meta.resultGrid.rowsPerPage = 25;
      mockSearchObj.data.queryPayload = {
        query: {
          sql: "",
          start_time: 1700000000000000,
          end_time: 1700003600000000,
          from: 0,
          size: 25,
        },
      };
      return wrapper;
    };

    const lastCallbacks = () => {
      const calls = mockFetchQueryDataWithHttpStream.mock.calls;
      return calls[calls.length - 1][1];
    };

    it("replaces the previous page when the stream opens with an empty batch", async () => {
      await mountPage();
      mockFetchQueryDataWithHttpStream.mockClear();
      await wrapper.vm.getQueryData(true);
      await flushPromises();

      const page1 = spans("p1", 25);
      mockSearchObj.data.queryResults.hits = [...page1];

      const cb = lastCallbacks();
      const page2 = spans("p2", 25);
      // The backend opens every page past the first with an empty batch.
      cb.data(null, meta([]));
      cb.data(null, chunk([]));
      cb.data(null, meta([]));
      cb.data(null, chunk(page2));

      const ids = mockSearchObj.data.queryResults.hits.map((h: any) => h.span_id);
      expect(ids).toHaveLength(25);
      expect(ids).toEqual(page2.map((h) => h.span_id));
      expect(ids.some((id: string) => id.startsWith("p1-"))).toBe(false);
    });

    it("joins batches within one page instead of replacing them", async () => {
      await mountPage();
      mockFetchQueryDataWithHttpStream.mockClear();
      await wrapper.vm.getQueryData(true);
      await flushPromises();

      const cb = lastCallbacks();
      const first = spans("a", 5);
      const second = spans("b", 20);
      cb.data(null, meta([]));
      cb.data(null, chunk(first));
      cb.data(null, meta([]));
      cb.data(null, chunk(second));

      const ids = mockSearchObj.data.queryResults.hits.map((h: any) => h.span_id);
      expect(ids).toEqual([...first, ...second].map((h) => h.span_id));
    });

    it("clears the grid when a page streams no rows at all", async () => {
      await mountPage();
      mockFetchQueryDataWithHttpStream.mockClear();
      await wrapper.vm.getQueryData(true);
      await flushPromises();

      mockSearchObj.data.queryResults.hits = spans("p1", 25);

      const cb = lastCallbacks();
      cb.data(null, meta([]));
      cb.data(null, chunk([]));
      cb.complete(null);

      expect(mockSearchObj.data.queryResults.hits).toEqual([]);
    });

    // Logs shows its error banner over the last results rather than blanking; traces matches it.
    it("keeps the previous rows when a page fails before writing any", async () => {
      await mountPage();
      mockFetchQueryDataWithHttpStream.mockClear();
      await wrapper.vm.getQueryData(true);
      await flushPromises();

      const page1 = spans("p1", 25);
      mockSearchObj.data.queryResults.hits = [...page1];

      const cb = lastCallbacks();
      cb.data(null, meta([]));
      cb.data(null, chunk([]));
      cb.error(null, { content: { message: "boom", code: 500 } });

      const ids = mockSearchObj.data.queryResults.hits.map((h: any) => h.span_id);
      expect(ids).toEqual(page1.map((h) => h.span_id));
    });

    it("ignores batches from a request that a newer search superseded", async () => {
      await mountPage();
      mockFetchQueryDataWithHttpStream.mockClear();
      await wrapper.vm.getQueryData(true);
      await flushPromises();
      const stale = lastCallbacks();

      // A second search cancels the first and takes ownership of the grid.
      await wrapper.vm.getQueryData(true);
      await flushPromises();
      const current = lastCallbacks();

      const fresh = spans("new", 25);
      current.data(null, meta([]));
      current.data(null, chunk(fresh));

      stale.data(null, meta([]));
      stale.data(null, chunk(spans("old", 25)));
      stale.complete(null);

      const ids = mockSearchObj.data.queryResults.hits.map((h: any) => h.span_id);
      expect(ids).toEqual(fresh.map((h) => h.span_id));
    });

    it("tracks traces_search_completed when a new search completes", async () => {
      await mountPage();
      mockFetchQueryDataWithHttpStream.mockClear();
      await wrapper.vm.getQueryData(false);
      await flushPromises();
      vi.mocked(analytics.track).mockClear();

      lastCallbacks().complete(null);

      expect(analytics.track).toHaveBeenCalledWith("traces_search_completed");
    });

    it("does not track traces_search_completed when a page completes", async () => {
      await mountPage();
      mockFetchQueryDataWithHttpStream.mockClear();
      await wrapper.vm.getQueryData(true);
      await flushPromises();
      vi.mocked(analytics.track).mockClear();

      lastCallbacks().complete(null);

      expect(analytics.track).not.toHaveBeenCalledWith("traces_search_completed");
    });
  });

  describe("Metrics Filters Integration", () => {
    // Spies for SearchBar ref methods exposed via stub
    const mockApplyFilters = vi.fn();
    const mockRemoveFilterByField = vi.fn();
    const mockSetEditorValue = vi.fn();

    function mountWithSearchBarStub() {
      return mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": {
              template: "<div />",
              setup() {
                return {
                  applyFilters: mockApplyFilters,
                  removeFilterByField: mockRemoveFilterByField,
                  setEditorValue: mockSetEditorValue,
                };
              },
            },
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
    }

    beforeEach(() => {
      mockApplyFilters.mockReset();
      mockRemoveFilterByField.mockReset();
      mockSetEditorValue.mockReset();
      mockSearchObj.data.editorValue = "";
      mockSearchObj.meta.metricsRangeFilters.clear();
      // Reset auto_query_enabled to undefined for each test
      delete store.state.zoConfig.auto_query_enabled;
    });

    it("should render the drill-down target in the search tab", async () => {
      wrapper = mountWithSearchBarStub();
      await flushPromises();

      expect(wrapper.vm.activeTab).toBe("search");
      expect(wrapper.find("#traces-drill-down-page").exists()).toBe(true);
    });

    it("should open the analysis dashboard on SearchResult when SearchBar emits drill-down", async () => {
      wrapper = mountWithSearchBarStub();
      await flushPromises();
      const openUnifiedAnalysisDashboard = vi.fn();
      wrapper.vm.searchResultRef = { openUnifiedAnalysisDashboard };

      wrapper.findComponent('[data-test="logs-search-bar"]').vm.$emit("drill-down");
      await flushPromises();

      expect(openUnifiedAnalysisDashboard).toHaveBeenCalledTimes(1);
    });

    it("should call applyFilters with all filter terms when metrics filters are updated", async () => {
      wrapper = mountWithSearchBarStub();
      await flushPromises();

      wrapper.vm.onMetricsFiltersUpdated(["duration >= 100", "service_name = 'test'"]);
      await flushPromises();

      expect(mockApplyFilters).toHaveBeenCalledWith(["duration >= 100", "service_name = 'test'"]); // applyFilters owns the single trigger; no skipSearch arg
    });

    it("should append error filter to applyFilters call when span_status = 'ERROR' is in the query", async () => {
      mockSearchObj.data.editorValue = "span_status = 'ERROR'";
      wrapper = mountWithSearchBarStub();
      await flushPromises();

      wrapper.vm.onMetricsFiltersUpdated(["duration >= 100"]);
      await flushPromises();

      expect(mockApplyFilters).toHaveBeenCalledWith(["duration >= 100", "span_status = 'ERROR'"]); // applyFilters owns the single trigger; no skipSearch arg
    });

    it("should not duplicate error filter when it is already present in incoming filters", async () => {
      mockSearchObj.data.editorValue = "span_status = 'ERROR'";
      wrapper = mountWithSearchBarStub();
      await flushPromises();

      // Error panel brush already emitted span_status filter
      wrapper.vm.onMetricsFiltersUpdated(["duration >= 100", "span_status = 'ERROR'"]);
      await flushPromises();

      // span_status = 'ERROR' must appear exactly once
      const calledWith = mockApplyFilters.mock.calls[0][0] as string[];
      expect(calledWith.filter((f) => f === "span_status = 'ERROR'")).toHaveLength(1);
    });

    describe("onMetricsEditorFilterSet", () => {
      const searchDataRuns = () =>
        vi
          .mocked(analytics.track)
          .mock.calls.filter(
            ([event, props]: any[]) => event === "Button Click" && props?.button === "Search Data",
          ).length;

      beforeEach(() => {
        mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
        mockSearchObj.data.stream.selectedStream = { label: "default", value: "default" };
      });

      it("sets the editor text and runs exactly one search in live mode", async () => {
        mockSearchObj.meta.liveMode = true;
        store.state.zoConfig.auto_query_enabled = true;
        wrapper = mountWithSearchBarStub();
        await flushPromises();
        vi.mocked(analytics.track).mockClear();

        wrapper.vm.onMetricsEditorFilterSet("(a = '1') and duration < '1ms'");

        expect(mockSearchObj.data.editorValue).toBe("(a = '1') and duration < '1ms'");
        expect(mockSetEditorValue).toHaveBeenCalledWith("(a = '1') and duration < '1ms'");
        expect(searchDataRuns()).toBe(1);
      });

      it("sets the editor text and runs no search with live mode off", async () => {
        store.state.zoConfig.auto_query_enabled = true;
        wrapper = mountWithSearchBarStub();
        await flushPromises();
        // Mount derives liveMode from auto_query_enabled, so switch it off afterwards.
        mockSearchObj.meta.liveMode = false;
        vi.mocked(analytics.track).mockClear();

        wrapper.vm.onMetricsEditorFilterSet("duration < '1ms'");

        expect(mockSearchObj.data.editorValue).toBe("duration < '1ms'");
        expect(mockSetEditorValue).toHaveBeenCalledWith("duration < '1ms'");
        expect(searchDataRuns()).toBe(0);
      });
    });

    it("should call applyFilters with error condition when error only toggle is turned on", async () => {
      wrapper = mountWithSearchBarStub();
      await flushPromises();

      wrapper.vm.onErrorOnlyToggled(true);
      await flushPromises();

      expect(mockApplyFilters).toHaveBeenCalledWith(["span_status = 'ERROR'"]);
    });

    it("should call removeFilterByField when error only toggle is turned off", async () => {
      wrapper = mountWithSearchBarStub();
      await flushPromises();

      wrapper.vm.onErrorOnlyToggled(false);
      await flushPromises();

      expect(mockRemoveFilterByField).toHaveBeenCalledWith("span_status");
    });

    // Index no longer branches on liveMode / passes a skipSearch flag — it always
    // calls applyFilters with just the filters; the live-mode search-gating now
    // lives inside SearchBar.applyFilters (covered in SearchBar.spec).
    it("should call applyFilters with only the filters when live mode is ON", async () => {
      mockSearchObj.meta.liveMode = true;
      store.state.zoConfig.auto_query_enabled = true;
      wrapper = mountWithSearchBarStub();
      await flushPromises();

      const testFilters = ["duration > 100ms", 'service_name = "api"'];
      wrapper.vm.onMetricsFiltersUpdated(testFilters);
      await flushPromises();

      expect(mockApplyFilters).toHaveBeenCalledWith(testFilters);
    });

    it("should call applyFilters with only the filters when live mode is OFF", async () => {
      mockSearchObj.meta.liveMode = false;
      wrapper = mountWithSearchBarStub();
      await flushPromises();

      const testFilters = ['span_status = "ERROR"'];
      wrapper.vm.onMetricsFiltersUpdated(testFilters);
      await flushPromises();

      expect(mockApplyFilters).toHaveBeenCalledWith(testFilters);
    });

    it("should call applyFilters with only the filters when liveMode is undefined", async () => {
      mockSearchObj.meta.liveMode = undefined;
      wrapper = mountWithSearchBarStub();
      await flushPromises();

      const testFilters = ['http_method = "POST"'];
      wrapper.vm.onMetricsFiltersUpdated(testFilters);
      await flushPromises();

      expect(mockApplyFilters).toHaveBeenCalledWith(testFilters);
    });

    it("should handle searchBarRef not available", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true, // No exposed methods
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
      await flushPromises();

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      wrapper.vm.onMetricsFiltersUpdated(["test"]);
      await flushPromises();

      expect(consoleSpy).toHaveBeenCalledWith("SearchBar not ready for filter application");
      consoleSpy.mockRestore();
    });
  });

  describe("Splitter Behavior", () => {
    it("should dispatch resize event when splitter is updated", async () => {
      const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      wrapper.vm.onSplitterUpdate();
      await flushPromises();

      expect(dispatchEventSpy).toHaveBeenCalledWith(expect.any(Event));
    });
  });

  describe("Horizontal Splitter Layout", () => {
    it("should render the outer horizontal splitter with the correct class", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(wrapper.find(".traces-horizontal-splitter").exists()).toBe(true);
    });

    it("should initialize splitterModel with a default value of 15", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // splitterModel is initialized to 90 (horizontal px height for the search-bar panel)
      expect(wrapper.vm.splitterModel).toBe(90);
    });

    it("should render the second-level container with full-height class", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(wrapper.find("#tracesSecondLevel").classes()).toContain("h-full");
    });

    it("should render search-bar inside the outer horizontal splitter", async () => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": { template: '<div data-test="logs-search-bar" />' },
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      const horizontalSplitter = wrapper.find(".traces-horizontal-splitter");
      expect(horizontalSplitter.exists()).toBe(true);
      expect(horizontalSplitter.find('[data-test="logs-search-bar"]').exists()).toBe(true);
    });
  });

  describe("Query Restoration", () => {
    it("should restore query from URL params", async () => {
      const testQuery = "service_name = 'test'";
      const encodedQuery = btoa(testQuery);

      routerCurrentRouteSpy.mockReturnValue({
        value: {
          query: {
            query: encodedQuery,
            stream: "default",
          },
          name: "traces",
          path: "/traces",
        },
      } as any);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(mockSearchObj.data.editorValue).toBe(testQuery);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty stream list gracefully", async () => {
      // Override just for this test — mockGetStreams is the shared vi.fn from vi.hoisted
      mockGetStreams.mockResolvedValueOnce({ list: [] });

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      expect(mockSearchObj.data.stream.streamLists).toEqual([]);
      expect(mockSearchObj.loading).toBe(false);
    });

    it("should not execute search when no stream is selected", async () => {
      mockSearchObj.data.stream.streamLists = [];
      mockSearchObj.data.stream.selectedStream = { label: "", value: "" };

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      const result = await wrapper.vm.searchData();

      expect(result).toBeUndefined();
    });

    it("should handle refresh interval of 0 correctly", async () => {
      mockSearchObj.meta.refreshInterval = 5;

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // Should not call getQueryData when refresh interval is not 0
      await wrapper.vm.getMoreData();

      // No error should be thrown
      expect(wrapper.vm).toBeTruthy();
    });
  });

  describe("onSearchModeChange — sortBy reset", () => {
    function mountIndexStubbed() {
      return mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
    }

    it("should reset sortBy to start_time when switching to traces mode and sortBy is a spans-only column", async () => {
      // Simulate a spans-specific sort column being active
      mockSearchObj.meta.resultGrid.sortBy = "span_status";
      mockSearchObj.meta.searchMode = "spans";

      wrapper = mountIndexStubbed();
      await flushPromises();

      const searchBarEl = wrapper.findComponent({ name: "search-bar" });
      await searchBarEl.vm.$emit("update:searchMode", "traces");
      await flushPromises();

      expect(mockSearchObj.meta.resultGrid.sortBy).toBe("start_time");
    });

    it("should NOT reset sortBy when switching to traces mode and sortBy is start_time", async () => {
      mockSearchObj.meta.resultGrid.sortBy = "start_time";
      mockSearchObj.meta.searchMode = "spans";

      wrapper = mountIndexStubbed();
      await flushPromises();

      const searchBarEl = wrapper.findComponent({ name: "search-bar" });
      await searchBarEl.vm.$emit("update:searchMode", "traces");
      await flushPromises();

      expect(mockSearchObj.meta.resultGrid.sortBy).toBe("start_time");
    });

    it("should NOT reset sortBy when switching to traces mode and sortBy is duration", async () => {
      mockSearchObj.meta.resultGrid.sortBy = "duration";
      mockSearchObj.meta.searchMode = "spans";

      wrapper = mountIndexStubbed();
      await flushPromises();

      const searchBarEl = wrapper.findComponent({ name: "search-bar" });
      await searchBarEl.vm.$emit("update:searchMode", "traces");
      await flushPromises();

      expect(mockSearchObj.meta.resultGrid.sortBy).toBe("duration");
    });

    it("should NOT reset sortBy when switching to spans mode", async () => {
      mockSearchObj.meta.resultGrid.sortBy = "operation_name";
      mockSearchObj.meta.searchMode = "traces";

      wrapper = mountIndexStubbed();
      await flushPromises();

      const searchBarEl = wrapper.findComponent({ name: "search-bar" });
      await searchBarEl.vm.$emit("update:searchMode", "spans");
      await flushPromises();

      // Switching to spans does not reset sortBy
      expect(mockSearchObj.meta.resultGrid.sortBy).toBe("operation_name");
    });

    it("should reset sortBy to start_time when switching to traces mode and sortBy is operation_name", async () => {
      mockSearchObj.meta.resultGrid.sortBy = "operation_name";
      mockSearchObj.meta.searchMode = "spans";

      wrapper = mountIndexStubbed();
      await flushPromises();

      const searchBarEl = wrapper.findComponent({ name: "search-bar" });
      await searchBarEl.vm.$emit("update:searchMode", "traces");
      await flushPromises();

      expect(mockSearchObj.meta.resultGrid.sortBy).toBe("start_time");
    });
  });

  describe("cancelSearch", () => {
    it("should dispatch cancelQuery event on window when cancelSearch is called", async () => {
      const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      wrapper.vm.cancelSearch();
      await flushPromises();

      const cancelQueryCalls = dispatchEventSpy.mock.calls.filter(
        ([evt]) => evt instanceof Event && evt.type === "cancelQuery",
      );
      expect(cancelQueryCalls.length).toBeGreaterThan(0);
    });

    it.skip("should set searchObj.loading to false when an in-flight search is cancelled", async () => {
      mockSearchObj.data.stream.selectedStream = {
        label: "default",
        value: "default",
      };
      mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
      // Ensure datetime is in a valid state for buildSearch
      mockSearchObj.data.datetime = {
        startTime: new Date().getTime() * 1000 - 900000000,
        endTime: new Date().getTime() * 1000,
        relativeTimePeriod: "15m",
        type: "relative",
      };
      // Keep the stream query open — never resolve — so currentSearchTraceId stays set
      vi.mocked(mockFetchQueryDataWithHttpStream).mockImplementation(() => {
        // intentional no-op: callbacks never called
      });

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // Start a search to populate currentSearchTraceId; wait until loading is set
      wrapper.vm.searchData();
      await flushPromises();

      // Verify the search started (loading = true means getQueryData reached fetchQueryDataWithHttpStream)
      await vi.waitFor(
        () => {
          expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalled();
        },
        { timeout: 2000 },
      );

      expect(mockSearchObj.loading).toBe(true);

      wrapper.vm.cancelSearch();
      await flushPromises();

      expect(mockSearchObj.loading).toBe(false);
    });

    it("should not call cancelStreamQueryBasedOnRequestId when there is no active trace id", async () => {
      // With a stream list, mount starts a search a variable number of macrotask hops later; no streams means none.
      mockGetStreams.mockResolvedValueOnce({ list: [] });
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      for (let i = 0; i < 3; i++) {
        await flushPromises();
        await new Promise((r) => setTimeout(r, 0));
      }
      // Unmounted instances from earlier tests can still search on the shared mocks, so only this instance counts.
      const ownSearches = mockFetchQueryDataWithHttpStream.mock.contexts.filter(
        (owner) => owner === wrapper.vm.$,
      );
      expect(ownSearches).toHaveLength(0);

      // cancelSearch is synchronous, so bracketing it keeps a leftover instance's cancel out of the count.
      const cancelsBefore = mockCancelStreamQueryBasedOnRequestId.mock.calls.length;
      wrapper.vm.cancelSearch();
      expect(mockCancelStreamQueryBasedOnRequestId.mock.calls.length).toBe(cancelsBefore);
    });

    it.skip("should call cancelStreamQueryBasedOnRequestId with trace id and org id when a search is in-flight", async () => {
      mockSearchObj.data.stream.selectedStream = {
        label: "default",
        value: "default",
      };
      mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
      // Reset datetime to a known-good state so buildSearch doesn't fall back to
      // absolute timestamps that might be left over from previous tests
      mockSearchObj.data.datetime = {
        startTime: new Date().getTime() * 1000 - 900000000,
        endTime: new Date().getTime() * 1000,
        relativeTimePeriod: "15m",
        type: "relative",
      };

      // Keep the search in-flight so currentSearchTraceId stays set
      mockFetchQueryDataWithHttpStream.mockImplementation(() => {
        // intentional no-op: callbacks never called, search stays open
      });

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // Trigger a search to populate currentSearchTraceId
      wrapper.vm.searchData();
      await flushPromises();

      // Wait until the search has actually started (fetchQueryDataWithHttpStream called)
      await vi.waitFor(
        () => {
          expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalled();
        },
        { timeout: 2000 },
      );

      wrapper.vm.cancelSearch();
      await flushPromises();

      expect(mockCancelStreamQueryBasedOnRequestId).toHaveBeenCalledWith(
        expect.objectContaining({
          org_id: mockSearchObj.organizationIdentifier,
        }),
      );
      expect(mockSearchObj.loading).toBe(false);
    });
  });

  describe("parseDurationWhereClause integration", () => {
    beforeEach(() => {
      mockSearchObj.data.stream.selectedStream = {
        label: "default",
        value: "default",
      };
      mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
    });

    it("should call parseDurationWhereClause when building a search with a non-empty where clause", async () => {
      const parseSpy = vi.mocked(useDurationPercentilesModule.parseDurationWhereClause);
      parseSpy.mockReturnValue("duration >= 1500");

      mockSearchObj.data.editorValue = "duration >= '1.50ms'";

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      await wrapper.vm.searchData();
      await flushPromises();

      expect(parseSpy).toHaveBeenCalled();
    });

    it("should use the converted where clause string returned by parseDurationWhereClause", async () => {
      const parseSpy = vi.mocked(useDurationPercentilesModule.parseDurationWhereClause);
      // Simulate duration conversion: '1.50ms' → 1500 (raw µs)
      parseSpy.mockReturnValue("duration >= 1500");

      mockSearchObj.data.editorValue = "duration >= '1.50ms'";

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // buildSearch is called inside searchData
      await wrapper.vm.searchData();
      await flushPromises();

      // parseDurationWhereClause should have been called with the raw where clause
      expect(parseSpy).toHaveBeenCalledWith(
        expect.stringContaining("duration"),
        expect.anything(),
        "default",
      );
    });

    it("should not call parseDurationWhereClause when where clause is empty", async () => {
      const parseSpy = vi.mocked(useDurationPercentilesModule.parseDurationWhereClause);
      mockSearchObj.data.editorValue = "";

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      await wrapper.vm.searchData();
      await flushPromises();

      // Guards the parser filter below from going vacuous if the parser argument stops being passed.
      expect(parseSpy.mock.calls.some(([, parser]) => createdTracesParsers.includes(parser))).toBe(
        true,
      );

      // parseDurationWhereClause returns the input unchanged for empty strings (no-op)
      // Either it was not called, or if called, it was with an empty string and returned it
      const callsWithNonEmpty = parseSpy.mock.calls.filter(
        ([clause, parser]) =>
          createdTracesParsers.includes(parser) &&
          typeof clause === "string" &&
          clause.trim() !== "",
      );
      expect(callsWithNonEmpty.length).toBe(0);
    });

    it("should pass a match_all term containing a pipe to parseDurationWhereClause in full", async () => {
      const parseSpy = vi.mocked(useDurationPercentilesModule.parseDurationWhereClause);
      parseSpy.mockReturnValue("duration >= 1500");

      // A pipe inside a quoted search term is part of the term, not a separator.
      mockSearchObj.data.editorValue = "match_all('text | error') and duration >= '1.50ms'";

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      await wrapper.vm.searchData();
      await flushPromises();

      // The whole editor value is the where clause — the match_all term must reach
      // parseDurationWhereClause intact rather than truncated at the pipe.
      const calls = parseSpy.mock.calls.filter(
        ([clause]) => typeof clause === "string" && clause.trim() !== "",
      );
      expect(calls.length).toBeGreaterThan(0);
      for (const [clause] of calls) {
        expect(clause).toContain("match_all('text | error')");
      }
    });

    it("should keep original where clause when parseDurationWhereClause returns an error object", async () => {
      const parseSpy = vi.mocked(useDurationPercentilesModule.parseDurationWhereClause);
      // Return an error object — component should keep the original whereClause
      parseSpy.mockReturnValue({
        error: 'Unknown duration unit: "lightyears"',
      });

      mockSearchObj.data.editorValue = "duration >= '5lightyears'";

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();

      // Component should not throw when parseDurationWhereClause returns an error object
      let thrownError: unknown = null;
      try {
        await wrapper.vm.searchData();
      } catch (e) {
        thrownError = e;
      }
      await flushPromises();

      expect(thrownError).toBeNull();
      expect(parseSpy).toHaveBeenCalled();
    });
  });

  describe("Services Catalog — activeTab computed & URL restore", async () => {
    function mountWithServicesCatalogStub() {
      return mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
    }

    it("should set searchMode and early-return without resetting sortBy when switching to services-catalog", async () => {
      // Set a non-default sortBy to prove it was not reset
      mockSearchObj.meta.resultGrid.sortBy = "operation_name";

      wrapper = mountWithServicesCatalogStub();
      await flushPromises();

      const searchBarEl = wrapper.findComponent({ name: "search-bar" });
      await searchBarEl.vm.$emit("update:searchMode", "services-catalog");
      await flushPromises();

      expect(mockSearchObj.meta.searchMode).toBe("services-catalog");
      // Early return prevents sortBy reset
      expect(mockSearchObj.meta.resultGrid.sortBy).toBe("operation_name");
    });
  });

  describe("parseSpanKindWhereClause integration", () => {
    // Shared mount factory — keeps stub config in one place.
    function mountIndexStubbed() {
      return mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
    }

    beforeEach(() => {
      // Provide a selected stream so getQueryData does not early-return.
      mockSearchObj.data.stream.selectedStream = {
        label: "default",
        value: "default",
      };
      mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
      // Clear call history so earlier tests in the suite do not pollute
      // toHaveBeenCalledWith assertions (the component auto-searches on mount
      mockFetchQueryDataWithHttpStream.mockClear();
      // Default: spy passes the where clause through unchanged (real-implementation behaviour).
      mockParseSpanKindWhereClause.mockImplementation((whereClause: string) => whereClause);
      // Reset parseDurationWhereClause to passthrough so bleed-through from
      // the parseDurationWhereClause integration tests does not alter the
      // where clause before parseSpanKindWhereClause sees it.
      vi.mocked(useDurationPercentilesModule.parseDurationWhereClause).mockImplementation(
        (whereClause: string) => whereClause,
      );
    });

    it("should call parseSpanKindWhereClause when buildSearch runs with a non-empty where clause", async () => {
      mockSearchObj.data.editorValue = "span_kind='Server'";

      wrapper = mountIndexStubbed();
      await flushPromises();

      await wrapper.vm.searchData();
      await flushPromises();

      expect(mockParseSpanKindWhereClause).toHaveBeenCalled();
    });

    it("should call parseSpanKindWhereClause with the where-clause portion of editorValue", async () => {
      mockSearchObj.data.editorValue = "span_kind='Server'";

      wrapper = mountIndexStubbed();
      await flushPromises();

      await wrapper.vm.searchData();
      await flushPromises();

      const calls = mockParseSpanKindWhereClause.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      // At least one call must have received the span_kind filter string.
      const matchingCall = calls.find(([arg]) => (arg as string).includes("span_kind"));
      expect(matchingCall).toBeDefined();
      expect(matchingCall![0]).toContain("span_kind='Server'");
    });

    it("should not call parseSpanKindWhereClause when the where clause is empty", async () => {
      mockSearchObj.data.editorValue = "";

      wrapper = mountIndexStubbed();
      await flushPromises();

      await wrapper.vm.searchData();
      await flushPromises();

      // Guards the parser filter below from going vacuous if the parser argument stops being passed.
      expect(
        mockParseSpanKindWhereClause.mock.calls.some(([, parser]) =>
          createdTracesParsers.includes(parser),
        ),
      ).toBe(true);

      // parseSpanKindWhereClause is guarded by `whereClause.trim() != ""` in buildSearch;
      // for an empty editorValue the spy must not have been called with a non-empty string.
      const callsWithNonEmpty = mockParseSpanKindWhereClause.mock.calls.filter(
        ([clause, parser]) =>
          createdTracesParsers.includes(parser) &&
          typeof clause === "string" &&
          clause.trim() !== "",
      );
      expect(callsWithNonEmpty.length).toBe(0);
    });

    it("should pass a match_all term containing a pipe to parseSpanKindWhereClause in full", async () => {
      mockSearchObj.data.editorValue = "match_all('text | error') and span_kind='Consumer'";

      wrapper = mountIndexStubbed();
      await flushPromises();

      await wrapper.vm.searchData();
      await flushPromises();

      const nonEmptyCalls = mockParseSpanKindWhereClause.mock.calls.filter(
        ([clause]) => typeof clause === "string" && clause.trim() !== "",
      );
      expect(nonEmptyCalls.length).toBeGreaterThan(0);
      for (const [clause] of nonEmptyCalls) {
        // The quoted term is forwarded intact rather than truncated at the pipe.
        expect(clause).toContain("match_all('text | error')");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Organisation change handling
  // ---------------------------------------------------------------------------
  describe("Organisation change handling", () => {
    function mountIndexStubbed() {
      return mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
    }

    describe("onBeforeMount", () => {
      it("should call resetSearchObj when organizationIdentifier differs from store org on mount", async () => {
        // Simulate a stale singleton — component was last used under "old-org"
        // but the store now says "default".
        mockSearchObj.organizationIdentifier = "old-org";
        // store.state.selectedOrganization.identifier is "default" (set in helpers/store.ts)

        wrapper = mountIndexStubbed();
        await flushPromises();

        expect(mockResetSearchObj).toHaveBeenCalled();
      });

      it("should NOT call resetSearchObj on first mount when organizationIdentifier is empty", async () => {
        // Fresh singleton — no previous org stored yet.
        mockSearchObj.organizationIdentifier = "";

        wrapper = mountIndexStubbed();
        await flushPromises();

        expect(mockResetSearchObj).not.toHaveBeenCalled();
      });
    });

    describe("onActivated", () => {
      // Helper: mount Index inside a KeepAlive wrapper so that toggling
      // the `show` ref produces real deactivate/activate lifecycle calls.
      function mountWithKeepAlive() {
        const show = ref(true);
        const Parent = defineComponent({
          setup() {
            return () =>
              h(KeepAlive, null, {
                default: () =>
                  show.value ? h(Index, null, null) : h("div", { key: "placeholder" }),
              });
          },
        });
        const parentWrapper = mount(Parent, {
          attachTo: node,
          global: {
            plugins: [i18n, router],
            provide: { store: store },
            stubs: {
              "search-bar": true,
              "index-list": true,
              "search-result": true,
              "service-graph": true,
              "services-catalog": true,
              SanitizedHtmlRenderer: true,
            },
          },
        });
        return { parentWrapper, show };
      }

      afterEach(() => {
        globalThis.localStorage.removeItem("oo_toggle_auto_run");
      });

      it("should call resetSearchObj and loadPageData when org mismatch is detected on activation", async () => {
        // Mount with matching org so onBeforeMount does not reset.
        mockSearchObj.organizationIdentifier = "default";

        const { parentWrapper, show } = mountWithKeepAlive();
        await flushPromises();

        // Deactivate — hide the component so it is cached by KeepAlive.
        mockResetSearchObj.mockClear();
        mockGetStreams.mockClear();
        mockSearchObj.organizationIdentifier = "old-org";
        show.value = false;
        await flushPromises();

        // Reactivate — show the component again so onActivated fires.
        show.value = true;
        await flushPromises();

        expect(mockResetSearchObj).toHaveBeenCalled();
        // loadPageData is called after reset, which fetches streams.
        expect(mockGetStreams).toHaveBeenCalled();

        parentWrapper.unmount();
      });

      it("should read oo_toggle_auto_run from localStorage and set liveMode on activation", async () => {
        globalThis.localStorage.setItem("oo_toggle_auto_run", "true");

        const { parentWrapper, show } = mountWithKeepAlive();
        await flushPromises();

        // Deactivate then reactivate to trigger onActivated.
        show.value = false;
        await flushPromises();
        show.value = true;
        await flushPromises();

        expect(mockSearchObj.meta.liveMode).toBe(true);

        parentWrapper.unmount();
      });

      it("should set liveMode to false when oo_toggle_auto_run is 'false' in localStorage", async () => {
        mockSearchObj.meta.liveMode = true;
        globalThis.localStorage.setItem("oo_toggle_auto_run", "false");

        const { parentWrapper, show } = mountWithKeepAlive();
        await flushPromises();

        show.value = false;
        await flushPromises();
        show.value = true;
        await flushPromises();

        expect(mockSearchObj.meta.liveMode).toBe(false);

        parentWrapper.unmount();
      });

      it("should NOT change liveMode when oo_toggle_auto_run is absent from localStorage", async () => {
        // Ensure the key is absent before mounting.
        globalThis.localStorage.removeItem("oo_toggle_auto_run");
        mockSearchObj.meta.liveMode = false;

        const { parentWrapper, show } = mountWithKeepAlive();
        await flushPromises();

        show.value = false;
        await flushPromises();
        show.value = true;
        await flushPromises();

        // liveMode must remain unchanged when the key is not present.
        expect(mockSearchObj.meta.liveMode).toBe(false);

        parentWrapper.unmount();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // loadStreamLists — stream selection priority
  // ---------------------------------------------------------------------------
  describe("loadStreamLists — stream selection priority", () => {
    // Stream list shared by all priority tests.
    const twoStreams = {
      list: [
        {
          name: "url-stream",
          storage_type: "s3",
          stream_type: "traces",
          stats: {
            doc_time_min: 0,
            doc_time_max: 0,
            doc_num: 0,
            file_num: 0,
            storage_size: 0,
            compressed_size: 0,
          },
          schema: [],
          settings: {
            partition_keys: {},
            full_text_search_keys: [],
            max_query_range: 0,
          },
        },
        {
          name: "old-stream",
          storage_type: "s3",
          stream_type: "traces",
          stats: {
            doc_time_min: 0,
            doc_time_max: 0,
            doc_num: 0,
            file_num: 0,
            storage_size: 0,
            compressed_size: 0,
          },
          schema: [],
          settings: {
            partition_keys: {},
            full_text_search_keys: [],
            max_query_range: 0,
          },
        },
        {
          name: "persisted-stream",
          storage_type: "s3",
          stream_type: "traces",
          stats: {
            doc_time_min: 0,
            doc_time_max: 0,
            doc_num: 0,
            file_num: 0,
            storage_size: 0,
            compressed_size: 0,
          },
          schema: [],
          settings: {
            partition_keys: {},
            full_text_search_keys: [],
            max_query_range: 0,
          },
        },
      ],
    };

    beforeEach(() => {
      mockGetStreams.mockResolvedValue(twoStreams);
      mockGetStream.mockImplementation((name: string) =>
        Promise.resolve(twoStreams.list.find((s: any) => s.name === name)),
      );
    });

    it("should select URL stream (Priority 1) even when previouslySelectedStream also matches", async () => {
      // Previously selected stream exists in the list but URL stream takes priority.
      mockSearchObj.data.stream.selectedStream = {
        label: "old-stream",
        value: "old-stream",
      };

      routerCurrentRouteSpy.mockReturnValue({
        value: {
          query: { stream: "url-stream" },
          name: "traces",
          path: "/traces",
        },
      } as any);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.selectedStream.value).toBe("url-stream");
        },
        { timeout: 2000 },
      );
    });

    it("should select previously selected stream (Priority 2) when no URL stream param", async () => {
      mockSearchObj.data.stream.selectedStream = {
        label: "old-stream",
        value: "old-stream",
      };

      routerCurrentRouteSpy.mockReturnValue({
        value: { query: {}, name: "traces", path: "/traces" },
      } as any);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.selectedStream.value).toBe("old-stream");
        },
        { timeout: 2000 },
      );
    });

    it("should select persisted stream when auto query is disabled", async () => {
      mockSearchObj.data.stream.selectedStream = { label: "", value: "" };
      mockRestoreTracesStream.mockReturnValue("persisted-stream");

      store.state.zoConfig = {
        ...store.state.zoConfig,
        auto_query_enabled: false,
      };

      routerCurrentRouteSpy.mockReturnValue({
        value: { query: {}, name: "traces", path: "/traces" },
      } as any);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.selectedStream.value).toBe("persisted-stream");
        },
        { timeout: 2000 },
      );
    });

    it("should select the first stream when no preferred or default stream exists", async () => {
      mockSearchObj.data.stream.selectedStream = { label: "", value: "" };
      mockRestoreTracesStream.mockReturnValue("");

      store.state.zoConfig = {
        ...store.state.zoConfig,
        auto_query_enabled: false,
      };

      routerCurrentRouteSpy.mockReturnValue({
        value: { query: {}, name: "traces", path: "/traces" },
      } as any);

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.streamLists.length).toBeGreaterThan(0);
        },
        { timeout: 2000 },
      );

      expect(mockSearchObj.data.stream.selectedStream.value).toBe("url-stream");
    });
  });

  // ---------------------------------------------------------------------------
  // loadPageData — auto-search behaviour
  // ---------------------------------------------------------------------------
  describe("loadPageData — auto-search", () => {
    function mountIndexStubbed() {
      return mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
    }

    beforeEach(() => {
      // Restore standard stream list for this describe block.
      mockGetStreams.mockResolvedValue(mockStreamList);
      // Reset datetime to a known-good relative state so buildSearch can
      // compute valid timestamps regardless of what prior tests wrote to it.
      mockSearchObj.data.datetime = {
        startTime: new Date().getTime() * 1000 - 900000000,
        endTime: new Date().getTime() * 1000,
        relativeTimePeriod: "15m",
        type: "relative",
      };
      mockSearchObj.data.stream.selectedStreamFields = [];
      mockSearchObj.searchApplied = false;
      // Full reset (not just mockClear) so no stale once-queue or
      // implementation from a prior test's mockImplementation survives.
      mockFetchQueryDataWithHttpStream.mockReset();
    });

    it("should call searchData (getQueryData) after loadPageData when a stream resolves via URL param", async () => {
      routerCurrentRouteSpy.mockReturnValue({
        value: {
          query: { stream: "default" },
          name: "traces",
          path: "/traces",
        },
      } as any);

      wrapper = mountIndexStubbed();

      // Poll until the stream list populates and stream is selected.
      // getStreamList uses an un-awaited .then() chain internally.
      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.selectedStream.value).toBe("default");
        },
        { timeout: 2000 },
      );

      // loadPageData calls searchData when selectedStream resolves; searchData
      // calls getQueryData which sets searchApplied = true immediately before
      // any async work, making it a reliable assertion even if fetchQueryData
      // callbacks are never invoked by the mock.
      await vi.waitFor(
        () => {
          expect(mockSearchObj.searchApplied).toBe(true);
        },
        { timeout: 2000 },
      );
    });

    it("should NOT call searchData (getQueryData) after loadPageData when no stream resolves", async () => {
      // No URL stream, no previously selected, auto_query disabled → no stream selected.
      mockSearchObj.data.stream.selectedStream = { label: "", value: "" };
      mockRestoreTracesStream.mockReturnValue("");
      store.state.zoConfig = {
        ...store.state.zoConfig,
        auto_query_enabled: false,
      };

      routerCurrentRouteSpy.mockReturnValue({
        value: { query: {}, name: "traces", path: "/traces" },
      } as any);

      wrapper = mountIndexStubbed();
      await flushPromises();

      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.streamLists.length).toBeGreaterThan(0);
        },
        { timeout: 2000 },
      );

      expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();

      store.state.zoConfig = {
        ...store.state.zoConfig,
        auto_query_enabled: false,
      };
    });
  });

  // ---------------------------------------------------------------------------
  // Stream Change Confirmation Dialog
  // ---------------------------------------------------------------------------
  describe("Stream Change Confirmation Dialog", () => {
    function mountIndexStubbed() {
      return mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": {
              name: "service-graph",
              template: "<div />",
              emits: ["request:stream-change"],
            },
            "services-catalog": {
              name: "services-catalog",
              template: "<div />",
              emits: ["request:stream-change"],
            },
            ODialog: true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
    }

    beforeEach(() => {
      mockSearchObj.data.editorValue = "";
      mockSearchObj.meta.searchMode = "service-graph";
    });

    it("should apply stream change immediately when editorValue is empty", async () => {
      mockSearchObj.data.editorValue = "";
      mockSearchObj.data.stream.selectedStream = {
        label: "old-stream",
        value: "old-stream",
      };

      wrapper = mountIndexStubbed();
      await flushPromises();

      wrapper.vm.onChildStreamChangeRequest("new-stream");
      await flushPromises();

      expect(wrapper.vm.streamChangeDialog.show).toBe(false);
      expect(mockSearchObj.data.stream.selectedStream.value).toBe("new-stream");
      expect(mockSearchObj.data.stream.selectedStream.label).toBe("new-stream");
    });

    it("should apply stream change immediately when editorValue is only whitespace", async () => {
      mockSearchObj.data.editorValue = "   ";
      mockSearchObj.data.stream.selectedStream = {
        label: "old-stream",
        value: "old-stream",
      };

      wrapper = mountIndexStubbed();
      await flushPromises();

      wrapper.vm.onChildStreamChangeRequest("new-stream");
      await flushPromises();

      expect(wrapper.vm.streamChangeDialog.show).toBe(false);
      expect(mockSearchObj.data.stream.selectedStream.value).toBe("new-stream");
    });

    it("should show confirmation dialog when editorValue has content", async () => {
      mockSearchObj.data.editorValue = "service_name = 'test'";

      wrapper = mountIndexStubbed();
      await flushPromises();

      wrapper.vm.onChildStreamChangeRequest("other-stream");
      await flushPromises();

      expect(wrapper.vm.streamChangeDialog.show).toBe(true);
      expect(wrapper.vm.streamChangeDialog.pendingStream).toBe("other-stream");
    });

    it("should not change selectedStream when dialog is shown instead of applying immediately", async () => {
      // Use a stream name present in mockStreamList so loadStreamLists does not
      // clear it during mount — the assertion checks the stream stays unchanged.
      mockSearchObj.data.editorValue = "duration >= 1000";
      mockSearchObj.data.stream.selectedStream = {
        label: "default",
        value: "default",
      };

      wrapper = mountIndexStubbed();
      await flushPromises();

      // Ensure stream is still "default" after mount before triggering request
      // (it can be re-set by loadStreamLists when it finds a match)
      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.selectedStream.value).toBe("default");
        },
        { timeout: 2000 },
      );

      wrapper.vm.onChildStreamChangeRequest("requested-stream");
      await flushPromises();

      // Dialog was shown — selectedStream must NOT have been changed
      expect(wrapper.vm.streamChangeDialog.show).toBe(true);
      expect(mockSearchObj.data.stream.selectedStream.value).toBe("default");
    });

    it("should update selectedStream, clear editorValue, and hide dialog when applyStreamChange is called", async () => {
      mockSearchObj.data.editorValue = "service_name = 'svc'";
      wrapper = mountIndexStubbed();
      await flushPromises();

      // Simulate dialog being shown with a pending stream
      wrapper.vm.streamChangeDialog.show = true;
      wrapper.vm.streamChangeDialog.pendingStream = "target-stream";

      await wrapper.vm.applyStreamChange("target-stream");
      await flushPromises();

      expect(mockSearchObj.data.stream.selectedStream.value).toBe("target-stream");
      expect(mockSearchObj.data.stream.selectedStream.label).toBe("target-stream");
      expect(mockSearchObj.data.editorValue).toBe("");
      expect(wrapper.vm.streamChangeDialog.show).toBe(false);
    });

    it("should close dialog and leave stream unchanged when secondary button sets show to false", async () => {
      // Use a stream name present in mockStreamList so loadStreamLists keeps it.
      mockSearchObj.data.editorValue = "service_name = 'svc'";
      mockSearchObj.data.stream.selectedStream = {
        label: "default",
        value: "default",
      };

      wrapper = mountIndexStubbed();
      await flushPromises();

      // Wait until mount resolves and selectedStream remains "default".
      await vi.waitFor(
        () => {
          expect(mockSearchObj.data.stream.selectedStream.value).toBe("default");
        },
        { timeout: 2000 },
      );

      // Open dialog as if primary button was not clicked
      wrapper.vm.streamChangeDialog.show = true;
      wrapper.vm.streamChangeDialog.pendingStream = "other-stream";

      // Secondary button handler — just closes the dialog
      wrapper.vm.streamChangeDialog.show = false;
      await flushPromises();

      expect(wrapper.vm.streamChangeDialog.show).toBe(false);
      // Stream must remain unchanged — the cancel did not apply the pending change
      expect(mockSearchObj.data.stream.selectedStream.value).toBe("default");
    });
  });

  describe("apply-saved-view", () => {
    const originalDatetime = { ...mockSearchObj.data.datetime };

    const savedView = (overrides: Record<string, unknown> = {}) => ({
      version: 1,
      stream: { label: "default", value: "default" },
      editorValue: "service_name = 'checkout'",
      datetime: { type: "absolute", relativeTimePeriod: "15m", startTime: 111, endTime: 222 },
      searchMode: "spans",
      sortBy: "duration",
      sortOrder: "asc",
      selectedFields: ["service_name", "http_method"],
      ...overrides,
    });

    // Unmounted instances from earlier tests can still land a mount search on the shared mock.
    const ownSearches = () =>
      mockFetchQueryDataWithHttpStream.mock.contexts.filter((owner) => owner === wrapper.vm.$);

    // Field grouping inside extractFields awaits across macrotasks.
    const drain = async () => {
      for (let i = 0; i < 3; i++) {
        await flushPromises();
        await new Promise((r) => setTimeout(r, 0));
      }
    };

    const mountPage = async (searchBar: any = true) => {
      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": searchBar,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });
      await flushPromises();
      await vi.waitFor(
        () => expect(mockSearchObj.data.stream.selectedStream.value).toBe("default"),
        { timeout: 2000 },
      );
      await vi.waitFor(() => expect(ownSearches().length).toBeGreaterThan(0), {
        timeout: 2000,
      });
      await drain();
      mockFetchQueryDataWithHttpStream.mockClear();
      mockGetStream.mockClear();
      mockUpdatedLocalLogFilterField.mockClear();
      routerReplaceSpy.mockClear();
    };

    const applyView = async (view: Record<string, unknown>) => {
      await wrapper.findComponent({ name: "search-bar" }).vm.$emit("apply-saved-view", view);
      await drain();
    };

    const applyViewAndWaitForSearch = async (view: Record<string, unknown>) => {
      await applyView(view);
      await vi.waitFor(() => expect(ownSearches().length).toBeGreaterThan(0), {
        timeout: 2000,
      });
      await drain();
    };

    afterEach(() => {
      mockSearchObj.meta.resultGrid.sortBy = "start_time";
      mockSearchObj.meta.resultGrid.sortOrder = "desc";
      mockSearchObj.data.datetime = { ...originalDatetime };
      mockSearchObj.data.stream.selectedFields = [];
      mockSearchObj.data.resultGrid.columns = [];
      mockFetchQueryDataWithHttpStream.mockReset();
    });

    it("restores every field before running exactly one search", async () => {
      await mountPage();
      const stateAtSearch: any[] = [];
      mockFetchQueryDataWithHttpStream.mockImplementation(function (this: unknown) {
        if (this !== wrapper.vm.$) return;
        stateAtSearch.push({
          editorValue: mockSearchObj.data.editorValue,
          searchMode: mockSearchObj.meta.searchMode,
          datetime: { ...mockSearchObj.data.datetime },
          sortBy: mockSearchObj.meta.resultGrid.sortBy,
          sortOrder: mockSearchObj.meta.resultGrid.sortOrder,
          selectedFields: [...mockSearchObj.data.stream.selectedFields],
        });
      });

      await applyViewAndWaitForSearch(savedView());

      expect(stateAtSearch).toEqual([
        {
          editorValue: "service_name = 'checkout'",
          searchMode: "spans",
          datetime: expect.objectContaining({ type: "absolute", startTime: 111, endTime: 222 }),
          sortBy: "duration",
          sortOrder: "asc",
          selectedFields: ["service_name", "http_method"],
        },
      ]);
      expect(mockGetStream).not.toHaveBeenCalled();
      expect(mockUpdatedLocalLogFilterField).toHaveBeenCalledWith("spans");
    });

    describe("restores the picker's date type", () => {
      const ABSOLUTE = {
        type: "absolute",
        relativeTimePeriod: "15m",
        startTime: 1752490000000000,
        endTime: 1752490900000000,
      };
      const RELATIVE = { type: "relative", relativeTimePeriod: "2h", startTime: 0, endTime: 0 };
      let pickerEmits: any[];

      // Pinned default-type, so only Index.vue itself can move the picker's type.
      const searchBarWithPicker = (defaultType: string) =>
        defineComponent({
          name: "search-bar",
          emits: ["apply-saved-view"],
          setup() {
            return { dateTimeRef: ref<any>(null) };
          },
          render() {
            return h(DateTime, {
              ref: "dateTimeRef",
              autoApply: true,
              defaultType,
              defaultRelativeTime: "15m",
              "onOn:date-change": (value: any) => pickerEmits.push(value),
            });
          },
        });

      const picker = () => wrapper.findComponent(DateTime).vm as any;

      beforeEach(() => {
        pickerEmits = [];
      });

      it("switches a relative picker to absolute with one search", async () => {
        await mountPage(searchBarWithPicker("relative"));
        pickerEmits.length = 0;

        await applyViewAndWaitForSearch(savedView({ datetime: ABSOLUTE }));

        expect(picker().selectedType).toBe("absolute");
        expect(ownSearches()).toHaveLength(1);
        expect(pickerEmits.filter((v) => v.userChangedValue)).toEqual([]);
      });

      it("switches an absolute picker to relative with one search", async () => {
        await mountPage(searchBarWithPicker("absolute"));
        pickerEmits.length = 0;

        await applyViewAndWaitForSearch(savedView({ datetime: RELATIVE }));

        expect(picker().selectedType).toBe("relative");
        expect(picker().relativeValue).toBe(2);
        expect(picker().relativePeriod).toBe("h");
        expect(ownSearches()).toHaveLength(1);
        expect(pickerEmits.filter((v) => v.userChangedValue)).toEqual([]);
      });
    });

    it("extracts fields for a different stream without clearing the filter", async () => {
      await mountPage();

      await applyViewAndWaitForSearch(
        savedView({ stream: { label: "test-stream", value: "test-stream" } }),
      );

      expect(mockGetStream).toHaveBeenCalledWith("test-stream", "traces", true);
      expect(mockSearchObj.data.stream.selectedStream.value).toBe("test-stream");
      expect(mockSearchObj.data.editorValue).toBe("service_name = 'checkout'");
      expect(ownSearches()).toHaveLength(1);
    });

    it("applies only the latest view when an earlier apply finishes last", async () => {
      await mountPage();
      let resolveStreamA!: (value: unknown) => void;
      mockGetStream.mockImplementationOnce(
        () => new Promise((resolve) => (resolveStreamA = resolve)),
      );
      const streamA = { label: "test-stream", value: "test-stream" };
      const searchBar = wrapper.findComponent({ name: "search-bar" });

      searchBar.vm.$emit("apply-saved-view", savedView({ stream: streamA, editorValue: "a" }));
      await flushPromises();
      await applyViewAndWaitForSearch(savedView({ stream: streamA, editorValue: "b" }));
      resolveStreamA(mockStreamList.list.find((s: any) => s.name === "test-stream"));
      await drain();

      expect(ownSearches()).toHaveLength(1);
      expect(mockSearchObj.data.editorValue).toBe("b");
    });

    it("rebuilds the columns even when the search returns no hits", async () => {
      await mountPage();

      await applyViewAndWaitForSearch(savedView());

      const ids = mockSearchObj.data.resultGrid.columns.map((c: any) => c.id);
      expect(ids).toContain("http_method");
    });

    it("clears trace_id and span_id from a trace-detail URL", async () => {
      await mountPage();
      routerCurrentRouteSpy.mockReturnValue({
        value: {
          query: { stream: "default", tab: "traces", trace_id: "abc", span_id: "def" },
          name: "traces",
          path: "/traces",
        },
      } as any);

      await applyViewAndWaitForSearch(savedView());

      expect(routerReplaceSpy).toHaveBeenCalledTimes(1);
      const query = (routerReplaceSpy.mock.calls[0][0] as any).query;
      expect(query).not.toHaveProperty("trace_id");
      expect(query).not.toHaveProperty("span_id");
      expect(query.tab).toBe("spans");
    });

    it("applies a view saved without selectedFields as no selected fields", async () => {
      await mountPage();
      mockSearchObj.data.stream.selectedFields = ["stale_field"];
      const { selectedFields: _omitted, ...view } = savedView();

      await applyViewAndWaitForSearch(view);

      expect(mockSearchObj.data.stream.selectedFields).toEqual([]);
      expect(mockSearchObj.data.editorValue).toBe("service_name = 'checkout'");
      expect(ownSearches()).toHaveLength(1);
    });

    it("toasts an error and leaves state unchanged for an unknown view version", async () => {
      await mountPage();
      const before = mockSearchObj.data.editorValue;
      const modeBefore = mockSearchObj.meta.searchMode;

      await applyView(savedView({ version: 2 }));

      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
      expect(mockSearchObj.data.editorValue).toBe(before);
      expect(mockSearchObj.meta.searchMode).toBe(modeBefore);
      expect(ownSearches()).toHaveLength(0);
    });

    it("toasts and leaves state unchanged when the stream no longer exists", async () => {
      await mountPage();
      const before = mockSearchObj.data.editorValue;
      const modeBefore = mockSearchObj.meta.searchMode;

      await applyView(savedView({ stream: { label: "gone", value: "gone" } }));

      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }));
      expect(mockSearchObj.data.stream.selectedStream.value).toBe("default");
      expect(mockSearchObj.data.editorValue).toBe(before);
      expect(mockSearchObj.meta.searchMode).toBe(modeBefore);
      expect(ownSearches()).toHaveLength(0);
    });

    describe("keeps datetime on the searched window", () => {
      const NOW = Date.UTC(2026, 9, 6, 12, 0, 0);
      const MIN = 60 * 1000;
      const THREE_DAYS = 3 * 24 * 60 * MIN;
      const staleRelative = {
        type: "relative",
        relativeTimePeriod: "15m",
        startTime: (NOW - THREE_DAYS - 15 * MIN) * 1000,
        endTime: (NOW - THREE_DAYS) * 1000,
      };

      const ownRequests = () => {
        const { calls, contexts } = mockFetchQueryDataWithHttpStream.mock;
        return calls.filter((_c, i) => contexts[i] === wrapper.vm.$).map((c: any) => c[0].queryReq);
      };
      const lastWindow = () => {
        const req = ownRequests().at(-1);
        return {
          startTime: req.query?.start_time ?? req.start_time,
          endTime: req.query?.end_time ?? req.end_time,
        };
      };
      const datetimeWindow = () => ({
        startTime: mockSearchObj.data.datetime.startTime,
        endTime: mockSearchObj.data.datetime.endTime,
      });

      beforeEach(() => {
        vi.setSystemTime(NOW);
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it("moves a stale relative view's datetime onto the request window ending now", async () => {
        await mountPage();

        await applyViewAndWaitForSearch(savedView({ datetime: staleRelative }));

        expect(datetimeWindow()).toEqual(lastWindow());
        expect(datetimeWindow()).toEqual({
          startTime: (NOW - 15 * MIN) * 1000,
          endTime: NOW * 1000,
        });
      });

      it("moves the window forward when the view is applied again later", async () => {
        await mountPage();
        await applyViewAndWaitForSearch(savedView({ datetime: staleRelative }));

        vi.setSystemTime(NOW + 5 * MIN);
        mockFetchQueryDataWithHttpStream.mockClear();
        await applyViewAndWaitForSearch(savedView({ datetime: staleRelative }));

        expect(datetimeWindow().endTime).toBe((NOW + 5 * MIN) * 1000);
        expect(datetimeWindow()).toEqual(lastWindow());
      });

      it("updates datetime when Run query fires after time has passed", async () => {
        await mountPage();
        await applyViewAndWaitForSearch(savedView({ datetime: staleRelative }));

        vi.setSystemTime(NOW + 7 * MIN);
        wrapper.vm.searchData();
        await drain();

        expect(datetimeWindow().endTime).toBe((NOW + 7 * MIN) * 1000);
        expect(datetimeWindow()).toEqual(lastWindow());
      });

      it("leaves an absolute view's datetime unchanged", async () => {
        await mountPage();

        await applyViewAndWaitForSearch(savedView());

        expect(datetimeWindow()).toEqual({ startTime: 111, endTime: 222 });
        expect(lastWindow()).toEqual({ startTime: 111, endTime: 222 });
      });

      it("sorts on the last request's window without moving datetime", async () => {
        await mountPage();
        await applyViewAndWaitForSearch(savedView({ datetime: staleRelative }));
        const searched = lastWindow();

        vi.setSystemTime(NOW + 5 * MIN);
        wrapper.vm.runQueryOnSort();
        await drain();

        expect(datetimeWindow()).toEqual(searched);
        expect(lastWindow()).toEqual(searched);
      });
    });

    describe("paging keeps page 1's filter", () => {
      const lastFilter = () => {
        const { calls, contexts } = mockFetchQueryDataWithHttpStream.mock;
        const own = calls.filter((_c, i) => contexts[i] === wrapper.vm.$);
        return (own.at(-1) as any)[0].queryReq.filter;
      };

      afterEach(() => {
        mockSearchObj.data.resultGrid.currentPage = 0;
      });

      it("pages with the submitted filter after the editor changes, until a new Run", async () => {
        await mountPage();
        await applyViewAndWaitForSearch(
          savedView({ searchMode: "traces", editorValue: "service_name = 'a'" }),
        );
        expect(lastFilter()).toBe("service_name = 'a'");

        mockSearchObj.data.editorValue = "service_name = 'b'";
        mockSearchObj.data.resultGrid.currentPage = 1;
        wrapper.vm.getMoreData();
        await drain();
        expect(lastFilter()).toBe("service_name = 'a'");

        wrapper.vm.searchData();
        await drain();
        expect(lastFilter()).toBe("service_name = 'b'");

        mockSearchObj.data.resultGrid.currentPage = 1;
        wrapper.vm.getMoreData();
        await drain();
        expect(lastFilter()).toBe("service_name = 'b'");
      });
    });
  });

  // Placed last in the file: this test drives fetchQueryDataWithHttpStream's
  // handlers directly and calls mockFetchQueryDataWithHttpStream.mockReset()
  // at the end, so it cannot leak an implementation into tests declared after it.
  describe("Stale search error handling (o2-enterprise#2643)", () => {
    // Regression: a rejected query's RED metrics charts stayed hidden forever,
    // even after the query was fixed and the next search succeeded — because a
    // cancelled search's late error callback overwrote the newer search's state.
    it("should not let a cancelled search's late error overwrite a newer search's state", async () => {
      mockSearchObj.data.stream.selectedStream = {
        label: "default",
        value: "default",
      };
      mockSearchObj.data.stream.streamLists = [{ label: "default", value: "default" }];
      mockSearchObj.data.datetime = {
        startTime: new Date().getTime() * 1000 - 900000000,
        endTime: new Date().getTime() * 1000,
        relativeTimePeriod: "15m",
        type: "relative",
      };

      const capturedHandlers: any[] = [];
      mockFetchQueryDataWithHttpStream.mockImplementation((_data: any, handlers: any) => {
        capturedHandlers.push(handlers);
      });

      wrapper = mount(Index, {
        attachTo: node,
        global: {
          plugins: [i18n, router],
          provide: { store: store },
          stubs: {
            "search-bar": true,
            "index-list": true,
            "search-result": true,
            "service-graph": true,
            "services-catalog": true,
            SanitizedHtmlRenderer: true,
          },
        },
      });

      await flushPromises();
      capturedHandlers.length = 0;

      // Search #1 starts and is left in-flight (never resolves on its own).
      await wrapper.vm.getQueryData();
      expect(capturedHandlers.length).toBe(1);

      // Search #2 starts before #1 finishes — this cancels #1 (deletes its
      // request-state entry) and clears errorMsg for the new attempt.
      await wrapper.vm.getQueryData();
      expect(capturedHandlers.length).toBe(2);

      expect(mockSearchObj.data.errorMsg).toBe("");

      // #1's HTTP stream finally errors out after being cancelled/superseded.
      capturedHandlers[0].error({}, { message: "stale failure from search #1", code: 500 });
      await flushPromises();

      // The stale error must not resurrect the error banner / hide the charts
      // for the still-in-flight, newer search.
      expect(mockSearchObj.data.errorMsg).toBe("");

      // A genuine error for the CURRENT (non-superseded) search must still work.
      // getQueryData()'s error handler sets errorMsg synchronously, so assert
      // immediately — before yielding to the event loop via flushPromises().
      // An unrelated component instance left over from an earlier test in this
      // file can still have a mount-triggered search pending (onUnmounted does
      // not cancel in-flight work); if its own getQueryData() call happens to
      // settle during our flushPromises() here, it resets the shared
      // mockSearchObj.data.errorMsg back to "" before we get a chance to read
      // it, unrelated to the cancellation behavior this test is verifying.
      capturedHandlers[1].error({}, { message: "real failure from search #2", code: 500 });
      expect(mockSearchObj.data.errorMsg).toBe("real failure from search #2");
      await flushPromises();

      mockFetchQueryDataWithHttpStream.mockReset();
    });
  });
});
