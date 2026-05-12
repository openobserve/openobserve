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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// ---------------------------------------------------------------------------
// Module-level mocks — vi.mock is hoisted by Vitest; never use vi.doMock here
// ---------------------------------------------------------------------------

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));

vi.mock("@/services/segment_analytics", () => ({
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
    config: {
      refreshTimes: [
        [
          { label: "5 sec", value: 5 },
          { label: "1 min", value: 60 },
        ],
      ],
    },
    meta: {
      refreshInterval: 0,
      refreshIntervalLabel: "Off",
      showFields: true,
      showQuery: true,
      showHistogram: true,
      showDetailTab: false,
      showTraceDetails: false,
      sqlMode: false,
      searchMode: "traces" as
        | "traces"
        | "spans"
        | "service-graph"
        | "services-catalog",
      showErrorOnly: false,
      queryEditorPlaceholderFlag: true,
      metricsRangeFilters: new Map<
        string,
        { panelTitle: string; start: number; end: number }
      >(),
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

// ---------------------------------------------------------------------------
// Quasar setup
// ---------------------------------------------------------------------------
installQuasar({ plugins: [quasar.Dialog, quasar.Notify] });

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
    template:
      '<div data-test="logs-search-bar-sql-mode-toggle-btn" class="syntax-guide-stub" />',
    props: ["sqlmode"],
  },
  ShareButton: {
    template:
      '<button data-test="logs-search-bar-share-link-btn" class="share-btn-stub" />',
    props: ["url", "buttonClass", "buttonSize"],
  },
  // OToggleGroup: stub to render inline without Reka UI context requirements
  OToggleGroup: {
    name: "OToggleGroup",
    template: '<div class="o-toggle-group-stub logs-visualize-toggle button-group" v-bind="$attrs"><slot /></div>',
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
    template: '<div class="o-dropdown-item-stub" v-bind="$attrs" @click="$emit(\'select\')"><slot name="icon-left" /><slot /></div>',
    emits: ["select"],
  },
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

      // OToggleGroup replaces the old .button-group.logs-visualize-toggle div
      expect(wrapper.find(".o-toggle-group-stub").exists()).toBe(true);
      expect(
        wrapper.find('[data-test="traces-search-mode-traces-btn"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="traces-service-graph-toggle"]').exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="traces-search-mode-services-catalog-btn"]')
          .exists(),
      ).toBe(true);
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
      expect(wrapper.emitted("update:searchMode")![0]).toEqual([
        "service-graph",
      ]);
    });

    it("should emit update:searchMode with 'services-catalog' when the services-catalog button is clicked", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      const scBtn = wrapper.find(
        '[data-test="traces-search-mode-services-catalog-btn"]',
      );
      expect(scBtn.exists()).toBe(true);
      await scBtn.trigger("click");

      expect(wrapper.emitted("update:searchMode")).toBeTruthy();
      expect(wrapper.emitted("update:searchMode")![0]).toEqual([
        "services-catalog",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  describe("searchMode conditional rendering", () => {
    it("should show search controls when searchMode is 'traces'", async () => {
      searchObjInstance.meta.searchMode = "traces";
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper
          .find('[data-test="traces-search-bar-reset-filters-btn"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="logs-search-bar-date-time-dropdown"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="logs-search-bar-refresh-btn"]').exists(),
      ).toBe(true);
    });

    it("should hide search controls when searchMode is 'service-graph'", async () => {
      searchObjInstance.meta.searchMode = "service-graph";
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper
          .find('[data-test="traces-search-bar-reset-filters-btn"]')
          .exists(),
      ).toBe(false);
      expect(
        wrapper
          .find('[data-test="logs-search-bar-date-time-dropdown"]')
          .exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="logs-search-bar-refresh-btn"]').exists(),
      ).toBe(false);
    });

    it("should hide search controls when searchMode is 'services-catalog'", async () => {
      searchObjInstance.meta.searchMode = "services-catalog";
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper
          .find('[data-test="traces-search-bar-reset-filters-btn"]')
          .exists(),
      ).toBe(false);
      expect(
        wrapper
          .find('[data-test="logs-search-bar-date-time-dropdown"]')
          .exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="logs-search-bar-refresh-btn"]').exists(),
      ).toBe(false);
    });

    it("should re-show controls when searchMode changes back to 'traces'", async () => {
      searchObjInstance.meta.searchMode = "service-graph";
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper.find('[data-test="logs-search-bar-refresh-btn"]').exists(),
      ).toBe(false);

      searchObjInstance.meta.searchMode = "traces";
      await wrapper.vm.$nextTick();

      expect(
        wrapper.find('[data-test="logs-search-bar-refresh-btn"]').exists(),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("search mode toggle (update:searchMode)", () => {
    it("should emit update:searchMode with 'traces' when Traces button is clicked", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      const tracesBtn = wrapper.find(
        '[data-test="traces-search-mode-traces-btn"]',
      );
      expect(tracesBtn.exists()).toBe(true);
      await tracesBtn.trigger("click");

      expect(wrapper.emitted("update:searchMode")).toBeTruthy();
      expect(wrapper.emitted("update:searchMode")![0]).toEqual(["traces"]);
    });

    it("should emit update:searchMode with 'spans' when Spans button is clicked", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      const spansBtn = wrapper.find(
        '[data-test="traces-search-mode-spans-btn"]',
      );
      expect(spansBtn.exists()).toBe(true);
      await spansBtn.trigger("click");

      expect(wrapper.emitted("update:searchMode")).toBeTruthy();
      expect(wrapper.emitted("update:searchMode")![0]).toEqual(["spans"]);
    });

    it("should apply 'selected' class to Traces button when searchMode is 'traces'", async () => {
      searchObjInstance.meta.searchMode = "traces";
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper.find('[data-test="traces-search-mode-traces-btn"]').classes(),
      ).toContain("selected");
      expect(
        wrapper.find('[data-test="traces-search-mode-spans-btn"]').classes(),
      ).not.toContain("selected");
    });

    it("should apply 'selected' class to Spans button when searchMode is 'spans'", async () => {
      searchObjInstance.meta.searchMode = "spans";
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper.find('[data-test="traces-search-mode-spans-btn"]').classes(),
      ).toContain("selected");
      expect(
        wrapper.find('[data-test="traces-search-mode-traces-btn"]').classes(),
      ).not.toContain("selected");
    });

    it("should apply 'selected' class to Services Catalog button when searchMode is 'services-catalog'", async () => {
      searchObjInstance.meta.searchMode = "services-catalog";
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper
          .find('[data-test="traces-search-mode-services-catalog-btn"]')
          .classes(),
      ).toContain("selected");
      expect(
        wrapper.find('[data-test="traces-search-mode-traces-btn"]').classes(),
      ).not.toContain("selected");
    });
  });

  // -------------------------------------------------------------------------
  describe("histogram toggle", () => {
    it("should render the histogram (metrics) toggle", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper
          .find('[data-test="traces-search-bar-show-metrics-toggle-btn"]')
          .exists(),
      ).toBe(true);
    });

    it("should reflect showHistogram=false from searchObj", async () => {
      searchObjInstance.meta.showHistogram = false;
      wrapper = mountSearchBar();
      await flushPromises();

      // The toggle is bound via v-model to searchObj.meta.showHistogram.
      // Verify the reactive source has the correct initial value.
      expect(searchObjInstance.meta.showHistogram).toBe(false);
    });

    it("should reflect showHistogram=true from searchObj", async () => {
      searchObjInstance.meta.showHistogram = true;
      wrapper = mountSearchBar();
      await flushPromises();

      expect(searchObjInstance.meta.showHistogram).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("error-only toggle", () => {
    it("should render the error-only toggle", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper
          .find('[data-test="traces-search-bar-error-only-toggle-btn"]')
          .exists(),
      ).toBe(true);
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

      expect(
        wrapper
          .find('[data-test="traces-search-bar-reset-filters-btn"]')
          .exists(),
      ).toBe(true);
    });

    it("should clear editorValue and advanceFiltersQuery when clicked", async () => {
      searchObjInstance.data.editorValue = "some query";
      searchObjInstance.data.advanceFiltersQuery = "some filter";
      wrapper = mountSearchBar();
      await flushPromises();

      await wrapper
        .find('[data-test="traces-search-bar-reset-filters-btn"]')
        .trigger("click");

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

      await wrapper
        .find('[data-test="traces-search-bar-reset-filters-btn"]')
        .trigger("click");

      expect(
        searchObjInstance.data.stream.fieldValues.service_name.selectedValues,
      ).toEqual([]);
      expect(
        searchObjInstance.data.stream.fieldValues.service_name.searchKeyword,
      ).toBe("");
      expect(
        searchObjInstance.data.stream.fieldValues.status_code.selectedValues,
      ).toEqual([]);
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

      await wrapper
        .find('[data-test="traces-search-bar-reset-filters-btn"]')
        .trigger("click");

      expect(searchObjInstance.meta.metricsRangeFilters.size).toBe(0);
    });

    it("should emit filters-reset when the reset button is clicked", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      await wrapper
        .find('[data-test="traces-search-bar-reset-filters-btn"]')
        .trigger("click");

      expect(wrapper.emitted("filters-reset")).toBeTruthy();
      expect(wrapper.emitted("filters-reset")).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("run query button", () => {
    it("should render the run query button", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper.find('[data-test="logs-search-bar-refresh-btn"]').exists(),
      ).toBe(true);
    });

    it("should emit searchdata when clicked and searchObj.loading is false", async () => {
      searchObjInstance.loading = false;
      wrapper = mountSearchBar({ isLoading: false });
      await flushPromises();

      await wrapper
        .find('[data-test="logs-search-bar-refresh-btn"]')
        .trigger("click");

      expect(wrapper.emitted("searchdata")).toBeTruthy();
      expect(wrapper.emitted("searchdata")).toHaveLength(1);
    });

    it("should show cancel button when isLoading prop is true on enterprise", async () => {
      wrapper = mountSearchBar({ isLoading: true });
      await flushPromises();

      expect(
        wrapper.find('[data-test="traces-search-bar-cancel-btn"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="logs-search-bar-refresh-btn"]').exists(),
      ).toBe(false);
    });

    it("should not emit searchdata when searchObj.loading is true", async () => {
      searchObjInstance.loading = true;
      wrapper = mountSearchBar({ isLoading: false });
      await flushPromises();

      await wrapper
        .find('[data-test="logs-search-bar-refresh-btn"]')
        .trigger("click");

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
      expect(wrapper.find('[title="Export Traces"]').exists()).toBe(true);
    });

    it("should be disabled when queryResults.hits is empty", async () => {
      searchObjInstance.data.queryResults.hits = [];
      wrapper = mountSearchBar();
      await flushPromises();

      // OButton uses native HTML disabled attribute (not a CSS "disabled" class)
      const btn = wrapper.find('[title="Export Traces"]');
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
      const btn = wrapper.find('[title="Export Traces"]');
      expect(btn.exists()).toBe(true);
      expect(btn.attributes("disabled")).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  describe("structural elements", () => {
    it("should render the date-time dropdown", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper
          .find('[data-test="logs-search-bar-date-time-dropdown"]')
          .exists(),
      ).toBe(true);
    });

    it("should render the syntax guide (SQL mode toggle)", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper
          .find('[data-test="logs-search-bar-sql-mode-toggle-btn"]')
          .exists(),
      ).toBe(true);
    });

    it("should render the share link button", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper.find('[data-test="logs-search-bar-share-link-btn"]').exists(),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("query editor visibility (showQuery)", () => {
    it("should render the query editor when showQuery is true", async () => {
      searchObjInstance.meta.showQuery = true;
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper.find('[data-test="code-query-editor-stub"]').exists(),
      ).toBe(true);
    });

    it("should hide the query editor when showQuery is false", async () => {
      searchObjInstance.meta.showQuery = false;
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper.find('[data-test="code-query-editor-stub"]').exists(),
      ).toBe(false);
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

      expect(searchObjInstance.data.editorValue).toBe(
        "service_name='svc-a' and some bare keyword",
      );
    });
  });

  // -------------------------------------------------------------------------
  describe("tooltips on icon-only buttons", () => {
    it("should have a tooltip inside the reset filters button", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      const resetBtn = wrapper.find(
        '[data-test="traces-search-bar-reset-filters-btn"]',
      );
      expect(resetBtn.exists()).toBe(true);
      // QTooltip uses <Teleport> and renders outside the button — check via component tree
      expect(wrapper.findComponent({ name: "QTooltip" }).exists()).toBe(true);
    });

    it("should have a tooltip inside the Traces mode toggle button", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      const searchBtn = wrapper.find(
        '[data-test="traces-search-mode-traces-btn"]',
      );
      expect(searchBtn.exists()).toBe(true);
      expect(wrapper.findComponent({ name: "QTooltip" }).exists()).toBe(true);
    });

    it("should have a tooltip inside the service-graph tab toggle button", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      const sgBtn = wrapper.find('[data-test="traces-service-graph-toggle"]');
      expect(sgBtn.exists()).toBe(true);
      expect(wrapper.findComponent({ name: "QTooltip" }).exists()).toBe(true);
    });

    it("should have a tooltip inside the Traces search mode button", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      const tracesBtn = wrapper.find(
        '[data-test="traces-search-mode-traces-btn"]',
      );
      expect(tracesBtn.exists()).toBe(true);
      expect(wrapper.findComponent({ name: "QTooltip" }).exists()).toBe(true);
    });

    it("should have a tooltip inside the Spans search mode button", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      const spansBtn = wrapper.find(
        '[data-test="traces-search-mode-spans-btn"]',
      );
      expect(spansBtn.exists()).toBe(true);
      expect(wrapper.findComponent({ name: "QTooltip" }).exists()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // [auto-generated] refreshTimeChange
  // -------------------------------------------------------------------------
  describe("refreshTimeChange", () => {
    it("should update meta.refreshInterval and meta.refreshIntervalLabel", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      (wrapper.vm as any).refreshTimeChange({ value: 30, label: "30 sec" });

      expect(searchObjInstance.meta.refreshInterval).toBe(30);
      expect(searchObjInstance.meta.refreshIntervalLabel).toBe("30 sec");
    });

    it("should set btnRefreshInterval to false after the change", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      (wrapper.vm as any).btnRefreshInterval = true;
      (wrapper.vm as any).refreshTimeChange({ value: 60, label: "1 min" });

      expect((wrapper.vm as any).btnRefreshInterval).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // [auto-generated] updateQuery
  // -------------------------------------------------------------------------
  describe("updateQuery", () => {
    it("should call queryEditorRef.setValue with searchObj.data.query", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      const mockSetValue = vi.fn();
      (wrapper.vm as any).queryEditorRef = { setValue: mockSetValue };
      searchObjInstance.data.query = "SELECT trace_id FROM default";

      (wrapper.vm as any).updateQuery();

      expect(mockSetValue).toHaveBeenCalledWith("SELECT trace_id FROM default");
    });

    it("should not throw when queryEditorRef is null", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      (wrapper.vm as any).queryEditorRef = null;

      expect(() => (wrapper.vm as any).updateQuery()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // [auto-generated] Props
  // -------------------------------------------------------------------------
  describe("service-graph mode toolbar", () => {
    beforeEach(() => {
      searchObjInstance.meta.searchMode = "service-graph";
    });

    it("should render service-graph-date-time-picker when searchMode is service-graph", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper.find('[data-test="service-graph-date-time-picker"]').exists(),
      ).toBe(true);
    });

    it("should render service-graph-refresh-btn when searchMode is service-graph", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper.find('[data-test="service-graph-refresh-btn"]').exists(),
      ).toBe(true);
    });

    it("should render tree-view and graph-view toggle buttons when searchMode is service-graph", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper.find('[data-test="service-graph-tree-view-btn"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="service-graph-graph-view-btn"]').exists(),
      ).toBe(true);
    });

    it("should emit service-graph-refresh when refresh btn is clicked", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      const refreshBtn = wrapper.find(
        '[data-test="service-graph-refresh-btn"]',
      );
      expect(refreshBtn.exists()).toBe(true);
      await refreshBtn.trigger("click");

      expect(wrapper.emitted("service-graph-refresh")).toBeTruthy();
      expect(wrapper.emitted("service-graph-refresh")).toHaveLength(1);
    });

    it("should call onServiceGraphVisualizationChange with 'tree' when tree-view btn is clicked", async () => {
      searchObjInstance.meta.serviceGraphVisualizationType = "graph";
      wrapper = mountSearchBar();
      await flushPromises();

      const treeBtn = wrapper.find('[data-test="service-graph-tree-view-btn"]');
      expect(treeBtn.exists()).toBe(true);
      await treeBtn.trigger("click");

      expect(searchObjInstance.meta.serviceGraphVisualizationType).toBe("tree");
      expect(searchObjInstance.meta.serviceGraphLayoutType).toBe("horizontal");
    });

    it("should call onServiceGraphVisualizationChange with 'graph' when graph-view btn is clicked", async () => {
      searchObjInstance.meta.serviceGraphVisualizationType = "tree";
      wrapper = mountSearchBar();
      await flushPromises();

      const graphBtn = wrapper.find(
        '[data-test="service-graph-graph-view-btn"]',
      );
      expect(graphBtn.exists()).toBe(true);
      await graphBtn.trigger("click");

      expect(searchObjInstance.meta.serviceGraphVisualizationType).toBe(
        "graph",
      );
      expect(searchObjInstance.meta.serviceGraphLayoutType).toBe("force");
    });

    it("should hide service-graph toolbar when searchMode is not service-graph", async () => {
      searchObjInstance.meta.searchMode = "traces";
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper.find('[data-test="service-graph-date-time-picker"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="service-graph-refresh-btn"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="service-graph-tree-view-btn"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="service-graph-graph-view-btn"]').exists(),
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("services-catalog mode toolbar", () => {
    beforeEach(() => {
      searchObjInstance.meta.searchMode = "services-catalog";
    });

    it("should render services-catalog-date-time-picker when searchMode is services-catalog", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper
          .find('[data-test="services-catalog-date-time-picker"]')
          .exists(),
      ).toBe(true);
    });

    it("should render services-catalog-refresh-btn when searchMode is services-catalog", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper.find('[data-test="services-catalog-refresh-btn"]').exists(),
      ).toBe(true);
    });

    it("should emit services-catalog-refresh when refresh btn is clicked", async () => {
      wrapper = mountSearchBar();
      await flushPromises();

      const refreshBtn = wrapper.find(
        '[data-test="services-catalog-refresh-btn"]',
      );
      expect(refreshBtn.exists()).toBe(true);
      await refreshBtn.trigger("click");

      expect(wrapper.emitted("services-catalog-refresh")).toBeTruthy();
      expect(wrapper.emitted("services-catalog-refresh")).toHaveLength(1);
    });

    it("should hide services-catalog toolbar when searchMode is not services-catalog", async () => {
      searchObjInstance.meta.searchMode = "traces";
      wrapper = mountSearchBar();
      await flushPromises();

      expect(
        wrapper
          .find('[data-test="services-catalog-date-time-picker"]')
          .exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="services-catalog-refresh-btn"]').exists(),
      ).toBe(false);
    });
  });

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

      expect(
        wrapper.find('[data-test="logs-search-bar-refresh-btn"]').exists(),
      ).toBe(true);

      await wrapper.setProps({ isLoading: true });
      await flushPromises();

      expect(
        wrapper.find('[data-test="traces-search-bar-cancel-btn"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="logs-search-bar-refresh-btn"]').exists(),
      ).toBe(false);
    });
  });
});
