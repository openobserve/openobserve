// Copyright 2023 OpenObserve Inc.
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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import PatternStatistics from "./PatternStatistics.vue";
import store from "@/test/unit/helpers/store";

installQuasar({
  plugins: [quasar.Notify],
});

describe("PatternStatistics", () => {
  let wrapper: any;
  const mockStatistics = {
    total_patterns_found: 42,
    coverage_percentage: 87.5,
    extraction_time_ms: 150,
    total_logs_analyzed: 1000,
  };

  beforeEach(() => {
    wrapper = mount(PatternStatistics, {
      props: {
        statistics: mockStatistics,
        scanSize: 1000,
      },
      global: {
        provide: { store },
      },
    });
  });

  it("should mount PatternStatistics component", () => {
    expect(wrapper.exists()).toBe(true);
    expect(
      wrapper.find('[data-test="pattern-statistics"]').exists(),
    ).toBe(true);
  });

  describe("Statistics Cards", () => {
    it("should display logs analyzed card with correct value", () => {
      const logsAnalyzedCard = wrapper.find(
        '[data-test="pattern-stats-logs-analyzed-card"]',
      );
      expect(logsAnalyzedCard.exists()).toBe(true);

      const scanSizeValue = wrapper.find(
        '[data-test="pattern-stats-scan-size-value"]',
      );
      expect(scanSizeValue.text()).toBe("1,000");
    });

    it("should display patterns found card with correct value", () => {
      const patternsFoundCard = wrapper.find(
        '[data-test="pattern-stats-patterns-found-card"]',
      );
      expect(patternsFoundCard.exists()).toBe(true);

      const patternsFoundValue = wrapper.find(
        '[data-test="pattern-stats-patterns-found-value"]',
      );
      expect(patternsFoundValue.text()).toBe("42");
    });

    it("should display coverage card with correct value", () => {
      const coverageCard = wrapper.find(
        '[data-test="pattern-stats-coverage-card"]',
      );
      expect(coverageCard.exists()).toBe(true);

      const coverageValue = wrapper.find(
        '[data-test="pattern-stats-coverage-value"]',
      );
      expect(coverageValue.text()).toBe("87.5%");
    });

    it("should display processing time card with correct value", () => {
      const processingTimeCard = wrapper.find(
        '[data-test="pattern-stats-processing-time-card"]',
      );
      expect(processingTimeCard.exists()).toBe(true);

      const processingTimeValue = wrapper.find(
        '[data-test="pattern-stats-processing-time-value"]',
      );
      expect(processingTimeValue.text()).toBe("150ms");
    });
  });

  describe("Scan Size Edit Functionality", () => {
    it("should show edit button in view mode", () => {
      const editButton = wrapper.find(
        '[data-test="pattern-stats-edit-scan-size-btn"]',
      );
      expect(editButton.exists()).toBe(true);

      const displayMode = wrapper.find(
        '[data-test="pattern-stats-scan-size-display"]',
      );
      expect(displayMode.exists()).toBe(true);
    });

    it("should switch to edit mode when edit button is clicked", async () => {
      const editButton = wrapper.find(
        '[data-test="pattern-stats-edit-scan-size-btn"]',
      );
      await editButton.trigger("click");

      const editMode = wrapper.find(
        '[data-test="pattern-stats-scan-size-edit"]',
      );
      expect(editMode.exists()).toBe(true);

      const input = wrapper.find(
        '[data-test="pattern-stats-scan-size-input"]',
      );
      expect(input.exists()).toBe(true);
    });

    it("should emit update event when scan size is changed", async () => {
      // Click edit button to enter edit mode
      const editButton = wrapper.find(
        '[data-test="pattern-stats-edit-scan-size-btn"]',
      );
      await editButton.trigger("click");
      await wrapper.vm.$nextTick();

      // Directly set the localScanSize ref in the component
      wrapper.vm.localScanSize = 2000;
      await wrapper.vm.$nextTick();

      // Call updateScanSize method directly
      wrapper.vm.updateScanSize();
      await wrapper.vm.$nextTick();

      // Check if update:scanSize event was emitted
      expect(wrapper.emitted("update:scanSize")).toBeTruthy();
      expect(wrapper.emitted("update:scanSize")![0]).toEqual([2000]);
    });

    it("should cancel edit mode on escape key", async () => {
      // Click edit button
      const editButton = wrapper.find(
        '[data-test="pattern-stats-edit-scan-size-btn"]',
      );
      await editButton.trigger("click");

      // Find input and press escape
      const input = wrapper.find(
        '[data-test="pattern-stats-scan-size-input"]',
      );
      await input.trigger("keyup.escape");

      // Should return to view mode
      await wrapper.vm.$nextTick();
      const displayMode = wrapper.find(
        '[data-test="pattern-stats-scan-size-display"]',
      );
      expect(displayMode.exists()).toBe(true);
    });
  });

  describe("Empty Statistics", () => {
    it("should display zero values when statistics are null", async () => {
      await wrapper.setProps({
        statistics: null,
        scanSize: 500,
      });

      const patternsFoundValue = wrapper.find(
        '[data-test="pattern-stats-patterns-found-value"]',
      );
      expect(patternsFoundValue.text()).toBe("0");

      const coverageValue = wrapper.find(
        '[data-test="pattern-stats-coverage-value"]',
      );
      expect(coverageValue.text()).toBe("0.0%");

      const processingTimeValue = wrapper.find(
        '[data-test="pattern-stats-processing-time-value"]',
      );
      expect(processingTimeValue.text()).toBe("0ms");
    });
  });
});
