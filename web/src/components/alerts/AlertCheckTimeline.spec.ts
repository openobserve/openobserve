// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import AlertCheckTimeline from "./AlertCheckTimeline.vue";

const mountTimeline = (frequency: number, period: number, extra: Record<string, unknown> = {}) =>
  mount(AlertCheckTimeline, {
    props: { frequency, period, ...extra },
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
  });

  it("draws the strip only once Show is pressed", async () => {
    const wrapper = mountTimeline(10, 10);
    expect(wrapper.text()).not.toContain(i18n.global.t("alerts.sections.timeline.now"));
    await wrapper.get('[data-test="add-alert-check-timeline-toggle"]').trigger("click");
    expect(wrapper.text()).toContain(i18n.global.t("alerts.sections.timeline.now"));
  });

  const t = i18n.global.t;
  const equal = t("alerts.form.schedule.equalWords", { period: "5 minutes" });
  it.each([
    [{ aligned: true }, "alerts.form.schedule.alignedBlocks", {}],
    [
      { queryCondition: { type: "promql", promql_multi_alert: true } },
      "alerts.form.schedule.promqlLatest",
      {},
    ],
    [{ queryCondition: { type: "promql" } }, "alerts.form.schedule.promqlAny", { overlap: equal }],
  ])("says what a window means for %j", (extra, key, params) => {
    const text = mountTimeline(5, 5, extra).get('[data-test="add-alert-check-timeline-caption"]');
    expect(text.text()).toBe(t(key, { period: "5 minutes", ...params }));
  });

  it("keeps one drawing height whether checks overlap or leave gaps", async () => {
    const wrapper = mountTimeline(10, 30);
    await wrapper.get('[data-test="add-alert-check-timeline-toggle"]').trigger("click");
    const height = () =>
      wrapper.get('[data-test="add-alert-check-timeline-drawing"]').attributes("height");
    const overlap = height();
    expect(wrapper.find('[data-test="add-alert-check-timeline-overlap"]').exists()).toBe(true);
    await wrapper.setProps({ period: 5 });
    expect(wrapper.find('[data-test="add-alert-check-timeline-gaps"]').exists()).toBe(true);
    expect(height()).toBe(overlap);
  });
});
