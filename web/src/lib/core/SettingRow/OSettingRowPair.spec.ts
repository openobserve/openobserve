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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { h } from "vue";

import { raw } from "@/types/i18n";

import OSettingRow from "./OSettingRow.vue";
import OSettingRowPair from "./OSettingRowPair.vue";

// A render-function slot, so the required label prop can be built with raw().
const twoRows = () => [
  h(OSettingRow, { label: raw("a"), dataTest: "a" }),
  h(OSettingRow, { label: raw("b"), dataTest: "b" }),
];

describe("OSettingRowPair", () => {
  it("renders both rows in one grid", () => {
    const wrapper = mount(OSettingRowPair, { slots: { default: twoRows } });

    expect(wrapper.find('[data-test="a"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="b"]').exists()).toBe(true);
    const grid = wrapper.find(".grid");
    expect(grid.classes()).toContain("grid-cols-[45%_45%]");
    expect(grid.classes()).toContain("max-md:grid-cols-1");
  });

  it("owns the rule so the cells do not draw their own", () => {
    const wrapper = mount(OSettingRowPair, { slots: { default: twoRows } });

    expect(wrapper.classes()).toContain("border-b");
    expect(wrapper.classes()).toContain("last:border-b-0");
    for (const row of ["a", "b"]) {
      const classes = wrapper.find(`[data-test="${row}"]`).classes();
      expect(classes).not.toContain("border-b");
      expect(classes).not.toContain("py-3");
    }
  });

  it("renders the footer under both cells only when given", () => {
    const bare = mount(OSettingRowPair, { slots: { default: twoRows } });
    expect(bare.find(".mt-1").exists()).toBe(false);

    const wrapper = mount(OSettingRowPair, {
      slots: { default: twoRows, footer: '<p data-test="msg">too small</p>' },
    });
    expect(wrapper.find('[data-test="msg"]').exists()).toBe(true);
    expect(wrapper.find(".grid").find('[data-test="msg"]').exists()).toBe(false);
  });

  it("forwards data-test", () => {
    const wrapper = mount(OSettingRowPair, {
      props: { dataTest: "settings-password-policy-pair-length" },
      slots: { default: twoRows },
    });

    expect(wrapper.attributes("data-test")).toBe("settings-password-policy-pair-length");
  });
});
