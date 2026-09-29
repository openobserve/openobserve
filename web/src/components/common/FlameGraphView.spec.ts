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

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import FlameGraphView from "@/components/common/FlameGraphView.vue";
import i18n from "@/locales";

const ChartRendererStub = {
  name: "ChartRenderer",
  props: ["data"],
  emits: ["click"],
  template: '<div class="chart-renderer-stub"></div>',
};

describe("FlameGraphView frame menu", () => {
  it("positions the menu from the pointer relative to the root", async () => {
    const wrapper = mount(FlameGraphView, {
      props: {
        root: { name: "main", self: 1, total: 4, children: [] },
        unitLabel: "ns",
        summaryLabel: "total",
        summaryValue: "4",
      },
      global: {
        plugins: [i18n],
        stubs: {
          ChartRenderer: ChartRendererStub,
          OButton: { template: "<button><slot /></button>" },
          OSwitch: true,
        },
      },
    });
    await flushPromises();
    await nextTick();

    const root = wrapper.element as HTMLElement;
    viGetBoundingClientRect(root, { left: 40, top: 80 });

    wrapper.findComponent({ name: "ChartRenderer" }).vm.$emit("click", {
      data: { block: { id: "root", name: "main", value: 4, depth: 0, x: 0, width: 100 } },
      event: { offsetX: 1, offsetY: 1, event: { clientX: 140, clientY: 200 } },
    });
    await nextTick();

    const menu = wrapper.get('[data-test="flame-graph-frame-menu"]');
    expect(menu.attributes("style")).toContain("left: 100px");
    expect(menu.attributes("style")).toContain("top: 120px");
  });
});

function viGetBoundingClientRect(element: HTMLElement, box: { left: number; top: number }) {
  element.getBoundingClientRect = () =>
    ({
      left: box.left,
      top: box.top,
      right: box.left,
      bottom: box.top,
      width: 0,
      height: 0,
      x: box.left,
      y: box.top,
      toJSON: () => ({}),
    }) as DOMRect;
}
