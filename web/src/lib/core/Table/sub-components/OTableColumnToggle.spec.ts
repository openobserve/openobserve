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
import i18n from "@/locales";
import OTableColumnToggle from "./OTableColumnToggle.vue";
import type { OTableColumnDef } from "../OTable.types";

const columns = [
  { id: "name", header: "Name", hideable: true },
  { id: "arch", header: "Architecture", hideable: true },
  { id: "from", header: "Last connected from", hideable: true },
] as unknown as OTableColumnDef[];

function mountToggle(
  defaults?: Record<string, boolean>,
  visibility: Record<string, boolean> = { name: false, arch: true, from: true },
  hasResizedColumns = false,
) {
  return mount(OTableColumnToggle, {
    props: {
      columns,
      columnVisibility: visibility,
      defaultColumnVisibility: defaults,
      hasResizedColumns,
    },
    global: {
      plugins: [i18n],
      stubs: {
        ODropdown: { template: "<div><slot name='trigger' /><slot /></div>" },
        OTooltip: { template: "<div><slot /></div>" },
      },
    },
  });
}

describe("OTableColumnToggle", () => {
  it("resets to the table's defaults, keeping hidden-by-default columns hidden", async () => {
    const wrapper = mountToggle({ arch: false, from: false });
    await wrapper.find('[data-test="o2-table-column-toggle-reset-btn"]').trigger("click");
    expect(wrapper.emitted("update:columnVisibility")?.[0]).toEqual([
      { name: true, arch: false, from: false },
    ]);
  });

  it("shows every column on reset when the table has no defaults", async () => {
    const wrapper = mountToggle();
    await wrapper.find('[data-test="o2-table-column-toggle-reset-btn"]').trigger("click");
    expect(wrapper.emitted("update:columnVisibility")?.[0]).toEqual([
      { name: true, arch: true, from: true },
    ]);
  });

  it("does not count a column the table hides by default as hidden", () => {
    const wrapper = mountToggle({ arch: false }, { name: true, arch: false, from: true });
    expect(wrapper.find('[data-test="o2-table-column-toggle-hidden-badge"]').exists()).toBe(false);
  });

  it("counts a default-hidden column the reader turned on", () => {
    const wrapper = mountToggle({ arch: false }, { name: true, arch: true, from: true });
    expect(wrapper.find('[data-test="o2-table-column-toggle-hidden-badge"]').text()).toBe("1");
  });

  it("disables reset while the table is already at its defaults", async () => {
    const wrapper = mountToggle({ arch: false }, { name: true, arch: false, from: true });
    const reset = wrapper.find('[data-test="o2-table-column-toggle-reset-btn"]');
    expect(reset.attributes("disabled")).toBeDefined();
    await reset.trigger("click");
    expect(wrapper.emitted("update:columnVisibility")).toBeUndefined();
  });

  it("resets widths too when only the sizes differ from default", async () => {
    const wrapper = mountToggle({ arch: false }, { name: true, arch: false, from: true }, true);
    await wrapper.find('[data-test="o2-table-column-toggle-reset-btn"]').trigger("click");
    expect(wrapper.emitted("reset:columnSizes")).toHaveLength(1);
  });
});
