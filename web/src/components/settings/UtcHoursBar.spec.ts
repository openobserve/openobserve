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

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import UtcHoursBar from "./UtcHoursBar.vue";

const OTooltipStub = {
  name: "OTooltip",
  props: ["content", "side", "sideOffset"],
  template: `<span data-test="o-tooltip-stub" :data-content="content" />`,
};

function mountBar(windows: Array<{ start_minute: number; end_minute: number }>) {
  return mount(UtcHoursBar, {
    props: { windows },
    global: { stubs: { OTooltip: OTooltipStub } },
  });
}

function segmentStyles(wrapper: ReturnType<typeof mountBar>) {
  return wrapper
    .findAll("[data-test^='utc-hours-bar-segment-']")
    .map((el) => ({ left: el.element.style.left, width: el.element.style.width }));
}

describe("UtcHoursBar", () => {
  it("renders one segment per non-wrapping window with proportional geometry", () => {
    // DeepSeek's peak hours: 01:00-04:00 and 06:00-10:00 UTC.
    const wrapper = mountBar([
      { start_minute: 60, end_minute: 240 },
      { start_minute: 360, end_minute: 600 },
    ]);
    const segs = segmentStyles(wrapper);
    expect(segs).toHaveLength(2);
    // 60/1440 = 4.1667%, (240-60)/1440 = 12.5%
    expect(parseFloat(segs[0].left)).toBeCloseTo(4.1667, 3);
    expect(parseFloat(segs[0].width)).toBeCloseTo(12.5, 3);
    expect(parseFloat(segs[1].left)).toBeCloseTo(25, 3);
    expect(parseFloat(segs[1].width)).toBeCloseTo(16.6667, 3);
  });

  it("splits a midnight-wrapping window into a tail run and a head run", () => {
    // 22:00 -> 02:00 wraps: [22:00, 24:00) plus [00:00, 02:00).
    const wrapper = mountBar([{ start_minute: 1320, end_minute: 120 }]);
    const segs = segmentStyles(wrapper);
    expect(segs).toHaveLength(2);
    expect(parseFloat(segs[0].left)).toBeCloseTo((1320 / 1440) * 100, 3);
    expect(parseFloat(segs[0].width)).toBeCloseTo((120 / 1440) * 100, 3);
    expect(parseFloat(segs[1].left)).toBeCloseTo(0, 3);
    expect(parseFloat(segs[1].width)).toBeCloseTo((120 / 1440) * 100, 3);
  });

  it("labels each segment with the window's full range, not the split run", () => {
    const wrapper = mountBar([{ start_minute: 1320, end_minute: 120 }]);
    const tooltips = wrapper.findAll("[data-test='o-tooltip-stub']");
    expect(tooltips).toHaveLength(2);
    for (const tip of tooltips) {
      expect(tip.attributes("data-content")).toBe("22:00 – 02:00 UTC");
    }
  });

  it("skips degenerate windows (start === end) instead of drawing a full-day run", () => {
    const wrapper = mountBar([
      { start_minute: 300, end_minute: 300 },
      { start_minute: 60, end_minute: 240 },
    ]);
    expect(segmentStyles(wrapper)).toHaveLength(1);
  });

  it("renders an empty track when there are no windows", () => {
    const wrapper = mountBar([]);
    expect(segmentStyles(wrapper)).toHaveLength(0);
    expect(wrapper.find("[data-test='utc-hours-bar']").exists()).toBe(true);
  });

  it("shows the six-hour ruler from 00:00 through 24:00", () => {
    const wrapper = mountBar([]);
    const ticks = wrapper.findAll("[data-test='utc-hours-bar'] span").map((el) => el.text());
    expect(ticks).toEqual(["00:00", "06:00", "12:00", "18:00", "24:00"]);
  });

  it("treats an end of 1440 (24:00) as end-of-day, a single run to the right edge", () => {
    // 20:00 -> 24:00. end % 1440 === 0 < start, so it takes the wrap branch and
    // the head run [0, 0) must collapse to nothing.
    const wrapper = mountBar([{ start_minute: 1200, end_minute: 1440 }]);
    const segs = segmentStyles(wrapper);
    expect(segs).toHaveLength(1);
    expect(parseFloat(segs[0].left)).toBeCloseTo((1200 / 1440) * 100, 3);
    expect(parseFloat(segs[0].width)).toBeCloseTo((240 / 1440) * 100, 3);
  });
});
