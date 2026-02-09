// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import DedupSummaryCards from "./DedupSummaryCards.vue";
import { createStore } from "vuex";
import alertsService from "@/services/alerts";

installQuasar();

// ==================== TEST DATA FACTORIES ====================

/**
 * Creates a mock Vuex store with organization
 */
function createMockStore(orgId = "default-org") {
  return createStore({
    state: {
      selectedOrganization: {
        identifier: orgId,
      },
    },
  });
}

/**
 * Creates mock dedup summary data
 */
function createMockSummary(overrides = {}) {
  return {
    total_alerts: 100,
    alerts_with_dedup: 50,
    suppressions_total: 30,
    passed_total: 20,
    suppression_rate: 0.6,
    pending_batches: 5,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Finds an element by data-test attribute
 */
function findByTestId(wrapper: VueWrapper, testId: string) {
  return wrapper.find(`[data-test="${testId}"]`);
}

/**
 * Checks if an element exists by data-test id
 */
function existsByTestId(wrapper: VueWrapper, testId: string): boolean {
  return findByTestId(wrapper, testId).exists();
}

/**
 * Mounts the component with default test setup
 */
async function mountComponent(summaryData = createMockSummary(), orgId = "test-org") {
  const store = createMockStore(orgId);

  // Mock the alertsService
  vi.spyOn(alertsService, "get_dedup_summary").mockResolvedValue({
    data: summaryData,
  });

  const wrapper = mount(DedupSummaryCards, {
    global: {
      plugins: [store],
    },
  });

  await flushPromises();
  return wrapper;
}

// ==================== TESTS ====================

describe("DedupSummaryCards", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
  });

  describe("Component Rendering", () => {
    it("should render the component", async () => {
      wrapper = await mountComponent();
      expect(wrapper.exists()).toBe(true);
      expect(existsByTestId(wrapper, "dedup-summary-cards")).toBe(true);
    });

    it("should render all four summary cards", async () => {
      wrapper = await mountComponent();
      expect(existsByTestId(wrapper, "total-alerts-card")).toBe(true);
      expect(existsByTestId(wrapper, "alerts-with-dedup-card")).toBe(true);
      expect(existsByTestId(wrapper, "suppression-rate-card")).toBe(true);
      expect(existsByTestId(wrapper, "pending-batches-card")).toBe(true);
    });
  });

  describe("Card 1: Total Alerts", () => {
    it("should display total alerts value", async () => {
      wrapper = await mountComponent(createMockSummary({ total_alerts: 150 }));
      const value = findByTestId(wrapper, "total-alerts-value");
      expect(value.text()).toBe("150");
    });

    it("should display correct label", async () => {
      wrapper = await mountComponent();
      const label = findByTestId(wrapper, "total-alerts-label");
      expect(label.text()).toBe("Total Alerts");
    });

    it("should display zero when no alerts", async () => {
      wrapper = await mountComponent(createMockSummary({ total_alerts: 0 }));
      const value = findByTestId(wrapper, "total-alerts-value");
      expect(value.text()).toBe("0");
    });

    it("should display large numbers correctly", async () => {
      wrapper = await mountComponent(createMockSummary({ total_alerts: 99999 }));
      const value = findByTestId(wrapper, "total-alerts-value");
      expect(value.text()).toBe("99999");
    });
  });

  describe("Card 2: Alerts with Dedup", () => {
    it("should display alerts with dedup value", async () => {
      wrapper = await mountComponent(createMockSummary({ alerts_with_dedup: 75 }));
      const value = findByTestId(wrapper, "alerts-with-dedup-value");
      expect(value.text()).toBe("75");
    });

    it("should display correct label", async () => {
      wrapper = await mountComponent();
      const label = findByTestId(wrapper, "alerts-with-dedup-label");
      expect(label.text()).toContain("Using Deduplication");
    });

    it("should render filter icon", async () => {
      wrapper = await mountComponent();
      expect(existsByTestId(wrapper, "dedup-filter-icon")).toBe(true);
      const icon = findByTestId(wrapper, "dedup-filter-icon");
      const qIcon = icon.findComponent({ name: "QIcon" });
      expect(qIcon.props("name")).toBe("filter_alt");
    });

    it("should render info icon with tooltip", async () => {
      wrapper = await mountComponent();
      expect(existsByTestId(wrapper, "dedup-info-icon")).toBe(true);
      const icon = findByTestId(wrapper, "dedup-info-icon");
      const tooltip = icon.findComponent({ name: "QTooltip" });
      expect(tooltip.exists()).toBe(true);
    });

  });

  describe("Card 3: Suppression Rate", () => {
    it("should display suppression rate as percentage", async () => {
      wrapper = await mountComponent(createMockSummary({ suppression_rate: 0.75 }));
      const value = findByTestId(wrapper, "suppression-rate-value");
      expect(value.text()).toBe("75.0%");
    });

    it("should display 0% when rate is zero", async () => {
      wrapper = await mountComponent(createMockSummary({ suppression_rate: 0 }));
      const value = findByTestId(wrapper, "suppression-rate-value");
      expect(value.text()).toBe("0%");
    });

    it("should format rate with one decimal place", async () => {
      wrapper = await mountComponent(createMockSummary({ suppression_rate: 0.456 }));
      const value = findByTestId(wrapper, "suppression-rate-value");
      expect(value.text()).toBe("45.6%");
    });

    it("should apply green styling when rate > 0.5", async () => {
      wrapper = await mountComponent(createMockSummary({ suppression_rate: 0.8 }));
      const card = findByTestId(wrapper, "suppression-rate-card");
      const value = findByTestId(wrapper, "suppression-rate-value");

      expect(card.classes()).toContain("tw:bg-green-50");
      expect(value.classes()).toContain("tw:text-green-700");
    });

    it("should apply yellow styling when rate > 0 and <= 0.5", async () => {
      wrapper = await mountComponent(createMockSummary({ suppression_rate: 0.3 }));
      const card = findByTestId(wrapper, "suppression-rate-card");
      const value = findByTestId(wrapper, "suppression-rate-value");

      expect(card.classes()).toContain("tw:bg-yellow-50");
      expect(value.classes()).toContain("tw:text-yellow-700");
    });

    it("should apply no special styling when rate is 0", async () => {
      wrapper = await mountComponent(createMockSummary({ suppression_rate: 0 }));
      const card = findByTestId(wrapper, "suppression-rate-card");
      const value = findByTestId(wrapper, "suppression-rate-value");

      expect(card.classes()).not.toContain("tw:bg-green-50");
      expect(card.classes()).not.toContain("tw:bg-yellow-50");
      expect(value.classes()).not.toContain("tw:text-green-700");
      expect(value.classes()).not.toContain("tw:text-yellow-700");
    });

    it("should handle boundary case at exactly 0.5", async () => {
      wrapper = await mountComponent(createMockSummary({ suppression_rate: 0.5 }));
      const card = findByTestId(wrapper, "suppression-rate-card");

      expect(card.classes()).toContain("tw:bg-yellow-50");
      expect(card.classes()).not.toContain("tw:bg-green-50");
    });

    it("should display correct label", async () => {
      wrapper = await mountComponent();
      const label = findByTestId(wrapper, "suppression-rate-label");
      expect(label.text()).toContain("Suppression Rate (24h)");
    });

    it("should render info icon with tooltip", async () => {
      wrapper = await mountComponent();
      expect(existsByTestId(wrapper, "suppression-info-icon")).toBe(true);
      const icon = findByTestId(wrapper, "suppression-info-icon");
      const tooltip = icon.findComponent({ name: "QTooltip" });
      expect(tooltip.exists()).toBe(true);
    });

  });

  describe("Card 4: Pending Batches", () => {
    it("should display pending batches value", async () => {
      wrapper = await mountComponent(createMockSummary({ pending_batches: 12 }));
      const value = findByTestId(wrapper, "pending-batches-value");
      expect(value.text()).toBe("12");
    });

    it("should display correct label", async () => {
      wrapper = await mountComponent();
      const label = findByTestId(wrapper, "pending-batches-label");
      expect(label.text()).toContain("Pending Batches");
    });

    it("should render group work icon", async () => {
      wrapper = await mountComponent();
      expect(existsByTestId(wrapper, "pending-batches-icon")).toBe(true);
      const icon = findByTestId(wrapper, "pending-batches-icon");
      const qIcon = icon.findComponent({ name: "QIcon" });
      expect(qIcon.props("name")).toBe("group_work");
    });

    it("should render info icon with tooltip", async () => {
      wrapper = await mountComponent();
      expect(existsByTestId(wrapper, "pending-batches-info-icon")).toBe(true);
      const icon = findByTestId(wrapper, "pending-batches-info-icon");
      const tooltip = icon.findComponent({ name: "QTooltip" });
      expect(tooltip.exists()).toBe(true);
    });

    it("should display zero when no pending batches", async () => {
      wrapper = await mountComponent(createMockSummary({ pending_batches: 0 }));
      const value = findByTestId(wrapper, "pending-batches-value");
      expect(value.text()).toBe("0");
    });
  });

  describe("Data Fetching", () => {
    it("should fetch summary data on mount", async () => {
      const spy = vi.spyOn(alertsService, "get_dedup_summary");
      wrapper = await mountComponent();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith("test-org");
    });

    it("should use correct organization ID from store", async () => {
      const spy = vi.spyOn(alertsService, "get_dedup_summary");
      wrapper = await mountComponent(createMockSummary(), "custom-org-123");

      expect(spy).toHaveBeenCalledWith("custom-org-123");
    });

    it("should update summary data after fetch", async () => {
      const mockData = createMockSummary({
        total_alerts: 200,
        suppression_rate: 0.85,
      });

      wrapper = await mountComponent(mockData);

      const totalValue = findByTestId(wrapper, "total-alerts-value");
      const rateValue = findByTestId(wrapper, "suppression-rate-value");

      expect(totalValue.text()).toBe("200");
      expect(rateValue.text()).toBe("85.0%");
    });

    it("should handle fetch error gracefully", async () => {
      vi.clearAllMocks();
      vi.spyOn(alertsService, "get_dedup_summary").mockRejectedValue(
        new Error("Network error")
      );
      vi.spyOn(console, "error").mockImplementation(() => {});

      const store = createMockStore("test-org");
      wrapper = mount(DedupSummaryCards, {
        global: {
          plugins: [store],
        },
      });

      await flushPromises();

      // Component should still render with initial zero values
      expect(wrapper.exists()).toBe(true);
      expect(findByTestId(wrapper, "total-alerts-value").text()).toBe("0");
    });
  });

  describe("Exposed Methods", () => {
    it("should expose fetchSummary method", async () => {
      wrapper = await mountComponent();
      expect(wrapper.vm.fetchSummary).toBeDefined();
      expect(typeof wrapper.vm.fetchSummary).toBe("function");
    });

    it("should allow parent to refresh data via fetchSummary", async () => {
      const initialData = createMockSummary({ total_alerts: 100 });
      wrapper = await mountComponent(initialData);

      const updatedData = createMockSummary({ total_alerts: 150 });
      vi.spyOn(alertsService, "get_dedup_summary").mockResolvedValue({
        data: updatedData,
      });

      await wrapper.vm.fetchSummary();
      await flushPromises();

      const value = findByTestId(wrapper, "total-alerts-value");
      expect(value.text()).toBe("150");
    });
  });

  describe("Percentage Formatting", () => {
    it("should format 0 as '0%'", async () => {
      wrapper = await mountComponent(createMockSummary({ suppression_rate: 0 }));
      const value = findByTestId(wrapper, "suppression-rate-value");
      expect(value.text()).toBe("0%");
    });

    it("should format 1.0 as '100.0%'", async () => {
      wrapper = await mountComponent(createMockSummary({ suppression_rate: 1.0 }));
      const value = findByTestId(wrapper, "suppression-rate-value");
      expect(value.text()).toBe("100.0%");
    });

    it("should round to one decimal place", async () => {
      wrapper = await mountComponent(createMockSummary({ suppression_rate: 0.12345 }));
      const value = findByTestId(wrapper, "suppression-rate-value");
      expect(value.text()).toBe("12.3%");
    });

    it("should handle very small rates", async () => {
      wrapper = await mountComponent(createMockSummary({ suppression_rate: 0.001 }));
      const value = findByTestId(wrapper, "suppression-rate-value");
      expect(value.text()).toBe("0.1%");
    });
  });

  describe("Edge Cases", () => {
    it("should handle all zero values", async () => {
      wrapper = await mountComponent(
        createMockSummary({
          total_alerts: 0,
          alerts_with_dedup: 0,
          suppressions_total: 0,
          passed_total: 0,
          suppression_rate: 0,
          pending_batches: 0,
        })
      );

      expect(findByTestId(wrapper, "total-alerts-value").text()).toBe("0");
      expect(findByTestId(wrapper, "alerts-with-dedup-value").text()).toBe("0");
      expect(findByTestId(wrapper, "suppression-rate-value").text()).toBe("0%");
      expect(findByTestId(wrapper, "pending-batches-value").text()).toBe("0");
    });

    it("should handle very large numbers", async () => {
      wrapper = await mountComponent(
        createMockSummary({
          total_alerts: 999999,
          alerts_with_dedup: 888888,
          pending_batches: 77777,
        })
      );

      expect(findByTestId(wrapper, "total-alerts-value").text()).toBe("999999");
      expect(findByTestId(wrapper, "alerts-with-dedup-value").text()).toBe("888888");
      expect(findByTestId(wrapper, "pending-batches-value").text()).toBe("77777");
    });

    it("should handle suppression rate at exact boundary values", async () => {
      // Test exactly 0.5
      wrapper = await mountComponent(createMockSummary({ suppression_rate: 0.5 }));
      let card = findByTestId(wrapper, "suppression-rate-card");
      expect(card.classes()).toContain("tw:bg-yellow-50");

      wrapper.unmount();

      // Test just above 0.5
      wrapper = await mountComponent(createMockSummary({ suppression_rate: 0.501 }));
      card = findByTestId(wrapper, "suppression-rate-card");
      expect(card.classes()).toContain("tw:bg-green-50");
    });

    it("should handle missing data gracefully", async () => {
      vi.clearAllMocks();
      vi.spyOn(alertsService, "get_dedup_summary").mockResolvedValue({
        data: null,
      });

      const store = createMockStore("test-org");
      wrapper = mount(DedupSummaryCards, {
        global: {
          plugins: [store],
        },
      });

      await flushPromises();

      // Should show initial zero values
      expect(findByTestId(wrapper, "total-alerts-value").text()).toBe("0");
    });

    it("should update all cards when data changes", async () => {
      const initialData = createMockSummary({
        total_alerts: 50,
        alerts_with_dedup: 25,
        suppression_rate: 0.3,
        pending_batches: 5,
      });

      wrapper = await mountComponent(initialData);

      const updatedData = createMockSummary({
        total_alerts: 100,
        alerts_with_dedup: 75,
        suppression_rate: 0.8,
        pending_batches: 10,
      });

      vi.spyOn(alertsService, "get_dedup_summary").mockResolvedValue({
        data: updatedData,
      });

      await wrapper.vm.fetchSummary();
      await flushPromises();

      expect(findByTestId(wrapper, "total-alerts-value").text()).toBe("100");
      expect(findByTestId(wrapper, "alerts-with-dedup-value").text()).toBe("75");
      expect(findByTestId(wrapper, "suppression-rate-value").text()).toBe("80.0%");
      expect(findByTestId(wrapper, "pending-batches-value").text()).toBe("10");
    });
  });

  describe("Integration Scenarios", () => {
    it("should handle complete data flow from mount to display", async () => {
      const mockData = createMockSummary({
        total_alerts: 250,
        alerts_with_dedup: 180,
        suppressions_total: 120,
        passed_total: 60,
        suppression_rate: 0.667,
        pending_batches: 15,
      });

      wrapper = await mountComponent(mockData);

      // Verify service was called
      expect(alertsService.get_dedup_summary).toHaveBeenCalled();

      // Verify all cards display correct data
      expect(findByTestId(wrapper, "total-alerts-value").text()).toBe("250");
      expect(findByTestId(wrapper, "alerts-with-dedup-value").text()).toBe("180");
      expect(findByTestId(wrapper, "suppression-rate-value").text()).toBe("66.7%");
      expect(findByTestId(wrapper, "pending-batches-value").text()).toBe("15");

      // Verify styling is applied correctly
      const card = findByTestId(wrapper, "suppression-rate-card");
      expect(card.classes()).toContain("tw:bg-green-50");
    });

    it("should handle theme styling transitions", async () => {
      // Start with yellow threshold
      wrapper = await mountComponent(createMockSummary({ suppression_rate: 0.4 }));
      let card = findByTestId(wrapper, "suppression-rate-card");
      expect(card.classes()).toContain("tw:bg-yellow-50");

      // Update to green threshold
      const updatedData = createMockSummary({ suppression_rate: 0.7 });
      vi.spyOn(alertsService, "get_dedup_summary").mockResolvedValue({
        data: updatedData,
      });

      await wrapper.vm.fetchSummary();
      await flushPromises();

      card = findByTestId(wrapper, "suppression-rate-card");
      expect(card.classes()).not.toContain("tw:bg-yellow-50");
      expect(card.classes()).toContain("tw:bg-green-50");
    });

    it("should maintain tooltip functionality across all cards", async () => {
      wrapper = await mountComponent();

      // Verify all tooltip components exist and have content via icon HTML
      const dedupIcon = findByTestId(wrapper, "dedup-info-icon");
      const suppressionIcon = findByTestId(wrapper, "suppression-info-icon");
      const batchesIcon = findByTestId(wrapper, "pending-batches-info-icon");

      // Check that icons contain tooltip components
      expect(dedupIcon.findComponent({ name: "QTooltip" }).exists()).toBe(true);
      expect(suppressionIcon.findComponent({ name: "QTooltip" }).exists()).toBe(true);
      expect(batchesIcon.findComponent({ name: "QTooltip" }).exists()).toBe(true);

      // Verify tooltip content is present in icon HTML
      expect(dedupIcon.html().length).toBeGreaterThan(0);
      expect(suppressionIcon.html().length).toBeGreaterThan(0);
      expect(batchesIcon.html().length).toBeGreaterThan(0);
    });
  });
});
