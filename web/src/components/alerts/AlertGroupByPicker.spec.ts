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
import OSelect from "@/lib/forms/Select/OSelect.vue";
import AlertGroupByPicker from "./AlertGroupByPicker.vue";

const mountPicker = () =>
  mount(AlertGroupByPicker, {
    props: { modelValue: [], options: ["a", "b", "c"] },
    global: { plugins: [i18n] },
  });

describe("AlertGroupByPicker", () => {
  it("holds picks while the list is open and hands them over once on close", async () => {
    const wrapper = mountPicker();
    const select = wrapper.findComponent(OSelect);
    select.vm.$emit("open");
    select.vm.$emit("update:modelValue", ["a"]);
    select.vm.$emit("update:modelValue", ["a", "b"]);
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(select.props("modelValue")).toEqual(["a", "b"]);

    select.vm.$emit("close");
    expect(wrapper.emitted("update:modelValue")).toEqual([[["a", "b"]]]);

    select.vm.$emit("update:modelValue", ["b"]);
    expect(wrapper.emitted("update:modelValue")?.[1]).toEqual([["b"]]);
  });
});
