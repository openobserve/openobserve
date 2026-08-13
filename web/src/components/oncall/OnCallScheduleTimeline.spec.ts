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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import OnCallScheduleTimeline from "@/components/oncall/OnCallScheduleTimeline.vue";
import i18n from "@/locales";
import type { ResolvedSegment, Rotation } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY, MICROS_PER_WEEK } from "@/ts/interfaces/oncall";

const stubs = {
  OText: { name: "OText", template: "<span><slot /></span>" },
  OInnerLoading: { name: "OInnerLoading", template: "<div />" },
  OButton: {
    name: "OButton",
    emits: ["click"],
    template: "<button @click=\"$emit('click')\"><slot /></button>",
  },
  OScheduleTimeline: {
    name: "OScheduleTimeline",
    props: ["tracks", "axisTicks", "nowOffset", "nowLabel"],
    template: "<div><slot name='legend' /></div>",
  },
};

const DAY = MICROS_PER_DAY;
const start = Math.floor((Date.now() * 1000) / DAY) * DAY;

const rotation = (name: string): Rotation => ({
  name,
  members: ["ana@o2.ai", "bob@o2.ai"],
  shift_micros: MICROS_PER_WEEK,
  anchor_micros: start,
});

const seg = (over: Partial<ResolvedSegment> = {}): ResolvedSegment => ({
  from: start,
  to: start + 3 * DAY,
  user_email: "ana@o2.ai",
  rotation: "Primary",
  ...over,
});

function render(over: Record<string, unknown> = {}) {
  return mount(OnCallScheduleTimeline, {
    props: {
      rotations: [rotation("Primary")],
      segments: [seg()],
      timezone: "UTC",
      window: { from: 0, to: 0 },
      "onUpdate:window": () => {},
      ...over,
    } as any,
    global: { plugins: [i18n], stubs },
  });
}

const tracksOf = (wrapper: any) =>
  wrapper.findComponent({ name: "OScheduleTimeline" }).props("tracks");

describe("OnCallScheduleTimeline", () => {
  it("draws one lane per rotation", () => {
    const wrapper = render({
      rotations: [rotation("Primary"), rotation("Secondary")],
      segments: [seg(), seg({ rotation: "Secondary", user_email: "bob@o2.ai" })],
    });
    expect(tracksOf(wrapper).map((t: any) => t.key)).toEqual(["Primary", "Secondary"]);
  });

  /// A layer nobody is on all week still has to appear — an absent lane reads
  /// as "no such rotation" rather than "this rotation covers nothing".
  it("keeps a lane for a rotation with no segments", () => {
    const wrapper = render({
      rotations: [rotation("Primary"), rotation("Weekends")],
      segments: [seg()],
    });
    const weekends = tracksOf(wrapper).find((t: any) => t.key === "Weekends");
    expect(weekends).toBeDefined();
    expect(weekends.bands).toHaveLength(0);
  });

  /// The whole reason to ask the server: a span with nobody in it arrives as a
  /// segment, so a gap is drawn rather than inferred from a hole.
  it("draws an uncovered span as a gap band", () => {
    const wrapper = render({ segments: [seg({ user_email: null })] });
    expect(tracksOf(wrapper)[0].bands[0].tone).toBe("gap");
  });

  /// Keyed off the address so somebody keeps their colour as the window moves.
  it("gives each person a stable colour and two people different ones", () => {
    const wrapper = render({
      segments: [
        seg({ user_email: "ana@o2.ai" }),
        seg({ from: start + 3 * DAY, to: start + 6 * DAY, user_email: "bob@o2.ai" }),
      ],
    });
    const [first, second] = tracksOf(wrapper)[0].bands;
    expect(first.tone).not.toBe(second.tone);
    expect(first.tone).not.toBe("gap");
  });

  /// A band is role="img"; a schedule a screen reader cannot read is not a
  /// schedule.
  it("gives every band an accessible name", () => {
    const band = tracksOf(render())[0].bands[0];
    expect(band.ariaLabel).toContain("ana@o2.ai");
    expect(band.ariaLabel).toContain("Primary");
  });

  it("offers to fill the first gap, and stays quiet when there is none", () => {
    expect(render().find('[data-test="oncall-timeline-fill-gap"]').exists()).toBe(false);

    const withGap = render({ segments: [seg({ user_email: null })] });
    expect(withGap.find('[data-test="oncall-timeline-gap"]').exists()).toBe(true);
  });

  it("hands the caller the gap it offered to fill", async () => {
    const wrapper = render({ segments: [seg({ user_email: null })] });
    await wrapper.find('[data-test="oncall-timeline-fill-gap"]').trigger("click");

    expect(wrapper.emitted("fill-gap")?.[0]?.[0]).toMatchObject({ rotation: "Primary" });
  });

  /// The parent owns the fetch, so the window has to be published rather than
  /// kept private — otherwise the range buttons change nothing.
  it("publishes the window it wants fetched", () => {
    const wrapper = render();
    const emitted = wrapper.emitted("update:window");
    expect(emitted?.length).toBeTruthy();
    const [{ from, to }] = emitted!.at(-1) as [{ from: number; to: number }];
    expect(to - from).toBe(7 * DAY);
  });

  /// Changing the range must move the window, or the buttons are decoration.
  it("asks for a different window when the range changes", async () => {
    const wrapper = render();
    await wrapper.find('[data-test="oncall-timeline-range-day"]').trigger("click");

    const [{ from, to }] = wrapper.emitted("update:window")!.at(-1) as [
      { from: number; to: number },
    ];
    expect(to - from).toBe(DAY);
  });
});
