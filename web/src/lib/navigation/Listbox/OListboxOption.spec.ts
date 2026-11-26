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

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import OListboxOption from "./OListboxOption.vue";

describe("OListboxOption", () => {
  it("renders a link option that never takes focus itself", () => {
    const w = mount(OListboxOption, {
      props: { href: "/web/dashboards", icon: "dashboard" },
      slots: { default: "Payments overview", meta: "Payments" },
    });
    expect(w.element.tagName).toBe("A");
    expect(w.attributes()).toMatchObject({
      href: "/web/dashboards",
      role: "option",
      tabindex: "-1",
      "aria-selected": "false",
    });
    expect(w.get('[data-test="o-listbox-option-label"]').text()).toBe("Payments overview");
    expect(w.get('[data-test="o-listbox-option-meta"]').text()).toBe("Payments");
  });

  it("marks the highlighted row for the owning field", () => {
    const w = mount(OListboxOption, { props: { href: "/x", highlighted: true } });
    expect(w.attributes("aria-selected")).toBe("true");
    expect(w.attributes("data-highlighted")).toBe("true");
    expect(w.classes()).toContain("bg-dropdown-item-hover-bg");
  });

  it("emits select on click, and neither links nor emits while disabled", async () => {
    const enabled = mount(OListboxOption, { props: { href: "/x" } });
    await enabled.trigger("click");
    expect(enabled.emitted("select")).toHaveLength(1);
    const disabled = mount(OListboxOption, { props: { href: "/x", disabled: true } });
    expect(disabled.element.tagName).toBe("DIV");
    expect(disabled.attributes("href")).toBeUndefined();
    expect(disabled.attributes("aria-disabled")).toBe("true");
    await disabled.trigger("click");
    expect(disabled.emitted("select")).toBeUndefined();
  });

  it("renders no meta or trailing box without their slots", () => {
    const w = mount(OListboxOption, { slots: { default: "Logs" } });
    expect(w.find('[data-test="o-listbox-option-meta"]').exists()).toBe(false);
    expect(w.findAll("span.shrink-0")).toHaveLength(0);
  });
});
