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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import PanelChartPlaceholder from "./PanelChartPlaceholder.vue";

describe("PanelChartPlaceholder", () => {
  it("is one image named Loading chart, filling the body it is given", () => {
    const wrapper = mount(PanelChartPlaceholder, { props: { dataTest: "card-body" } });
    const root = wrapper.find('[data-test="card-body"]');
    expect(root.attributes("role")).toBe("img");
    expect(root.attributes("aria-label")).toBe("Loading chart");
    expect(root.classes()).toEqual(expect.arrayContaining(["h-full", "w-full"]));
  });

  it("is one static block: no shimmer, no pulse, no axes, and no second live region", () => {
    const wrapper = mount(PanelChartPlaceholder);
    const blocks = wrapper.findAll(".bg-skeleton-base");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].classes()).not.toContain("animate-pulse");
    expect(blocks[0].classes()).not.toContain("skeleton-wave");
    expect(blocks[0].attributes("aria-hidden")).toBe("true");
    expect(wrapper.find("svg, canvas").exists()).toBe(false);
  });

  it("announces nothing under a failure message, which says it instead, and keeps its look (K2)", () => {
    const wrapper = mount(PanelChartPlaceholder, { props: { dataTest: "tile", failed: true } });
    const root = wrapper.find('[data-test="tile"]');
    expect(root.attributes("role")).toBeUndefined();
    expect(root.attributes("aria-label")).toBeUndefined();
    expect(root.attributes("aria-hidden")).toBe("true");
    expect(wrapper.findAll(".bg-skeleton-base")).toHaveLength(1);
    expect(root.classes()).toEqual(expect.arrayContaining(["h-full", "w-full"]));
  });

  it("is a loading image unless told it failed", () => {
    const root = mount(PanelChartPlaceholder).find('[data-test="chart-placeholder"]');
    expect(root.attributes("aria-hidden")).toBeUndefined();
    expect(root.attributes("aria-label")).toBe("Loading chart");
  });
});
