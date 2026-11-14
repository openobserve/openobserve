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
import OTabs from "./OTabs.vue";
import OTab from "./OTab.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";

function mountTabs() {
  return mount({
    components: { OTabs, OTab },
    template: `<OTabs model-value="a"><OTab name="a" label="Alpha" /><OTab name="b" label="Beta" /></OTabs>`,
  });
}

function mountToggle(type: "single" | "multiple") {
  return mount({
    components: { OToggleGroup, OToggleGroupItem },
    data: () => ({ type, value: type === "single" ? "a" : ["a"] }),
    template: `<OToggleGroup :type="type" v-model="value" size="sm">
      <OToggleGroupItem value="a" size="sm">Alpha</OToggleGroupItem>
      <OToggleGroupItem value="b" size="sm">Beta</OToggleGroupItem>
    </OToggleGroup>`,
  });
}

describe("active label tab weight (item 2)", () => {
  it("sets only the active label tab at the 550 weight", () => {
    const [active, inactive] = mountTabs().findAll('[role="tab"]');
    expect(active.classes()).toContain("font-semibold");
    expect(inactive.classes()).toContain("font-normal");
    expect(inactive.classes()).not.toContain("font-semibold");
  });

  it("reserves the bold label width on every tab so switching tabs shifts nothing", () => {
    const wrapper = mountTabs();
    for (const tab of wrapper.findAll('[role="tab"]')) {
      const reserve = tab.find("[data-otab-label]");
      expect(reserve.exists()).toBe(true);
      expect(reserve.attributes("data-otab-label")).toBe(tab.text());
      expect(reserve.classes()).toContain("after:font-semibold");
    }
  });
});

describe("segmented control (item 3)", () => {
  const EDGE = ["ring-1", "ring-inset", "ring-toggle-item-active-border"];
  const ON = "data-[state=on]:not-focus-visible:";
  // A border, padding, margin or size class would change the box the indicator is measured from.
  const BOX = /(^|:)(border|p[xyse]?|m[xyse]?|w|h|size)(-|$)/;
  const BOX_CLASSES = ["h-7", "px-2.5"];

  it("edges the sliding indicator with an inset brand ring and main's shadow", () => {
    const indicator = mountToggle("single").find('[aria-hidden="true"].absolute');
    expect(indicator.classes()).toEqual(
      expect.arrayContaining(["bg-toggle-item-active-bg", "shadow-xs", ...EDGE]),
    );
    expect(indicator.classes().filter((name) => BOX.test(name))).toEqual([]);
  });

  it("edges a per-item active segment the same way without touching its box", () => {
    const item = mountToggle("multiple").findAll("button")[0];
    expect(item.classes()).toContain("data-[state=on]:bg-toggle-item-active-bg");
    expect(item.classes()).toEqual(expect.arrayContaining(EDGE.map((name) => ON + name)));
    const stateClasses = item.classes().filter((name) => name.startsWith("data-[state=on]:"));
    expect(stateClasses.filter((name) => BOX.test(name.replace(ON, "")))).toEqual([]);
  });

  it("leaves the item's own box classes as they were", () => {
    for (const type of ["single", "multiple"] as const) {
      const boxes = mountToggle(type)
        .findAll("button")
        .map((item) => item.classes().filter((name) => !name.includes(":") && BOX.test(name)));
      expect(boxes).toEqual([BOX_CLASSES, BOX_CLASSES]);
    }
  });

  it("paints an unselected segment in the item text colour and lifts it to heading ink on hover", () => {
    for (const type of ["single", "multiple"] as const) {
      for (const item of mountToggle(type).findAll("button")) {
        expect(item.classes()).toContain("text-toggle-item-text");
        expect(item.classes().filter((name) => /(^|:)hover:text-/.test(name))).toEqual([
          "data-[state=off]:hover:text-text-heading",
        ]);
      }
    }
  });

  it("keeps the shared control timing on its colour changes", () => {
    const item = mountToggle("single").findAll("button")[1];
    expect(item.classes()).toEqual(
      expect.arrayContaining(["duration-(--duration-control)", "ease-(--ease-control)"]),
    );
  });
});

describe("tab label alignment", () => {
  it("starts every label at the tab's start edge, so the reserved bold width never centres it", () => {
    for (const tab of mountTabs().findAll('[role="tab"]')) {
      expect(tab.find("[data-otab-label]").classes()).toContain("text-start");
    }
  });
});
