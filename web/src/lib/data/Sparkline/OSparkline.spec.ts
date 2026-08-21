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

import OSparkline from "./OSparkline.vue";

describe("OSparkline", () => {
  it("renders one line path per unbroken run", () => {
    const wrapper = mount(OSparkline, { props: { points: [1, 2, 3, 4] } });
    // area + line for a single run
    expect(wrapper.findAll("path")).toHaveLength(2);
  });

  it("BREAKS the line at a null instead of drawing through zero", () => {
    // The component's reason to exist: a gap must not read as a collapse.
    const wrapper = mount(OSparkline, { props: { points: [5, 5, null, 5, 5] } });
    const lines = wrapper.findAll('path[stroke="currentColor"]');
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.attributes("d")).not.toContain("NaN");
  });

  it("does not draw a bar for a missing point, but does for a real zero", () => {
    const gap = mount(OSparkline, { props: { shape: "bar", points: [5, null, 5] } });
    expect(gap.findAll("rect")).toHaveLength(2);

    const zero = mount(OSparkline, { props: { shape: "bar", points: [5, 0, 5] } });
    expect(zero.findAll("rect")).toHaveLength(3);
  });

  it("renders a placeholder that reserves height when there is no data", () => {
    const wrapper = mount(OSparkline, { props: { points: [] } });
    expect(wrapper.find("svg").exists()).toBe(false);
    expect(wrapper.find("div").classes()).toContain("h-5");
  });

  it("renders an all-null series as the empty placeholder", () => {
    const wrapper = mount(OSparkline, { props: { points: [null, null] } });
    expect(wrapper.find("svg").exists()).toBe(false);
  });

  it("still draws a visible mark for a single isolated point", () => {
    const wrapper = mount(OSparkline, { props: { points: [null, 7, null] } });
    const line = wrapper.find('path[stroke="currentColor"]');
    expect(line.exists()).toBe(true);
    expect(line.attributes("d")).toMatch(/^M[\d.]+,[\d.]+ L[\d.]+,[\d.]+$/);
  });

  it("produces no NaN coordinates for a flat series", () => {
    // A zero range would divide by zero without the guard.
    const wrapper = mount(OSparkline, { props: { points: [3, 3, 3] } });
    for (const path of wrapper.findAll("path")) {
      expect(path.attributes("d")).not.toContain("NaN");
    }
  });

  it("scales to a shared max so sibling sparklines stay comparable", () => {
    const own = mount(OSparkline, { props: { points: [1, 2] } });
    const shared = mount(OSparkline, { props: { points: [1, 2], max: 100 } });
    expect(own.find('path[stroke="currentColor"]').attributes("d")).not.toBe(
      shared.find('path[stroke="currentColor"]').attributes("d"),
    );
  });

  it("applies the tone class matching OCoverageMeter's vocabulary", () => {
    const wrapper = mount(OSparkline, { props: { points: [1, 2], tone: "danger" } });
    expect(wrapper.find("svg").classes()).toContain("text-status-error-text");
  });

  it("dims a provisional bar so a live tail is distinguishable", () => {
    const wrapper = mount(OSparkline, {
      props: { shape: "bar", points: [{ value: 5 }, { value: 6, provisional: true }] },
    });
    const rects = wrapper.findAll("rect");
    expect(rects[0].attributes("opacity")).toBe("1");
    expect(rects[1].attributes("opacity")).toBe("0.4");
  });

  it("exposes the series to assistive tech via aria-label", () => {
    const wrapper = mount(OSparkline, {
      props: { points: [1, 2], ariaLabel: "calls over time", dataTest: "dbm-queries" },
    });
    const svg = wrapper.find("svg");
    expect(svg.attributes("role")).toBe("img");
    expect(svg.attributes("aria-label")).toBe("calls over time");
    expect(svg.attributes("data-test")).toBe("dbm-queries-sparkline");
  });
});
