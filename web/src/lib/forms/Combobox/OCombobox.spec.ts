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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import OCombobox from "./OCombobox.vue";
import type { ComboboxOption } from "./OCombobox.types";
import i18n from "@/locales";
import { labelRows } from "@/components/shared/ServiceNameLabel.fixtures";

const row = labelRows.differs;

const plain: ComboboxOption[] = [
  { label: "Series 1", value: "series1" },
  { label: "Series 2", value: "series2" },
];

const described: ComboboxOption[] = [
  {
    label: row.display_name,
    value: row.service_name,
    description: `detected as ${row.service_name}`,
    searchText: row.service_name,
  },
  { label: "nats", value: "nats" },
];

let wrapper: VueWrapper | undefined;

async function open(items: ComboboxOption[], typed = "") {
  wrapper = mount(OCombobox, {
    props: { items, modelValue: typed },
    attrs: { "data-test": "box" },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });
  await flushPromises();
  await wrapper.get('[data-test="box-input"]').trigger("click");
  await flushPromises();
}

const options = () =>
  [...document.body.querySelectorAll('[data-test="box-option"]')] as HTMLElement[];

describe("OCombobox", () => {
  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    document.body.innerHTML = "";
  });

  it("filters options without searchText on the label only", async () => {
    await open(plain, "series1");
    expect(options()).toHaveLength(0);
    wrapper!.unmount();
    document.body.innerHTML = "";
    await open(plain, "2");
    expect(options().map((o) => o.dataset.testValue)).toEqual(["series2"]);
  });

  it("draws the description under the label when an option has one", async () => {
    await open(described);
    const [first, second] = options();
    expect(first.textContent).toContain(row.display_name);
    expect(first.querySelector('[data-test="box-option-description"]')?.textContent).toBe(
      `detected as ${row.service_name}`,
    );
    expect(second.querySelector('[data-test="box-option-description"]')).toBeNull();
  });

  it("matches searchText when the label does not, and keeps the value", async () => {
    await open(described, row.service_name.slice(0, 6));
    expect(options().map((o) => o.dataset.testValue)).toEqual([row.service_name]);
  });
});

describe("OCombobox aria", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("routes aria-* attrs to the real control, not the wrapper", () => {
    wrapper = mount(OCombobox, {
      props: { items: [] },
      attrs: { "aria-label": "Name", "aria-labelledby": "lbl", "aria-describedby": "desc" },
    });
    const control = wrapper.find("input");
    expect(control.attributes("aria-label")).toBe("Name");
    expect(control.attributes("aria-labelledby")).toBe("lbl");
    expect(control.attributes("aria-describedby")).toBe("desc");
    expect(wrapper.element.getAttribute("aria-label")).toBeNull();
    expect(wrapper.element.getAttribute("aria-labelledby")).toBeNull();
    expect(wrapper.element.getAttribute("aria-describedby")).toBeNull();
  });

  it("warns when mounted without a label or aria name", () => {
    vi.stubEnv("MODE", "development");
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount(OCombobox, { props: { items: [] } }).unmount();
    mount(OCombobox, { attrs: { "aria-label": "Name" }, props: { items: [] } }).unmount();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("OCombobox"));
  });
});
