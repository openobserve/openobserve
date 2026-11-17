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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { useToolbarResponsive, type ToolbarResponsiveOptions } from "./useToolbarResponsive";

type Callback = (entries: { contentRect: { width: number } }[]) => void;
const observed = new Map<Element, Callback>();

class FakeResizeObserver {
  constructor(private cb: Callback) {}
  observe(el: Element) {
    observed.set(el, this.cb);
  }
  disconnect() {}
}

const resize = (el: Element, width: number) => observed.get(el)?.([{ contentRect: { width } }]);

const mountBar = (options?: ToolbarResponsiveOptions) => {
  let api!: ReturnType<typeof useToolbarResponsive>;
  const Bar = defineComponent({
    setup() {
      api = useToolbarResponsive(options);
      return () =>
        h("div", { class: "bar" }, [
          h("div", { ref: api.toolbarLeftRef }),
          h("div", { ref: api.toolbarRightRef }),
        ]);
    },
  });
  const wrapper = mount(Bar, { attachTo: document.body });
  return { wrapper, api };
};

describe("useToolbarResponsive", () => {
  beforeEach(() => {
    observed.clear();
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("follows the bar's width minus the right section and padding", () => {
    const { wrapper, api } = mountBar();
    const bar = wrapper.element as HTMLElement;
    resize(bar, 1214);
    resize(bar.lastElementChild!, 200);
    expect(api.availableLeftWidth.value).toBe(1000);
    wrapper.unmount();
  });

  it("by default takes the 0 a detached bar reports", () => {
    const { wrapper, api } = mountBar();
    const bar = wrapper.element as HTMLElement;
    resize(bar, 1214);
    bar.remove();
    resize(bar, 0);
    expect(api.availableLeftWidth.value).toBe(0);
    wrapper.unmount();
  });

  it("keeps the last real width while the bar is detached when asked, so a return draws no stage change", () => {
    const { wrapper, api } = mountBar({ keepWidthWhenDetached: true });
    const bar = wrapper.element as HTMLElement;
    resize(bar, 1214);
    resize(bar.lastElementChild!, 200);
    bar.remove();
    resize(bar, 0);
    resize(bar.lastElementChild!, 0);
    expect(api.availableLeftWidth.value).toBe(1000);
    document.body.appendChild(bar);
    resize(bar, 0);
    expect(api.availableLeftWidth.value).toBe(0);
    wrapper.unmount();
  });
});
