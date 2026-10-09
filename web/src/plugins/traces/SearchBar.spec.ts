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
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { ref, computed, reactive } from "vue";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// ---------------------------------------------------------------------------
// Module-level mocks — vi.mock is hoisted by Vitest; never use vi.doMock here
// ---------------------------------------------------------------------------

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));

vi.mock("@/services/product_analytics", () => ({
  default: { track: vi.fn() },
}));

vi.mock("@/aws-exports", () => ({
  default: { isCloud: "false", isEnterprise: "true" },
}));

// getImageURL is called by the metricsIcon computed; stub to avoid asset loading.
// Use importOriginal so mergeRoutes (used by router.ts) is not lost.
vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getImageURL: (path: string) => `/mocked/${path}`,
    b64EncodeUnicode: (s: string) => btoa(s),
    b64EncodeStandard: (s: string) => btoa(s),
    useLocalTraceFilterField: () => ({ value: null }),
    timestampToTimezoneDate: () => "2024-01-01",
  };
});

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn().mockResolvedValue({
      name: "default",
      schema: [{ name: "timestamp" }, { name: "trace_id" }],
    }),
  }),
}));

vi.mock("@/composables/useSuggestions", () => ({
  default: () => ({
    autoCompleteData: ref({
      query: "",
      cursorIndex: 0,
      fieldValues: {},
      popup: { open: vi.fn() },
    }),
    autoCompleteKeywords: ref(["SELECT", "FROM", "WHERE"]),
    effectiveKeywords: ref([]),
    getSuggestions: vi.fn(),
    updateFieldKeywords: vi.fn(),
    updateStreamKeywords: vi.fn(),
  }),
}));

// useParser is dynamically imported inside onBeforeUnmount; stub the module.
vi.mock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: vi.fn().mockResolvedValue({
      astify: vi.fn().mockReturnValue({ from: [{ table: "default" }] }),
    }),
  }),
}));

const { downloadFileMock, toastMock } = vi.hoisted(() => ({
  downloadFileMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@/utils/dom", async (importOriginal) => ({
  ...((await importOriginal()) as any),
  downloadFile: downloadFileMock,
}));

vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...((await importOriginal()) as any),
  toast: toastMock,
}));

const {
  mockSavedViewsGet,
  mockSavedViewsPost,
  mockSavedViewsPut,
  mockSavedViewsDelete,
  mockGetViewDetail,
  mockConfirm,
} = vi.hoisted(() => ({
  mockSavedViewsGet: vi.fn(),
  mockSavedViewsPost: vi.fn(),
  mockSavedViewsPut: vi.fn(),
  mockSavedViewsDelete: vi.fn(),
  mockGetViewDetail: vi.fn(),
  mockConfirm: vi.fn(),
}));

vi.mock("@/services/saved_views", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      get: mockSavedViewsGet,
      post: mockSavedViewsPost,
      put: mockSavedViewsPut,
      delete: mockSavedViewsDelete,
      getViewDetail: mockGetViewDetail,
    },
  });
});

vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: mockConfirm }),
}));

// Read at setup time, so set it before mounting.
const breakpointState = vi.hoisted(() => ({ lgUp: true }));

vi.mock("@/composables/useBreakpoint", () => ({
  default: () => ({
    isMobile: { value: false },
    isTablet: { value: !breakpointState.lgUp },
    isDesktop: { value: breakpointState.lgUp },
    mdUp: { value: true },
    lgUp: { value: breakpointState.lgUp },
  }),
}));

// ---------------------------------------------------------------------------
// Shared mutable searchObj — reset to a fresh copy in every beforeEach so
// that mutations in one test cannot affect the next.
// ---------------------------------------------------------------------------

const makeSearchObj = () =>
  reactive({
    organizationIdentifier: "default",
    runQuery: false,
    loading: false,
    loadingStream: false,
    searchApplied: false,
    config: {},
    meta: {
      showFields: true,
      showQuery: true,
      showHistogram: true,
      showDetailTab: false,
      showTraceDetails: false,
      sqlMode: false,
      searchMode: "traces" as "traces" | "spans" | "service-graph" | "services-catalog",
      queryEditorPlaceholderFlag: true,
      metricsRangeFilters: new Map<string, { panelTitle: string; start: number; end: number }>(),
      resultGrid: {
        wrapCells: false,
        manualRemoveFields: false,
        rowsPerPage: 25,
        showPagination: false,
        sortBy: "start_time",
        sortOrder: "desc",
        chartInterval: "1 second",
        chartKeyFormat: "HH:mm:ss",
        navigation: { currentRowIndex: 0 },
      },
      scrollInfo: {},
      serviceColors: {},
      redirectedFromLogs: false,
      searchApplied: false,
      serviceGraphVisualizationType: "tree" as "tree" | "graph",
      serviceGraphLayoutType: "horizontal" as string,
    },
    data: {
      query: "",
      editorValue: "",
      advanceFiltersQuery: "",
      parsedQuery: {},
      errorMsg: "",
      errorCode: 0,
      errorDetail: "",
      additionalErrorMsg: "",
      stream: {
        streamLists: [],
        selectedStream: { label: "default", value: "default" },
        selectedStreamFields: [
          { name: "timestamp" },
          { name: "trace_id" },
          { name: "span_id" },
          { name: "service_name" },
        ],
        selectedFields: [] as string[],
        filterField: "",
        addToFilter: "",
        functions: [],
        filters: [] as any[],
        fieldValues: {} as Record<
          string,
          {
            isLoading: boolean;
            values: any[];
            selectedValues: string[];
            size: number;
            isOpen: boolean;
            searchKeyword: string;
          }
        >,
      },
      resultGrid: {
        currentDateTime: new Date(),
        currentPage: 0,
        columns: [] as any[],
      },
      queryPayload: {} as any,
      transforms: [] as any[],
      queryResults: {
        hits: [
          {
            trace_id: "trace-1",
            span_id: "span-1",
            service_name: "svc-a",
            timestamp: 1700000000000,
          },
          {
            trace_id: "trace-2",
            span_id: "span-2",
            service_name: "svc-b",
            timestamp: 1700000001000,
          },
        ],
      },
      sortedQueryResults: [] as any[],
      streamResults: [] as any[],
      histogram: {} as any,
      datetime: {
        startTime: Date.now() - 900_000,
        endTime: Date.now(),
        relativeTimePeriod: "15m",
        type: "relative",
        queryRangeRestrictionInHour: 0,
        queryRangeRestrictionMsg: "",
      },
      searchAround: { indexTimestamp: 0, size: 10, histogramHide: false },
      traceDetails: {
        selectedTrace: null,
        traceId: "",
        spanList: [],
        isLoadingTraceMeta: false,
        isLoadingTraceDetails: false,
        selectedSpanId: "",
        expandedSpans: [] as string[],
        showSpanDetails: false,
        selectedLogStreams: [] as string[],
      },
    },
  });

// This variable is reassigned in beforeEach; the mock factory reads it at
// call-time so every mount gets the fresh instance.
let searchObjInstance = makeSearchObj();

vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    get searchObj() {
      return searchObjInstance;
    },
    tracesShareURL: computed(() => "http://localhost/traces?shared=1"),
    resetSearchObj: vi.fn(),
    updatedLocalLogFilterField: vi.fn(),
    getUrlQueryParams: vi.fn().mockReturnValue({}),
    copyTracesUrl: vi.fn(),
    buildQueryDetails: vi.fn(),
    navigateToLogs: vi.fn(),
    formatTracesMetaData: vi.fn().mockReturnValue([]),
  }),
}));

// ---------------------------------------------------------------------------
// Import the component AFTER all vi.mock declarations.
// ---------------------------------------------------------------------------
import SearchBar from "@/plugins/traces/SearchBar.vue";
import SavedViewsListDialog from "@/components/savedViews/SavedViewsListDialog.vue";
import { useToolbarPins } from "@/composables/useToolbarPins";

// ---------------------------------------------------------------------------
// DOM anchor node required by attachTo
// ---------------------------------------------------------------------------
const appNode = document.createElement("div");
appNode.setAttribute("id", "app");
document.body.appendChild(appNode);

// ---------------------------------------------------------------------------
// Stubs shared across all mounts — one place to update when the template changes
// ---------------------------------------------------------------------------
const sharedStubs = {
  DateTime: {
    template: '<div data-test="logs-search-bar-date-time-dropdown" />',
    props: [
      "autoApply",
      "defaultType",
      "defaultAbsoluteTime",
      "defaultRelativeTime",
      "queryRangeRestrictionInHour",
      "queryRangeRestrictionMsg",
    ],
    emits: ["on:date-change", "on:timezone-change"],
    setup() {
      return {
        setRelativeTime: vi.fn(),
        setAbsoluteTime: vi.fn(),
        setDateType: vi.fn(),
        refresh: vi.fn(),
      };
    },
  },
  CodeQueryEditor: {
    template: '<div data-test="code-query-editor-stub" />',
    props: ["editorId", "query", "keywords", "functions", "language", "class"],
    emits: ["update:query", "run-query", "focus", "blur"],
    setup() {
      return {
        setValue: vi.fn(),
        getCursorIndex: vi.fn().mockReturnValue(0),
        triggerAutoComplete: vi.fn(),
      };
    },
  },
  SyntaxGuide: {
    template: '<div data-test="traces-search-bar-syntax-guide-btn" class="syntax-guide-stub" />',
    props: ["sqlmode", "menuItem"],
  },
  ShareButton: {
    template: '<button data-test="logs-search-bar-share-link-btn" class="share-btn-stub" />',
    props: ["url", "buttonClass", "buttonSize"],
  },
  // OToggleGroup: stub to render inline without Reka UI context requirements
  OToggleGroup: {
    name: "OToggleGroup",
    template:
      '<div class="o-toggle-group-stub logs-visualize-toggle button-group" v-bind="$attrs"><slot /></div>',
    props: ["modelValue"],
    emits: ["update:modelValue"],
  },
  // OToggleGroupItem: stub that emits the value up to the parent OToggleGroup
  OToggleGroupItem: {
    name: "OToggleGroupItem",
    template: `<button
      class="o-toggle-group-item-stub"
      :class="{ selected: isSelected }"
      :data-state="isSelected ? 'on' : 'off'"
      v-bind="$attrs"
      @click="$parent.$emit('update:modelValue', value)"
    ><slot name="icon-left" /><slot /></button>`,
    props: ["value", "size"],
    computed: {
      isSelected() {
        return this.$parent?.modelValue === this.value;
      },
    },
  },
  // ODropdown stub to render portal content inline
  ODropdown: {
    name: "ODropdown",
    template: '<div class="o-dropdown-stub" v-bind="$attrs"><slot name="trigger" /><slot /></div>',
    emits: ["update:open"],
    props: ["open", "side", "align", "sideOffset"],
  },
  ODropdownItem: {
    name: "ODropdownItem",
    template:
      '<div class="o-dropdown-item-stub" v-bind="$attrs" @click="$emit(\'select\')"><slot name="icon-left" /><slot /><slot name="icon-right" /></div>',
    emits: ["select"],
  },
  ODropdownGroup: {
    template: '<div v-bind="$attrs"><slot name="label-action" /><slot /></div>',
  },
  ODropdownSeparator: { template: "<hr />" },
};

// ---------------------------------------------------------------------------
// Mount factory — eliminates per-test stub duplication
// ---------------------------------------------------------------------------
function mountSearchBar(props: Record<string, unknown> = {}): VueWrapper {
  return mount(SearchBar, {
    attachTo: "#app",
    props: {
      fieldValues: {},
      isLoading: false,
      ...props,
    },
    global: {
      plugins: [store, router],
      stubs: sharedStubs,
    },
  });
}

// jsdom reports zero widths, so the pinned saved-views group would always fall back into More.
function mockToolbarWidth(width: number) {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return { width: this.classList.contains("justify-between") ? width : 0 } as DOMRect;
  });
}

// Minimal RFC 4180 reader so the test checks column alignment independently of the writer.
function csvToRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && csv[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------
describe("SearchBar", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    // Fresh searchObj per test — mutations cannot bleed across tests.
    searchObjInstance = makeSearchObj();

    // Spy on router so updateDateTime's route guard does not early-return.
    vi.spyOn(router, "currentRoute", "get").mockReturnValue({
      value: {
        name: "traces",
        query: { stream: "default", org_identifier: "default" },
      },
    } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  describe("smoke render", () => {
    it("should mount without errors", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".search-bar-component").exists()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("tab toggle visibility", () => {
    it("should render tab toggle buttons on enterprise", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      // OToggleGroup replaces the old .button-group.logs-visualize-toggle div.
      // All four modes render as in-page tabs — Service Graph and Services
      // Catalog switch views inline on the Traces page (`?tab=`).
      expect(wrapper.find(".o-toggle-group-stub").exists()).toBe(true);
      expect(wrapper.find('[data-test="traces-search-mode-spans-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="traces-search-mode-traces-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="traces-service-graph-toggle"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="traces-search-mode-services-catalog-btn"]').exists()).toBe(
        true,
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("search mode toggle emits (update:searchMode)", () => {
    it("should emit update:searchMode with 'service-graph' when the service-graph button is clicked", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      const sgBtn = wrapper.find('[data-test="traces-service-graph-toggle"]');
      expect(sgBtn.exists()).toBe(true);
      await sgBtn.trigger("click");

      expect(wrapper.emitted("update:searchMode")).toBeTruthy();
      expect(wrapper.emitted("update:searchMode")![0]).toEqual(["service-graph"]);
    });

    it("should emit update:searchMode with 'services-catalog' when the services-catalog button is clicked", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      const scBtn = wrapper.find('[data-test="traces-search-mode-services-catalog-btn"]');
      expect(scBtn.exists()).toBe(true);
      await scBtn.trigger("click");

      expect(wrapper.emitted("update:searchMode")).toBeTruthy();
      expect(wrapper.emitted("update:searchMode")![0]).toEqual(["services-catalog"]);
    });
  });

  // -------------------------------------------------------------------------
  describe("searchMode conditional rendering", () => {
    it("should show search controls when searchMode is 'traces'", async () => {
      searchObjInstance.meta.searchMode = "traces";
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="traces-search-bar-reset-filters-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="logs-search-bar-date-time-dropdown"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="logs-search-bar-refresh-btn"]').exists()).toBe(true);
    });

    it("should hide search controls when searchMode is 'service-graph'", async () => {
      searchObjInstance.meta.searchMode = "service-graph";
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="traces-search-bar-reset-filters-btn"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-test="logs-search-bar-date-time-dropdown"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="logs-search-bar-refresh-btn"]').exists()).toBe(false);
    });

    it("should hide search controls when searchMode is 'services-catalog'", async () => {
      searchObjInstance.meta.searchMode = "services-catalog";
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="traces-search-bar-reset-filters-btn"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-test="logs-search-bar-date-time-dropdown"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="logs-search-bar-refresh-btn"]').exists()).toBe(false);
    });

    it("should re-show controls when searchMode changes back to 'traces'", async () => {
      searchObjInstance.meta.searchMode = "service-graph";
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="logs-search-bar-refresh-btn"]').exists()).toBe(false);

      searchObjInstance.meta.searchMode = "traces";
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-test="logs-search-bar-refresh-btn"]').exists()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("per-mode toolbars", () => {
    it("should show the Service Graph toolbar (DateTime, refresh, view toggles) in service-graph mode", async () => {
      searchObjInstance.meta.searchMode = "service-graph";
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="service-graph-date-time-picker"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="service-graph-refresh-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="service-graph-tree-view-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="service-graph-graph-view-btn"]').exists()).toBe(true);
      // Services Catalog toolbar is not co-mounted
      expect(wrapper.find('[data-test="services-catalog-date-time-picker"]').exists()).toBe(false);
    });

    it("should show the Services Catalog toolbar (DateTime) in services-catalog mode", async () => {
      searchObjInstance.meta.searchMode = "services-catalog";
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="services-catalog-date-time-picker"]').exists()).toBe(true);
      // Service Graph toolbar is not co-mounted
      expect(wrapper.find('[data-test="service-graph-date-time-picker"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="service-graph-refresh-btn"]').exists()).toBe(false);
    });

    it("should emit service-graph-refresh when the graph refresh button is clicked", async () => {
      searchObjInstance.meta.searchMode = "service-graph";
      wrapper = mountSearchBar();
      await flushPromises();

      await wrapper.find('[data-test="service-graph-refresh-btn"]').trigger("click");

      expect(wrapper.emitted("service-graph-refresh")).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  describe("search mode toggle (update:searchMode)", () => {
    it("should emit update:searchMode with 'traces' when Traces button is clicked", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      const tracesBtn = wrapper.find('[data-test="traces-search-mode-traces-btn"]');
      expect(tracesBtn.exists()).toBe(true);
      await tracesBtn.trigger("click");

      expect(wrapper.emitted("update:searchMode")).toBeTruthy();
      expect(wrapper.emitted("update:searchMode")![0]).toEqual(["traces"]);
    });

    it("should emit update:searchMode with 'spans' when Spans button is clicked", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      const spansBtn = wrapper.find('[data-test="traces-search-mode-spans-btn"]');
      expect(spansBtn.exists()).toBe(true);
      await spansBtn.trigger("click");

      expect(wrapper.emitted("update:searchMode")).toBeTruthy();
      expect(wrapper.emitted("update:searchMode")![0]).toEqual(["spans"]);
    });

    it("should apply 'selected' class to Traces button when searchMode is 'traces'", async () => {
      searchObjInstance.meta.searchMode = "traces";
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="traces-search-mode-traces-btn"]').classes()).toContain(
        "selected",
      );
      expect(wrapper.find('[data-test="traces-search-mode-spans-btn"]').classes()).not.toContain(
        "selected",
      );
    });

    it("should apply 'selected' class to Spans button when searchMode is 'spans'", async () => {
      searchObjInstance.meta.searchMode = "spans";
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="traces-search-mode-spans-btn"]').classes()).toContain(
        "selected",
      );
      expect(wrapper.find('[data-test="traces-search-mode-traces-btn"]').classes()).not.toContain(
        "selected",
      );
    });

    it("should apply 'selected' class to Services Catalog button when searchMode is 'services-catalog'", async () => {
      searchObjInstance.meta.searchMode = "services-catalog";
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper.find('[data-test="traces-search-mode-services-catalog-btn"]').classes(),
      ).toContain("selected");
      expect(wrapper.find('[data-test="traces-search-mode-traces-btn"]').classes()).not.toContain(
        "selected",
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("RED Metrics toggle", () => {
    it("should render the metrics toggle inside the More menu, not on the toolbar", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      const menuItem = wrapper.find('[data-test="traces-search-bar-menu-metrics-btn"]');
      expect(menuItem.exists()).toBe(true);
      expect(menuItem.text()).toContain("traces.redMetrics");
      expect(
        menuItem.find('[data-test="traces-search-bar-show-metrics-toggle-btn"]').exists(),
      ).toBe(true);
      expect(
        wrapper.findAll('[data-test="traces-search-bar-show-metrics-toggle-btn"]'),
      ).toHaveLength(1);
    });

    it("should toggle showHistogram when the menu item is selected", async () => {
      searchObjInstance.meta.showHistogram = true;
      wrapper = mountSearchBar();
      await flushPromises();

      const item = wrapper
        .findAllComponents({ name: "ODropdownItem" })
        .find((c) => c.attributes("data-test") === "traces-search-bar-menu-metrics-btn")!;
      item.vm.$emit("select", new Event("select"));
      await flushPromises();
      expect(searchObjInstance.meta.showHistogram).toBe(false);

      item.vm.$emit("select", new Event("select"));
      await flushPromises();
      expect(searchObjInstance.meta.showHistogram).toBe(true);
    });

    it("should flip showHistogram exactly once when the switch itself is clicked", async () => {
      searchObjInstance.meta.showHistogram = true;
      wrapper = mountSearchBar();
      await flushPromises();

      await wrapper
        .find(
          '[data-test="traces-search-bar-menu-metrics-btn"] [data-test="traces-search-bar-show-metrics-toggle-btn"]',
        )
        .trigger("click");
      await flushPromises();

      expect(searchObjInstance.meta.showHistogram).toBe(false);
    });

    it("should keep the Syntax Guide in the More menu", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="traces-search-bar-syntax-guide-btn"]').exists()).toBe(true);
    });

    it.each(["service-graph", "services-catalog"] as const)(
      "should hide the metrics toggle in %s mode",
      async (mode) => {
        searchObjInstance.meta.searchMode = mode;
        wrapper = mountSearchBar();
        await flushPromises();

        expect(wrapper.find('[data-test="traces-search-bar-menu-metrics-btn"]').exists()).toBe(
          false,
        );
      },
    );
  });

  // -------------------------------------------------------------------------
  describe("RED Metrics pin", () => {
    const { isPinned, togglePin } = useToolbarPins("traces");
    let widthSpy: ReturnType<typeof mockToolbarWidth>;

    const pinBtn = () => wrapper.find('[data-test="traces-search-bar-menu-pin-metrics-btn"]');
    const pinnedBtn = () => wrapper.find('[data-test="traces-search-bar-metrics-pinned-btn"]');
    const savedViewsGroup = () => wrapper.find('[data-test="traces-search-bar-saved-views"]');
    const menuItem = () => wrapper.find('[data-test="traces-search-bar-menu-metrics-btn"]');
    const resetPins = () => {
      if (isPinned("histogram")) togglePin("histogram");
      if (!isPinned("savedViews")) togglePin("savedViews");
    };
    const useWidth = (width: number) => {
      widthSpy.mockRestore();
      widthSpy = mockToolbarWidth(width);
    };

    beforeEach(() => {
      mockSavedViewsGet.mockResolvedValue({ data: { views: [] } });
      searchObjInstance.meta.searchMode = "spans";
      breakpointState.lgUp = true;
      resetPins();
      widthSpy = mockToolbarWidth(1600);
    });

    afterEach(() => {
      widthSpy.mockRestore();
      breakpointState.lgUp = true;
      resetPins();
    });

    it("offers a pin in the More item and no toolbar copy by default", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(pinBtn().exists()).toBe(true);
      expect(pinBtn().attributes("title")).toBe("search.pinToToolbar");
      expect(pinBtn().findComponent({ name: "OIcon" }).props("name")).toBe("keep-outline");
      expect(pinnedBtn().exists()).toBe(false);
    });

    it("pins without selecting the menu item, and unpins", async () => {
      searchObjInstance.meta.showHistogram = true;
      wrapper = mountSearchBar();
      await flushPromises();

      const item = wrapper
        .findAllComponents({ name: "ODropdownItem" })
        .find((c) => c.attributes("data-test") === "traces-search-bar-menu-metrics-btn")!;
      await pinBtn().trigger("click");
      await flushPromises();

      expect(item.emitted("select")).toBeUndefined();
      expect(searchObjInstance.meta.showHistogram).toBe(true);
      expect(pinnedBtn().exists()).toBe(true);
      expect(pinBtn().attributes("title")).toBe("search.unpinFromToolbar");
      expect(pinBtn().findComponent({ name: "OIcon" }).props("name")).toBe("keep");
      expect(menuItem().exists()).toBe(true);

      await pinBtn().trigger("click");
      await flushPromises();
      expect(pinnedBtn().exists()).toBe(false);
    });

    it("flips showHistogram from the pinned button and its switch exactly once", async () => {
      searchObjInstance.meta.showHistogram = true;
      togglePin("histogram");
      wrapper = mountSearchBar();
      await flushPromises();

      await pinnedBtn().trigger("click");
      await flushPromises();
      expect(searchObjInstance.meta.showHistogram).toBe(false);

      await pinnedBtn().find('[role="switch"]').trigger("click");
      await flushPromises();
      expect(searchObjInstance.meta.showHistogram).toBe(true);
    });

    it("keeps a single show-metrics toggle data-test while pinned", async () => {
      togglePin("histogram");
      wrapper = mountSearchBar();
      await flushPromises();

      expect(pinnedBtn().exists()).toBe(true);
      expect(
        wrapper.findAll('[data-test="traces-search-bar-show-metrics-toggle-btn"]'),
      ).toHaveLength(1);
    });

    it.each(["service-graph", "services-catalog"] as const)(
      "hides the pinned copy on the %s tab",
      async (mode) => {
        searchObjInstance.meta.searchMode = mode;
        togglePin("histogram");
        wrapper = mountSearchBar();
        await flushPromises();

        expect(pinnedBtn().exists()).toBe(false);
      },
    );

    it("shows the pinned copy below lg without a width budget", async () => {
      useWidth(0);
      breakpointState.lgUp = false;
      togglePin("histogram");
      wrapper = mountSearchBar();
      await flushPromises();

      expect(pinnedBtn().exists()).toBe(true);
      expect(savedViewsGroup().exists()).toBe(true);
    });

    it("falls back to More at a narrow lg width", async () => {
      useWidth(300);
      togglePin("histogram");
      wrapper = mountSearchBar();
      await flushPromises();

      expect(pinnedBtn().exists()).toBe(false);
      expect(menuItem().exists()).toBe(true);
    });

    it.each([
      [359, false],
      [360, true],
    ])(
      "admits the pinned copy at width %i only when its full width fits: %s",
      async (width, shown) => {
        togglePin("savedViews");
        togglePin("histogram");
        useWidth(width);
        wrapper = mountSearchBar();
        await flushPromises();

        expect(pinnedBtn().exists()).toBe(shown);
        expect(menuItem().exists()).toBe(true);
      },
    );

    it("keeps RED Metrics before Saved Views when only one fits", async () => {
      useWidth(400);
      wrapper = mountSearchBar();
      await flushPromises();
      expect(savedViewsGroup().exists()).toBe(true);

      togglePin("histogram");
      await flushPromises();
      expect(pinnedBtn().exists()).toBe(true);
      expect(savedViewsGroup().exists()).toBe(false);
      expect(wrapper.find('[data-test="traces-search-bar-menu-saved-views-group"]').exists()).toBe(
        true,
      );
    });

    it("shrinks the toggle labels for the pinned RED Metrics width", async () => {
      togglePin("savedViews");
      togglePin("histogram");
      useWidth(800);
      wrapper = mountSearchBar();
      await flushPromises();

      expect(pinnedBtn().exists()).toBe(true);
      expect(wrapper.find('[data-test="traces-search-mode-spans-btn"]').text()).not.toContain(
        "traces.spansTab",
      );

      togglePin("histogram");
      await flushPromises();
      expect(wrapper.find('[data-test="traces-search-mode-spans-btn"]').text()).toContain(
        "traces.spansTab",
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("Drill down button", () => {
    const applySearch = () => {
      searchObjInstance.searchApplied = true;
      searchObjInstance.data.errorMsg = "";
      searchObjInstance.data.stream.streamLists = [{ label: "default", value: "default" }] as any;
    };

    it.each(["spans", "traces"] as const)(
      "should render right after the tab group in %s mode once a search is applied",
      async (mode) => {
        searchObjInstance.meta.searchMode = mode;
        applySearch();
        wrapper = mountSearchBar();
        await flushPromises();

        const btn = wrapper.find('[data-test="insights-button"]');
        expect(btn.exists()).toBe(true);
        expect(btn.text().includes("traces.drillDown")).toBe(
          !(wrapper.vm as any).shouldHideToggleText,
        );
        const toggleGroup = wrapper.find(".o-toggle-group-stub").element;
        expect(toggleGroup.nextElementSibling).toBe(btn.element);
      },
    );

    it.each(["service-graph", "services-catalog"] as const)(
      "should be hidden in %s mode",
      async (mode) => {
        searchObjInstance.meta.searchMode = mode;
        applySearch();
        wrapper = mountSearchBar();
        await flushPromises();

        expect(wrapper.find('[data-test="insights-button"]').exists()).toBe(false);
      },
    );

    it("should be hidden before a search is applied", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="insights-button"]').exists()).toBe(false);
    });

    it("should be hidden when the search errored", async () => {
      applySearch();
      searchObjInstance.data.errorMsg = "boom";
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="insights-button"]').exists()).toBe(false);
    });

    it("should be hidden while streams are loading", async () => {
      applySearch();
      searchObjInstance.loadingStream = true;
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="insights-button"]').exists()).toBe(false);
    });

    it("should be hidden while a search is loading", async () => {
      applySearch();
      searchObjInstance.loading = true;
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="insights-button"]').exists()).toBe(false);
    });

    it("should be hidden when the org has no trace streams", async () => {
      applySearch();
      searchObjInstance.data.stream.streamLists = [];
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="insights-button"]').exists()).toBe(false);
    });

    it("should be hidden when no stream is selected", async () => {
      applySearch();
      searchObjInstance.data.stream.selectedStream = { label: "", value: "" };
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="insights-button"]').exists()).toBe(false);
    });

    it("should emit drill-down when clicked", async () => {
      applySearch();
      wrapper = mountSearchBar();
      await flushPromises();

      await wrapper.find('[data-test="insights-button"]').trigger("click");
      expect(wrapper.emitted("drill-down")).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("error-only toggle", () => {
    it("should not render the error-only toggle in SearchBar (moved to SearchResult)", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="traces-search-bar-error-only-toggle-btn"]').exists()).toBe(
        false,
      );
    });

    it("should emit error-only-toggled with true when onErrorOnlyToggle(true) is called", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      (wrapper.vm as any).onErrorOnlyToggle(true);
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("error-only-toggled")).toBeTruthy();
      expect(wrapper.emitted("error-only-toggled")![0]).toEqual([true]);
    });

    it("should emit error-only-toggled with false when onErrorOnlyToggle(false) is called", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      (wrapper.vm as any).onErrorOnlyToggle(false);
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("error-only-toggled")).toBeTruthy();
      expect(wrapper.emitted("error-only-toggled")![0]).toEqual([false]);
    });
  });

  // -------------------------------------------------------------------------
  describe("reset filters", () => {
    it("should render the reset filters button", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="traces-search-bar-reset-filters-btn"]').exists()).toBe(true);
    });

    it("should clear editorValue and advanceFiltersQuery when clicked", async () => {
      searchObjInstance.data.editorValue = "some query";
      searchObjInstance.data.advanceFiltersQuery = "some filter";
      wrapper = mountSearchBar();
      await flushPromises();

      await wrapper.find('[data-test="traces-search-bar-reset-filters-btn"]').trigger("click");

      expect(searchObjInstance.data.editorValue).toBe("");
      expect(searchObjInstance.data.advanceFiltersQuery).toBe("");
    });

    it("should clear selectedValues and searchKeyword on all fieldValues entries when clicked", async () => {
      searchObjInstance.data.stream.fieldValues = {
        service_name: {
          isLoading: false,
          values: [],
          selectedValues: ["svc-a"],
          size: 10,
          isOpen: false,
          searchKeyword: "keyword",
        },
        status_code: {
          isLoading: false,
          values: [],
          selectedValues: ["200"],
          size: 10,
          isOpen: false,
          searchKeyword: "",
        },
      };
      wrapper = mountSearchBar();
      await flushPromises();

      await wrapper.find('[data-test="traces-search-bar-reset-filters-btn"]').trigger("click");

      expect(searchObjInstance.data.stream.fieldValues.service_name.selectedValues).toEqual([]);
      expect(searchObjInstance.data.stream.fieldValues.service_name.searchKeyword).toBe("");
      expect(searchObjInstance.data.stream.fieldValues.status_code.selectedValues).toEqual([]);
    });

    it("should clear metricsRangeFilters Map when clicked", async () => {
      searchObjInstance.meta.metricsRangeFilters.set("panel-1", {
        panelTitle: "CPU",
        start: 1000,
        end: 2000,
      });
      wrapper = mountSearchBar();
      await flushPromises();

      expect(searchObjInstance.meta.metricsRangeFilters.size).toBe(1);

      await wrapper.find('[data-test="traces-search-bar-reset-filters-btn"]').trigger("click");

      expect(searchObjInstance.meta.metricsRangeFilters.size).toBe(0);
    });

    it("should emit filters-reset when the reset button is clicked", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      await wrapper.find('[data-test="traces-search-bar-reset-filters-btn"]').trigger("click");

      expect(wrapper.emitted("filters-reset")).toBeTruthy();
      expect(wrapper.emitted("filters-reset")).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("run query button", () => {
    it("should render the run query button", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="logs-search-bar-refresh-btn"]').exists()).toBe(true);
    });

    it("should emit searchdata when clicked and searchObj.loading is false", async () => {
      searchObjInstance.loading = false;
      wrapper = mountSearchBar({ isLoading: false });
      await flushPromises();

      await wrapper.find('[data-test="logs-search-bar-refresh-btn"]').trigger("click");

      expect(wrapper.emitted("searchdata")).toBeTruthy();
      expect(wrapper.emitted("searchdata")).toHaveLength(1);
    });

    it("should show cancel button when isLoading prop is true on enterprise", async () => {
      wrapper = mountSearchBar({ isLoading: true });
      await flushPromises();

      expect(wrapper.find('[data-test="traces-search-bar-cancel-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="logs-search-bar-refresh-btn"]').exists()).toBe(false);
    });

    it("should not emit searchdata when searchObj.loading is true", async () => {
      searchObjInstance.loading = true;
      wrapper = mountSearchBar({ isLoading: false });
      await flushPromises();

      await wrapper.find('[data-test="logs-search-bar-refresh-btn"]').trigger("click");

      // The searchData method guards on loading == false
      expect(wrapper.emitted("searchdata")).toBeFalsy();
    });

    it("should emit searchdata when searchData() is called directly", async () => {
      searchObjInstance.loading = false;
      wrapper = mountSearchBar();
      await flushPromises();

      (wrapper.vm as any).searchData();
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("searchdata")).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  describe("download button", () => {
    it("should render the download button", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      // OButton: the download button uses title="Export Traces" (no .download-logs-btn class)
      expect(wrapper.find('[title="traces.exportTraces"]').exists()).toBe(true);
    });

    it("should be disabled when queryResults.hits is empty", async () => {
      searchObjInstance.data.queryResults.hits = [];
      wrapper = mountSearchBar();
      await flushPromises();

      // OButton uses native HTML disabled attribute (not a CSS "disabled" class)
      const btn = wrapper.find('[title="traces.exportTraces"]');
      expect(btn.exists()).toBe(true);
      expect(btn.attributes("disabled")).toBeDefined();
    });

    it("should be enabled when queryResults.hits has entries", async () => {
      searchObjInstance.data.queryResults.hits = [
        {
          trace_id: "t-1",
          span_id: "s-1",
          service_name: "svc",
          timestamp: 1700000000000,
        },
      ];
      wrapper = mountSearchBar();
      await flushPromises();

      // OButton: when enabled, native disabled attribute should be absent
      const btn = wrapper.find('[title="traces.exportTraces"]');
      expect(btn.exists()).toBe(true);
      expect(btn.attributes("disabled")).toBeUndefined();
    });

    it("should export a traces-mode hit with a services object as aligned CSV", async () => {
      downloadFileMock.mockReturnValue(true);
      searchObjInstance.data.queryResults.hits = [
        {
          trace_id: "t-1",
          services: { "svc-a": { count: 1, duration: 0 }, "svc-b": { count: 2, duration: 5 } },
          spans: [3, 1],
          zo_sql_timestamp: 1700000000000,
        },
        { trace_id: "t-2", services: { "svc-c": { count: 1, duration: 2 } }, extra: "a,b" },
      ];
      wrapper = mountSearchBar();
      await flushPromises();

      (wrapper.vm as any).downloadLogs();

      expect(downloadFileMock).toHaveBeenCalledTimes(1);
      const [fileName, csv, mimeType] = downloadFileMock.mock.calls[0];
      expect(fileName).toBe("traces-data.csv");
      expect(mimeType).toBe("text/csv");
      const rows = csvToRows(csv);
      expect(rows[0]).toEqual(["trace_id", "services", "spans", "zo_sql_timestamp", "extra"]);
      expect(rows).toHaveLength(3);
      rows.forEach((row) => expect(row).toHaveLength(rows[0].length));
      expect(rows[1][1]).toBe(
        JSON.stringify({ "svc-a": { count: 1, duration: 0 }, "svc-b": { count: 2, duration: 5 } }),
      );
      expect(rows[2][4]).toBe("a,b");
      expect(toastMock).not.toHaveBeenCalled();
    });

    it("should not download or throw when there are no hits", async () => {
      searchObjInstance.data.queryResults.hits = [];
      wrapper = mountSearchBar();
      await flushPromises();

      expect(() => (wrapper.vm as any).downloadLogs()).not.toThrow();
      expect(downloadFileMock).not.toHaveBeenCalled();
      expect(toastMock).not.toHaveBeenCalled();
    });

    it("should show an error toast when the download fails", async () => {
      downloadFileMock.mockReturnValue(false);
      wrapper = mountSearchBar();
      await flushPromises();

      (wrapper.vm as any).downloadLogs();

      expect(downloadFileMock).toHaveBeenCalledTimes(1);
      expect(toastMock).toHaveBeenCalledWith({
        message: "traces.exportTracesFailed",
        variant: "error",
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("structural elements", () => {
    it("should render the date-time dropdown", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="logs-search-bar-date-time-dropdown"]').exists()).toBe(true);
    });

    it("should render the syntax guide (SQL mode toggle)", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="traces-search-bar-syntax-guide-btn"]').exists()).toBe(true);
    });

    it("should render the share link button", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="logs-search-bar-share-link-btn"]').exists()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("query editor visibility (showQuery)", () => {
    it("should render the query editor when showQuery is true", async () => {
      searchObjInstance.meta.showQuery = true;
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="code-query-editor-stub"]').exists()).toBe(true);
    });

    it("should hide the query editor when showQuery is false", async () => {
      searchObjInstance.meta.showQuery = false;
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="code-query-editor-stub"]').exists()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("updateDateTime", () => {
    it("should update datetime with absolute times when relativeTimePeriod is absent", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      const startTime = Date.now() - 3_600_000;
      const endTime = Date.now();

      await (wrapper.vm as any).updateDateTime({
        startTime,
        endTime,
        relativeTimePeriod: undefined,
        userChangedValue: false,
      });

      expect(searchObjInstance.data.datetime.startTime).toBe(startTime);
      expect(searchObjInstance.data.datetime.endTime).toBe(endTime);
      expect(searchObjInstance.data.datetime.type).toBe("absolute");
    });

    it("should update datetime with relative period when relativeTimePeriod is provided", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      await (wrapper.vm as any).updateDateTime({
        startTime: 0,
        endTime: 0,
        relativeTimePeriod: "1h",
        userChangedValue: false,
      });

      expect(searchObjInstance.data.datetime.relativeTimePeriod).toBe("1h");
      expect(searchObjInstance.data.datetime.type).toBe("relative");
    });

    it("should not update datetime when route name is not 'traces'", async () => {
      vi.spyOn(router, "currentRoute", "get").mockReturnValue({
        value: { name: "logs", query: {} },
      } as any);

      wrapper = mountSearchBar();
      await flushPromises();

      const originalStart = searchObjInstance.data.datetime.startTime;

      await (wrapper.vm as any).updateDateTime({
        startTime: 9_999_999,
        endTime: 9_999_999,
        relativeTimePeriod: undefined,
        userChangedValue: false,
      });

      expect(searchObjInstance.data.datetime.startTime).toBe(originalStart);
    });

    it("should emit searchdata on a user-driven relative date change in live mode", async () => {
      store.state.zoConfig = { auto_query_enabled: true };
      searchObjInstance.meta.liveMode = true;

      wrapper = mountSearchBar();
      await flushPromises();

      // Control `prev` so isDatetimeChanged() is true for the "1h" change.
      searchObjInstance.data.datetime.relativeTimePeriod = "15m";

      await (wrapper.vm as any).updateDateTime({
        startTime: 0,
        endTime: 0,
        relativeTimePeriod: "1h",
        valueType: "relative",
        userChangedValue: true,
      });

      expect(wrapper.emitted("searchdata")).toBeTruthy();
      expect(wrapper.emitted("searchdata")).toHaveLength(1);
    });

    it("should NOT emit searchdata for a programmatic date change (userChangedValue false) in live mode", async () => {
      store.state.zoConfig = { auto_query_enabled: true };
      searchObjInstance.meta.liveMode = true;

      wrapper = mountSearchBar();
      await flushPromises();

      searchObjInstance.data.datetime.relativeTimePeriod = "15m";

      await (wrapper.vm as any).updateDateTime({
        startTime: 0,
        endTime: 0,
        relativeTimePeriod: "1h",
        valueType: "relative",
        userChangedValue: false,
      });

      expect(wrapper.emitted("searchdata")).toBeFalsy();
    });
  });

  // -------------------------------------------------------------------------
  describe("updateTimezone", () => {
    it("should emit onChangeTimezone when updateTimezone is called", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      (wrapper.vm as any).updateTimezone();
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted("onChangeTimezone")).toBeTruthy();
      expect(wrapper.emitted("onChangeTimezone")).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("setEditorValue", () => {
    it("should call setValue on queryEditorRef with the given string", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      const mockSetValue = vi.fn();
      (wrapper.vm as any).queryEditorRef = { setValue: mockSetValue };

      (wrapper.vm as any).setEditorValue("SELECT * FROM traces");

      expect(mockSetValue).toHaveBeenCalledWith("SELECT * FROM traces");
    });

    it("should not throw when queryEditorRef is null", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      (wrapper.vm as any).queryEditorRef = null;

      expect(() => (wrapper.vm as any).setEditorValue("query")).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  describe("addToFilter watcher (query building)", () => {
    it("should append filter with 'and' when the pipe section already has content", async () => {
      searchObjInstance.data.editorValue = "SELECT * FROM traces | WHERE a='1'";
      wrapper = mountSearchBar();
      await flushPromises();

      const mockSetValue = vi.fn();
      (wrapper.vm as any).queryEditorRef = { setValue: mockSetValue };

      searchObjInstance.data.stream.addToFilter = "b='2'";
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(searchObjInstance.data.stream.addToFilter).toBe("");
      expect(mockSetValue).toHaveBeenCalled();
    });

    it("should set filter directly when the pipe section is empty", async () => {
      searchObjInstance.data.editorValue = "SELECT * FROM traces | ";
      wrapper = mountSearchBar();
      await flushPromises();

      const mockSetValue = vi.fn();
      (wrapper.vm as any).queryEditorRef = { setValue: mockSetValue };

      searchObjInstance.data.stream.addToFilter = "field='val'";
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(searchObjInstance.data.stream.addToFilter).toBe("");
      expect(searchObjInstance.data.editorValue).toContain("field='val'");
    });

    it('should transform "field=\'null\'" to "field is null" in the filter', async () => {
      searchObjInstance.data.editorValue = "";
      wrapper = mountSearchBar();
      await flushPromises();

      const mockSetValue = vi.fn();
      (wrapper.vm as any).queryEditorRef = { setValue: mockSetValue };

      searchObjInstance.data.stream.addToFilter = "field='null'";
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(searchObjInstance.data.editorValue).toContain("field is null");
    });

    it("should use the filter as the full query when there is no existing query and no pipe", async () => {
      searchObjInstance.data.editorValue = "";
      wrapper = mountSearchBar();
      await flushPromises();

      const mockSetValue = vi.fn();
      (wrapper.vm as any).queryEditorRef = { setValue: mockSetValue };

      searchObjInstance.data.stream.addToFilter = "service_name='svc-a'";
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(searchObjInstance.data.editorValue).toBe("service_name='svc-a'");
    });

    it("should not duplicate the filter when the same condition already exists in the query", async () => {
      searchObjInstance.data.editorValue = "span_status='ERROR'";
      wrapper = mountSearchBar();
      await flushPromises();

      const mockSetValue = vi.fn();
      (wrapper.vm as any).queryEditorRef = { setValue: mockSetValue };

      searchObjInstance.data.stream.addToFilter = "span_status='ERROR'";
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(searchObjInstance.data.editorValue).toBe("span_status='ERROR'");
    });

    it("should replace an existing condition for the same field rather than appending", async () => {
      searchObjInstance.data.editorValue = "span_status='ERROR'";
      wrapper = mountSearchBar();
      await flushPromises();

      const mockSetValue = vi.fn();
      (wrapper.vm as any).queryEditorRef = { setValue: mockSetValue };

      searchObjInstance.data.stream.addToFilter = "span_status='OK'";
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(searchObjInstance.data.editorValue).toBe("span_status='OK'");
    });

    it("should append with 'and' when the filter field does not exist in the current query", async () => {
      searchObjInstance.data.editorValue = "service_name='svc-a'";
      wrapper = mountSearchBar();
      await flushPromises();

      const mockSetValue = vi.fn();
      (wrapper.vm as any).queryEditorRef = { setValue: mockSetValue };

      searchObjInstance.data.stream.addToFilter = "span_status='ERROR'";
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(searchObjInstance.data.editorValue).toBe(
        "service_name='svc-a' and span_status='ERROR'",
      );
    });

    it("should append filter when the filter expression has no parseable field name", async () => {
      // A bare keyword without an operator (=, !=, >=, etc.) causes
      // getFieldFromExpression to return null. With the new logic the caller
      // treats a null field as "no replacement possible" and falls through to
      // the append path, producing: <existing> and <filter>.
      searchObjInstance.data.editorValue = "service_name='svc-a'";
      wrapper = mountSearchBar();
      await flushPromises();

      const mockSetValue = vi.fn();
      (wrapper.vm as any).queryEditorRef = { setValue: mockSetValue };

      // "some bare keyword" has no operator — getFieldFromExpression returns null
      searchObjInstance.data.stream.addToFilter = "some bare keyword";
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(searchObjInstance.data.editorValue).toBe("service_name='svc-a' and some bare keyword");
    });
  });

  // -------------------------------------------------------------------------
  describe("tooltips on icon-only buttons", () => {
    it("should have the analysis tooltip inside the Drill down button", async () => {
      searchObjInstance.searchApplied = true;
      searchObjInstance.data.stream.streamLists = [{ label: "default", value: "default" }] as any;
      wrapper = mountSearchBar();
      await flushPromises();

      const tooltip = wrapper
        .find('[data-test="insights-button"]')
        .findComponent({ name: "OTooltip" });
      expect(tooltip.exists()).toBe(true);
      expect(tooltip.props("content")).toBe("volumeInsights.analyzeTooltipTraces");
    });
  });

  // -------------------------------------------------------------------------
  // [auto-generated] Props
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  describe("props", () => {
    it("should accept updated fieldValues without errors", async () => {
      wrapper = mountSearchBar({ fieldValues: {} });
      await flushPromises();

      await wrapper.setProps({
        fieldValues: {
          service_name: {
            values: [{ key: "svc-a", count: "10" }],
            selectedValues: [],
          },
        },
      });

      expect(wrapper.props("fieldValues")).toHaveProperty("service_name");
    });

    it("should switch to cancel button when isLoading changes to true on enterprise", async () => {
      wrapper = mountSearchBar({ isLoading: false });
      await flushPromises();

      expect(wrapper.find('[data-test="logs-search-bar-refresh-btn"]').exists()).toBe(true);

      await wrapper.setProps({ isLoading: true });
      await flushPromises();

      expect(wrapper.find('[data-test="traces-search-bar-cancel-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="logs-search-bar-refresh-btn"]').exists()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("applyFilters function", () => {
    beforeEach(async () => {
      // Setup auto-search enabled + live mode
      store.state.zoConfig = { auto_query_enabled: true };
      searchObjInstance.meta.liveMode = true;

      wrapper = mountSearchBar();
      await flushPromises();
    });

    it("should emit searchdata when skipSearch=false and auto-search enabled", async () => {
      const testTerms = ["service_name = 'test-service'"];

      wrapper.vm.applyFilters(testTerms, false);

      expect(wrapper.emitted("searchdata")).toHaveLength(1);
      expect(searchObjInstance.data.editorValue).toContain("service_name = 'test-service'");
    });

    it("should not emit searchdata when skipSearch=true", async () => {
      const testTerms = ["duration > 100ms"];

      wrapper.vm.applyFilters(testTerms, true);

      expect(wrapper.emitted("searchdata")).toBeUndefined();
      expect(searchObjInstance.data.editorValue).toContain("duration > 100ms");
    });

    it("should preserve existing behavior when skipSearch parameter omitted", async () => {
      const testTerms = ["span_status = 'ERROR'"];

      wrapper.vm.applyFilters(testTerms);

      expect(wrapper.emitted("searchdata")).toHaveLength(1);
      expect(searchObjInstance.data.editorValue).toContain("span_status = 'ERROR'");
    });

    it("should not emit searchdata when auto-search disabled", async () => {
      store.state.zoConfig.auto_query_enabled = false;
      const testTerms = ["service_name = 'test'"];

      wrapper.vm.applyFilters(testTerms, false);

      expect(wrapper.emitted("searchdata")).toBeUndefined();
    });

    it("should not emit searchdata when live mode is OFF", async () => {
      searchObjInstance.meta.liveMode = false;
      const testTerms = ["http_method = 'POST'"];

      wrapper.vm.applyFilters(testTerms, false);

      expect(wrapper.emitted("searchdata")).toBeUndefined();
    });
  });

  describe("saved views", () => {
    const tracesView = {
      view_id: "t1",
      view_name: "checkout errors",
      view_type: "traces",
      org_id: "default",
    };
    const tracesView2 = {
      view_id: "t2",
      view_name: "Alpha latency",
      view_type: "traces",
      org_id: "default",
    };
    const logsView = { view_id: "l1", view_name: "logs view" };

    const { isPinned, togglePin } = useToolbarPins("traces");
    let widthSpy: ReturnType<typeof mockToolbarWidth>;

    const expectedData = () => ({
      version: 1,
      stream: { label: "default", value: "default" },
      editorValue: "span_status = 'ERROR'",
      datetime: { type: "relative", relativeTimePeriod: "1h", startTime: 10, endTime: 20 },
      searchMode: "spans",
      sortBy: "duration",
      sortOrder: "asc",
      selectedFields: ["service_name", "duration"],
    });

    beforeEach(() => {
      mockSavedViewsGet.mockResolvedValue({ data: { views: [tracesView, logsView] } });
      mockSavedViewsPost.mockResolvedValue({ status: 200, data: { view_id: "n1" } });
      mockSavedViewsPut.mockResolvedValue({ status: 200, data: {} });
      mockSavedViewsDelete.mockResolvedValue({ status: 200, data: {} });
      mockConfirm.mockResolvedValue(true);

      searchObjInstance.meta.searchMode = "spans";
      searchObjInstance.data.editorValue = "span_status = 'ERROR'";
      searchObjInstance.data.datetime = {
        startTime: 10,
        endTime: 20,
        relativeTimePeriod: "1h",
        type: "relative",
        queryRangeRestrictionInHour: 0,
        queryRangeRestrictionMsg: "",
      };
      searchObjInstance.meta.resultGrid.sortBy = "duration";
      searchObjInstance.meta.resultGrid.sortOrder = "asc";
      searchObjInstance.data.stream.selectedFields = ["service_name", "duration"];

      breakpointState.lgUp = true;
      if (!isPinned("savedViews")) togglePin("savedViews");
      widthSpy = mockToolbarWidth(1600);
      localStorage.removeItem("savedViews");
    });

    afterEach(() => {
      widthSpy.mockRestore();
      breakpointState.lgUp = true;
      if (!isPinned("savedViews")) togglePin("savedViews");
    });

    it("lists only traces views", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="traces-search-bar-saved-views-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="traces-saved-view-apply-t1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="traces-saved-view-apply-l1"]').exists()).toBe(false);
    });

    it("marks the saved-views button as a menu with a drop-down caret, as logs does", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      const icons = wrapper
        .find('[data-test="traces-search-bar-saved-views-btn"]')
        .findAllComponents({ name: "OIcon" })
        .map((c) => c.props("name"));
      expect(icons).toEqual(["saved-search", "arrow-drop-down"]);
    });

    it("opens the save dialog from the save button beside the menu, as logs does", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      const saveBtn = wrapper.find('[data-test="traces-search-bar-saved-views-create-btn"]');
      expect(saveBtn.exists()).toBe(true);
      await saveBtn.trigger("click");
      expect((wrapper.vm as any).saveViewDialogOpen).toBe(true);
    });

    it("separates the menu and the save button with a divider", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      const group = wrapper.find('[data-test="traces-search-bar-saved-views"]');
      const separator = group.findComponent({ name: "OSeparator" });
      expect(separator.exists()).toBe(true);
      expect(separator.props("vertical")).toBe(true);
    });

    it("is as tall as Reset and More: a hairline border around 1.625rem children", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      const group = wrapper.find('[data-test="traces-search-bar-saved-views"]');
      expect(group.classes()).toContain("border");
      expect(group.classes()).toContain("p-0");
      expect(group.find('[data-test="traces-search-bar-saved-views-btn"]').classes()).toContain(
        "h-6.5",
      );
      expect(
        group.find('[data-test="traces-search-bar-saved-views-create-btn"]').classes(),
      ).toContain("size-6.5");
      for (const neighbour of [
        "traces-search-bar-reset-filters-btn",
        "traces-search-bar-more-menu-btn",
      ]) {
        expect(wrapper.find(`[data-test="${neighbour}"]`).classes()).toContain("h-7");
      }
    });

    it.each(["service-graph", "services-catalog"])("is hidden on the %s tab", async (mode) => {
      searchObjInstance.meta.searchMode = mode as any;
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="traces-search-bar-saved-views-btn"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="traces-search-bar-saved-views-create-btn"]').exists()).toBe(
        false,
      );
    });

    it("save serialises exactly the view fields", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      (wrapper.vm as any).newViewName = "checkout errors";
      await (wrapper.vm as any).saveAsNewView();

      expect(mockSavedViewsPost).toHaveBeenCalledTimes(1);
      expect(mockSavedViewsPost.mock.calls[0][1]).toEqual({
        view_name: "checkout errors",
        view_type: "traces",
        data: expectedData(),
      });
    });

    it("apply emits apply-saved-view with the stored data", async () => {
      mockGetViewDetail.mockResolvedValue({ data: { ...tracesView, data: expectedData() } });
      wrapper = mountSearchBar();
      await flushPromises();

      await wrapper.find('[data-test="traces-saved-view-apply-t1"]').trigger("click");
      await flushPromises();

      expect(mockGetViewDetail).toHaveBeenCalledWith(expect.any(String), "t1");
      expect(wrapper.emitted("apply-saved-view")?.[0]).toEqual([expectedData()]);
    });

    it("emits only the latest view when an earlier detail resolves last", async () => {
      let resolveA!: (value: unknown) => void;
      mockGetViewDetail
        .mockReturnValueOnce(new Promise((resolve) => (resolveA = resolve)))
        .mockResolvedValueOnce({ data: { data: { ...expectedData(), editorValue: "view-b" } } });
      wrapper = mountSearchBar();
      await flushPromises();

      const applyA = (wrapper.vm as any).applySavedView({ view_id: "a" });
      const applyB = (wrapper.vm as any).applySavedView({ view_id: "b" });
      await applyB;
      resolveA({ data: { data: { ...expectedData(), editorValue: "view-a" } } });
      await applyA;
      await flushPromises();

      const emitted = wrapper.emitted("apply-saved-view") ?? [];
      expect(emitted).toHaveLength(1);
      expect((emitted[0][0] as any).editorValue).toBe("view-b");
    });

    it("update overwrites the view with the current state", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      await wrapper.find('[data-test="traces-saved-view-update-t1"]').trigger("click");
      await flushPromises();

      expect(mockSavedViewsPut).toHaveBeenCalledWith(expect.any(String), "t1", {
        view_name: "checkout errors",
        data: expectedData(),
      });
      expect(wrapper.emitted("apply-saved-view")).toBeUndefined();
    });

    it("pinned dropdown has no delete action", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="traces-saved-view-update-t1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="traces-saved-view-delete-t1"]').exists()).toBe(false);
    });

    it("pinned dropdown lists favourites first, then by name, with a star on favourites", async () => {
      mockSavedViewsGet.mockResolvedValue({ data: { views: [tracesView, tracesView2, logsView] } });
      localStorage.setItem("savedViews", JSON.stringify({ t1: tracesView }));
      wrapper = mountSearchBar();
      await flushPromises();

      const items = wrapper
        .findAll('[data-test^="traces-saved-view-apply-"]')
        .map((item) => item.attributes("data-test"));
      expect(items).toEqual(["traces-saved-view-apply-t1", "traces-saved-view-apply-t2"]);
      const iconName = (id: string) =>
        wrapper
          .findAllComponents({ name: "OIcon" })
          .find((c) => c.attributes("data-test") === `traces-saved-view-icon-${id}`)
          ?.props("name");
      expect(iconName("t1")).toBe("star");
      expect(iconName("t2")).toBe("saved-search");
    });

    it("pinned dropdown shows a loading row while the list loads", async () => {
      mockSavedViewsGet.mockReturnValue(new Promise(() => {}));
      wrapper = mountSearchBar();
      await flushPromises();

      expect(wrapper.find('[data-test="traces-saved-views-menu-loading"]').exists()).toBe(true);
      expect(wrapper.findComponent(SavedViewsListDialog).props("loading")).toBe(true);
    });

    describe("in the More menu", () => {
      const moreGroup = () =>
        wrapper.find('[data-test="traces-search-bar-menu-saved-views-group"]');
      const toolbarGroup = () => wrapper.find('[data-test="traces-search-bar-saved-views"]');
      const dialog = () => wrapper.findComponent(SavedViewsListDialog);

      it("shows the saved-views group with List, Create and the pin button", async () => {
        wrapper = mountSearchBar();
        await flushPromises();

        expect(moreGroup().exists()).toBe(true);
        expect(
          moreGroup().find('[data-test="traces-search-bar-menu-list-saved-views-btn"]').exists(),
        ).toBe(true);
        expect(
          moreGroup().find('[data-test="traces-search-bar-menu-create-saved-view-btn"]').exists(),
        ).toBe(true);
        expect(
          moreGroup().find('[data-test="traces-search-bar-menu-pin-saved-views-btn"]').exists(),
        ).toBe(true);
        expect(moreGroup().find('[data-test="traces-saved-view-apply-t1"]').exists()).toBe(false);
      });

      it("opens the saved-views dialog from List saved views", async () => {
        wrapper = mountSearchBar();
        await flushPromises();
        expect(dialog().props("open")).toBe(false);

        await moreGroup()
          .find('[data-test="traces-search-bar-menu-list-saved-views-btn"]')
          .trigger("click");

        expect(dialog().props("open")).toBe(true);
        expect(dialog().props("views")).toEqual([tracesView]);
      });

      it("opens the saved-views dialog from the pinned dropdown's Manage item", async () => {
        wrapper = mountSearchBar();
        await flushPromises();

        await toolbarGroup().find('[data-test="traces-saved-view-manage"]').trigger("click");

        expect(dialog().props("open")).toBe(true);
      });

      it("deletes from the dialog through the confirmation flow while unpinned", async () => {
        togglePin("savedViews");
        wrapper = mountSearchBar();
        await flushPromises();
        expect(toolbarGroup().exists()).toBe(false);

        dialog().vm.$emit("delete", tracesView);
        await flushPromises();

        expect(mockConfirm).toHaveBeenCalledTimes(1);
        expect(mockSavedViewsDelete).toHaveBeenCalledWith(expect.any(String), "t1");
      });

      it("applies and updates views from the dialog", async () => {
        mockGetViewDetail.mockResolvedValue({ data: { ...tracesView, data: expectedData() } });
        wrapper = mountSearchBar();
        await flushPromises();

        dialog().vm.$emit("apply", tracesView);
        await flushPromises();
        expect(wrapper.emitted("apply-saved-view")?.[0]).toEqual([expectedData()]);

        dialog().vm.$emit("update", tracesView);
        await flushPromises();
        expect(mockSavedViewsPut).toHaveBeenCalledWith(expect.any(String), "t1", {
          view_name: "checkout errors",
          data: expectedData(),
        });
      });

      it("refetches the saved views each time the dialog opens", async () => {
        wrapper = mountSearchBar();
        await flushPromises();
        const callsBefore = mockSavedViewsGet.mock.calls.length;
        mockSavedViewsGet.mockResolvedValue({
          data: { views: [tracesView, tracesView2, logsView] },
        });

        await wrapper
          .find('[data-test="traces-search-bar-menu-list-saved-views-btn"]')
          .trigger("click");
        await flushPromises();

        expect(mockSavedViewsGet.mock.calls.length).toBe(callsBefore + 1);
        expect(dialog().props("open")).toBe(true);
        expect(dialog().props("views")).toEqual([tracesView, tracesView2]);

        dialog().vm.$emit("update:open", false);
        await flushPromises();
        expect(dialog().props("open")).toBe(false);
        await wrapper
          .find('[data-test="traces-search-bar-menu-list-saved-views-btn"]')
          .trigger("click");
        await flushPromises();

        expect(mockSavedViewsGet.mock.calls.length).toBe(callsBefore + 2);
        expect(dialog().props("open")).toBe(true);
      });

      it("prunes favourites deleted elsewhere once the list loads, freeing the cap", async () => {
        const favourites: Record<string, unknown> = {
          l1: { ...logsView, org_id: "default" },
        };
        for (let i = 0; i < 9; i++) {
          favourites[`gone${i}`] = { ...tracesView, view_id: `gone${i}` };
        }
        favourites.t1 = tracesView;
        localStorage.setItem("savedViews", JSON.stringify(favourites));
        wrapper = mountSearchBar();
        await flushPromises();

        expect(dialog().props("favoriteIds")).toEqual(["t1"]);
        expect(Object.keys(JSON.parse(localStorage.getItem("savedViews") || "{}"))).toEqual([
          "l1",
          "t1",
        ]);

        dialog().vm.$emit("toggle-favorite", tracesView2, false);
        await flushPromises();
        expect(dialog().props("favoriteIds")).toEqual(["t1", "t2"]);
      });

      it("keeps every favourite when the list fails to load", async () => {
        mockSavedViewsGet.mockRejectedValue(new Error("boom"));
        const gone = { ...tracesView, view_id: "gone" };
        localStorage.setItem("savedViews", JSON.stringify({ t1: tracesView, gone }));
        wrapper = mountSearchBar();
        await flushPromises();

        expect(dialog().props("loading")).toBe(false);
        expect(dialog().props("views")).toEqual([]);
        expect(dialog().props("favoriteIds")).toEqual(["t1", "gone"]);
        expect(JSON.parse(localStorage.getItem("savedViews") || "{}")).toEqual({
          t1: tracesView,
          gone,
        });
      });

      it("reports a successful delete even when localStorage rejects the write", async () => {
        localStorage.setItem("savedViews", JSON.stringify({ t1: tracesView }));
        wrapper = mountSearchBar();
        await flushPromises();
        const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
          throw new DOMException("quota", "QuotaExceededError");
        });

        dialog().vm.$emit("delete", tracesView);
        await flushPromises();
        setItem.mockRestore();

        expect(mockSavedViewsDelete).toHaveBeenCalledWith(expect.any(String), "t1");
        expect(dialog().props("favoriteIds")).toEqual([]);
        expect(toastMock).toHaveBeenCalledWith({
          message: "search.viewDeletedSuccessfully",
          variant: "success",
        });
      });

      it("passes the traces data-test prefix, views and favourites to the dialog", async () => {
        localStorage.setItem(
          "savedViews",
          JSON.stringify({ t1: tracesView, l1: { ...logsView, org_id: "default" } }),
        );
        wrapper = mountSearchBar();
        await flushPromises();

        expect(dialog().props("dataTestPrefix")).toBe("traces-saved-views-dialog");
        expect(dialog().props("loading")).toBe(false);
        expect(dialog().props("favoriteIds")).toEqual(["t1"]);
        expect(dialog().props("favoriteViews")).toEqual([tracesView]);
      });

      it("update from the dialog closes it and asks for confirmation first", async () => {
        mockConfirm.mockResolvedValue(false);
        wrapper = mountSearchBar();
        await flushPromises();
        await wrapper
          .find('[data-test="traces-search-bar-menu-list-saved-views-btn"]')
          .trigger("click");
        expect(dialog().props("open")).toBe(true);

        dialog().vm.$emit("update", tracesView);
        await flushPromises();

        expect(dialog().props("open")).toBe(false);
        expect(mockConfirm).toHaveBeenCalledWith({
          title: "search.updateSavedView",
          message: "search.updateSavedViewConfirm",
        });
        expect(mockSavedViewsPut).not.toHaveBeenCalled();
      });

      it("delete from the dialog closes it, confirms, and drops the favourite", async () => {
        localStorage.setItem("savedViews", JSON.stringify({ t1: tracesView }));
        wrapper = mountSearchBar();
        await flushPromises();
        await wrapper
          .find('[data-test="traces-search-bar-menu-list-saved-views-btn"]')
          .trigger("click");

        dialog().vm.$emit("delete", tracesView);
        await flushPromises();

        expect(dialog().props("open")).toBe(false);
        expect(mockConfirm).toHaveBeenCalledWith({
          title: "search.deleteSavedView",
          message: "search.deleteSavedViewConfirm",
        });
        expect(mockSavedViewsDelete).toHaveBeenCalledWith(expect.any(String), "t1");
        expect(dialog().props("favoriteIds")).toEqual([]);
        expect(JSON.parse(localStorage.getItem("savedViews") || "{}")).toEqual({});
      });

      it("delete from the dialog does nothing when not confirmed", async () => {
        mockConfirm.mockResolvedValue(false);
        localStorage.setItem("savedViews", JSON.stringify({ t1: tracesView }));
        wrapper = mountSearchBar();
        await flushPromises();

        dialog().vm.$emit("delete", tracesView);
        await flushPromises();

        expect(mockSavedViewsDelete).not.toHaveBeenCalled();
        expect(dialog().props("favoriteIds")).toEqual(["t1"]);
      });

      it("toggles a favourite from the dialog", async () => {
        wrapper = mountSearchBar();
        await flushPromises();

        dialog().vm.$emit("toggle-favorite", tracesView, false);
        await flushPromises();
        expect(dialog().props("favoriteIds")).toEqual(["t1"]);

        dialog().vm.$emit("toggle-favorite", tracesView, true);
        await flushPromises();
        expect(dialog().props("favoriteIds")).toEqual([]);
      });

      it("pin click toggles the toolbar group without closing the menu", async () => {
        wrapper = mountSearchBar();
        await flushPromises();
        expect(toolbarGroup().exists()).toBe(true);

        const bubbled = vi.fn();
        moreGroup().element.addEventListener("click", bubbled);
        await moreGroup()
          .find('[data-test="traces-search-bar-menu-pin-saved-views-btn"]')
          .trigger("click");

        expect(isPinned("savedViews")).toBe(false);
        expect(toolbarGroup().exists()).toBe(false);
        expect(bubbled).not.toHaveBeenCalled();

        await moreGroup()
          .find('[data-test="traces-search-bar-menu-pin-saved-views-btn"]')
          .trigger("click");
        expect(toolbarGroup().exists()).toBe(true);
      });

      it("opens the save dialog from Create saved view", async () => {
        wrapper = mountSearchBar();
        await flushPromises();

        await wrapper
          .find('[data-test="traces-search-bar-menu-create-saved-view-btn"]')
          .trigger("click");
        expect((wrapper.vm as any).saveViewDialogOpen).toBe(true);
      });

      it.each(["service-graph", "services-catalog"])(
        "hides the group but keeps More on the %s tab",
        async (mode) => {
          searchObjInstance.meta.searchMode = mode as any;
          wrapper = mountSearchBar();
          await flushPromises();

          expect(wrapper.find('[data-test="traces-search-bar-more-menu-btn"]').exists()).toBe(true);
          expect(moreGroup().exists()).toBe(false);
        },
      );

      it("keeps the toolbar group off when unpinned", async () => {
        togglePin("savedViews");
        wrapper = mountSearchBar();
        await flushPromises();

        expect(toolbarGroup().exists()).toBe(false);
        expect(moreGroup().exists()).toBe(true);
      });

      it("shows the pinned group below lg without a width budget", async () => {
        widthSpy.mockRestore();
        widthSpy = mockToolbarWidth(0);
        breakpointState.lgUp = false;
        wrapper = mountSearchBar();
        await flushPromises();

        expect(toolbarGroup().exists()).toBe(true);
      });

      it("shrinks the toggle labels before the pinned group falls back", async () => {
        widthSpy.mockRestore();
        widthSpy = mockToolbarWidth(800);
        wrapper = mountSearchBar();
        await flushPromises();

        expect(toolbarGroup().exists()).toBe(true);
        expect(wrapper.find('[data-test="traces-search-mode-spans-btn"]').text()).not.toContain(
          "traces.spansTab",
        );

        togglePin("savedViews");
        await flushPromises();
        expect(wrapper.find('[data-test="traces-search-mode-spans-btn"]').text()).toContain(
          "traces.spansTab",
        );
      });

      it("falls back to More at desktop width when the toolbar has no room", async () => {
        widthSpy.mockRestore();
        widthSpy = mockToolbarWidth(360);
        wrapper = mountSearchBar();
        await flushPromises();

        expect(toolbarGroup().exists()).toBe(false);
        expect(moreGroup().exists()).toBe(true);
      });
    });
  });
});
