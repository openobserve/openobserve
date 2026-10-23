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
import ColorSwatchPicker from "./ColorSwatchPicker.vue";

const swatches = ["#111111", "#222222", "#333333"];

describe("ColorSwatchPicker", () => {
  it("renders the 'no color' swatch by default", () => {
    const wrapper = mount(ColorSwatchPicker, {
      props: { modelValue: null, swatches, dataTest: "picker" },
    });
    expect(wrapper.find('[data-test="picker-none"]').exists()).toBe(true);
  });

  it("hides the 'no color' swatch when allowNone is false", () => {
    const wrapper = mount(ColorSwatchPicker, {
      props: { modelValue: swatches[0], swatches, allowNone: false, dataTest: "picker" },
    });
    expect(wrapper.find('[data-test="picker-none"]').exists()).toBe(false);
  });

  it("emits the clicked swatch value", async () => {
    const wrapper = mount(ColorSwatchPicker, {
      props: { modelValue: null, swatches, allowNone: false, dataTest: "picker" },
    });
    await wrapper.find('[data-test="picker-swatch-1"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["#222222"]);
  });
});
