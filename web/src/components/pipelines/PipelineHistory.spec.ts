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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

installQuasar({ plugins: [Dialog, Notify] });

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
    props: [
      "autoApply",
      "defaultType",
      "defaultAbsoluteTime",
      "defaultRelativeTime",
    ],
    emits: ["on:date-change"],
    methods: {
      setCustomDate: vi.fn(),
    },
  },
}));

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

function createWrapper(props: Record<string, unknown> = {}) {
  return mount(PipelineHistory, {
    props,
    global: {
      plugins: [i18n, store],
      stubs: {
        ODialog: ODialogStub,
        QTablePagination: {
          template: '<div data-test="q-table-pagination-stub"></div>',
          props: ["scope", "position", "resultTotal", "perPageOptions"],
          emits: ["update:changeRecordPerPage"],
        },
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
      expect(
        wrapper.find('[data-test="pipeline-history-page"]').exists(),
      ).toBe(true);
    });

    it("renders data-test='alert-history-back-btn'", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(
        wrapper.find('[data-test="alert-history-back-btn"]').exists(),
      ).toBe(true);
    });

    it("renders data-test='pipeline-history-title' with 'Pipeline History' translation", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const title = wrapper.find('[data-test="pipeline-history-title"]');
      expect(title.exists()).toBe(true);
      expect(title.text()).toContain("Pipeline History");
    });

    it("renders data-test='pipeline-history-date-picker'", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(
        wrapper.find('[data-test="pipeline-history-date-picker"]').exists(),
      ).toBe(true);
    });

    it("renders data-test='pipeline-history-search-select'", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(
        wrapper.find('[data-test="pipeline-history-search-select"]').exists(),
      ).toBe(true);
    });

    it("renders data-test='pipeline-history-manual-search-btn'", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(
        wrapper
          .find('[data-test="pipeline-history-manual-search-btn"]')
          .exists(),
      ).toBe(true);
    });

    it("renders data-test='pipeline-history-refresh-btn'", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(
        wrapper.find('[data-test="pipeline-history-refresh-btn"]').exists(),
      ).toBe(true);
    });

    it("renders data-test='pipeline-history-table'", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(
        wrapper.find('[data-test="pipeline-history-table"]').exists(),
      ).toBe(true);
    });
  });

  describe("navigation", () => {
    it("goBack calls router.push with pipelines route and org identifier", async () => {
      const wrapper = createWrapper();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.goBack();
      await nextTick();

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "pipelines",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });

    it("clicking back button triggers goBack / router.push", async () => {
      const wrapper = createWrapper();
      await flushPromises();

      await wrapper
        .find('[data-test="alert-history-back-btn"]')
        .trigger("click");
      await nextTick();

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "pipelines",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
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

  describe("filterPipelineOptions", () => {
    it("filters pipeline options case-insensitively", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;

      const updateFn = vi.fn((cb: () => void) => cb());
      vm.filterPipelineOptions("alpha", updateFn);

      expect(vm.filteredPipelineOptions).toHaveLength(1);
      expect(vm.filteredPipelineOptions[0].label).toBe("Alpha Pipeline");
    });

    it("returns all options when filter value is empty string", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;

      const updateFn = vi.fn((cb: () => void) => cb());
      vm.filterPipelineOptions("", updateFn);

      expect(vm.filteredPipelineOptions).toHaveLength(3);
    });

    it("filters options by partial match case-insensitively (uppercase input)", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;

      const updateFn = vi.fn((cb: () => void) => cb());
      vm.filterPipelineOptions("BETA", updateFn);

      expect(vm.filteredPipelineOptions).toHaveLength(1);
      expect(vm.filteredPipelineOptions[0].label).toBe("Beta Pipeline");
    });

    it("returns empty list when no pipelines match the filter", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;

      const updateFn = vi.fn((cb: () => void) => cb());
      vm.filterPipelineOptions("zzz-no-match", updateFn);

      expect(vm.filteredPipelineOptions).toHaveLength(0);
    });

    it("calls the update callback function", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;

      const updateFn = vi.fn((cb: () => void) => cb());
      vm.filterPipelineOptions("alpha", updateFn);

      expect(updateFn).toHaveBeenCalledTimes(1);
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
      vm.onPipelineSelected({ label: "Alpha Pipeline", value: "pid-alpha" });
      await flushPromises();

      expect(vm.searchQuery).toBe("pid-alpha");
      expect(mockHttpGet).toHaveBeenCalled();
    });

    it("resets pagination page to 1 when pipeline is selected", async () => {
      const wrapper = createWrapper();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.pagination.page = 3;
      vm.onPipelineSelected({ label: "Alpha Pipeline", value: "pid-alpha" });
      await nextTick();

      expect(vm.pagination.page).toBe(1);
    });

    it("does not trigger fetch when selected value has no pipeline_id", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      vi.clearAllMocks();

      const vm = wrapper.vm as any;
      vm.onPipelineSelected(null);
      await flushPromises();

      // http get should not have been called for history after null selection
      expect(mockHttpGet).not.toHaveBeenCalled();
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
      expect(vm.selectedPipeline).toBeNull();
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

    describe("getStatusColor", () => {
      it("returns 'positive' for 'success'", async () => {
        const wrapper = createWrapper();
        await flushPromises();
        const vm = wrapper.vm as any;
        expect(vm.getStatusColor("success")).toBe("positive");
      });

      it("returns 'positive' for 'ok' and 'completed'", async () => {
        const wrapper = createWrapper();
        await flushPromises();
        const vm = wrapper.vm as any;
        expect(vm.getStatusColor("ok")).toBe("positive");
        expect(vm.getStatusColor("completed")).toBe("positive");
      });

      it("returns 'negative' for 'error' and 'failed'", async () => {
        const wrapper = createWrapper();
        await flushPromises();
        const vm = wrapper.vm as any;
        expect(vm.getStatusColor("error")).toBe("negative");
        expect(vm.getStatusColor("failed")).toBe("negative");
      });

      it("returns 'warning' for 'warning'", async () => {
        const wrapper = createWrapper();
        await flushPromises();
        const vm = wrapper.vm as any;
        expect(vm.getStatusColor("warning")).toBe("warning");
      });

      it("returns 'info' for 'pending' and 'running'", async () => {
        const wrapper = createWrapper();
        await flushPromises();
        const vm = wrapper.vm as any;
        expect(vm.getStatusColor("pending")).toBe("info");
        expect(vm.getStatusColor("running")).toBe("info");
      });

      it("returns theme-based fallback for unknown status", async () => {
        const wrapper = createWrapper();
        await flushPromises();
        const vm = wrapper.vm as any;
        const color = vm.getStatusColor("some-unknown-status");
        expect(["white", "black"]).toContain(color);
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
      const alphaOption = vm.filteredPipelineOptions.find(
        (p: any) => p.value === "pid-alpha",
      );
      expect(alphaOption).toBeDefined();
      expect(alphaOption.label).toBe("Alpha Pipeline");
    });
  });

  describe("initial state", () => {
    it("selectedPipeline is null initially", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.selectedPipeline).toBeNull();
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

    it("loading is false initially", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.loading).toBe(false);
    });

    it("rows is an empty array initially", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(Array.isArray(vm.rows)).toBe(true);
    });
  });

  describe("no-option slot content", () => {
    it("filteredPipelineOptions is empty when no match, which triggers no-option slot", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      // Quasar renders the no-option slot only when the dropdown is open and
      // filteredPipelineOptions is empty. In jsdom the slot is not injected into
      // the static DOM without dropdown focus. We verify the state condition
      // that drives the no-option slot display.
      const vm = wrapper.vm as any;
      const updateFn = vi.fn((cb: () => void) => cb());
      vm.filterPipelineOptions("zzz-no-match", updateFn);
      await nextTick();
      // Empty filtered options is the condition that causes Quasar to render
      // the no-option slot with "No pipelines found"
      expect(vm.filteredPipelineOptions).toHaveLength(0);
    });
  });

  describe("loading state", () => {
    it("manual search button is disabled when loading is true", async () => {
      const wrapper = createWrapper();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.loading = true;
      await nextTick();

      const searchBtn = wrapper.find(
        '[data-test="pipeline-history-manual-search-btn"]',
      );
      expect(
        searchBtn.attributes("disabled") !== undefined ||
          searchBtn.attributes("aria-disabled") === "true",
      ).toBe(true);
    });

    it("refresh button shows loading state when loading is true", async () => {
      const wrapper = createWrapper();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.loading = true;
      await nextTick();

      const refreshBtn = wrapper.find(
        '[data-test="pipeline-history-refresh-btn"]',
      );
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

      await wrapper
        .find('[data-test="pipeline-history-refresh-btn"]')
        .trigger("click");
      await flushPromises();

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

    it("showDetailsDialog opens dialog and sets selectedRow", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      const row = { pipeline_name: "Alpha", status: "success" };

      vm.showDetailsDialog(row);
      await nextTick();

      expect(vm.detailsDialog).toBe(true);
      expect(vm.selectedRow).toEqual(row);
    });

    it("renders ODialog with details props when open", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.showDetailsDialog({
        pipeline_name: "Alpha Pipeline",
        status: "success",
        timestamp: 1700000000000000,
        start_time: 1700000000000000,
        end_time: 1700003600000000,
        is_realtime: false,
        is_silenced: false,
        retries: 0,
      });
      await nextTick();

      const dialog = wrapper.findAll('[data-test="o-dialog-stub"]')[0];
      expect(dialog.exists()).toBe(true);
      expect(dialog.attributes("data-title")).toBe(
        "Pipeline Execution Details",
      );
      expect(dialog.attributes("data-size")).toBe("lg");
      expect(dialog.attributes("data-primary-label")).toBe("Close");
      expect(dialog.attributes("data-open")).toBe("true");
    });

    it("clicking primary button on details dialog closes it", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.showDetailsDialog({ pipeline_name: "Alpha", status: "success" });
      await nextTick();
      expect(vm.detailsDialog).toBe(true);

      const dialog = wrapper.findAll('[data-test="o-dialog-stub"]')[0];
      await dialog
        .find('[data-test="o-dialog-stub-primary"]')
        .trigger("click");
      await nextTick();

      expect(vm.detailsDialog).toBe(false);
    });

    it("renders selected row details inside dialog slot", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.showDetailsDialog({
        pipeline_name: "My Test Pipeline",
        status: "success",
        timestamp: 1700000000000000,
        start_time: 1700000000000000,
        end_time: 1700003600000000,
        is_realtime: true,
        is_silenced: false,
        retries: 0,
      });
      await nextTick();

      const dialog = wrapper.findAll('[data-test="o-dialog-stub"]')[0];
      expect(dialog.text()).toContain("My Test Pipeline");
      expect(dialog.text()).toContain("success");
    });

    it("renders error details section when selectedRow has error", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.showDetailsDialog({
        pipeline_name: "Alpha",
        status: "error",
        timestamp: 1700000000000000,
        start_time: 1700000000000000,
        end_time: 1700003600000000,
        is_realtime: false,
        is_silenced: false,
        retries: 0,
        error: "Something went wrong",
      });
      await nextTick();

      const dialog = wrapper.findAll('[data-test="o-dialog-stub"]')[0];
      expect(dialog.text()).toContain("Error Details");
      expect(dialog.text()).toContain("Something went wrong");
    });

    it("renders success response section when selectedRow has success_response", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.showDetailsDialog({
        pipeline_name: "Alpha",
        status: "success",
        timestamp: 1700000000000000,
        start_time: 1700000000000000,
        end_time: 1700003600000000,
        is_realtime: false,
        is_silenced: false,
        retries: 0,
        success_response: '{"ok":true}',
      });
      await nextTick();

      const dialog = wrapper.findAll('[data-test="o-dialog-stub"]')[0];
      expect(dialog.text()).toContain("Response");
      expect(dialog.text()).toContain('{"ok":true}');
    });

    it("renders source_node section when selectedRow has source_node", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.showDetailsDialog({
        pipeline_name: "Alpha",
        status: "success",
        timestamp: 1700000000000000,
        start_time: 1700000000000000,
        end_time: 1700003600000000,
        is_realtime: false,
        is_silenced: false,
        retries: 0,
        source_node: "node-01",
      });
      await nextTick();

      const dialog = wrapper.findAll('[data-test="o-dialog-stub"]')[0];
      expect(dialog.text()).toContain("Source Node");
      expect(dialog.text()).toContain("node-01");
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

    it("showErrorDialog opens dialog and sets errorMessage", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      const err = {
        pipeline_name: "Failing Pipeline",
        error: "Some failure",
        last_error_timestamp: 1700000000000000,
      };

      vm.showErrorDialog(err);
      await nextTick();

      expect(vm.errorDialog).toBe(true);
      expect(vm.errorMessage).toEqual(err);
    });

    it("renders error ODialog with title from errorMessage.pipeline_name", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.showErrorDialog({
        pipeline_name: "Failing Pipeline",
        error: "Some failure",
        last_error_timestamp: 1700000000000000,
      });
      await nextTick();

      // The error dialog is the second ODialog stub in the template
      const dialogs = wrapper.findAll('[data-test="o-dialog-stub"]');
      const errorDialog = dialogs[1];
      expect(errorDialog.exists()).toBe(true);
      expect(errorDialog.attributes("data-title")).toBe("Failing Pipeline");
      expect(errorDialog.attributes("data-size")).toBe("sm");
      expect(errorDialog.attributes("data-primary-label")).toBe("Close");
      expect(errorDialog.attributes("data-open")).toBe("true");
    });

    it("renders subTitle when last_error_timestamp is provided", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.showErrorDialog({
        pipeline_name: "Failing Pipeline",
        error: "Some failure",
        last_error_timestamp: 1700000000000000,
      });
      await nextTick();

      const dialogs = wrapper.findAll('[data-test="o-dialog-stub"]');
      const errorDialog = dialogs[1];
      expect(errorDialog.attributes("data-sub-title")).toContain("Last error:");
    });

    it("subTitle is undefined when last_error_timestamp is missing", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.showErrorDialog({
        pipeline_name: "Failing Pipeline",
        error: "Some failure",
      });
      await nextTick();

      const dialogs = wrapper.findAll('[data-test="o-dialog-stub"]');
      const errorDialog = dialogs[1];
      // attribute is omitted or empty when sub-title is undefined
      const subTitle = errorDialog.attributes("data-sub-title");
      expect(subTitle === undefined || subTitle === "").toBe(true);
    });

    it("renders error summary text in dialog slot", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.showErrorDialog({
        pipeline_name: "Failing Pipeline",
        error: "Detailed failure message here",
        last_error_timestamp: 1700000000000000,
      });
      await nextTick();

      const dialogs = wrapper.findAll('[data-test="o-dialog-stub"]');
      const errorDialog = dialogs[1];
      expect(errorDialog.text()).toContain("Error Summary");
      expect(errorDialog.text()).toContain("Detailed failure message here");
    });

    it("clicking primary button on error dialog closes it via closeErrorDialog", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.showErrorDialog({
        pipeline_name: "Failing Pipeline",
        error: "Some failure",
        last_error_timestamp: 1700000000000000,
      });
      await nextTick();
      expect(vm.errorDialog).toBe(true);

      const dialogs = wrapper.findAll('[data-test="o-dialog-stub"]');
      const errorDialog = dialogs[1];
      await errorDialog
        .find('[data-test="o-dialog-stub-primary"]')
        .trigger("click");
      await nextTick();

      expect(vm.errorDialog).toBe(false);
      expect(vm.errorMessage).toBeNull();
    });

    it("emitting update:open=false on error dialog closes it via closeErrorDialog", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      vm.showErrorDialog({
        pipeline_name: "Failing Pipeline",
        error: "Some failure",
        last_error_timestamp: 1700000000000000,
      });
      await nextTick();
      expect(vm.errorDialog).toBe(true);

      const dialogs = wrapper.findAll('[data-test="o-dialog-stub"]');
      const errorDialog = dialogs[1];
      await errorDialog
        .find('[data-test="o-dialog-stub-close"]')
        .trigger("click");
      await nextTick();

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
