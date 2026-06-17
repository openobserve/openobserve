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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { reactive } from "vue";
import i18n from "@/locales";

// ---------------------------------------------------------------------------
// Shared reactive mock — mutated per test to drive computed properties
// ---------------------------------------------------------------------------
const mockSearchObj = reactive({
  data: {
    datetime: {
      type: "relative" as string,
      relativeTimePeriod: "15m" as string,
    },
  },
});

// vi.mock() is hoisted — must be declared before the component import
vi.mock("@/composables/useTraces", () => ({
  default: () => ({ searchObj: mockSearchObj }),
}));

import ServicesCatalogNoDataState from "./ServicesCatalogNoDataState.vue";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------
const OEmptyStateStub = {
  template: "<div><slot name=\"actions\" /></div>",
};

const EmptyStateActionCardStub = {
  template:
    "<button @click=\"$emit('click')\" :data-test=\"$attrs['data-test']\" />",
  inheritAttrs: false,
  emits: ["click"],
  props: ["icon", "label", "sublabel"],
};

// ---------------------------------------------------------------------------
// Mount factory
// ---------------------------------------------------------------------------
function mountComponent() {
  return mount(ServicesCatalogNoDataState, {
    global: {
      plugins: [i18n],
      stubs: {
        OEmptyState: OEmptyStateStub,
        EmptyStateActionCard: EmptyStateActionCardStub,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe("ServicesCatalogNoDataState", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    // Reset to relative mode with 15m so each test starts from a known state
    mockSearchObj.data.datetime.type = "relative";
    mockSearchObj.data.datetime.relativeTimePeriod = "15m";
    wrapper = mountComponent();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  describe("rendering", () => {
    it("should mount without errors", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the expand-range action card", () => {
      const card = wrapper.find(
        '[data-test="services-catalog-empty-expand-range-card"]',
      );
      expect(card.exists()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Sublabel — relative mode
  // -------------------------------------------------------------------------
  describe("expandRangeSublabel — relative mode", () => {
    it('should show "Past 15 Minutes → Past 1 Day" for relativeTimePeriod "15m"', async () => {
      // 15m = 15 mins ≤ 60 → nextWiderPeriod = "1d"
      mockSearchObj.data.datetime.relativeTimePeriod = "15m";
      await flushPromises();

      expect(wrapper.vm.expandRangeSublabel).toBe(
        "Past 15 Minutes → Past 1 Day",
      );
    });

    it('should show "Past 1 Day → Past 7 Days" for relativeTimePeriod "1d"', async () => {
      // 1d = 1440 mins ≤ 1440 → nextWiderPeriod = "7d"
      mockSearchObj.data.datetime.relativeTimePeriod = "1d";
      await flushPromises();

      expect(wrapper.vm.expandRangeSublabel).toBe("Past 1 Day → Past 7 Days");
    });

    it('should show "Past 7 Days → Past 30 Days" for relativeTimePeriod "7d"', async () => {
      // 7d = 10080 mins > 1440 → nextWiderPeriod = "30d"
      mockSearchObj.data.datetime.relativeTimePeriod = "7d";
      await flushPromises();

      expect(wrapper.vm.expandRangeSublabel).toBe(
        "Past 7 Days → Past 30 Days",
      );
    });

    it('should use singular form "Past 1 Day" not "Past 1 Days" for value 1', async () => {
      mockSearchObj.data.datetime.relativeTimePeriod = "1d";
      await flushPromises();

      expect(wrapper.vm.expandRangeSublabel).toContain("Past 1 Day");
      expect(wrapper.vm.expandRangeSublabel).not.toContain("Past 1 Days");
    });
  });

  // -------------------------------------------------------------------------
  // Sublabel — absolute mode
  // -------------------------------------------------------------------------
  describe("expandRangeSublabel — absolute mode", () => {
    it("should show the i18n expandRangeDescAbsolute message when type is absolute", async () => {
      mockSearchObj.data.datetime.type = "absolute";
      mockSearchObj.data.datetime.relativeTimePeriod = "";
      await flushPromises();

      // The component falls back to t("traces.noEvents.expandRangeDescAbsolute")
      expect(wrapper.vm.expandRangeSublabel).toBe(
        "Switch to a wider relative time range",
      );
    });

    it("should show the i18n expandRangeDescAbsolute message when relativeTimePeriod is empty", async () => {
      mockSearchObj.data.datetime.type = "relative";
      mockSearchObj.data.datetime.relativeTimePeriod = "";
      await flushPromises();

      expect(wrapper.vm.expandRangeSublabel).toBe(
        "Switch to a wider relative time range",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Emit — widen-range
  // -------------------------------------------------------------------------
  describe('emit "widen-range"', () => {
    it('should emit "widen-range" with "1d" when card is clicked and period is "15m"', async () => {
      // 15m ≤ 60 mins → suggestedPeriod = "1d"
      mockSearchObj.data.datetime.relativeTimePeriod = "15m";
      await flushPromises();

      const card = wrapper.find(
        '[data-test="services-catalog-empty-expand-range-card"]',
      );
      expect(card.exists()).toBe(true);
      await card.trigger("click");

      expect(wrapper.emitted("widen-range")).toBeTruthy();
      expect(wrapper.emitted("widen-range")![0]).toEqual(["1d"]);
    });

    it('should emit "widen-range" with "7d" when type is absolute', async () => {
      // absolute mode → suggestedPeriod falls back to "7d"
      mockSearchObj.data.datetime.type = "absolute";
      mockSearchObj.data.datetime.relativeTimePeriod = "";
      await flushPromises();

      const card = wrapper.find(
        '[data-test="services-catalog-empty-expand-range-card"]',
      );
      expect(card.exists()).toBe(true);
      await card.trigger("click");

      expect(wrapper.emitted("widen-range")).toBeTruthy();
      expect(wrapper.emitted("widen-range")![0]).toEqual(["7d"]);
    });

    it('should emit "widen-range" with "7d" when period is "1d"', async () => {
      // 1d = 1440 mins ≤ 1440 → suggestedPeriod = "7d"
      mockSearchObj.data.datetime.relativeTimePeriod = "1d";
      await flushPromises();

      const card = wrapper.find(
        '[data-test="services-catalog-empty-expand-range-card"]',
      );
      await card.trigger("click");

      expect(wrapper.emitted("widen-range")![0]).toEqual(["7d"]);
    });

    it('should emit "widen-range" with "30d" when period is "7d"', async () => {
      // 7d = 10080 mins > 1440 → suggestedPeriod = "30d"
      mockSearchObj.data.datetime.relativeTimePeriod = "7d";
      await flushPromises();

      const card = wrapper.find(
        '[data-test="services-catalog-empty-expand-range-card"]',
      );
      await card.trigger("click");

      expect(wrapper.emitted("widen-range")![0]).toEqual(["30d"]);
    });
  });
});
