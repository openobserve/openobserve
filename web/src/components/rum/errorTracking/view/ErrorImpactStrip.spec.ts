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
import { mount, VueWrapper } from "@vue/test-utils";
import ErrorImpactStrip from "@/components/rum/errorTracking/view/ErrorImpactStrip.vue";
import i18n from "@/locales";
import { formatLargeNumber, addCommasToNumber } from "@/utils/formatters";

interface ErrorImpactMetrics {
  occurrences: number;
  usersAffected: number;
  totalUsers: number;
  sessionsAffected: number;
  crashFreePct: number | null;
  firstSeen: number;
  lastSeen: number;
  status: "new" | "ongoing";
}

const baseMetrics: ErrorImpactMetrics = {
  occurrences: 4821,
  usersAffected: 128,
  totalUsers: 640,
  sessionsAffected: 96,
  crashFreePct: 92.4,
  firstSeen: 0,
  lastSeen: 0,
  status: "ongoing",
};

const TILE_KEYS = [
  "occurrences",
  "users-affected",
  "crash-free",
  "sessions",
  "first-seen",
  "last-seen",
];

function mountStrip(
  props: {
    metrics?: ErrorImpactMetrics;
    spikeFactor?: number | null;
    release?: string | null;
    loading?: boolean;
  } = {},
): VueWrapper {
  return mount(ErrorImpactStrip, {
    props: { metrics: baseMetrics, ...props },
    global: { plugins: [i18n] },
  });
}

describe("ErrorImpactStrip", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // =========================================================================
  // Rendering — the six tiles
  // =========================================================================

  describe("rendering", () => {
    beforeEach(() => {
      wrapper = mountStrip();
    });

    it("renders all six impact tiles", () => {
      // Assert
      TILE_KEYS.forEach((key) => {
        expect(wrapper.find(`[data-test="error-impact-${key}-tile"]`).exists()).toBe(
          true,
        );
      });
    });

    it("labels the strip section with the impact metrics aria label", () => {
      // Assert
      expect(wrapper.find('[data-test="error-impact-strip"]').attributes("aria-label")).toBe(
        "Error impact metrics",
      );
    });

    it("shows the occurrences value formatted with formatLargeNumber", () => {
      // Assert
      expect(wrapper.find('[data-test="error-impact-occurrences-value"]').text()).toBe(
        formatLargeNumber(baseMetrics.occurrences),
      );
    });

    it("shows the occurrences title as the comma-formatted exact count", () => {
      // Assert
      expect(
        wrapper.find('[data-test="error-impact-occurrences-value"]').attributes("title"),
      ).toBe(addCommasToNumber(baseMetrics.occurrences));
    });

    it("shows the users-affected value formatted with formatLargeNumber", () => {
      // Assert
      expect(
        wrapper.find('[data-test="error-impact-users-affected-value"]').text(),
      ).toBe(formatLargeNumber(baseMetrics.usersAffected));
    });

    it("shows the sessions value formatted with formatLargeNumber", () => {
      // Assert
      expect(wrapper.find('[data-test="error-impact-sessions-value"]').text()).toBe(
        formatLargeNumber(baseMetrics.sessionsAffected),
      );
    });

    it("shows the impacted-sessions caption on the crash-free tile", () => {
      // Assert
      expect(
        wrapper.find('[data-test="error-impact-crash-free-caption"]').text(),
      ).toBe(`${addCommasToNumber(baseMetrics.sessionsAffected)} sessions hit`);
    });
  });

  // =========================================================================
  // Users-affected caption
  // =========================================================================

  describe("users-affected caption", () => {
    it("shows 'of N active users · P%' when totalUsers is greater than 0", () => {
      // Arrange
      wrapper = mountStrip({
        metrics: { ...baseMetrics, usersAffected: 128, totalUsers: 640 },
      });

      // Assert
      const caption = wrapper.find('[data-test="error-impact-users-affected-caption"]');
      expect(caption.exists()).toBe(true);
      expect(caption.text()).toBe("of 640 active users · 20%");
    });

    it("hides the caption when totalUsers is 0", () => {
      // Arrange
      wrapper = mountStrip({
        metrics: { ...baseMetrics, usersAffected: 0, totalUsers: 0 },
      });

      // Assert
      expect(
        wrapper.find('[data-test="error-impact-users-affected-caption"]').exists(),
      ).toBe(false);
    });
  });

  // =========================================================================
  // Crash-free tile
  // =========================================================================

  describe("crash-free tile", () => {
    it("shows an em-dash when crashFreePct is null", () => {
      // Arrange
      wrapper = mountStrip({ metrics: { ...baseMetrics, crashFreePct: null } });

      // Assert
      expect(wrapper.find('[data-test="error-impact-crash-free-value"]').text()).toBe(
        "—",
      );
    });

    it("formats a numeric crashFreePct to one decimal with a percent sign", () => {
      // Arrange
      wrapper = mountStrip({ metrics: { ...baseMetrics, crashFreePct: 64 } });

      // Assert
      expect(wrapper.find('[data-test="error-impact-crash-free-value"]').text()).toBe(
        "64.0%",
      );
    });

    it("shows the Poor badge when crashFreePct is below 95", () => {
      // Arrange
      wrapper = mountStrip({ metrics: { ...baseMetrics, crashFreePct: 80 } });

      // Assert
      const badge = wrapper.find('[data-test="error-impact-crash-free-badge"]');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("Poor");
    });

    it("shows the Fair badge when crashFreePct is between 95 and 99", () => {
      // Arrange
      wrapper = mountStrip({ metrics: { ...baseMetrics, crashFreePct: 97 } });

      // Assert
      const badge = wrapper.find('[data-test="error-impact-crash-free-badge"]');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("Fair");
    });

    it("shows the Good badge when crashFreePct is 99 or above", () => {
      // Arrange
      wrapper = mountStrip({ metrics: { ...baseMetrics, crashFreePct: 99.9 } });

      // Assert
      const badge = wrapper.find('[data-test="error-impact-crash-free-badge"]');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toBe("Good");
    });

    it("does not render a badge when crashFreePct is null", () => {
      // Arrange
      wrapper = mountStrip({ metrics: { ...baseMetrics, crashFreePct: null } });

      // Assert
      expect(
        wrapper.find('[data-test="error-impact-crash-free-badge"]').exists(),
      ).toBe(false);
    });
  });

  // =========================================================================
  // First seen / last seen — relative time + release + still-active
  // =========================================================================

  describe("first-seen / last-seen", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    });

    it("shows an em-dash for first-seen when the timestamp is 0", () => {
      // Arrange
      wrapper = mountStrip({ metrics: { ...baseMetrics, firstSeen: 0 } });

      // Assert
      expect(wrapper.find('[data-test="error-impact-first-seen-value"]').text()).toBe(
        "—",
      );
    });

    it("shows an em-dash for last-seen when the timestamp is 0", () => {
      // Arrange
      wrapper = mountStrip({ metrics: { ...baseMetrics, lastSeen: 0 } });

      // Assert
      expect(wrapper.find('[data-test="error-impact-last-seen-value"]').text()).toBe(
        "—",
      );
    });

    it("shows a non-empty relative time for a non-zero first-seen timestamp", () => {
      // Arrange
      const tenMinutesAgoUs = Date.now() * 1000 - 10 * 60 * 1_000_000;
      wrapper = mountStrip({ metrics: { ...baseMetrics, firstSeen: tenMinutesAgoUs } });

      // Assert
      const value = wrapper.find('[data-test="error-impact-first-seen-value"]').text();
      expect(value).not.toBe("");
      expect(value).not.toBe("—");
    });

    it("shows a non-empty relative time for a non-zero last-seen timestamp", () => {
      // Arrange
      const tenMinutesAgoUs = Date.now() * 1000 - 10 * 60 * 1_000_000;
      wrapper = mountStrip({ metrics: { ...baseMetrics, lastSeen: tenMinutesAgoUs } });

      // Assert
      const value = wrapper.find('[data-test="error-impact-last-seen-value"]').text();
      expect(value).not.toBe("");
      expect(value).not.toBe("—");
    });

    it("shows the release caption on first-seen when release is set", () => {
      // Arrange
      wrapper = mountStrip({ release: "1.4.2" });

      // Assert
      const caption = wrapper.find('[data-test="error-impact-first-seen-caption"]');
      expect(caption.exists()).toBe(true);
      expect(caption.text()).toBe("in 1.4.2");
    });

    it("hides the release caption on first-seen when release is null", () => {
      // Arrange
      wrapper = mountStrip({ release: null });

      // Assert
      expect(
        wrapper.find('[data-test="error-impact-first-seen-caption"]').exists(),
      ).toBe(false);
    });

    it("shows the still-active caption on last-seen when lastSeen is within the last hour", () => {
      // Arrange
      const thirtyMinutesAgoUs = Date.now() * 1000 - 30 * 60 * 1_000_000;
      wrapper = mountStrip({
        metrics: { ...baseMetrics, lastSeen: thirtyMinutesAgoUs },
      });

      // Assert
      const caption = wrapper.find('[data-test="error-impact-last-seen-caption"]');
      expect(caption.exists()).toBe(true);
      expect(caption.text()).toBe("still active");
    });

    it("hides the still-active caption on last-seen when lastSeen is more than an hour old", () => {
      // Arrange
      const twoHoursAgoUs = Date.now() * 1000 - 2 * 60 * 60 * 1_000_000;
      wrapper = mountStrip({ metrics: { ...baseMetrics, lastSeen: twoHoursAgoUs } });

      // Assert
      expect(
        wrapper.find('[data-test="error-impact-last-seen-caption"]').exists(),
      ).toBe(false);
    });
  });

  // =========================================================================
  // Loading state
  // =========================================================================

  describe("loading state", () => {
    beforeEach(() => {
      wrapper = mountStrip({ loading: true });
    });

    it("shows a skeleton placeholder for every tile", () => {
      // Assert
      expect(wrapper.findAll('[role="status"]')).toHaveLength(TILE_KEYS.length);
    });

    it("hides the occurrences value while loading", () => {
      // Assert
      expect(
        wrapper.find('[data-test="error-impact-occurrences-value"]').exists(),
      ).toBe(false);
    });

    it("hides all captions while loading", () => {
      // Assert
      TILE_KEYS.forEach((key) => {
        expect(
          wrapper.find(`[data-test="error-impact-${key}-caption"]`).exists(),
        ).toBe(false);
      });
    });
  });

  // =========================================================================
  // Spike caption on occurrences
  // =========================================================================

  describe("occurrences spike caption", () => {
    it("shows the spike caption when spikeFactor is 1.5 or greater", () => {
      // Arrange
      wrapper = mountStrip({ spikeFactor: 2 });

      // Assert
      const caption = wrapper.find('[data-test="error-impact-occurrences-caption"]');
      expect(caption.exists()).toBe(true);
      expect(caption.text()).toBe("▲ 2.0× vs. baseline");
    });

    it("hides the spike caption when spikeFactor is below 1.5", () => {
      // Arrange
      wrapper = mountStrip({ spikeFactor: 1.2 });

      // Assert
      expect(
        wrapper.find('[data-test="error-impact-occurrences-caption"]').exists(),
      ).toBe(false);
    });

    it("hides the spike caption when spikeFactor is null", () => {
      // Arrange
      wrapper = mountStrip({ spikeFactor: null });

      // Assert
      expect(
        wrapper.find('[data-test="error-impact-occurrences-caption"]').exists(),
      ).toBe(false);
    });
  });

  // =========================================================================
  // Props reactivity
  // =========================================================================

  describe("props reactivity", () => {
    it("updates the occurrences value when metrics prop changes", async () => {
      // Arrange
      wrapper = mountStrip();

      // Act
      await wrapper.setProps({ metrics: { ...baseMetrics, occurrences: 12 } });

      // Assert
      expect(wrapper.find('[data-test="error-impact-occurrences-value"]').text()).toBe(
        "12",
      );
    });

    it("re-renders the crash-free badge when crashFreePct crosses a threshold", async () => {
      // Arrange
      wrapper = mountStrip({ metrics: { ...baseMetrics, crashFreePct: 80 } });
      expect(
        wrapper.find('[data-test="error-impact-crash-free-badge"]').text(),
      ).toBe("Poor");

      // Act
      await wrapper.setProps({ metrics: { ...baseMetrics, crashFreePct: 99.9 } });

      // Assert
      expect(
        wrapper.find('[data-test="error-impact-crash-free-badge"]').text(),
      ).toBe("Good");
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe("edge cases", () => {
    it("renders 0 occurrences as the literal digit, not blank", () => {
      // Arrange
      wrapper = mountStrip({ metrics: { ...baseMetrics, occurrences: 0 } });

      // Assert
      expect(wrapper.find('[data-test="error-impact-occurrences-value"]').text()).toBe(
        "0",
      );
    });

    it("formats a value in the millions with the M suffix", () => {
      // Arrange
      wrapper = mountStrip({ metrics: { ...baseMetrics, occurrences: 2_500_000 } });

      // Assert
      expect(wrapper.find('[data-test="error-impact-occurrences-value"]').text()).toBe(
        "2.5M",
      );
    });
  });
});
