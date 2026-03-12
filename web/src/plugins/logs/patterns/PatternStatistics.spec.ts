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

  describe("Summary Text", () => {
    it("should display summary with correct statistics", () => {
      const summaryElement = wrapper.find('[data-test="pattern-statistics"]');
      const summaryText = summaryElement.text();

      // Check that summary contains the key statistics
      expect(summaryText).toContain("1,000"); // logs analyzed
      expect(summaryText).toContain("42"); // patterns found
      expect(summaryText).toContain("events");
      expect(summaryText).toContain("patterns found");
      expect(summaryText).toContain("ms");
    });

    it("should display correct format", () => {
      const summaryElement = wrapper.find('[data-test="pattern-statistics"]');
      const summaryText = summaryElement.text();

      // Check the full format
      expect(summaryText).toMatch(/Showing 1 to 50 out of \d+/);
      expect(summaryText).toMatch(/\d+ patterns found in \d+/);
    });

    it("should handle totalEvents prop", async () => {
      await wrapper.setProps({
        statistics: mockStatistics,
        totalEvents: 5000,
      });

      const summaryElement = wrapper.find('[data-test="pattern-statistics"]');
      const summaryText = summaryElement.text();

      expect(summaryText).toContain("5,000"); // totalEvents
    });

    it("should combine histogram time with extraction time", async () => {
      await wrapper.setProps({
        statistics: mockStatistics,
        histogramTime: 50,
      });

      const summaryElement = wrapper.find('[data-test="pattern-statistics"]');
      const summaryText = summaryElement.text();

      // Should show 50 (histogram) + 150 (extraction) = 200ms
      expect(summaryText).toContain("200 ms");
    });
  });

  describe("Empty Statistics", () => {
    it("should display zero values when statistics are null", async () => {
      await wrapper.setProps({
        statistics: null,
      });

      const summaryElement = wrapper.find('[data-test="pattern-statistics"]');
      const summaryText = summaryElement.text();

      expect(summaryText).toContain("0 patterns found");
      expect(summaryText).toContain("0 events");
    });
  });

  // --- New tests covering functionality added in Dec 29 changes ---

  describe("histogramTime prop", () => {
    it("should use only extraction_time_ms when histogramTime is not provided", () => {
      const summaryElement = wrapper.find('[data-test="pattern-statistics"]');
      const summaryText = summaryElement.text();
      // histogramTime defaults to 0, extraction_time_ms is 150 → total = 150ms
      expect(summaryText).toContain("150 ms");
    });

    it("should use only extraction_time_ms when histogramTime is 0", async () => {
      await wrapper.setProps({ histogramTime: 0 });
      const summaryElement = wrapper.find('[data-test="pattern-statistics"]');
      expect(summaryElement.text()).toContain("150 ms");
    });

    it("should sum histogramTime and extraction_time_ms for total time", async () => {
      await wrapper.setProps({ histogramTime: 100 });
      const summaryElement = wrapper.find('[data-test="pattern-statistics"]');
      // 100 + 150 = 250ms
      expect(summaryElement.text()).toContain("250 ms");
    });

    it("should show 0 ms when both histogramTime and extraction_time_ms are absent", async () => {
      await wrapper.setProps({
        statistics: { total_patterns_found: 5, total_logs_analyzed: 200 },
        histogramTime: 0,
      });
      const summaryElement = wrapper.find('[data-test="pattern-statistics"]');
      expect(summaryElement.text()).toContain("0 ms");
    });
  });

  describe("totalEvents prop", () => {
    it("should fall back to total_logs_analyzed for event count when totalEvents is absent", () => {
      const summaryElement = wrapper.find('[data-test="pattern-statistics"]');
      const summaryText = summaryElement.text();
      // totalEvents not set → uses logsAnalyzed = 1,000
      expect(summaryText).toContain("1,000");
    });

    it("should use totalEvents for event count when provided", async () => {
      await wrapper.setProps({ totalEvents: 9999 });
      const summaryElement = wrapper.find('[data-test="pattern-statistics"]');
      expect(summaryElement.text()).toContain("9,999");
    });

    it("should format totalEvents with locale separators", async () => {
      await wrapper.setProps({ totalEvents: 1000000 });
      const summaryElement = wrapper.find('[data-test="pattern-statistics"]');
      expect(summaryElement.text()).toContain("1,000,000");
    });

    it("should format total_logs_analyzed with locale separators in fallback path", async () => {
      await wrapper.setProps({
        statistics: { ...mockStatistics, total_logs_analyzed: 50000 },
        totalEvents: undefined,
      });
      const summaryElement = wrapper.find('[data-test="pattern-statistics"]');
      expect(summaryElement.text()).toContain("50,000");
    });
  });

  describe("summaryText computed property", () => {
    it("should always start with 'Showing 1 to 50 out of'", () => {
      const summaryElement = wrapper.find('[data-test="pattern-statistics"]');
      expect(summaryElement.text()).toMatch(/^Showing 1 to 50 out of/);
    });

    it("should include patterns found count in the output", () => {
      const summaryElement = wrapper.find('[data-test="pattern-statistics"]');
      expect(summaryElement.text()).toContain("42 patterns found");
    });

    it("should include logs analyzed count in the 'in X events' clause", () => {
      const summaryElement = wrapper.find('[data-test="pattern-statistics"]');
      // logs analyzed = 1000 → "in 1,000 events"
      expect(summaryElement.text()).toContain("in 1,000 events");
    });

    it("should produce correct full summary string", async () => {
      await wrapper.setProps({ histogramTime: 0 });
      const summaryElement = wrapper.find('[data-test="pattern-statistics"]');
      expect(summaryElement.text()).toBe(
        "Showing 1 to 50 out of 1,000 events & 42 patterns found in 1,000 events in 150 ms.",
      );
    });
  });

  describe("data-test attribute", () => {
    it("should always render the pattern-statistics container", () => {
      expect(wrapper.find('[data-test="pattern-statistics"]').exists()).toBe(true);
    });

    it("should still render the container when statistics is null", async () => {
      await wrapper.setProps({ statistics: null });
      expect(wrapper.find('[data-test="pattern-statistics"]').exists()).toBe(true);
    });
  });
});
