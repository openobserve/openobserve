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
  it("says how often it checks and how much data each check reads", () => {
    const wrapper = mountTimeline(10, 30);
    expect(wrapper.get('[data-test="add-alert-check-timeline-caption"]').text()).toBe(
      "Every 10 min we read the last 30 min of data.",
    );
    expect(wrapper.text()).toContain("Now");
    expect(wrapper.text()).toContain("40 min ago");
  });

  it("warns when events can fall between two checks", () => {
    expect(mountTimeline(10, 5).find('[data-test="add-alert-check-timeline-gap"]').exists()).toBe(
      true,
    );
    expect(mountTimeline(10, 10).find('[data-test="add-alert-check-timeline-gap"]').exists()).toBe(
      false,
    );
  });

  it("draws the read window back from now, stopping at the edge of the line", () => {
    const band = (period: number) =>
      mountTimeline(10, period).get('[data-test="add-alert-check-timeline-band"]');
    expect(Number(band(10).attributes("width"))).toBe(120);
    expect(Number(band(1000).attributes("x"))).toBe(0);
  });
});
