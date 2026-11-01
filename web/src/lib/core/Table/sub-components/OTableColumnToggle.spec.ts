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

function mountToggle(defaults?: Record<string, boolean>) {
  return mount(OTableColumnToggle, {
    props: {
      columns,
      columnVisibility: { name: false, arch: true, from: true },
      defaultColumnVisibility: defaults,
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

const toggleColumns = [
  { id: "name", header: "Name", hideable: true },
  { id: "kind", header: "Kind", hideable: true },
] as OTableColumnDef[];

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

  it("makes the button itself the menu trigger, with the hidden-count badge inside it", () => {
    const wrapper = mount(OTableColumnToggle, {
      props: { columns: toggleColumns, columnVisibility: { kind: false } },
      attachTo: document.body,
    });
    const button = wrapper.get('[data-test="o2-table-column-toggle-btn"]');
    expect(button.element.tagName).toBe("BUTTON");
    expect(button.attributes("aria-haspopup")).toBe("menu");
    expect(button.attributes("aria-label")).toBe("Manage columns, 1 hidden");
    expect(button.find('[data-test="o2-table-column-toggle-hidden-badge"]').text()).toBe("1");
    expect(wrapper.find("div[aria-expanded]").exists()).toBe(false);
    wrapper.unmount();
  });
});
