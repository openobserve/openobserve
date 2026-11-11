// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import OFilterToken from "./OFilterToken.vue";
import { raw } from "@/types/i18n";

const mountToken = (props: Record<string, unknown> = {}) =>
  mount(OFilterToken, {
    props: {
      field: raw("level"),
      operator: raw("="),
      value: raw("error"),
      dataTest: "t",
      ...props,
    },
  });

describe("OFilterToken", () => {
  it("draws a segment per part", () => {
    const wrapper = mountToken();
    expect(wrapper.find('[data-test="t-field"]').text()).toBe("level");
    expect(wrapper.find('[data-test="t-operator"]').text()).toBe("=");
    expect(wrapper.find('[data-test="t-value"]').text()).toBe("error");
  });

  it("emits the clicked part with its element", async () => {
    const wrapper = mountToken();
    await wrapper.find('[data-test="t-operator"]').trigger("click");
    const [part, element] = wrapper.emitted("select")![0] as [string, HTMLElement];
    expect(part).toBe("operator");
    expect(element.getAttribute("data-test")).toBe("t-operator");
  });

  it("emits nothing from a token that only displays", async () => {
    const wrapper = mountToken({ editable: false });
    await wrapper.find('[data-test="t-field"]').trigger("click");
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("puts the dismiss on the last segment, even before a value is picked", async () => {
    const wrapper = mountToken({ value: undefined, removable: true });
    expect(wrapper.find('[data-test="t-value"]').exists()).toBe(false);
    await wrapper.find('[data-test="t-remove"]').trigger("click");
    expect(wrapper.emitted("remove")).toHaveLength(1);
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("removes a focused token on Backspace or Delete, as a chip in a text field does", async () => {
    const wrapper = mountToken({ removable: true });
    await wrapper.find('[data-test="t-field"]').trigger("keydown", { key: "Backspace" });
    await wrapper.find('[data-test="t-value"]').trigger("keydown", { key: "Delete" });
    expect(wrapper.emitted("remove")).toHaveLength(2);
    await wrapper.find('[data-test="t-field"]').trigger("keydown", { key: "a" });
    expect(wrapper.emitted("remove")).toHaveLength(2);
  });

  it("keeps a token that cannot be removed when Backspace is pressed on it", async () => {
    const wrapper = mountToken();
    await wrapper.find('[data-test="t-field"]').trigger("keydown", { key: "Backspace" });
    expect(wrapper.emitted("remove")).toBeUndefined();
  });

  it("marks the active segment", () => {
    const wrapper = mountToken({ activePart: "value" });
    expect(wrapper.find('[data-test="t-value"]').classes()).toContain("ring-2");
    expect(wrapper.find('[data-test="t-field"]').classes()).not.toContain("ring-2");
  });
});
