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
import { createI18n } from "vue-i18n";
import enUS from "@/locales/languages/en-US.json";
import ProfilesFunctionMenu from "./ProfilesFunctionMenu.vue";
import FlameGraphView from "@/components/common/FlameGraphView.vue";

const i18n = createI18n({ legacy: false, locale: "en-US", messages: { "en-US": enUS } });

const stubs = {
  ODropdown: { template: "<div><slot name='trigger' /><slot /></div>" },
  ODropdownItem: { template: "<button><slot /></button>" },
  OButton: { template: "<button><slot /></button>" },
  OSwitch: true,
  OTooltip: true,
  OTruncatedText: { template: "<span><slot /></span>" },
  ChartRenderer: { name: "ChartRenderer", props: ["data"], template: "<div />" },
};

const labels = (root: ParentNode) =>
  [...root.querySelectorAll("button")].map((button) => button.textContent?.trim() ?? "");

describe("ProfilesFunctionMenu", () => {
  it("lists the same actions, in the same order and wording, as the flame graph frame menu", async () => {
    const row = mount(ProfilesFunctionMenu, {
      props: { name: "a", dataTest: "row" },
      global: { plugins: [i18n], stubs },
    });
    const rowItems = labels(row.element).slice(1);

    const flame = mount(FlameGraphView, {
      attachTo: document.body,
      props: {
        root: { name: "total", total: 10, children: [{ name: "a", total: 10, children: [] }] },
        unitLabel: "ns",
        summaryLabel: "total",
        summaryValue: "1",
      },
      global: { plugins: [i18n], stubs },
    });
    await flame.get('[data-test="flame-graph-plot"]').trigger("focus");
    await flame.get('[data-test="flame-graph-plot"]').trigger("keydown", { key: "ArrowDown" });
    await flame.get('[data-test="flame-graph-plot"]').trigger("keydown", { key: "ContextMenu" });
    const frameItems = labels(flame.get('[data-test="flame-graph-frame-menu"]').element);

    const shared = ["Copy function name", "Highlight function"];
    expect(rowItems.slice(0, shared.length)).toEqual(shared);
    expect(frameItems.slice(0, shared.length)).toEqual(shared);
    expect(rowItems.at(-2)).toBe(frameItems.at(-2));
    expect(rowItems.at(-1)).toBe(frameItems.at(-1));
    expect(rowItems).toEqual(
      expect.arrayContaining(["Function details", "Show callers and callees"]),
    );
    flame.unmount();
  });
});
