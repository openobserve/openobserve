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
import i18n from "@/locales";
import ErrorTrendCell from "./ErrorTrendCell.vue";

// ---------------------------------------------------------------------------
// Component analysis
// ---------------------------------------------------------------------------
// Props:
//   buckets: number[] | null  — histogram buckets
//     null/undefined  → not fetched yet → skeleton (rum-error-trend-cell-loading)
//     []              → fetched but empty/failed → em-dash (rum-error-trend-cell-empty)
//     non-empty       → bars + annotation (rum-error-trend-cell)
//   status:   "new" | "ongoing"
//   handling?: string  — "handled" | "unhandled" (affects bar color class — NOT asserted)
//
// Emits:
//   visible — fired ONCE when cell first scrolls into view via IntersectionObserver.
//             Falls back to synchronous emit on mount when IO is unavailable.
//             Never emitted when buckets is already non-null at mount.
//
// Downsampling:
//   >24 buckets → chunk-merge to MAX_BARS=24; 48 → 24 bars
//
// Annotation kinds:
//   "new"   → t("rum.trendNew") = "new"  (status wins)
//   "spike" → "▲ {factor}×"
//   "drop"  → "▼ {factor}×"
//   "flat"  → t("rum.trendFlat") = "flat"
//
// IntersectionObserver:
//   setupTests.ts provides a global MockIntersectionObserver with observe/disconnect
//   as vi.fn()s. Callbacks are NOT auto-fired by the mock — tests must either
//   capture the constructor call to invoke the callback manually, or stub IO away
//   with vi.stubGlobal to exercise the fallback path.
//
// Note: bar colour variant is purely CSS — not asserted (forbidden by rules).
// ---------------------------------------------------------------------------

/** Build ongoing spiking buckets: 8 baseline + 4 recent, factor = recent/baseline */
const spikeBuckets = [1, 1, 1, 1, 1, 1, 1, 1, 4, 4, 4, 4];
//   recent avg = 4, baseline avg = 1, factor = 4 → annotation "▲ 4.0×"

/** Dropping buckets: 8 high baseline + 4 zeros */
const dropBuckets = [4, 4, 4, 4, 4, 4, 4, 4, 0, 0, 0, 0];
//   recent avg = 0, baseline avg = 4, factor = 0/max(4,0.01)=0 → "▼ 0.0×"

/** Flat buckets: all equal, factor ≈ 1, between 0.5 and 2 */
const flatBuckets = [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2];

function mountCell(props: {
  buckets: number[] | null;
  status?: "new" | "ongoing";
  handling?: string;
}): VueWrapper {
  return mount(ErrorTrendCell, {
    props: {
      status: "ongoing",
      ...props,
    },
    global: { plugins: [i18n] },
  });
}

describe("ErrorTrendCell", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // skeleton state — buckets null/undefined = not yet fetched
  // -------------------------------------------------------------------------

  describe("skeleton state (buckets null = not yet fetched)", () => {
    it("renders skeleton when buckets is null", () => {
      // Arrange
      wrapper = mountCell({ buckets: null });

      // Assert
      expect(wrapper.find('[data-test="rum-error-trend-cell-loading"]').exists()).toBe(true);
    });

    it("does not render bars container when buckets is null", () => {
      // Arrange
      wrapper = mountCell({ buckets: null });

      // Assert
      expect(wrapper.find('[data-test="rum-error-trend-cell"]').exists()).toBe(false);
    });

    it("does not render em-dash when buckets is null", () => {
      // Arrange
      wrapper = mountCell({ buckets: null });

      // Assert
      expect(wrapper.find('[data-test="rum-error-trend-cell-empty"]').exists()).toBe(false);
    });

    it("skeleton has aria-label for screen readers", () => {
      // Arrange
      wrapper = mountCell({ buckets: null });

      // Assert — aria-label must be non-empty
      const label = wrapper
        .find('[data-test="rum-error-trend-cell-loading"]')
        .attributes("aria-label");
      expect(label).toBeTruthy();
    });

    it("transitions from skeleton to bars after buckets become populated", async () => {
      // Arrange
      wrapper = mountCell({ buckets: null });
      expect(wrapper.find('[data-test="rum-error-trend-cell-loading"]').exists()).toBe(true);

      // Act
      await wrapper.setProps({ buckets: flatBuckets });

      // Assert
      expect(wrapper.find('[data-test="rum-error-trend-cell-loading"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="rum-error-trend-cell"]').exists()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // empty state — buckets [] = fetched but no data / failed
  // -------------------------------------------------------------------------

  describe("empty state (buckets [] = fetched, no data)", () => {
    it("shows em-dash when buckets is an empty array", () => {
      // Arrange
      wrapper = mountCell({ buckets: [] });

      // Assert
      expect(wrapper.find('[data-test="rum-error-trend-cell-empty"]').exists()).toBe(true);
    });

    it("empty span contains the em-dash character", () => {
      // Arrange
      wrapper = mountCell({ buckets: [] });

      // Assert
      expect(wrapper.find('[data-test="rum-error-trend-cell-empty"]').text()).toBe("—");
    });

    it("empty span has title tooltip 'No occurrences in the selected time range'", () => {
      // Arrange
      wrapper = mountCell({ buckets: [] });

      // Assert
      expect(wrapper.find('[data-test="rum-error-trend-cell-empty"]').attributes("title")).toBe(
        "No occurrences in the selected time range",
      );
    });

    it("does not render skeleton when buckets is empty array", () => {
      // Arrange
      wrapper = mountCell({ buckets: [] });

      // Assert
      expect(wrapper.find('[data-test="rum-error-trend-cell-loading"]').exists()).toBe(false);
    });

    it("does not render bars container when buckets is empty array", () => {
      // Arrange
      wrapper = mountCell({ buckets: [] });

      // Assert
      expect(wrapper.find('[data-test="rum-error-trend-cell"]').exists()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // bars rendered when buckets are present
  // -------------------------------------------------------------------------

  describe("bars rendered for populated buckets", () => {
    beforeEach(() => {
      wrapper = mountCell({ buckets: spikeBuckets, status: "ongoing" });
    });

    it("renders the trend cell container", () => {
      expect(wrapper.find('[data-test="rum-error-trend-cell"]').exists()).toBe(true);
    });

    it("does not render the empty state", () => {
      expect(wrapper.find('[data-test="rum-error-trend-cell-empty"]').exists()).toBe(false);
    });

    it("does not render skeleton when buckets are populated", () => {
      expect(wrapper.find('[data-test="rum-error-trend-cell-loading"]').exists()).toBe(false);
    });

    it("renders exactly 12 bar spans for a 12-bucket input", () => {
      // The 12-bucket array is <= MAX_BARS(24), so no downsampling occurs.
      const bars = wrapper.findAll(".trend-bar");
      expect(bars).toHaveLength(12);
    });

    it("bars container has role='img'", () => {
      const imgEl = wrapper.find('[role="img"]');
      expect(imgEl.exists()).toBe(true);
    });

    it("aria-label contains the total event count", () => {
      // spikeBuckets total = 8×1 + 4×4 = 24
      const ariaLabel = wrapper.find('[role="img"]').attributes("aria-label");
      expect(ariaLabel).toContain("24");
    });

    it("aria-label matches 'N events' format", () => {
      const ariaLabel = wrapper.find('[role="img"]').attributes("aria-label");
      expect(ariaLabel).toBe("24 events");
    });
  });

  // -------------------------------------------------------------------------
  // downsampling — 48 buckets → 24 bars
  // -------------------------------------------------------------------------

  describe("downsampling", () => {
    it("renders exactly 24 bars when 48 buckets are provided", () => {
      // Arrange — 48 equal buckets; Math.ceil(48/24)=2 → merges pairs → 24 bars
      const buckets48 = Array.from({ length: 48 }, () => 1);
      wrapper = mountCell({ buckets: buckets48, status: "ongoing" });

      // Assert
      const bars = wrapper.findAll(".trend-bar");
      expect(bars).toHaveLength(24);
    });

    it("renders 12 bars for 12 buckets (no downsampling)", () => {
      // Arrange
      wrapper = mountCell({ buckets: flatBuckets, status: "ongoing" });

      // Assert
      const bars = wrapper.findAll(".trend-bar");
      expect(bars).toHaveLength(12);
    });

    it("renders at most 24 bars when given 100 buckets", () => {
      // Arrange
      const buckets100 = Array.from({ length: 100 }, (_, i) => i % 5);
      wrapper = mountCell({ buckets: buckets100, status: "ongoing" });

      // Assert
      const bars = wrapper.findAll(".trend-bar");
      expect(bars.length).toBeLessThanOrEqual(24);
    });
  });

  // -------------------------------------------------------------------------
  // annotation labels
  // -------------------------------------------------------------------------

  describe("annotation labels", () => {
    it("shows '▲ 4.0×' annotation for spiking ongoing buckets", () => {
      // Arrange — recent avg=4, baseline avg=1, factor=4.0 ≥ SPIKE_FACTOR(2)
      wrapper = mountCell({ buckets: spikeBuckets, status: "ongoing" });

      // Assert
      expect(wrapper.find('[data-test="rum-error-trend-cell-annotation"]').text()).toBe("▲ 4.0×");
    });

    it("shows '▼ 0.0×' annotation for dropping ongoing buckets", () => {
      // Arrange — recent avg=0, baseline avg=4, factor=0/max(4,0.01)=0 ≤ DROP_FACTOR(0.5)
      wrapper = mountCell({ buckets: dropBuckets, status: "ongoing" });

      // Assert
      expect(wrapper.find('[data-test="rum-error-trend-cell-annotation"]').text()).toBe("▼ 0.0×");
    });

    it("shows 'new' annotation when status is 'new' even with spiking buckets", () => {
      // Arrange — status "new" always wins over spike detection
      wrapper = mountCell({ buckets: spikeBuckets, status: "new" });

      // Assert
      expect(wrapper.find('[data-test="rum-error-trend-cell-annotation"]').text()).toBe("new");
    });

    it("shows 'flat' annotation for flat ongoing buckets", () => {
      // Arrange — all equal → factor ≈ 1 (between DROP_FACTOR and SPIKE_FACTOR)
      wrapper = mountCell({ buckets: flatBuckets, status: "ongoing" });

      // Assert
      expect(wrapper.find('[data-test="rum-error-trend-cell-annotation"]').text()).toBe("flat");
    });

    it("shows 'new' annotation when status is 'new' and buckets are flat", () => {
      // Arrange
      wrapper = mountCell({ buckets: flatBuckets, status: "new" });

      // Assert
      expect(wrapper.find('[data-test="rum-error-trend-cell-annotation"]').text()).toBe("new");
    });

    it("shows 'flat' for ongoing when buckets array is too short to compute trend (≤4)", () => {
      // Arrange — computeTrendAnnotation returns flat when buckets.length <= RECENT_BUCKETS(4)
      wrapper = mountCell({ buckets: [1, 2, 3, 4], status: "ongoing" });

      // Assert
      expect(wrapper.find('[data-test="rum-error-trend-cell-annotation"]').text()).toBe("flat");
    });

    it("annotation is not shown when buckets is null (skeleton shown instead)", () => {
      // Arrange — null buckets → skeleton state, annotation is irrelevant
      wrapper = mountCell({ buckets: null, status: "new" });

      // Assert
      expect(wrapper.find('[data-test="rum-error-trend-cell-annotation"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="rum-error-trend-cell-loading"]').exists()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // accessibility
  // -------------------------------------------------------------------------

  describe("accessibility", () => {
    it("skeleton has aria-label for screen readers", () => {
      // Arrange
      wrapper = mountCell({ buckets: null });

      // Assert — aria-label must be non-empty
      const label = wrapper
        .find('[data-test="rum-error-trend-cell-loading"]')
        .attributes("aria-label");
      expect(label).toBeTruthy();
    });

    it("bars container has aria-label containing total events count", () => {
      // Arrange
      wrapper = mountCell({ buckets: [3, 3, 3, 3, 3, 3, 3, 3], status: "ongoing" });

      // Assert
      const label = wrapper.find('[role="img"]').attributes("aria-label");
      expect(label).toContain("24");
    });
  });

  // -------------------------------------------------------------------------
  // props reactivity
  // -------------------------------------------------------------------------

  describe("props reactivity", () => {
    it("transitions from skeleton to bars after buckets become populated", async () => {
      // Arrange
      wrapper = mountCell({ buckets: null });
      expect(wrapper.find('[data-test="rum-error-trend-cell-loading"]').exists()).toBe(true);

      // Act
      await wrapper.setProps({ buckets: flatBuckets });

      // Assert
      expect(wrapper.find('[data-test="rum-error-trend-cell-loading"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="rum-error-trend-cell"]').exists()).toBe(true);
    });

    it("transitions from skeleton to em-dash after buckets become empty array", async () => {
      // Arrange
      wrapper = mountCell({ buckets: null });
      expect(wrapper.find('[data-test="rum-error-trend-cell-loading"]').exists()).toBe(true);

      // Act
      await wrapper.setProps({ buckets: [] });

      // Assert
      expect(wrapper.find('[data-test="rum-error-trend-cell-loading"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="rum-error-trend-cell-empty"]').exists()).toBe(true);
    });

    it("updates annotation when status changes from ongoing to new", async () => {
      // Arrange
      wrapper = mountCell({ buckets: spikeBuckets, status: "ongoing" });
      expect(wrapper.find('[data-test="rum-error-trend-cell-annotation"]').text()).toBe("▲ 4.0×");

      // Act
      await wrapper.setProps({ status: "new" });

      // Assert
      expect(wrapper.find('[data-test="rum-error-trend-cell-annotation"]').text()).toBe("new");
    });

    it("updates bar count when buckets prop changes from 12 to 48", async () => {
      // Arrange
      wrapper = mountCell({ buckets: flatBuckets, status: "ongoing" });
      expect(wrapper.findAll(".trend-bar")).toHaveLength(12);

      // Act
      const buckets48 = Array.from({ length: 48 }, () => 1);
      await wrapper.setProps({ buckets: buckets48 });

      // Assert
      expect(wrapper.findAll(".trend-bar")).toHaveLength(24);
    });
  });

  // -------------------------------------------------------------------------
  // visible emit — IntersectionObserver behavior
  // -------------------------------------------------------------------------

  describe("visible emit via IntersectionObserver", () => {
    it("emits visible when the cell intersects (via IO callback)", async () => {
      // Arrange — capture the IO constructor so we can manually fire the callback
      let capturedCallback: IntersectionObserverCallback | null = null;
      vi.stubGlobal(
        "IntersectionObserver",
        class MockIO {
          constructor(cb: IntersectionObserverCallback) {
            capturedCallback = cb;
          }
          observe = vi.fn();
          disconnect = vi.fn();
          takeRecords = vi.fn(() => []);
        },
      );

      wrapper = mountCell({ buckets: null });
      expect(capturedCallback).not.toBeNull();

      // Act — simulate a visible intersection
      capturedCallback!(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );

      // Assert
      expect(wrapper.emitted("visible")).toHaveLength(1);
    });

    it("does not emit visible when the cell is not intersecting", async () => {
      // Arrange
      let capturedCallback: IntersectionObserverCallback | null = null;
      vi.stubGlobal(
        "IntersectionObserver",
        class MockIO {
          constructor(cb: IntersectionObserverCallback) {
            capturedCallback = cb;
          }
          observe = vi.fn();
          disconnect = vi.fn();
          takeRecords = vi.fn(() => []);
        },
      );

      wrapper = mountCell({ buckets: null });

      // Act — not intersecting
      capturedCallback!(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );

      // Assert
      expect(wrapper.emitted("visible")).toBeFalsy();
    });

    it("emits visible only once even when IO fires multiple intersecting entries", async () => {
      // Arrange
      let capturedCallback: IntersectionObserverCallback | null = null;
      const disconnectSpy = vi.fn();
      vi.stubGlobal(
        "IntersectionObserver",
        class MockIO {
          constructor(cb: IntersectionObserverCallback) {
            capturedCallback = cb;
          }
          observe = vi.fn();
          disconnect = disconnectSpy;
          takeRecords = vi.fn(() => []);
        },
      );

      wrapper = mountCell({ buckets: null });

      // Act — fire intersecting twice
      const entry = { isIntersecting: true } as IntersectionObserverEntry;
      capturedCallback!([entry], {} as IntersectionObserver);
      capturedCallback!([entry], {} as IntersectionObserver);

      // Assert — only one emit and observer disconnected after first fire
      expect(wrapper.emitted("visible")).toHaveLength(1);
    });

    it("disconnects the observer after first intersection", async () => {
      // Arrange
      let capturedCallback: IntersectionObserverCallback | null = null;
      const disconnectSpy = vi.fn();
      vi.stubGlobal(
        "IntersectionObserver",
        class MockIO {
          constructor(cb: IntersectionObserverCallback) {
            capturedCallback = cb;
          }
          observe = vi.fn();
          disconnect = disconnectSpy;
          takeRecords = vi.fn(() => []);
        },
      );

      wrapper = mountCell({ buckets: null });

      // Act
      capturedCallback!(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );

      // Assert
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
    });

    it("does not emit visible when buckets is already non-null at mount", () => {
      // Arrange — pre-fetched buckets; no observer should be set up
      let capturedCallback: IntersectionObserverCallback | null = null;
      vi.stubGlobal(
        "IntersectionObserver",
        class MockIO {
          constructor(cb: IntersectionObserverCallback) {
            capturedCallback = cb;
          }
          observe = vi.fn();
          disconnect = vi.fn();
          takeRecords = vi.fn(() => []);
        },
      );

      wrapper = mountCell({ buckets: flatBuckets });

      // Assert — no observer set up, so no callback captured and no emit
      expect(capturedCallback).toBeNull();
      expect(wrapper.emitted("visible")).toBeFalsy();
    });

    it("does not emit visible when buckets is [] (empty array) at mount", () => {
      // Arrange — [] is non-null; IO guard is `buckets != null`, so no observer
      let capturedCallback: IntersectionObserverCallback | null = null;
      vi.stubGlobal(
        "IntersectionObserver",
        class MockIO {
          constructor(cb: IntersectionObserverCallback) {
            capturedCallback = cb;
          }
          observe = vi.fn();
          disconnect = vi.fn();
          takeRecords = vi.fn(() => []);
        },
      );

      wrapper = mountCell({ buckets: [] });

      // Assert — [] != null so no observer, no emit
      expect(capturedCallback).toBeNull();
      expect(wrapper.emitted("visible")).toBeFalsy();
    });
  });

  // -------------------------------------------------------------------------
  // visible emit — IntersectionObserver fallback (IO unavailable)
  // -------------------------------------------------------------------------

  describe("visible emit fallback when IntersectionObserver is unavailable", () => {
    it("emits visible synchronously on mount when IntersectionObserver is undefined", () => {
      // Arrange — remove IO from global to simulate unavailable environment
      vi.stubGlobal("IntersectionObserver", undefined);

      // Act
      wrapper = mountCell({ buckets: null });

      // Assert — emitted immediately at mount
      expect(wrapper.emitted("visible")).toHaveLength(1);
    });

    it("does not emit visible when IO is unavailable but buckets is already non-null", () => {
      // Arrange
      vi.stubGlobal("IntersectionObserver", undefined);

      // Act
      wrapper = mountCell({ buckets: flatBuckets });

      // Assert — buckets non-null → no emit regardless of IO availability
      expect(wrapper.emitted("visible")).toBeFalsy();
    });
  });

  // -------------------------------------------------------------------------
  // edge cases
  // -------------------------------------------------------------------------

  describe("edge cases", () => {
    it("renders without crash when a single bucket is given", () => {
      // Arrange
      wrapper = mountCell({ buckets: [5], status: "ongoing" });

      // Assert
      expect(wrapper.find('[data-test="rum-error-trend-cell"]').exists()).toBe(true);
      expect(wrapper.findAll(".trend-bar")).toHaveLength(1);
    });

    it("renders without crash when all bucket values are zero", () => {
      // Arrange
      wrapper = mountCell({
        buckets: [0, 0, 0, 0, 0, 0, 0, 0],
        status: "ongoing",
      });

      // Assert
      expect(wrapper.find('[data-test="rum-error-trend-cell"]').exists()).toBe(true);
    });

    it("renders single-bucket array with aria-label showing correct total", () => {
      // Arrange
      wrapper = mountCell({ buckets: [42], status: "ongoing" });

      // Assert
      const ariaLabel = wrapper.find('[role="img"]').attributes("aria-label");
      expect(ariaLabel).toContain("42");
    });

    // Bar variant coloring (trend-bar--unhandled, trend-bar--handled, trend-bar--empty)
    // is purely CSS-based and must not be asserted on per the no-CSS-class rule.
    // it("does NOT assert on CSS classes for bar colour — visual-only", () => {});

    it("all-zero buckets still render the bar elements", () => {
      // Arrange
      const zeroBuckets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      wrapper = mountCell({ buckets: zeroBuckets, status: "ongoing" });

      // Assert
      expect(wrapper.findAll(".trend-bar").length).toBe(12);
    });

    it("handles large bucket values without crashing", () => {
      // Arrange
      const largeBuckets = Array.from({ length: 12 }, (_, i) => (i >= 8 ? 1_000_000 : 1));
      wrapper = mountCell({ buckets: largeBuckets, status: "ongoing" });

      // Assert
      expect(wrapper.find('[data-test="rum-error-trend-cell"]').exists()).toBe(true);
    });
  });
});
