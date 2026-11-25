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

import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { GROUPS_LIMIT } from "@/utils/traces/tracesGroups";
import TracesGroupBySelect from "./TracesGroupBySelect.vue";

let wrapper: VueWrapper | undefined;

const mountSelect = (props: Record<string, unknown> = {}) => {
  wrapper = mount(TracesGroupBySelect, {
    props: { modelValue: "", fields: ["service_name", "http_method"], ...props },
    global: { plugins: [i18n, store] },
    attachTo: document.body,
  });
  return wrapper;
};

const trigger = (w: VueWrapper) => w.get('[data-test="traces-group-by-chip-trigger"]');
const pickerOpen = () =>
  document.querySelector('[role="listbox"], [data-test="traces-group-by-chip-search"]') !== null;

describe("TracesGroupBySelect", () => {
  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it("is a dashed Group by chip over a searchable list of the stream's fields", () => {
    const w = mountSelect();
    expect(w.get('[data-test="traces-group-by-chip-value"]').text()).toBe("Group by");
    expect(w.get('[data-test="traces-group-by-chip-wrap"]').classes()).toContain("border-dashed");
    const select = w.findComponent(OSelect);
    expect(select.props("searchable")).toBe(true);
    expect(select.props("modelValue")).toBe(null);
    expect(select.props("options")).toEqual([
      { label: "service_name", value: "service_name" },
      { label: "http_method", value: "http_method" },
    ]);
    expect(trigger(w).attributes("aria-label")).toBe("Group by");
    expect(w.find('[data-test="traces-group-by-clear"]').exists()).toBe(false);
  });

  it("reads Grouped by the field, with the count shown only in a wide results pane", () => {
    const w = mountSelect({ modelValue: "http_method", count: 12 });
    expect(w.get('[data-test="traces-group-by-chip-field"]').text()).toBe("Grouped by http_method");
    const count = w.get('[data-test="traces-group-by-chip-count"]');
    expect(count.text()).toBe("· 12 groups");
    expect(count.classes()).toEqual(
      expect.arrayContaining(["hidden", "@min-[67rem]/results:inline"]),
    );
    expect(w.get('[data-test="traces-group-by-chip-wrap"]').classes()).toContain("border-accent");
    expect(w.findComponent(OSelect).props("modelValue")).toBe("http_method");
  });

  it("names the trigger by its visible text, count included", () => {
    expect(
      trigger(mountSelect({ modelValue: "http_method", count: 12 })).attributes("aria-label"),
    ).toBe("Grouped by http_method · 12 groups");
    wrapper?.unmount();
    expect(
      trigger(mountSelect({ modelValue: "http_method", count: null })).attributes("aria-label"),
    ).toBe("Grouped by http_method");
  });

  it("leaves the count out until the groups load", () => {
    const w = mountSelect({ modelValue: "http_method", count: null });
    expect(w.find('[data-test="traces-group-by-chip-count"]').exists()).toBe(false);
  });

  it("marks the count approximate only above the Groups table's row limit", () => {
    const count = (n: number) => {
      wrapper?.unmount();
      return mountSelect({ modelValue: "http_method", count: n })
        .get('[data-test="traces-group-by-chip-count"]')
        .text();
    };
    expect(count(GROUPS_LIMIT - 1)).toBe(`· ${GROUPS_LIMIT - 1} groups`);
    expect(count(GROUPS_LIMIT)).toBe(`· ${GROUPS_LIMIT} groups`);
    expect(count(GROUPS_LIMIT + 1)).toBe(`· ~${GROUPS_LIMIT + 1} groups`);
    expect(count(1234)).toBe("· ~1.2K groups");
  });

  it("caps a long field name and keeps the full name in its title", () => {
    const field = "resource_attributes_k8s_deployment_name_long";
    const w = mountSelect({ modelValue: field, fields: [field] });
    const label = w.get('[data-test="traces-group-by-chip-field"]');
    expect(label.classes()).toEqual(expect.arrayContaining(["max-w-56", "truncate"]));
    expect(label.attributes("title")).toBe(field);
  });

  it("emits a newly picked field and ignores the current one", () => {
    const w = mountSelect({ modelValue: "service_name" });
    w.findComponent(OSelect).vm.$emit("update:modelValue", "http_method");
    w.findComponent(OSelect).vm.$emit("update:modelValue", "service_name");
    expect(w.emitted("update:modelValue")).toEqual([["http_method"]]);
  });

  it("opens the field list from the trigger", async () => {
    const w = mountSelect({ modelValue: "service_name" });
    await trigger(w).trigger("click");
    await flushPromises();
    expect(trigger(w).attributes("aria-expanded")).toBe("true");
    expect(pickerOpen()).toBe(true);
  });

  it("clears with its own small labelled button, without opening the field list", async () => {
    const w = mountSelect({ modelValue: "service_name", count: 3 });
    const clear = w.get('[data-test="traces-group-by-clear"]');
    expect(clear.attributes("aria-label")).toBe("Clear Group by");
    expect(clear.classes()).toContain("size-5!");
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      clear.element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    }
    await clear.trigger("click");
    await flushPromises();
    expect(w.emitted("update:modelValue")).toEqual([[""]]);
    expect(trigger(w).attributes("aria-expanded")).not.toBe("true");
    expect(pickerOpen()).toBe(false);
  });
});
