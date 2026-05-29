// Copyright 2026 OpenObserve Inc.
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
import DedupSummaryCards from "./DedupSummaryCards.vue";
import { createStore } from "vuex";
import alertsService from "@/services/alerts";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeStore(orgId = "test-org") {
  return createStore({
    state: { selectedOrganization: { identifier: orgId } },
  });
}

function makeSummary(overrides: Record<string, any> = {}) {
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

async function mountComp(summary = makeSummary(), orgId = "test-org") {
  const store = makeStore(orgId);
  vi.spyOn(alertsService, "get_dedup_summary").mockResolvedValue({ data: summary });
  const w = mount(DedupSummaryCards, { global: { plugins: [store] } });
  await flushPromises();
  return w;
}

function byTestId(wrapper: VueWrapper, id: string) {
  return wrapper.find(`[data-test="${id}"]`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DedupSummaryCards", () => {
  let wrapper: VueWrapper;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => { wrapper?.unmount(); vi.restoreAllMocks(); });

  describe("renders with minimum props", () => {
    it("renders the root container", async () => {
      wrapper = await mountComp();
      expect(byTestId(wrapper, "dedup-summary-cards").exists()).toBe(true);
    });

    it("renders all four cards", async () => {
      wrapper = await mountComp();
      expect(byTestId(wrapper, "total-alerts-card").exists()).toBe(true);
      expect(byTestId(wrapper, "alerts-with-dedup-card").exists()).toBe(true);
      expect(byTestId(wrapper, "suppression-rate-card").exists()).toBe(true);
      expect(byTestId(wrapper, "pending-batches-card").exists()).toBe(true);
    });
  });

  describe("Card 1 – Total Alerts", () => {
    it("displays the total_alerts value", async () => {
      wrapper = await mountComp(makeSummary({ total_alerts: 150 }));
      expect(byTestId(wrapper, "total-alerts-value").text()).toBe("150");
    });

    it("displays label text", async () => {
      wrapper = await mountComp();
      expect(byTestId(wrapper, "total-alerts-label").text()).toBe("Total Alerts");
    });

    it("shows 0 when no alerts", async () => {
      wrapper = await mountComp(makeSummary({ total_alerts: 0 }));
      expect(byTestId(wrapper, "total-alerts-value").text()).toBe("0");
    });

    it("shows large numbers correctly", async () => {
      wrapper = await mountComp(makeSummary({ total_alerts: 99999 }));
      expect(byTestId(wrapper, "total-alerts-value").text()).toBe("99999");
    });
  });

  describe("Card 2 – Alerts with Dedup", () => {
    it("displays the alerts_with_dedup value", async () => {
      wrapper = await mountComp(makeSummary({ alerts_with_dedup: 75 }));
      expect(byTestId(wrapper, "alerts-with-dedup-value").text()).toBe("75");
    });

    it("displays label text", async () => {
      wrapper = await mountComp();
      expect(byTestId(wrapper, "alerts-with-dedup-label").text()).toContain("Using Deduplication");
    });

    it("renders the filter-alt icon", async () => {
      wrapper = await mountComp();
      const icon = byTestId(wrapper, "dedup-filter-icon");
      expect(icon.exists()).toBe(true);
    });

    it("renders the info icon for tooltip", async () => {
      wrapper = await mountComp();
      expect(byTestId(wrapper, "dedup-info-icon").exists()).toBe(true);
    });
  });

  describe("Card 3 – Suppression Rate", () => {
    it("formats suppression rate as percentage", async () => {
      wrapper = await mountComp(makeSummary({ suppression_rate: 0.75 }));
      expect(byTestId(wrapper, "suppression-rate-value").text()).toBe("75.0%");
    });

    it("shows 0% when rate is zero", async () => {
      wrapper = await mountComp(makeSummary({ suppression_rate: 0 }));
      expect(byTestId(wrapper, "suppression-rate-value").text()).toBe("0%");
    });

    it("rounds to one decimal place", async () => {
      wrapper = await mountComp(makeSummary({ suppression_rate: 0.456 }));
      expect(byTestId(wrapper, "suppression-rate-value").text()).toBe("45.6%");
    });

    it("renders suppression rate card when rate > 0.5", async () => {
      wrapper = await mountComp(makeSummary({ suppression_rate: 0.8 }));
      expect(byTestId(wrapper, "suppression-rate-card").exists()).toBe(true);
      expect(byTestId(wrapper, "suppression-rate-value").text()).toBe("80.0%");
    });

    it("renders suppression rate card when 0 < rate <= 0.5", async () => {
      wrapper = await mountComp(makeSummary({ suppression_rate: 0.3 }));
      expect(byTestId(wrapper, "suppression-rate-card").exists()).toBe(true);
      expect(byTestId(wrapper, "suppression-rate-value").text()).toBe("30.0%");
    });

    it("renders suppression rate card when rate is 0", async () => {
      wrapper = await mountComp(makeSummary({ suppression_rate: 0 }));
      expect(byTestId(wrapper, "suppression-rate-card").exists()).toBe(true);
      expect(byTestId(wrapper, "suppression-rate-value").text()).toBe("0%");
    });

    it("boundary at exactly 0.5 shows 50%", async () => {
      wrapper = await mountComp(makeSummary({ suppression_rate: 0.5 }));
      expect(byTestId(wrapper, "suppression-rate-value").text()).toBe("50.0%");
    });

    it("displays label text", async () => {
      wrapper = await mountComp();
      expect(byTestId(wrapper, "suppression-rate-label").text()).toContain("Suppression Rate (24h)");
    });

    it("renders the info icon for tooltip", async () => {
      wrapper = await mountComp();
      expect(byTestId(wrapper, "suppression-info-icon").exists()).toBe(true);
    });
  });

  describe("Card 4 – Pending Batches", () => {
    it("displays pending_batches value", async () => {
      wrapper = await mountComp(makeSummary({ pending_batches: 12 }));
      expect(byTestId(wrapper, "pending-batches-value").text()).toBe("12");
    });

    it("displays label text", async () => {
      wrapper = await mountComp();
      expect(byTestId(wrapper, "pending-batches-label").text()).toContain("Pending Batches");
    });

    it("renders the group-work icon", async () => {
      wrapper = await mountComp();
      expect(byTestId(wrapper, "pending-batches-icon").exists()).toBe(true);
    });

    it("renders the info icon for tooltip", async () => {
      wrapper = await mountComp();
      expect(byTestId(wrapper, "pending-batches-info-icon").exists()).toBe(true);
    });

    it("shows 0 when no pending batches", async () => {
      wrapper = await mountComp(makeSummary({ pending_batches: 0 }));
      expect(byTestId(wrapper, "pending-batches-value").text()).toBe("0");
    });
  });

  describe("data fetching", () => {
    it("calls get_dedup_summary on mount with correct orgId", async () => {
      const spy = vi.spyOn(alertsService, "get_dedup_summary");
      wrapper = await mountComp(makeSummary(), "my-org");
      expect(spy).toHaveBeenCalledWith("my-org");
    });

    it("updates cards after fetch", async () => {
      wrapper = await mountComp(makeSummary({ total_alerts: 200, suppression_rate: 0.85 }));
      expect(byTestId(wrapper, "total-alerts-value").text()).toBe("200");
      expect(byTestId(wrapper, "suppression-rate-value").text()).toBe("85.0%");
    });

    it("keeps initial zero values on fetch error", async () => {
      vi.clearAllMocks();
      vi.spyOn(alertsService, "get_dedup_summary").mockRejectedValue(new Error("Network error"));
      const store = makeStore("test-org");
      wrapper = mount(DedupSummaryCards, { global: { plugins: [store] } });
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
      expect(byTestId(wrapper, "total-alerts-value").text()).toBe("0");
    });

    it("handles null data response gracefully", async () => {
      vi.clearAllMocks();
      vi.spyOn(alertsService, "get_dedup_summary").mockResolvedValue({ data: null });
      const store = makeStore("test-org");
      wrapper = mount(DedupSummaryCards, { global: { plugins: [store] } });
      await flushPromises();
      expect(byTestId(wrapper, "total-alerts-value").text()).toBe("0");
    });
  });

  describe("exposed fetchSummary method", () => {
    it("is callable from parent", async () => {
      wrapper = await mountComp();
      expect(typeof wrapper.vm.fetchSummary).toBe("function");
    });

    it("re-fetches and updates values when called", async () => {
      wrapper = await mountComp(makeSummary({ total_alerts: 100 }));
      vi.spyOn(alertsService, "get_dedup_summary").mockResolvedValue({
        data: makeSummary({ total_alerts: 150 }),
      });
      await wrapper.vm.fetchSummary();
      await flushPromises();
      expect(byTestId(wrapper, "total-alerts-value").text()).toBe("150");
    });
  });

  describe("formatPercentage edge cases", () => {
    it("formats 1.0 as 100.0%", async () => {
      wrapper = await mountComp(makeSummary({ suppression_rate: 1.0 }));
      expect(byTestId(wrapper, "suppression-rate-value").text()).toBe("100.0%");
    });

    it("formats small rates correctly", async () => {
      wrapper = await mountComp(makeSummary({ suppression_rate: 0.001 }));
      expect(byTestId(wrapper, "suppression-rate-value").text()).toBe("0.1%");
    });
  });

  describe("edge cases", () => {
    it("handles all-zero values", async () => {
      wrapper = await mountComp(
        makeSummary({ total_alerts: 0, alerts_with_dedup: 0, suppression_rate: 0, pending_batches: 0 })
      );
      expect(byTestId(wrapper, "total-alerts-value").text()).toBe("0");
      expect(byTestId(wrapper, "alerts-with-dedup-value").text()).toBe("0");
      expect(byTestId(wrapper, "suppression-rate-value").text()).toBe("0%");
      expect(byTestId(wrapper, "pending-batches-value").text()).toBe("0");
    });

    it("handles very large numbers", async () => {
      wrapper = await mountComp(makeSummary({ total_alerts: 999999, pending_batches: 77777 }));
      expect(byTestId(wrapper, "total-alerts-value").text()).toBe("999999");
      expect(byTestId(wrapper, "pending-batches-value").text()).toBe("77777");
    });

    it("updates suppression rate when fetchSummary is called with new data", async () => {
      wrapper = await mountComp(makeSummary({ suppression_rate: 0.4 }));
      expect(byTestId(wrapper, "suppression-rate-value").text()).toBe("40.0%");

      vi.spyOn(alertsService, "get_dedup_summary").mockResolvedValue({
        data: makeSummary({ suppression_rate: 0.7 }),
      });
      await wrapper.vm.fetchSummary();
      await flushPromises();

      expect(byTestId(wrapper, "suppression-rate-value").text()).toBe("70.0%");
    });
  });
});
