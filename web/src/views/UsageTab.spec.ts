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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { qLayoutInjections } from "@/test/unit/helpers/layout-injections";
import { Dialog, Notify } from "quasar";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import i18n from "@/locales";

// ── Mock data ───────────────────────────────────────────────────────────────

const mockSummaryData = {
  streams: {
    num_streams: 5,
    total_records: 10000,
    total_compressed_size: 500,
    total_storage_size: 2000,
    total_index_size: 100,
  },
  alerts: {
    num_realtime: 2,
    num_scheduled: 3,
    trigger_status: { healthy: 4, failed: 1, warning: 0 },
  },
  pipelines: {
    num_realtime: 1,
    num_scheduled: 2,
    trigger_status: { healthy: 2, failed: 1, warning: 0 },
  },
  total_dashboards: 4,
  total_functions: 3,
};

const mockEmptySummaryData = {
  streams: {
    num_streams: 0,
    total_records: 0,
    total_compressed_size: 0,
    total_storage_size: 0,
    total_index_size: 0,
  },
  alerts: {
    num_realtime: 0,
    num_scheduled: 0,
    trigger_status: { healthy: 0, failed: 0, warning: 0 },
  },
  pipelines: {
    num_realtime: 0,
    num_scheduled: 0,
    trigger_status: { healthy: 0, failed: 0, warning: 0 },
  },
  total_dashboards: 0,
  total_functions: 0,
};

// ── Module mocks (hoisted by Vitest) ────────────────────────────────────────

vi.mock("@/services/organizations", () => ({
  default: {
    get_organization_summary: vi.fn(),
  },
}));

vi.mock("@/aws-exports", () => ({
  default: {
    isCloud: "false",
    isEnterprise: "false",
  },
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    formatSizeFromMB: vi.fn((sizeInMB: unknown) => `${sizeInMB} MB`),
    getImageURL: vi.fn((path: string) => `/mock-assets/${path}`),
  };
});

vi.mock("@quasar/extras/material-icons-outlined", () => ({
  outlinedWindow: "outlined_window",
}));

// Mock Quasar useQuasar — notify must return a function for the dismiss pattern
const mockNotifyDismiss = vi.fn();
const mockNotify = vi.fn().mockReturnValue(mockNotifyDismiss);

vi.mock("quasar", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useQuasar: () => ({ notify: mockNotify }),
  };
});

// ── Import component under test (after all mocks) ───────────────────────────

import orgService from "@/services/organizations";
import UsageTab from "./UsageTab.vue";

installQuasar({ plugins: [Dialog, Notify] });

// ── Mount factory ───────────────────────────────────────────────────────────

function mountUsageTab() {
  return mount(UsageTab, {
    global: {
      plugins: [store, router, i18n],
      stubs: {
        WebinarBanner: true,
        TrialPeriod: true,
        LicensePeriod: true,
        UsageReportBanner: true,
        DatabaseDeprecationBanner: true,
        HomeViewSkeleton: {
          template:
            '<div data-test="usage-tab-loading-skeleton">Loading skeleton</div>',
        },
        CustomChartRenderer: {
          template:
            '<div data-test="usage-tab-custom-chart-renderer"></div>',
          props: ["data"],
        },
        OButton: {
          template: '<button data-test="usage-tab-o-button"><slot /></button>',
          props: ["variant", "size", "ariaLabel", "title"],
        },
        OSeparator: {
          template: '<div data-test="usage-tab-o-separator"></div>',
          props: ["vertical"],
        },
        "router-link": {
          template: '<a data-test="usage-tab-router-link"><slot /></a>',
          props: ["to", "exact"],
        },
        "q-icon": {
          template: '<span class="q-icon-stub"></span>',
          props: ["name", "size"],
        },
      },
      provide: {
        ...qLayoutInjections(),
      },
    },
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("UsageTab", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply mocks that vi.clearAllMocks() strips
    mockNotify.mockReturnValue(mockNotifyDismiss);
    // Default: API returns populated summary data
    vi.mocked(orgService.get_organization_summary).mockResolvedValue({
      data: mockSummaryData,
    });
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  // ── initial render ──────────────────────────────────────────────────────

  describe("initial render", () => {
    it("should render without errors", async () => {
      wrapper = mountUsageTab();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });
  });

  // ── loading state ───────────────────────────────────────────────────────

  describe("loading state", () => {
    it("should show loading skeleton while summary is being fetched", async () => {
      // Defer promise resolution so isLoadingSummary stays true
      let resolvePromise: (value: any) => void;
      vi.mocked(orgService.get_organization_summary).mockReturnValueOnce(
        new Promise((resolve) => {
          resolvePromise = resolve;
        }),
      );

      wrapper = mountUsageTab();
      await wrapper.vm.$nextTick();

      expect(
        wrapper.find('[data-test="usage-tab-loading-skeleton"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="usage-tab-loading-skeleton"]').text(),
      ).toBe("Loading skeleton");

      // Resolve and clean up
      resolvePromise!({ data: mockSummaryData });
      await flushPromises();
    });

    it("should hide the skeleton once loading completes", async () => {
      wrapper = mountUsageTab();
      await flushPromises();
      expect(
        wrapper.find('[data-test="usage-tab-loading-skeleton"]').exists(),
      ).toBe(false);
    });
  });

  // ── empty state ─────────────────────────────────────────────────────────

  describe("empty state", () => {
    it("should show no-data panel when API returns all zero counts", async () => {
      vi.mocked(orgService.get_organization_summary).mockResolvedValueOnce({
        data: mockEmptySummaryData,
      });

      wrapper = mountUsageTab();
      await flushPromises();

      expect(wrapper.find(".home-no-data-panel").exists()).toBe(true);
    });

    it("should show the noData message text in empty state", async () => {
      vi.mocked(orgService.get_organization_summary).mockResolvedValueOnce({
        data: mockEmptySummaryData,
      });

      wrapper = mountUsageTab();
      await flushPromises();

      const panel = wrapper.find(".home-no-data-panel");
      expect(panel.exists()).toBe(true);
      // i18n keys are rendered as-is with the stub
      expect(panel.text()).toContain("home.noData");
      expect(panel.text()).toContain("home.ingestionMsg");
    });
  });

  // ── data with summary ───────────────────────────────────────────────────

  describe("when summary data is loaded", () => {
    beforeEach(async () => {
      wrapper = mountUsageTab();
      await flushPromises();
    });

    it("should render the streams overview section", () => {
      const streamsSection = wrapper.find(
        '[aria-label="Streams overview section"]',
      );
      expect(streamsSection.exists()).toBe(true);
    });

    it("should render streams count tile", () => {
      const tile = wrapper.find('[aria-label="Streams count statistics"]');
      expect(tile.exists()).toBe(true);
      expect(tile.find(".data-to-display").text()).toBe("5");
    });

    it("should render events count tile", () => {
      const tile = wrapper.find('[aria-label="Events count statistics"]');
      expect(tile.exists()).toBe(true);
      // formatEventCount(10000) -> "10000" (falls back to summary.doc_count)
      expect(tile.find(".data-to-display").text()).toBe("10000");
    });

    it("should render ingested data size tile", () => {
      const tile = wrapper.find(
        '[aria-label="Ingested data size statistics"]',
      );
      expect(tile.exists()).toBe(true);
      // fallback: summary.value.ingested_data = formatSizeFromMB(2000) -> "2000 MB"
      expect(tile.find(".data-to-display").text()).toBe("2000 MB");
    });

    it("should render the functions tile", () => {
      const tile = wrapper.find('[aria-label="Functions count statistics"]');
      expect(tile.exists()).toBe(true);
      expect(tile.find(".data-to-display").text()).toBe("3");
    });

    it("should render the dashboards tile", () => {
      const tile = wrapper.find('[aria-label="Dashboards count statistics"]');
      expect(tile.exists()).toBe(true);
      expect(tile.find(".data-to-display").text()).toBe("4");
    });

    it("should render the alerts overview section", () => {
      const section = wrapper.find('[aria-label="Alerts overview section"]');
      expect(section.exists()).toBe(true);
    });

    it("should render the pipelines overview section", () => {
      const section = wrapper.find(
        '[aria-label="Pipelines overview section"]',
      );
      expect(section.exists()).toBe(true);
    });

    it("should render the CustomChartRenderer for alerts", () => {
      expect(wrapper.findAll('[data-test="usage-tab-custom-chart-renderer"]').length).toBe(2);
    });

    it("should show scheduled and real-time alert counts", () => {
      const section = wrapper.find('[aria-label="Alerts overview section"]');
      const resultsCounts = section.findAll(".results-count");
      // Two results-count elements: scheduled alerts and real-time alerts
      expect(resultsCounts.length).toBe(2);
      // animated counts are 0, so fallback to summary values
      expect(resultsCounts[0].text()).toBe("3");
      expect(resultsCounts[1].text()).toBe("2");
    });

    it("should show scheduled and real-time pipeline counts", () => {
      const section = wrapper.find(
        '[aria-label="Pipelines overview section"]',
      );
      const resultsCounts = section.findAll(".results-count");
      expect(resultsCounts.length).toBe(2);
      // animated counts are 0, so fallback to summary values
      expect(resultsCounts[0].text()).toBe("2");
      expect(resultsCounts[1].text()).toBe("1");
    });

    it("should not show the empty-state panel when data exists", () => {
      expect(wrapper.find(".home-no-data-panel").exists()).toBe(false);
    });
  });

  // ── non-cloud feature tiles ─────────────────────────────────────────────
  // These tiles are gated by v-if="config.isCloud == 'false'" in the template.
  // The default mock sets isCloud: "false", so they are always rendered.
  // Testing cloud-mode (where they are hidden) requires a separate spec file
  // because vi.mock("@/aws-exports") is hoisted and cannot be changed per test.

  describe("non-cloud feature tiles", () => {
    beforeEach(async () => {
      wrapper = mountUsageTab();
      await flushPromises();
    });

    it("should render compressed data size tile when isCloud is false", () => {
      const tile = wrapper.find(
        '[aria-label="Compressed data size statistics"]',
      );
      expect(tile.exists()).toBe(true);
      expect(tile.find(".data-to-display").text()).toBe("500 MB");
    });

    it("should render index size tile when isCloud is false", () => {
      const tile = wrapper.find('[aria-label="Index size statistics"]');
      expect(tile.exists()).toBe(true);
      expect(tile.find(".data-to-display").text()).toBe("100 MB");
    });
  });

  // ── API call behavior ───────────────────────────────────────────────────

  describe("API calls", () => {
    it("should call get_organization_summary on mount with the org identifier", async () => {
      wrapper = mountUsageTab();
      await flushPromises();

      expect(orgService.get_organization_summary).toHaveBeenCalledTimes(1);
      expect(orgService.get_organization_summary).toHaveBeenCalledWith(
        "default",
      );
    });

    it("should show a loading notification while fetching", async () => {
      wrapper = mountUsageTab();
      await flushPromises();

      expect(mockNotify).toHaveBeenCalledWith({
        spinner: true,
        message: "Please wait while loading summary...",
      });
      // The returned dismiss function should have been called
      expect(mockNotifyDismiss).toHaveBeenCalled();
    });

    it("should re-fetch summary when the org identifier changes", async () => {
      wrapper = mountUsageTab();
      await flushPromises();

      expect(orgService.get_organization_summary).toHaveBeenCalledTimes(1);

      // Change the org identifier in the store
      store.state.selectedOrganization.identifier = "new-org";
      await flushPromises();

      expect(orgService.get_organization_summary).toHaveBeenCalledTimes(2);
      expect(orgService.get_organization_summary).toHaveBeenLastCalledWith(
        "new-org",
      );
    });

    it("should re-fetch when org changes and summary was previously empty", async () => {
      // First, load with empty summary
      vi.mocked(orgService.get_organization_summary).mockResolvedValueOnce({
        data: mockEmptySummaryData,
      });

      wrapper = mountUsageTab();
      await flushPromises();

      expect(orgService.get_organization_summary).toHaveBeenCalledTimes(1);

      // Change org — even though summary is not populated, it should re-fetch
      store.state.selectedOrganization.identifier = "next-org";
      await flushPromises();

      // The watcher condition also triggers when Object.keys(summary.value).length === 0
      // In empty state, summary.value is set to {} so it should re-fetch
      expect(orgService.get_organization_summary).toHaveBeenCalledTimes(2);
    });

    it("should handle API errors gracefully", async () => {
      vi.mocked(orgService.get_organization_summary).mockRejectedValueOnce(
        new Error("Network failure"),
      );

      wrapper = mountUsageTab();
      await flushPromises();

      // After error, the component should not crash; isLoadingSummary should be false
      expect((wrapper.vm as any).isLoadingSummary).toBe(false);
      // Error notification should have been shown
      expect(mockNotify).toHaveBeenCalledWith({
        type: "negative",
        message: "Error while pulling summary.",
        timeout: 2000,
      });
    });

    it("should handle null/undefined values in response data", async () => {
      vi.mocked(orgService.get_organization_summary).mockResolvedValueOnce({
        data: {
          streams: {
            num_streams: null,
            total_storage_size: null,
            total_records: null,
          },
          pipelines: null,
          alerts: null,
          total_dashboards: null,
          total_functions: null,
        },
      });

      wrapper = mountUsageTab();
      await flushPromises();

      // Should not crash and should treat nulls as zeros
      expect((wrapper.vm as any).summary.streams_count).toBe(0);
      expect((wrapper.vm as any).summary.scheduled_pipelines).toBe(0);
      expect((wrapper.vm as any).summary.rt_pipelines).toBe(0);
    });

    it("should handle malformed API response with missing data", async () => {
      vi.mocked(orgService.get_organization_summary).mockResolvedValueOnce({
        data: null,
      } as any);

      wrapper = mountUsageTab();
      await flushPromises();

      // Should not crash
      expect(wrapper.exists()).toBe(true);
    });
  });
});
