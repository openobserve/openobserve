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
});
