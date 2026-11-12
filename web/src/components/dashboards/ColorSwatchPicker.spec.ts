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
import i18n from "@/locales";
import ColorSwatchPicker from "./ColorSwatchPicker.vue";

const SWATCHES = ["#22c55e", "#f59e0b", "#ef4444"];

const mountPicker = (props: Record<string, unknown> = {}) =>
  mount(ColorSwatchPicker, {
    props: { swatches: SWATCHES, dataTest: "picker", ...props },
    global: { plugins: [i18n] },
  });

describe("ColorSwatchPicker", () => {
  it("shows the None square by default, so its current users are unchanged", () => {
    const wrapper = mountPicker();
    const none = wrapper.find('[data-test="picker-none"]');
    expect(none.exists()).toBe(true);
    expect(none.attributes("aria-pressed")).toBe("true");
  });

  it("emits null when None is clicked", async () => {
    const wrapper = mountPicker({ modelValue: "#22c55e" });
    await wrapper.find('[data-test="picker-none"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")).toEqual([[null]]);
  });

  it("hides None when allowNone is false and keeps the swatches and custom input", () => {
    const wrapper = mountPicker({ allowNone: false, modelValue: "#f59e0b" });
    expect(wrapper.find('[data-test="picker-none"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-test^="picker-swatch-"]')).toHaveLength(3);
    expect(wrapper.find('input[type="color"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="picker-swatch-1"]').attributes("aria-pressed")).toBe("true");
  });

  it("emits the swatch value when a swatch is clicked", async () => {
    const wrapper = mountPicker({ allowNone: false });
    await wrapper.find('[data-test="picker-swatch-2"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")).toEqual([["#ef4444"]]);
  });

  it("emits the custom colour from the native input", async () => {
    const wrapper = mountPicker({ allowNone: false });
    const input = wrapper.find('input[type="color"]');
    await input.setValue("#123456");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["#123456"]);
  });
});
