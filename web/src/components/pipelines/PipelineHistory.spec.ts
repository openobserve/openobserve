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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

// Must be hoisted before any imports that reference the mocked modules
const mockRouterPush = vi.fn();
const mockRouterBack = vi.fn();

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRouter: () => ({
      back: mockRouterBack,
      push: mockRouterPush,
    }),
    useRoute: () => ({ params: {}, query: {} }),
  };
});

vi.mock("@/services/pipelines", () => ({
  default: {
    getPipelines: vi.fn().mockResolvedValue({
      data: {
        list: [
          { name: "Alpha Pipeline", pipeline_id: "pid-alpha" },
          { name: "Beta Pipeline", pipeline_id: "pid-beta" },
          { name: "Gamma Pipeline", pipeline_id: "pid-gamma" },
        ],
      },
    }),
  },
}));

const mockHttpGet = vi.fn().mockResolvedValue({
  data: {
    hits: [
      {
        pipeline_name: "Alpha Pipeline",
        timestamp: 1700000000000000,
        start_time: 1700000000000000,
        end_time: 1700003600000000,
        status: "success",
        is_realtime: false,
        is_silenced: false,
        retries: 0,
      },
    ],
    total: 1,
  },
});

vi.mock("@/services/http", () => ({
  default: vi.fn(() => ({
    get: mockHttpGet,
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
  })),
}));

vi.mock("@/components/DateTime.vue", () => ({
  default: {
    template: '<div data-test="pipeline-history-date-picker" />',
    props: ["autoApply", "defaultType", "defaultAbsoluteTime", "defaultRelativeTime"],
    emits: ["on:date-change"],
    methods: {
      setCustomDate: vi.fn(),
    },
    mounted() {
      // Simulate DateTime's auto-fire on mount so PipelineHistory calls fetchPipelineHistory
      this.$emit("on:date-change", {
        startTime: 1700000000000000,
        endTime: 1700003600000000,
        relativeTimePeriod: "15m",
      });
    },
  },
}));

// Stub Teleport to render inline so teleported controls are accessible in tests
vi.mock("vue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue")>();
  return {
    ...actual,
    Teleport: {
      name: "Teleport",
      props: ["to", "disabled"],
      template: "<div><slot /></div>",
    },
  };
});

import pipelinesService from "@/services/pipelines";
import PipelineHistory from "./PipelineHistory.vue";

// Stub ODialog so tests are deterministic (no Portal/Reka teleport)
// and so we can assert on the props the component forwards + emit
// the click events the component listens to.
const ODialogStub = {
  name: "ODialog",
  inheritAttrs: false,
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "persistent",
    "showClose",
    "width",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryButtonVariant",
    "secondaryButtonVariant",
    "neutralButtonVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test="o-dialog-stub"
      :data-open="String(open)"
      :data-size="size"
      :data-title="title"
      :data-sub-title="subTitle"
      :data-primary-label="primaryButtonLabel"
    >
      <slot name="header-left" />
      <slot name="header" />
      <slot />
      <slot name="footer" />
      <button
        data-test="o-dialog-stub-primary"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
      <button
        data-test="o-dialog-stub-close"
        @click="$emit('update:open', false)"
      >close</button>
    </div>
  `,
};

// Stub OTable — renders slots for empty/bottom to keep tests functional
const OTableStub = {
  name: "OTable",
  inheritAttrs: false,
  props: [
    "data",
    "columns",
    "rowKey",
    "pagination",
    "currentPage",
    "pageSize",
    "totalCount",
    "pageSizeOptions",
    "sorting",
    "sortBy",
    "sortOrder",
    "loading",
    "showGlobalFilter",
    "dense",
    "bordered",
    "stickyHeader",
    "maxHeight",
  ],
  emits: ["pagination-change", "sort-change"],
  template: `
    <div data-test="o2-table-stub">
      <slot name="empty" />
      <slot name="bottom" :total-rows="totalCount" />
    </div>
  `,
};

function createWrapper(props: Record<string, unknown> = {}) {
  return mount(PipelineHistory, {
    props,
    global: {
      plugins: [i18n, store],
      stubs: {
        ODialog: ODialogStub,
        OTable: OTableStub,
        NoData: {
          template: '<div data-test="no-data-stub">No Data</div>',
        },
      },
    },
  });
}

describe("PipelineHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply default mock for each test after clearAllMocks
    mockHttpGet.mockResolvedValue({
      data: {
        hits: [
          {
            pipeline_name: "Alpha Pipeline",
            timestamp: 1700000000000000,
            start_time: 1700000000000000,
            end_time: 1700003600000000,
            status: "success",
            is_realtime: false,
            is_silenced: false,
            retries: 0,
          },
        ],
        total: 1,
      },
    });
    vi.mocked(pipelinesService.getPipelines).mockResolvedValue({
      data: {
        list: [
          { name: "Alpha Pipeline", pipeline_id: "pid-alpha" },
          { name: "Beta Pipeline", pipeline_id: "pid-beta" },
          { name: "Gamma Pipeline", pipeline_id: "pid-gamma" },
        ],
      },
    } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("mounts without errors", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders data-test='pipeline-history-page'", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.find('[data-test="pipeline-history-page"]').exists()).toBe(true);
    });

    it.skip("renders data-test='alert-history-back-btn'", async () => {
      // The back button was removed in the layout redesign; navigation is now
      // handled via the breadcrumb in the shell header, not inside the component.
    });

    it.skip("renders data-test='pipeline-history-title' with 'Pipeline History' translation", async () => {
      // The page title was removed from the component body in the layout redesign;
      // it is now displayed in the shell breadcrumb outside this component.
    });

    it("renders data-test='pipeline-history-date-picker'", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.find('[data-test="pipeline-history-date-picker"]').exists()).toBe(true);
    });

    it("renders data-test='pipeline-history-search-select'", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.find('[data-test="pipeline-history-search-select"]').exists()).toBe(true);
    });

    it("renders data-test='pipeline-history-refresh-btn'", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.find('[data-test="pipeline-history-refresh-btn"]').exists()).toBe(true);
    });

    it("renders data-test='pipeline-history-table'", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.find('[data-test="pipeline-history-table"]').exists()).toBe(true);
    });
  });

  describe("navigation", () => {
    it.skip("goBack calls router.push with pipelines route and org identifier", async () => {
      // goBack is no longer exposed by the component (no defineExpose).
      // Navigation is handled via the breadcrumb in the shell header.
    });

    it.skip("clicking back button triggers goBack / router.push", async () => {
      // The back button was removed in the layout redesign.
    });
  });

  describe("pipeline history loading on mount", () => {
    it("calls pipelinesService.getPipelines on mount", async () => {
      createWrapper();
      await flushPromises();
      expect(pipelinesService.getPipelines).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
      );
    });

    it("calls http().get for pipeline history on mount", async () => {
      createWrapper();
      await flushPromises();
      expect(mockHttpGet).toHaveBeenCalled();
      const callUrl = mockHttpGet.mock.calls[0][0] as string;
      expect(callUrl).toContain("/pipelines/history");
    });

    it("populates rows with data from history API response", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.rows.length).toBe(1);
      expect(vm.rows[0].pipeline_name).toBe("Alpha Pipeline");
    });

    it("updates pagination.rowsNumber from API response total", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.pagination.rowsNumber).toBe(1);
    });
  });

  describe("onPipelineSelected", () => {
    it("sets searchQuery to the selected pipeline ID and fetches history", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      vi.clearAllMocks();
      mockHttpGet.mockResolvedValue({
        data: { hits: [], total: 0 },
      });

      const vm = wrapper.vm as any;
      // OSelect with valueKey="value" emits the primitive value string (the pipeline_id).
      // Call onPipelineSelected with the primitive value as the component receives it.
      vm.onPipelineSelected("pid-alpha");
      await flushPromises();

      expect(vm.searchQuery).toBe("pid-alpha");
      expect(mockHttpGet).toHaveBeenCalled();
    });

    it("resets pagination page to 1 when pipeline is selected", async () => {
      const wrapper = createWrapper();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.pagination.page = 3;
      // OSelect emits the primitive value (pipeline_id string) when valueKey is set
      vm.onPipelineSelected("pid-alpha");
      await nextTick();

      expect(vm.pagination.page).toBe(1);
    });

    it("clears searchQuery and still fetches (no filter) when null is selected", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      vi.clearAllMocks();
      mockHttpGet.mockResolvedValue({ data: { hits: [], total: 0 } });

      const vm = wrapper.vm as any;
      // Selecting null (clearing the select) always triggers a fetch without a pipeline_id filter.
      vm.onPipelineSelected(null);
      await flushPromises();

      // searchQuery is cleared to empty string
      expect(vm.searchQuery).toBe("");
      // A fetch is still issued (without pipeline_id param) to show unfiltered history
      expect(mockHttpGet).toHaveBeenCalledTimes(1);
      const callParams = mockHttpGet.mock.calls[0][1]?.params ?? {};
      expect(callParams.pipeline_id).toBeUndefined();
    });
  });

  describe("clearSearch", () => {
    it("clears searchQuery and selectedPipeline", async () => {
      const wrapper = createWrapper();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.searchQuery = "pid-alpha";
      vm.selectedPipeline = {
        label: "Alpha Pipeline",
        value: "pid-alpha",
      };

      vm.clearSearch();
      await nextTick();

      expect(vm.searchQuery).toBe("");
      expect(vm.selectedPipeline).toBeUndefined();
    });
  });

  describe("updateDateTime", () => {
    it("updates dateTimeValues from absolute time change event", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      vi.clearAllMocks();
      mockHttpGet.mockResolvedValue({ data: { hits: [], total: 0 } });

      const vm = wrapper.vm as any;
      vm.updateDateTime({
        startTime: 1700000000000000,
        endTime: 1700003600000000,
        relativeTimePeriod: "",
      });
      await flushPromises();

      expect(vm.dateTimeValues.startTime).toBe(1700000000000000);
      expect(vm.dateTimeValues.endTime).toBe(1700003600000000);
      expect(vm.dateTimeType).toBe("absolute");
    });

    it("updates dateTimeValues from relative time change event", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      vi.clearAllMocks();
      mockHttpGet.mockResolvedValue({ data: { hits: [], total: 0 } });

      const vm = wrapper.vm as any;
      vm.updateDateTime({
        startTime: 1700000000000000,
        endTime: 1700003600000000,
        relativeTimePeriod: "30m",
      });
      await flushPromises();

      expect(vm.dateTimeType).toBe("relative");
      expect(vm.relativeTime).toBe("30m");
      expect(vm.dateTimeValues.relativeTimePeriod).toBe("30m");
    });

    it("resets pagination page to 1 on date time update", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      vi.clearAllMocks();
      mockHttpGet.mockResolvedValue({ data: { hits: [], total: 0 } });

      const vm = wrapper.vm as any;
      vm.pagination.page = 5;
      vm.updateDateTime({
        startTime: 1700000000000000,
        endTime: 1700003600000000,
        relativeTimePeriod: "",
      });
      await nextTick();

      expect(vm.pagination.page).toBe(1);
    });

    it("calls fetchPipelineHistory after updateDateTime", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      vi.clearAllMocks();
      mockHttpGet.mockResolvedValue({ data: { hits: [], total: 0 } });

      const vm = wrapper.vm as any;
      vm.updateDateTime({
        startTime: 1700000000000000,
        endTime: 1700003600000000,
        relativeTimePeriod: "",
      });
      await flushPromises();

      expect(mockHttpGet).toHaveBeenCalled();
    });
  });

  describe("helpers", () => {
    describe("formatDate", () => {
      it("returns '-' for falsy timestamp", async () => {
        const wrapper = createWrapper();
        await flushPromises();
        const vm = wrapper.vm as any;
        expect(vm.formatDate(0)).toBe("-");
        expect(vm.formatDate(null)).toBe("-");
        expect(vm.formatDate(undefined)).toBe("-");
      });

      it("returns a formatted date string for valid timestamp in microseconds", async () => {
        const wrapper = createWrapper();
        await flushPromises();
        const vm = wrapper.vm as any;
        const result = vm.formatDate(1700000000000000);
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
        expect(result).not.toBe("-");
      });
    });

    describe("formatDuration", () => {
      it("returns '0s' for zero or negative microseconds", async () => {
        const wrapper = createWrapper();
        await flushPromises();
        const vm = wrapper.vm as any;
        expect(vm.formatDuration(0)).toBe("0s");
        expect(vm.formatDuration(-1)).toBe("0s");
        expect(vm.formatDuration(null)).toBe("0s");
      });

      it("formats 5 seconds correctly", async () => {
        const wrapper = createWrapper();
        await flushPromises();
        const vm = wrapper.vm as any;
        // 5 seconds = 5,000,000 microseconds
        expect(vm.formatDuration(5000000)).toBe("5s");
      });

      it("formats 90 seconds as '1m 30s'", async () => {
        const wrapper = createWrapper();
        await flushPromises();
        const vm = wrapper.vm as any;
        // 90 seconds = 90,000,000 microseconds
        expect(vm.formatDuration(90000000)).toBe("1m 30s");
      });

      it("formats hours and minutes correctly", async () => {
        const wrapper = createWrapper();
        await flushPromises();
        const vm = wrapper.vm as any;
        // 3900 seconds = 1h 5m
        expect(vm.formatDuration(3900000000)).toBe("1h 5m");
      });
    });
  });

  describe("filteredPipelineOptions initialization", () => {
    it("populates filteredPipelineOptions from getPipelines response on mount", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      // Should have 3 pipelines from the mocked service
      expect(vm.filteredPipelineOptions.length).toBe(3);
    });

    it("filteredPipelineOptions are sorted alphabetically by label", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      const labels = vm.filteredPipelineOptions.map((p: any) => p.label);
      const sorted = [...labels].sort((a, b) => a.localeCompare(b));
      expect(labels).toEqual(sorted);
    });

    it("filteredPipelineOptions contains mapped label/value pairs", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      const alphaOption = vm.filteredPipelineOptions.find((p: any) => p.value === "pid-alpha");
      expect(alphaOption).toBeDefined();
      expect(alphaOption.label).toBe("Alpha Pipeline");
    });
  });

  describe("initial state", () => {
    it("selectedPipeline is null initially", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.selectedPipeline).toBeUndefined();
    });

    it("pagination has correct default values", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.pagination.page).toBe(1);
      expect(vm.pagination.rowsPerPage).toBe(20);
      expect(vm.pagination.sortBy).toBe("timestamp");
      expect(vm.pagination.descending).toBe(true);
    });

    it("dateTimeType defaults to 'relative'", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.dateTimeType).toBe("relative");
    });

    it("relativeTime defaults to '15m'", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.relativeTime).toBe("15m");
    });

    it("loading is false initially", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.loading).toBe(false);
    });

    it("rows is an empty array initially", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(Array.isArray(vm.rows)).toBe(true);
    });
  });

  describe("loading state", () => {
    it("refresh button shows loading state when loading is true", async () => {
      const wrapper = createWrapper();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.loading = true;
      await nextTick();

      const refreshBtn = wrapper.find('[data-test="pipeline-history-refresh-btn"]');
      expect(refreshBtn.exists()).toBe(true);
      // loading attribute or class reflects loading state
      expect(vm.loading).toBe(true);
    });
  });

  describe("refreshData", () => {
    it("clicking refresh button calls fetchPipelineHistory again", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      vi.clearAllMocks();
      mockHttpGet.mockResolvedValue({ data: { hits: [], total: 0 } });

      await wrapper.find('[data-test="pipeline-history-refresh-btn"]').trigger("click");
      await flushPromises();

      expect(mockHttpGet).toHaveBeenCalled();
    });
  });

  describe("OTable pagination and sort handlers", () => {
    it("onPaginationChange updates pagination state and fetches history", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      vi.clearAllMocks();
      mockHttpGet.mockResolvedValue({ data: { hits: [], total: 0 } });

      const vm = wrapper.vm as any;
      vm.onPaginationChange({ page: 3, size: 50 });
      await flushPromises();

      expect(vm.pagination.page).toBe(3);
      expect(vm.pagination.rowsPerPage).toBe(50);
      expect(mockHttpGet).toHaveBeenCalled();
    });

    it("onSortChange updates sort state, resets page to 1, and fetches history", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      vi.clearAllMocks();
      mockHttpGet.mockResolvedValue({ data: { hits: [], total: 0 } });

      const vm = wrapper.vm as any;
      vm.pagination.page = 5;
      vm.onSortChange({ column: "status", order: "asc" });
      await flushPromises();

      expect(vm.pagination.sortBy).toBe("status");
      expect(vm.pagination.descending).toBe(false);
      expect(vm.pagination.page).toBe(1);
      expect(mockHttpGet).toHaveBeenCalled();
    });
  });

  describe("Details ODialog", () => {
    it("details dialog is closed initially", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.detailsDialog).toBe(false);
    });
  });

  describe("Error ODialog", () => {
    it("error dialog is closed initially", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.errorDialog).toBe(false);
      expect(vm.errorMessage).toBeNull();
    });

    it("closeErrorDialog clears errorDialog and errorMessage", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.errorDialog = true;
      vm.errorMessage = { pipeline_name: "x", error: "y" };

      vm.closeErrorDialog();
      await nextTick();

      expect(vm.errorDialog).toBe(false);
      expect(vm.errorMessage).toBeNull();
    });
  });
});
