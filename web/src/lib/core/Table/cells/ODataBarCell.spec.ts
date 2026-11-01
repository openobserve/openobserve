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
import ODataBarCell from "./ODataBarCell.vue";

const bar = (props: Record<string, unknown>) =>
  mount(ODataBarCell, { props: props as any }).find('[aria-hidden="true"]');

describe("ODataBarCell", () => {
  it("scales from zero with the tone class when no min or colour is given", () => {
    const fill = bar({ value: 25, max: 100 });
    expect(fill.attributes("style")).toBe("width: 25%;");
    expect(fill.classes()).toContain("bg-progress-bar-default");
    expect(bar({ value: 0, max: 100 }).exists()).toBe(false);
  });

  it("scales between a column min and max", () => {
    expect(bar({ value: 0, min: -50, max: 50 }).attributes("style")).toContain("width: 50%");
    expect(bar({ value: -50, min: -50, max: 50 }).exists()).toBe(false);
  });

  it("paints a data colour over the tone", () => {
    expect(bar({ value: 10, max: 10, color: "#ff0000" }).attributes("style")).toContain(
      "background-color: rgb(255, 0, 0)",
    );
  });

  it("draws a filled bar on a track beside the value in gauge mode", () => {
    const cell = mount(ODataBarCell, {
      props: { value: 25, max: 100, gauge: true, display: "25" },
    });
    expect(cell.find('[data-test="o2-data-bar-cell-track"]').classes()).toContain(
      "bg-progress-bar-track",
    );
    expect(cell.find('[data-test="o2-data-bar-cell-fill"]').attributes("style")).toBe(
      "width: 25%;",
    );
    expect(cell.text()).toBe("25");
    const plain = mount(ODataBarCell, { props: { value: 25, max: 100 } });
    expect(plain.find('[data-test="o2-data-bar-cell-track"]').exists()).toBe(false);
  });
});
