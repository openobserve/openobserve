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

import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import LogsNoEventsState from "./LogsNoEventsState.vue";
import { getConsumableRelativeTime } from "@/utils/date";

const OEmptyStateStub = defineComponent({
  name: "OEmptyState",
  setup(_, { slots }) {
    return () =>
      h("div", { "data-test": "o-empty-state" }, [slots.description?.(), slots.extra?.()]);
  },
});

// The window Index passes, resolved from the period the way Index.vue's queryWindowUs does.
const mountWithWindow = (relativeTimePeriod: string, rangeLimitHours?: number) => {
  const r = getConsumableRelativeTime(relativeTimePeriod, "UTC")!;
  return mount(LogsNoEventsState, {
    props: {
      sqlMode: false,
      query: "",
      editorValue: "",
      relativeTimePeriod,
      dateType: "relative",
      aiEnabled: false,
      queryWindowUs: { start: r.startTime, end: r.endTime },
      timezone: "UTC",
      rangeLimitHours,
    },
    global: { plugins: [i18n, store], stubs: { OEmptyState: OEmptyStateStub } },
  });
};

const mountState = (relativeTimePeriod: string) =>
  mount(LogsNoEventsState, {
    props: {
      sqlMode: false,
      query: "",
      editorValue: "",
      relativeTimePeriod,
      dateType: "relative",
      aiEnabled: false,
    },
    global: { plugins: [i18n, store], stubs: { OEmptyState: OEmptyStateStub } },
  });

describe("LogsNoEventsState", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names a calendar period in the no-events message", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T03:00:00Z"));
    const text = mountState("calendar:month:-1").text();
    expect(text).toContain("Previous month");
    expect(text).not.toContain("NaN");
  });

  it("keeps the rolling wording for a rolling period", () => {
    expect(mountState("15m").text()).toContain("Last 15 minutes");
  });

  it("dates the empty range from the query window (R7)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T03:00:00Z"));
    const text = mountWithWindow("calendar:month:-1").text();
    expect(text).toContain("No events in Oct 1 – 31");
  });

  it("dates the empty range in the user's locale", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T03:00:00Z"));
    const locale = i18n.global.locale;
    (i18n.global as any).locale = "fr";
    try {
      const text = mountWithWindow("calendar:month:-1").text();
      expect(text).toMatch(/oct\./);
      expect(text).not.toContain("Oct ");
    } finally {
      (i18n.global as any).locale = locale;
    }
  });

  it("offers the next longer quick range and emits its period (R7, O4)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T03:19:00Z"));
    const wrapper = mountWithWindow("15m");
    expect(wrapper.text()).toContain("No events in Nov 16, 03:04 – 03:19");
    const btn = wrapper.find('[data-test="logs-no-events-try-range-btn"]');
    expect(btn.text()).toBe("Try Last 1 hour");
    await btn.trigger("click");
    expect(wrapper.emitted("apply-range")).toEqual([["1h"]]);
  });

  it("rounds a live range's bounds to the minute (B9, R5)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T03:19:48Z"));
    const text = mountWithWindow("15m").text();
    expect(text).toContain("No events in Nov 16, 03:04 – 03:19");
    expect(text).not.toContain(":48");
  });

  it("keeps the dated message and Try beside the jump card (B10, R7)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T03:19:00Z"));
    const r = getConsumableRelativeTime("15m", "UTC")!;
    const wrapper = mount(LogsNoEventsState, {
      props: {
        sqlMode: false,
        query: "",
        editorValue: "",
        relativeTimePeriod: "15m",
        dateType: "relative",
        aiEnabled: false,
        queryWindowUs: { start: r.startTime, end: r.endTime },
        streamDocTimeRange: { min: 1_000_000, max: 10_000_000 },
        timezone: "UTC",
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          OEmptyState: defineComponent({
            setup(_, { slots }) {
              return () => h("div", [slots.description?.(), slots.actions?.(), slots.extra?.()]);
            },
          }),
        },
      },
    });
    expect(wrapper.find('[data-test="logs-no-events-jump-to-data-card"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("No events in Nov 16, 03:04 – 03:19");
    expect(wrapper.text()).not.toContain("doesn't contain any data");
    expect(wrapper.find('[data-test="logs-no-events-try-range-btn"]').text()).toBe(
      "Try Last 1 hour",
    );
  });

  it("offers no longer range when it is over the stream's query-range limit", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T03:19:00Z"));
    expect(
      mountWithWindow("4h", 24).find('[data-test="logs-no-events-try-range-btn"]').text(),
    ).toBe("Try Last 24 hours");
    const wrapper = mountWithWindow("24h", 24);
    expect(wrapper.find('[data-test="logs-no-events-try-range-btn"]').exists()).toBe(false);
  });

  it("offers no longer range when no quick range is longer than the window (O4)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T03:00:00Z"));
    const wrapper = mountWithWindow("calendar:month:-1");
    expect(wrapper.find('[data-test="logs-no-events-try-range-btn"]').exists()).toBe(false);
  });
});
