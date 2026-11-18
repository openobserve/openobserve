// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import AlertCheckTimeline from "./AlertCheckTimeline.vue";

const mountTimeline = (frequency: number, period: number) =>
  mount(AlertCheckTimeline, {
    props: { frequency, period },
    global: { plugins: [i18n] },
  });

describe("AlertCheckTimeline", () => {
  it.each([
    [10, 30, "Each check looks at the last 30 minutes, so checks overlap by 20 minutes."],
    [10, 11, "Each check looks at the last 11 minutes, so checks overlap by 1 minute."],
    [60, 120, "Each check looks at the last 2 hours, so checks overlap by 1 hour."],
    [
      1,
      1,
      "Each check looks at the last 1 minute, the same as the time between checks: no gaps, no overlap.",
    ],
    [
      10,
      5,
      "Each check looks at the last 5 minutes, so there are gaps of 5 minutes between checks.",
    ],
  ] as const)("every %i min looking at %i min reads %j", (frequency, period, caption) => {
    const wrapper = mountTimeline(frequency, period);
    expect(wrapper.get('[data-test="add-alert-check-timeline-caption"]').text()).toBe(caption);
    expect(wrapper.text()).toContain(i18n.global.t("alerts.sections.timeline.now"));
  });

  it("draws the read window back from now, stopping at the edge of the line", () => {
    const band = (period: number) =>
      mountTimeline(10, period).get('[data-test="add-alert-check-timeline-band"]');
    expect(Number(band(10).attributes("width"))).toBe(120);
    expect(Number(band(1000).attributes("x"))).toBe(0);
  });
});
