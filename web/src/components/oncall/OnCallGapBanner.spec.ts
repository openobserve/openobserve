// Copyright 2026 OpenObserve Inc.

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OnCallGapBanner from "@/components/oncall/OnCallGapBanner.vue";
import i18n from "@/locales";
import type { ResolvedSegment } from "@/ts/interfaces/oncall";

const NOW = 1_800_000_000_000_000;
const HOUR = 3_600_000_000;

function render(segments: ResolvedSegment[]) {
  return mount(OnCallGapBanner, {
    props: { segments, now: NOW, timezone: "UTC" },
    global: { plugins: [i18n] },
  });
}

const covered: ResolvedSegment[] = [
  { from: NOW - HOUR, to: NOW + 4 * HOUR, user_email: "ana@o2.ai", rotation: "Primary" },
];

describe("OnCallGapBanner", () => {
  // The banner is the attention-banner kind of fact: absent when healthy.
  // A permanent "No gaps" row spends space confirming nothing is wrong.
  it("renders nothing when every hour ahead is covered", () => {
    expect(render(covered).find('[data-test="oncall-gap-banner"]').exists()).toBe(false);
  });

  it("warns with the count, the total and the first window", () => {
    const text = render([
      ...covered,
      { from: NOW + 4 * HOUR, to: NOW + 7 * HOUR, rotation: "Primary" },
    ]).text();
    expect(text).toContain("1 coverage gap");
    expect(text).toContain("3h");
  });

  // Last night's gap is a postmortem, not a warning.
  it("ignores gaps already behind now", () => {
    const wrapper = render([
      { from: NOW - 5 * HOUR, to: NOW - HOUR, rotation: "Primary" },
      ...covered,
    ]);
    expect(wrapper.find('[data-test="oncall-gap-banner"]').exists()).toBe(false);
  });

  // The whole reason to interrupt the reader is that they can fix it here.
  it("hands the first gap to fill-gap, pre-filled", async () => {
    const gap: ResolvedSegment = { from: NOW + 4 * HOUR, to: NOW + 7 * HOUR, rotation: "Primary" };
    const wrapper = render([...covered, gap]);
    await wrapper.find('[data-test="oncall-gap-banner-fill"]').trigger("click");
    expect(wrapper.emitted("fill-gap")?.[0]).toEqual([gap]);
  });
});
