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
import store from "@/test/unit/helpers/store";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import TracesGroupBySelect from "./TracesGroupBySelect.vue";

const mountSelect = (props: Record<string, unknown> = {}) =>
  mount(TracesGroupBySelect, {
    props: { modelValue: "", sqlMode: false, fields: ["service_name", "http_method"], ...props },
    global: {
      plugins: [i18n, store],
      stubs: {
        OSelect: {
          name: "OSelect",
          props: ["modelValue", "disabled", "options", "searchable"],
          template: '<div><slot name="trigger" /></div>',
        },
        OTooltip: { name: "OTooltip", props: ["content"], template: "<span />" },
      },
    },
  });

describe("TracesGroupBySelect", () => {
  it("is labelled Group by and offers None first, then the stream's fields", () => {
    const wrapper = mountSelect();
    expect(wrapper.get('[data-test="traces-group-by-select-wrap"] > span').text()).toBe("Group by");
    const select = wrapper.findComponent(OSelect);
    expect(select.attributes("aria-label")).toBe("Group by");
    expect(select.props("searchable")).toBe(true);
    expect(select.props("options")).toEqual([
      { label: "None", value: null },
      { label: "service_name", value: "service_name" },
      { label: "http_method", value: "http_method" },
    ]);
  });

  it("shows None by default and the picked field once grouped", () => {
    expect(mountSelect().find('[data-test="traces-group-by-select-value"]').text()).toBe("None");
    const grouped = mountSelect({ modelValue: "http_method" });
    expect(grouped.find('[data-test="traces-group-by-select-value"]').text()).toBe("http_method");
  });

  it("emits the picked field, and an empty key for None", () => {
    const wrapper = mountSelect({ modelValue: "service_name" });
    wrapper.findComponent(OSelect).vm.$emit("update:modelValue", "http_method");
    wrapper.findComponent(OSelect).vm.$emit("update:modelValue", null);
    expect(wrapper.emitted("update:modelValue")).toEqual([["http_method"], [""]]);
  });

  it("is disabled in SQL mode with a tooltip to write GROUP BY, and reads None", () => {
    const wrapper = mountSelect({ sqlMode: true, modelValue: "service_name" });
    const select = wrapper.findComponent(OSelect);
    expect(select.props("disabled")).toBe(true);
    expect(select.props("modelValue")).toBe(null);
    expect(wrapper.findAllComponents(OTooltip).map((tip) => tip.props("content"))).toEqual([
      "Write GROUP BY in SQL mode",
    ]);
  });

  it("has no tooltip with SQL mode off", () => {
    expect(mountSelect().findAllComponents(OTooltip)).toHaveLength(0);
  });
});
