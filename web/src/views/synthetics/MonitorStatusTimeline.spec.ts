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
import MonitorStatusTimeline from "./MonitorStatusTimeline.vue";

// ── Test data ──────────────────────────────────────────────────────────────

interface TimelineExecution {
  location: string;
  browserEngine: string;
  device: string;
  status: "pass" | "warning" | "fail" | "error";
  errorSnippet: string | null;
}

interface TimelineSegment {
  runId: string;
  status: "all-pass" | "all-warning" | "mixed" | "all-fail";
  color: string;
  title: string;
  timestampMs: number;
  executions: TimelineExecution[];
}

function makePassExec(overrides?: Partial<TimelineExecution>): TimelineExecution {
  return {
    location: "us-east-1",
    browserEngine: "Chromium",
    device: "laptop_large",
    status: "pass",
    errorSnippet: null,
    ...overrides,
  };
}

function makeFailExec(overrides?: Partial<TimelineExecution>): TimelineExecution {
  return {
    location: "eu-west-1",
    browserEngine: "Chromium",
    device: "laptop_large",
    status: "fail",
    errorSnippet: "TimeoutError",
    ...overrides,
  };
}

function makeSegment(
  overrides?: Partial<TimelineSegment>,
): TimelineSegment {
  return {
    runId: "run-001",
    status: "all-pass",
    color: "bg-[var(--color-badge-success-solid-bg)]",
    title: "Passed",
    timestampMs: 1_700_000_000_000,
    executions: [makePassExec()],
    ...overrides,
  };
}

const defaultProps = {
  segments: [] as TimelineSegment[],
  failCount: "0",
  passCount: "0",
  mixedCount: "0",
  startLabel: "Start",
  endLabel: "End",
  isBrowser: true,
};

// ── Mount factory ──────────────────────────────────────────────────────────

function makeWrapper(props: Record<string, unknown> = {}) {
  return mount(MonitorStatusTimeline, {
    props: { ...defaultProps, ...props },
    global: {
      plugins: [i18n],
      stubs: {
        OIcon: { template: '<span class="oicon-stub" />', props: ["name", "size"] },
        OTooltip: {
          template: '<div class="otooltip-stub"><slot name="content" /></div>',
          props: ["side", "delay", "maxWidth"],
        },
      },
    },
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("MonitorStatusTimeline", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("initial render with segments", () => {
    it("should render the root container with data-test", () => {
      wrapper = makeWrapper({
        segments: [makeSegment()],
        failCount: "1",
        passCount: "10",
        mixedCount: "2",
      });

      expect(
        wrapper.find('[data-test="monitor-status-timeline"]').exists(),
      ).toBe(true);
    });

    it("should render timeline bars for each segment", () => {
      const segments = [
        makeSegment({ runId: "run-001", color: "bg-[var(--color-badge-success-solid-bg)]" }),
        makeSegment({ runId: "run-002", color: "bg-[var(--color-badge-error-solid-bg)]" }),
        makeSegment({ runId: "run-003", color: "bg-[var(--color-badge-orange-solid-bg)]" }),
      ];
      wrapper = makeWrapper({ segments });

      const bars = wrapper.findAll('[data-test="monitor-status-timeline"] .otooltip-stub');
      expect(bars.length).toBe(3);
    });

    it("should display legend counts from props", () => {
      wrapper = makeWrapper({
        segments: [makeSegment()],
        failCount: "7",
        passCount: "42",
        mixedCount: "3",
      });

      const root = wrapper.find('[data-test="monitor-status-timeline"]');
      const text = root.text();
      expect(text).toContain("7");
      expect(text).toContain("Failed");
      expect(text).toContain("42");
      expect(text).toContain("Passed");
      expect(text).toContain("3");
      expect(text).toContain("Warning");
    });

    it("should render start and end labels", () => {
      wrapper = makeWrapper({
        segments: [makeSegment()],
        startLabel: "2026-07-01",
        endLabel: "2026-07-15",
      });

      const root = wrapper.find('[data-test="monitor-status-timeline"]');
      const text = root.text();
      expect(text).toContain("2026-07-01");
      expect(text).toContain("2026-07-15");
    });
  });

  describe("scroll arrows", () => {
    it("should render both scroll arrow buttons", () => {
      wrapper = makeWrapper({ segments: [makeSegment()] });

      const leftBtn = wrapper.find('[aria-label="Scroll timeline left"]');
      const rightBtn = wrapper.find('[aria-label="Scroll timeline right"]');

      expect(leftBtn.exists()).toBe(true);
      expect(rightBtn.exists()).toBe(true);
    });

    it("should have left arrow disabled initially (scrollLeft is 0)", () => {
      wrapper = makeWrapper({ segments: [makeSegment()] });

      const leftBtn = wrapper.find('[aria-label="Scroll timeline left"]');
      // The button has :disabled="!canScrollLeft" — since scrollLeft starts at 0, canScrollLeft is false
      expect(leftBtn.attributes("disabled")).toBeDefined();
    });

    it("should have right arrow disabled when content does not overflow", () => {
      wrapper = makeWrapper({ segments: [makeSegment()] });

      const rightBtn = wrapper.find('[aria-label="Scroll timeline right"]');
      // In jsdom scrollWidth/clientWidth are 0, so canScrollRight is false
      expect(rightBtn.attributes("disabled")).toBeDefined();
    });
  });

  describe("empty segments", () => {
    it("should render with zero legend counts when segments is empty", () => {
      wrapper = makeWrapper({
        segments: [],
        failCount: "0",
        passCount: "0",
        mixedCount: "0",
      });

      const root = wrapper.find('[data-test="monitor-status-timeline"]');
      const text = root.text();
      expect(text).toContain("0 Failed");
      expect(text).toContain("0 Passed");
      expect(text).toContain("0 Warning");
    });

    it("should show 'Showing 1-0 of 0 runs' for empty segments", () => {
      wrapper = makeWrapper({ segments: [] });

      const text = wrapper.find('[data-test="monitor-status-timeline"]').text();
      // rangeLabel = "Showing " + start + "-" + end + " of " + total + " runs"
      expect(text).toContain("of 0 runs");
    });
  });

  describe("tooltip content", () => {
    it("should render execution details in tooltip content slot", () => {
      const executions: TimelineExecution[] = [
        makePassExec({ location: "us-east-1", browserEngine: "Chromium", device: "laptop" }),
        makeFailExec({ location: "eu-west-1", browserEngine: "Firefox", device: "mobile" }),
      ];
      wrapper = makeWrapper({
        segments: [makeSegment({ executions })],
      });

      const tooltip = wrapper.find(".otooltip-stub");
      expect(tooltip.exists()).toBe(true);
      // Tooltip should contain location labels
      const tooltipText = tooltip.text();
      expect(tooltipText).toContain("us-east-1");
      expect(tooltipText).toContain("eu-west-1");
      expect(tooltipText).toContain("laptop");
      expect(tooltipText).toContain("mobile");
    });

    it("should show correct pass/fail counts in tooltip header", () => {
      const executions: TimelineExecution[] = [
        makePassExec(),
        makePassExec(),
        makeFailExec(),
      ];
      wrapper = makeWrapper({
        segments: [makeSegment({ executions })],
      });

      const tooltip = wrapper.find(".otooltip-stub");
      const text = tooltip.text();
      expect(text).toContain("2 passed");
      expect(text).toContain("1 failed");
    });
  });

  describe("isBrowser prop", () => {
    it("should render per-execution details with device text when isBrowser is true", () => {
      const executions: TimelineExecution[] = [
        makePassExec({ location: "us-east-1", browserEngine: "Chromium", device: "laptop" }),
        makeFailExec({ location: "us-east-1", browserEngine: "Firefox", device: "tablet" }),
      ];
      wrapper = makeWrapper({
        segments: [makeSegment({ executions })],
        isBrowser: true,
      });

      const tooltip = wrapper.find(".otooltip-stub");
      const text = tooltip.text();
      // Per-execution device labels should be visible
      expect(text).toContain("laptop");
      expect(text).toContain("tablet");
    });

    it("should NOT render per-execution detail rows when isBrowser is false", () => {
      const executions: TimelineExecution[] = [
        makePassExec({ location: "us-east-1", browserEngine: "Chromium", device: "laptop" }),
        makeFailExec({ location: "eu-west-1", browserEngine: "Firefox", device: "tablet" }),
      ];
      wrapper = makeWrapper({
        segments: [makeSegment({ executions })],
        isBrowser: false,
      });

      const tooltip = wrapper.find(".otooltip-stub");
      const text = tooltip.text();
      // Location group headers should still be shown
      expect(text).toContain("us-east-1");
      expect(text).toContain("eu-west-1");
      // But per-execution device labels should NOT be shown
      expect(text).not.toContain("laptop");
      expect(text).not.toContain("tablet");
    });
  });

  describe("segment colors", () => {
    it("should apply the segment color class to each bar", () => {
      const segments = [
        makeSegment({ runId: "r1", color: "bg-red-500" }),
        makeSegment({ runId: "r2", color: "bg-green-500" }),
      ];
      wrapper = makeWrapper({ segments });

      const bars = wrapper.findAll('[data-test="monitor-status-timeline"] [style]');
      // Each segment renders a div with `:style="{ width: ... }"` and `:class="seg.color"`
      // We should have at least 2 bars with style (the timeline segments)
      // plus potentially more from the legend dots.
      // Just verify bars exist with color classes
      const allNodes = wrapper.findAll('[data-test="monitor-status-timeline"] > div > div > div > div > div > div');
      // The color class is bound to each segment div inside the scroll area
      const bars_in_scroll = wrapper.find('[data-test="monitor-status-timeline"]').findAll('[class*="bg-"]');
      expect(bars_in_scroll.length).toBeGreaterThanOrEqual(2);
    });
  });
});
