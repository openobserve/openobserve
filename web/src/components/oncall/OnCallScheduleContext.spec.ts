// Copyright 2026 OpenObserve Inc.

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OnCallScheduleContext from "@/components/oncall/OnCallScheduleContext.vue";
import i18n from "@/locales";
import type { ResolvedSegment } from "@/ts/interfaces/oncall";

const NOW = 1_800_000_000_000_000;
const HOUR = 3_600_000_000;

const stubs = {
  OUserCell: { name: "OUserCell", props: ["value"], template: "<span>{{ value }}</span>" },
  OIcon: { name: "OIcon", template: "<i />" },
  OText: { name: "OText", template: "<span><slot /></span>" },
};

function render(props: Record<string, unknown> = {}) {
  return mount(OnCallScheduleContext, {
    props: { now: NOW, timezone: "UTC", ...props },
    global: { plugins: [i18n], stubs },
  });
}

const segments: ResolvedSegment[] = [
  { slot: "primary", from: NOW - HOUR, to: NOW + 2 * HOUR, user_email: "ana@o2.ai", rotation: "Primary" },
  { slot: "primary", from: NOW + 2 * HOUR, to: NOW + 8 * HOUR, user_email: "bo@o2.ai", rotation: "Primary" },
];

describe("OnCallScheduleContext", () => {
  it("counts down to the handover and names who catches it", () => {
    const text = render({ segments }).text();
    expect(text).toContain("2h");
    expect(text).toContain("bo@o2.ai");
  });

  // A countdown with no successor is half an answer: "who do I brief" is the
  // reason anybody reads this cell.
  it("says so when the shift hands over to nobody", () => {
    const text = render({ segments: [segments[0]] }).text();
    expect(text).toContain("nobody");
  });






  it("totals the gaps ahead and names the first window", () => {
    const withGap: ResolvedSegment[] = [
      segments[0],
      { slot: "primary", from: NOW + 2 * HOUR, to: NOW + 5 * HOUR, rotation: "Primary" },
    ];
    const text = render({ segments: withGap }).text();
    expect(text).toContain("1 gap");
    expect(text).toContain("3h");
  });

  it("says plainly when nothing in the window is uncovered", () => {
    const text = render({ segments }).text();
    expect(text).toContain("No gaps");
  });


});
