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

import { describe, expect, it, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import PatternFrequencyBar from "./PatternFrequencyBar.vue";
import {
  FREQUENCY_BAR_THRESHOLD_HIGH,
  getFrequencyBarColor,
} from "./patternUtils";

installQuasar();

function mountBar(percentage: number, isAnomaly = false, dataTestSuffix = "test") {
  return mount(PatternFrequencyBar, {
    props: { percentage, isAnomaly, dataTestSuffix },
  });
}

function getOuter(wrapper: any, suffix = "test") {
  return wrapper.find(`[data-test="patterns-patternfrequencybar-${suffix}"]`);
}

function getInnerBar(wrapper: any, suffix = "test") {
  return getOuter(wrapper, suffix).find("div");
}

describe("PatternFrequencyBar", () => {
  let wrapper: any;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("rendering", () => {
    it("should render outer container with correct data-test attribute", () => {
      wrapper = mountBar(50, false, "my-bar");
      const outer = getOuter(wrapper, "my-bar");
      expect(outer.exists()).toBe(true);
    });

    it("should render the inner bar div", () => {
      wrapper = mountBar(50);
      const bar = getInnerBar(wrapper);
      expect(bar.exists()).toBe(true);
    });

    it("should use dataTestSuffix in data-test attribute", () => {
      wrapper = mountBar(30, false, "frequency-col-3");
      expect(
        wrapper
          .find('[data-test="patterns-patternfrequencybar-frequency-col-3"]')
          .exists()
      ).toBe(true);
    });
  });

  describe("bar width", () => {
    it("should set width style to the percentage value", () => {
      wrapper = mountBar(42);
      const bar = getInnerBar(wrapper);
      expect(bar.element.style.width).toBe("42%");
    });

    it("should set width to 0% when percentage is 0", () => {
      wrapper = mountBar(0);
      const bar = getInnerBar(wrapper);
      expect(bar.element.style.width).toBe("0%");
    });

    it("should set width to 100% when percentage is 100", () => {
      wrapper = mountBar(100);
      const bar = getInnerBar(wrapper);
      expect(bar.element.style.width).toBe("100%");
    });

    it("should set width to 0% when percentage is negative", () => {
      wrapper = mountBar(-10);
      const bar = getInnerBar(wrapper);
      expect(bar.element.style.width).toBe("0%");
    });

    it("should clamp width to 100% when percentage exceeds 100", () => {
      wrapper = mountBar(150);
      const bar = getInnerBar(wrapper);
      expect(bar.element.style.width).toBe("100%");
    });

    it("should set width to 0% for a large negative value", () => {
      wrapper = mountBar(-999);
      const bar = getInnerBar(wrapper);
      expect(bar.element.style.width).toBe("0%");
    });

    it("should handle fractional percentages correctly", () => {
      wrapper = mountBar(3.75);
      const bar = getInnerBar(wrapper);
      expect(bar.element.style.width).toBe("3.75%");
    });
  });

  describe("bar color", () => {
    it("should use anomaly color when isAnomaly is true", () => {
      wrapper = mountBar(10, true);
      const bar = getInnerBar(wrapper);
      expect(bar.element.style.backgroundColor).toBe(
        getFrequencyBarColor(10, true)
      );
    });

    it("should use anomaly color when isAnomaly is true, even for low percentages", () => {
      wrapper = mountBar(0.5, true);
      const bar = getInnerBar(wrapper);
      expect(bar.element.style.backgroundColor).toBe(
        getFrequencyBarColor(0.5, true)
      );
    });

    it("should use primary color when percentage is at the high threshold", () => {
      wrapper = mountBar(FREQUENCY_BAR_THRESHOLD_HIGH);
      const bar = getInnerBar(wrapper);
      expect(bar.element.style.backgroundColor).toBe(
        getFrequencyBarColor(FREQUENCY_BAR_THRESHOLD_HIGH, false)
      );
    });

    it("should use primary color when percentage is above the high threshold", () => {
      wrapper = mountBar(75);
      const bar = getInnerBar(wrapper);
      expect(bar.element.style.backgroundColor).toBe(
        getFrequencyBarColor(75, false)
      );
    });

    it("should use secondary color when percentage is between 1 and high threshold (exclusive)", () => {
      wrapper = mountBar(3);
      const bar = getInnerBar(wrapper);
      expect(bar.element.style.backgroundColor).toBe(
        getFrequencyBarColor(3, false)
      );
    });

    it("should use secondary color at percentage 1 (boundary)", () => {
      wrapper = mountBar(1);
      const bar = getInnerBar(wrapper);
      expect(bar.element.style.backgroundColor).toBe(
        getFrequencyBarColor(1, false)
      );
    });

    it("should use muted color when percentage is below 1", () => {
      wrapper = mountBar(0.3);
      const bar = getInnerBar(wrapper);
      expect(bar.element.style.backgroundColor).toBe(
        getFrequencyBarColor(0.3, false)
      );
    });

    it("should use muted color when percentage is 0", () => {
      wrapper = mountBar(0);
      const bar = getInnerBar(wrapper);
      expect(bar.element.style.backgroundColor).toBe(
        getFrequencyBarColor(0, false)
      );
    });

    it("should use muted color when percentage is just below 1 boundary", () => {
      wrapper = mountBar(0.99);
      const bar = getInnerBar(wrapper);
      expect(bar.element.style.backgroundColor).toBe(
        getFrequencyBarColor(0.99, false)
      );
    });
  });

  describe("combined width and color", () => {
    it("should apply both correct width and color for anomaly pattern", () => {
      wrapper = mountBar(88, true);
      const bar = getInnerBar(wrapper);
      expect(bar.element.style.width).toBe("88%");
      expect(bar.element.style.backgroundColor).toBe(
        getFrequencyBarColor(88, true)
      );
    });

    it("should clamp and apply anomaly color for out-of-range anomaly", () => {
      wrapper = mountBar(200, true);
      const bar = getInnerBar(wrapper);
      expect(bar.element.style.width).toBe("100%");
      expect(bar.element.style.backgroundColor).toBe(
        getFrequencyBarColor(200, true)
      );
    });
  });
});
