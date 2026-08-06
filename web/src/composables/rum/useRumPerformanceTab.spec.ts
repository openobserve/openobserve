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

/**
 * Composable: useRumPerformanceTab
 * Path: src/composables/rum/useRumPerformanceTab.ts
 *
 * Collaborators (all mocked at the boundary):
 *   - usePerformance   → the shared `_rumdata` schema map
 *   - useStreams       → getStream, the schema fetch fallback
 *   - useRumPlatforms  → the source probe that answers browser / mobile / mixed
 *   - convertDashboardSchemaVersion → identity here, so fixtures stay readable
 *
 * The composable registers a watcher, so every test mounts a host component rather
 * than calling it bare.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { defineComponent, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";

// ── vi.mock() at the top — hoisted by Vitest ─────────────────────────────────

const mockPerformanceState = {
  data: { streams: {} as Record<string, unknown> },
};

vi.mock("@/composables/rum/usePerformance", () => ({
  default: () => ({ performanceState: mockPerformanceState }),
}));

const mockGetStream = vi.fn();
vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStream: mockGetStream }),
}));

const mockDetectPlatforms = vi.fn();
const mockHasBrowser = ref(true);
const mockHasMobile = ref(false);
const mockResolvedKey = ref<string | null>(null);

vi.mock("@/composables/rum/useRumPlatforms", () => ({
  default: () => ({
    hasBrowser: mockHasBrowser,
    hasMobile: mockHasMobile,
    resolvedKey: mockResolvedKey,
    detectPlatforms: mockDetectPlatforms,
  }),
}));

vi.mock("@/utils/dashboard/convertDashboardSchemaVersion", () => ({
  convertDashboardSchemaVersion: (d: unknown) => d,
}));

import useRumPerformanceTab, { type RumTabDateTime } from "./useRumPerformanceTab";

// ── fixtures ─────────────────────────────────────────────────────────────────

const DASHBOARD = {
  panels: [
    { layout: { x: 0, y: 0, w: 3, h: 4, i: 1 }, title: "Total Errors", queries: [] },
    {
      layout: { x: 3, y: 0, w: 3, h: 4, i: 2 },
      title: "Crash-free Sessions",
      queries: [],
      o2Platform: "mobile",
    },
    {
      layout: { x: 6, y: 0, w: 3, h: 4, i: 3 },
      title: "LCP",
      queries: [],
      o2Platform: "browser",
    },
  ],
};

/** Mount a host component so the composable's watcher is bound to a lifecycle. */
function mountTab(dateTime?: ReturnType<typeof ref<RumTabDateTime | undefined>>) {
  const result: { value: ReturnType<typeof useRumPerformanceTab> | null } = { value: null };
  const wrapper = mount(
    defineComponent({
      setup() {
        result.value = useRumPerformanceTab(DASHBOARD, dateTime);
        return () => null;
      },
    }),
  );
  return { wrapper, tab: result.value! };
}

const titlesOf = (tab: ReturnType<typeof useRumPerformanceTab>) =>
  (tab.dashboardData.value.panels ?? []).map((p) => p.title);

describe("useRumPerformanceTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPerformanceState.data.streams = {};
    mockHasBrowser.value = true;
    mockHasMobile.value = false;
    mockResolvedKey.value = null;
    mockGetStream.mockResolvedValue({ schema: [] });
  });

  describe("platform detection", () => {
    it("probes with the range converted from milliseconds to microseconds", () => {
      // Arrange
      const dateTime = ref<RumTabDateTime | undefined>({
        start_time: new Date(1_700_000_000_000),
        end_time: new Date(1_700_000_060_000),
      });

      // Act
      mountTab(dateTime);

      // Assert
      expect(mockDetectPlatforms).toHaveBeenCalledWith({
        startTime: 1_700_000_000_000_000,
        endTime: 1_700_000_060_000_000,
      });
    });

    it("re-probes when the time range changes", async () => {
      // Arrange
      const dateTime = ref<RumTabDateTime | undefined>({
        start_time: new Date(1_700_000_000_000),
        end_time: new Date(1_700_000_060_000),
      });
      mountTab(dateTime);

      // Act
      dateTime.value = {
        start_time: new Date(1_800_000_000_000),
        end_time: new Date(1_800_000_060_000),
      };
      await nextTick();

      // Assert
      expect(mockDetectPlatforms).toHaveBeenCalledTimes(2);
      expect(mockDetectPlatforms).toHaveBeenLastCalledWith({
        startTime: 1_800_000_000_000_000,
        endTime: 1_800_000_060_000_000,
      });
    });

    it("does not probe when the range is incomplete", () => {
      // Arrange
      const dateTime = ref<RumTabDateTime | undefined>({ start_time: new Date(), end_time: null });

      // Act
      mountTab(dateTime);

      // Assert
      expect(mockDetectPlatforms).not.toHaveBeenCalled();
    });

    it("does not probe at all when the tab passes no range", () => {
      // Act
      mountTab();

      // Assert
      expect(mockDetectPlatforms).not.toHaveBeenCalled();
    });
  });

  describe("platform gating", () => {
    it("exposes null platforms until detection resolves", () => {
      // Act
      const { tab } = mountTab(ref({ start_time: new Date(1), end_time: new Date(2) }));

      // Assert
      expect(tab.platforms.value).toBeNull();
      expect(titlesOf(tab)).toEqual(["Total Errors", "Crash-free Sessions", "LCP"]);
    });

    it("drops mobile panels once detection reports browser-only data", async () => {
      // Arrange
      const { tab } = mountTab(ref({ start_time: new Date(1), end_time: new Date(2) }));

      // Act
      mockResolvedKey.value = "1_2";
      await nextTick();

      // Assert
      expect(tab.platforms.value).toEqual({ hasBrowser: true, hasMobile: false });
      expect(titlesOf(tab)).toEqual(["Total Errors", "LCP"]);
    });

    it("drops browser panels once detection reports mobile-only data", async () => {
      // Arrange
      const { tab } = mountTab(ref({ start_time: new Date(1), end_time: new Date(2) }));

      // Act
      mockHasBrowser.value = false;
      mockHasMobile.value = true;
      mockResolvedKey.value = "1_2";
      await nextTick();

      // Assert
      expect(titlesOf(tab)).toEqual(["Total Errors", "Crash-free Sessions"]);
      expect(tab.wasFiltered.value).toBe(true);
    });

    it("keeps every panel for a mixed stream", async () => {
      // Arrange
      const { tab } = mountTab(ref({ start_time: new Date(1), end_time: new Date(2) }));

      // Act
      mockHasMobile.value = true;
      mockResolvedKey.value = "1_2";
      await nextTick();

      // Assert
      expect(titlesOf(tab)).toEqual(["Total Errors", "Crash-free Sessions", "LCP"]);
      expect(tab.wasFiltered.value).toBe(false);
    });

    it("ignores platform tags for tabs that pass no range", async () => {
      // Arrange — Vitals / Errors / API keep pure field gating
      const { tab } = mountTab();

      // Act
      mockResolvedKey.value = "1_2";
      await nextTick();

      // Assert
      expect(titlesOf(tab)).toEqual(["Total Errors", "Crash-free Sessions", "LCP"]);
    });
  });

  describe("schema resolution", () => {
    it("fetches the stream schema and stores it in the shared performance state", async () => {
      // Arrange
      mockGetStream.mockResolvedValue({ schema: [{ name: "session_id" }, { name: "error_id" }] });
      const { tab } = mountTab();

      // Act
      await tab.ensureRumSchema();

      // Assert
      expect(mockGetStream).toHaveBeenCalledWith("_rumdata", "logs", true);
      expect(mockPerformanceState.data.streams["_rumdata"]).toEqual({
        schema: { session_id: { name: "session_id" }, error_id: { name: "error_id" } },
        name: "_rumdata",
      });
      expect(tab.schemaResolved.value).toBe(true);
    });

    it("skips the fetch when the schema is already in the shared state", async () => {
      // Arrange
      mockPerformanceState.data.streams["_rumdata"] = { schema: { session_id: {} } };
      const { tab } = mountTab();

      // Act
      await tab.ensureRumSchema();

      // Assert
      expect(mockGetStream).not.toHaveBeenCalled();
    });

    it("resolves without throwing when the schema fetch fails", async () => {
      // Arrange
      mockGetStream.mockRejectedValue(new Error("boom"));
      const { tab } = mountTab();

      // Act
      await tab.ensureRumSchema();

      // Assert — inconclusive schema renders the full dashboard rather than an empty tab
      expect(tab.schemaResolved.value).toBe(true);
      expect(tab.showEmptyState.value).toBe(false);
      expect(titlesOf(tab)).toHaveLength(3);
    });
  });

  describe("empty state", () => {
    it("reports empty when every panel is gated out", async () => {
      // Arrange — a dashboard of nothing but mobile panels, on a browser-only stream
      const mobileOnlyDashboard = {
        panels: [
          {
            layout: { x: 0, y: 0, w: 3, h: 4, i: 1 },
            title: "Crash-free Sessions",
            queries: [],
            o2Platform: "mobile",
          },
        ],
      };
      let tab: ReturnType<typeof useRumPerformanceTab> | null = null;
      const dateTime = ref<RumTabDateTime | undefined>({
        start_time: new Date(1),
        end_time: new Date(2),
      });
      mount(
        defineComponent({
          setup() {
            tab = useRumPerformanceTab(mobileOnlyDashboard, dateTime);
            return () => null;
          },
        }),
      );

      // Act
      mockResolvedKey.value = "1_2";
      await tab!.ensureRumSchema();
      await nextTick();

      // Assert
      expect(tab!.showEmptyState.value).toBe(true);
    });

    it("is not empty before anything has resolved", () => {
      // Act
      const { tab } = mountTab();

      // Assert
      expect(tab.showEmptyState.value).toBe(false);
    });
  });
});
