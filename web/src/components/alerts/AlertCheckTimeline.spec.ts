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
    [10, 30, "overlap", 20],
    [10, 10, "equal", 0],
    [10, 5, "gaps", 5],
  ] as const)("every %i min looking at %i min reads as %s", (frequency, period, kind, minutes) => {
    const wrapper = mountTimeline(frequency, period);
    expect(wrapper.get('[data-test="add-alert-check-timeline-caption"]').text()).toBe(
      i18n.global.t(`alerts.form.schedule.${kind}`, { period, minutes }),
    );
    expect(wrapper.text()).toContain(i18n.global.t("alerts.sections.timeline.now"));
  });

  it("draws the read window back from now, stopping at the edge of the line", () => {
    const band = (period: number) =>
      mountTimeline(10, period).get('[data-test="add-alert-check-timeline-band"]');
    expect(Number(band(10).attributes("width"))).toBe(120);
    expect(Number(band(1000).attributes("x"))).toBe(0);
  });
});
