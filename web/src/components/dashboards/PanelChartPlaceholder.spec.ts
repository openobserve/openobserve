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

  it("is a blank box: no skeleton, shimmer, axes or second live region", () => {
    const wrapper = mount(PanelChartPlaceholder);
    expect(wrapper.findComponent({ name: "OSkeleton" }).exists()).toBe(false);
    expect(wrapper.find(".bg-skeleton-base").exists()).toBe(false);
    expect(wrapper.find('[data-test="chart-placeholder"]').element.childElementCount).toBe(0);
  });

  it("stays a loading image with no way to be told it failed", () => {
    const wrapper = mount(PanelChartPlaceholder, { props: { failed: true } as any });
    const root = wrapper.find('[data-test="chart-placeholder"]');
    expect(root.attributes("role")).toBe("img");
    expect(root.attributes("aria-label")).toBe("Loading chart");
    expect(root.attributes("aria-hidden")).toBeUndefined();
  });
});
