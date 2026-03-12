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

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";

// ---------------------------------------------------------------------------
// moment-timezone mock
// Each moment object exposes _ms so that diff() can compute the real delta
// between two moment instances (nowMoment.diff(tsMoment)).
// ---------------------------------------------------------------------------
vi.mock("moment-timezone", () => {
  const makeMomentObj = (ms: number) => ({
    _ms: ms,
    format: (fmt: string) => {
      if (fmt === "hh:mm:ss A") return "12:00:00 PM";
      if (fmt === "D MMM")
        return new Date(ms).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
        });
      return "";
    },
    // diff(other, unit): this._ms - other._ms gives positive seconds for past times
    diff: (other: any, unit: string) => {
      if (unit === "seconds") return Math.floor((ms - other._ms) / 1000);
      return 0;
    },
  });

  const momentTz = (dateArg: Date, _tz: string) =>
    makeMomentObj(dateArg.getTime());
  momentTz.tz = momentTz;
  return { default: momentTz };
});

import TraceTimestampCell from "./TraceTimestampCell.vue";

installQuasar();

// ---------------------------------------------------------------------------
// Fixed clock — ensures Date.now() inside the component matches our constants
// ---------------------------------------------------------------------------
const FIXED_NOW = new Date("2026-03-07T12:00:00.000Z");
const FIXED_NOW_MS = FIXED_NOW.getTime();

// trace_start_time is in microseconds (component divides by 1000 to get ms)
const MICROS_TODAY = FIXED_NOW_MS * 1000 - 3600 * 1e6; // 1 hour ago → "Today"
const MICROS_YESTERDAY = FIXED_NOW_MS * 1000 - 25 * 3600 * 1e6; // 25 h ago → "Yesterday"
const MICROS_OLDER = FIXED_NOW_MS * 1000 - 3 * 86400 * 1e6; // 3 days ago → "D MMM"

const makeStore = (timezone = "UTC") =>
  createStore({ state: { timezone } });

describe("TraceTimestampCell", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const mount_ = (trace_start_time: number, timezone = "UTC") =>
    mount(TraceTimestampCell, {
      props: { item: { trace_start_time } },
      global: { plugins: [makeStore(timezone), i18n] },
    });

  describe("rendering", () => {
    it("mounts without errors", async () => {
      wrapper = mount_(MICROS_TODAY);
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the timestamp container", async () => {
      wrapper = mount_(MICROS_TODAY);
      await flushPromises();
      expect(wrapper.find('[data-test="trace-row-timestamp"]').exists()).toBe(true);
    });

    it("renders the day/time span", async () => {
      wrapper = mount_(MICROS_TODAY);
      await flushPromises();
      expect(wrapper.find('[data-test="trace-row-timestamp-day"]').exists()).toBe(true);
    });
  });

  describe("relative day labels", () => {
    it("shows 'Today' for traces within the last 24 hours", async () => {
      wrapper = mount_(MICROS_TODAY);
      await flushPromises();
      expect(wrapper.text()).toContain("Today");
    });

    it("shows 'Yesterday' for traces 24-48 hours ago", async () => {
      wrapper = mount_(MICROS_YESTERDAY);
      await flushPromises();
      expect(wrapper.text()).toContain("Yesterday");
    });

    it("shows formatted date for traces older than 2 days", async () => {
      wrapper = mount_(MICROS_OLDER);
      await flushPromises();
      // Should not say Today or Yesterday
      expect(wrapper.text()).not.toContain("Today");
      expect(wrapper.text()).not.toContain("Yesterday");
      // Should contain the formatted time
      expect(wrapper.text()).toContain("12:00:00 PM");
    });
  });

  describe("time display", () => {
    it("shows formatted time alongside the day label", async () => {
      wrapper = mount_(MICROS_TODAY);
      await flushPromises();
      expect(wrapper.text()).toContain("12:00:00 PM");
    });
  });

  describe("reactivity", () => {
    it("updates when trace_start_time prop changes", async () => {
      wrapper = mount_(MICROS_TODAY);
      await flushPromises();
      expect(wrapper.text()).toContain("Today");

      await wrapper.setProps({ item: { trace_start_time: MICROS_YESTERDAY } });
      await flushPromises();
      expect(wrapper.text()).toContain("Yesterday");
    });
  });

  describe("edge cases", () => {
    it("handles zero timestamp without crashing", async () => {
      wrapper = mount_(0);
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("handles undefined trace_start_time without crashing", async () => {
      wrapper = mount_(undefined as any);
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });
  });

  // --- Tests for spans mode (added in Mar 10 commit ae988c7) ---

  describe("searchMode='spans' — start_time in nanoseconds", () => {
    // start_time is ns → divide by 1_000_000 for ms
    const NANOS_TODAY = FIXED_NOW_MS * 1_000_000 - 3600 * 1e9; // 1 h ago → "Today"
    const NANOS_YESTERDAY = FIXED_NOW_MS * 1_000_000 - 25 * 3600 * 1e9; // 25 h ago → "Yesterday"

    const mountSpans = (start_time: number, timezone = "UTC") =>
      mount(TraceTimestampCell, {
        props: { item: { start_time }, searchMode: "spans" },
        global: { plugins: [makeStore(timezone), i18n] },
      });

    it("mounts without error when given start_time and searchMode='spans'", async () => {
      wrapper = mountSpans(NANOS_TODAY);
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("shows 'Today' when start_time is within last 24 hours", async () => {
      wrapper = mountSpans(NANOS_TODAY);
      await flushPromises();
      expect(wrapper.text()).toContain("Today");
    });

    it("shows 'Yesterday' when start_time is 24-48 hours ago", async () => {
      wrapper = mountSpans(NANOS_YESTERDAY);
      await flushPromises();
      expect(wrapper.text()).toContain("Yesterday");
    });

    it("falls through to start_time when trace_start_time is null", async () => {
      // trace_start_time not provided → component uses start_time (ns path)
      wrapper = mount(TraceTimestampCell, {
        props: { item: { start_time: NANOS_TODAY }, searchMode: "spans" },
        global: { plugins: [makeStore(), i18n] },
      });
      await flushPromises();
      expect(wrapper.text()).toContain("Today");
    });

    it("prefers trace_start_time over start_time when both are present", async () => {
      // trace_start_time != null → component divides by 1000 (µs path)
      const trace_start_time = FIXED_NOW_MS * 1000 - 3600 * 1e6; // µs, 1 h ago
      wrapper = mount(TraceTimestampCell, {
        props: {
          item: { trace_start_time, start_time: 0 },
          searchMode: "spans",
        },
        global: { plugins: [makeStore(), i18n] },
      });
      await flushPromises();
      expect(wrapper.text()).toContain("Today");
    });
  });

  describe("reactivity — start_time changes in spans mode", () => {
    const NANOS_TODAY = FIXED_NOW_MS * 1_000_000 - 3600 * 1e9;
    const NANOS_YESTERDAY = FIXED_NOW_MS * 1_000_000 - 25 * 3600 * 1e9;

    it("updates when start_time prop changes", async () => {
      wrapper = mount(TraceTimestampCell, {
        props: { item: { start_time: NANOS_TODAY }, searchMode: "spans" },
        global: { plugins: [makeStore(), i18n] },
      });
      await flushPromises();
      expect(wrapper.text()).toContain("Today");

      await wrapper.setProps({ item: { start_time: NANOS_YESTERDAY } });
      await flushPromises();
      expect(wrapper.text()).toContain("Yesterday");
    });
  });
});
