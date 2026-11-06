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
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import FitItems from "./FitItems.vue";

const SIZE = 40;

function mountFit(items: string[]) {
  return mount(FitItems as any, {
    props: { items },
    slots: {
      default: `<template #default="{ item }"><span class="item">{{ item }}</span></template>`,
      more: `<template #more="{ count }"><span class="more">+{{ count }}</span></template>`,
    },
  });
}

async function settle() {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await nextTick();
  await nextTick();
  await nextTick();
}

function visibleItems(wrapper: ReturnType<typeof mountFit>) {
  return wrapper
    .findAll("[data-fit-item]")
    .filter((w) => !w.classes().includes("invisible"))
    .map((w) => w.text());
}

function mockCell(width: { current: number }) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width.current);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(SIZE);
}

describe("FitItems", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows everything with no +N when jsdom-style zero width has no layout", async () => {
    const wrapper = mountFit(["a", "b", "c"]);
    await settle();
    expect(visibleItems(wrapper)).toEqual(["a", "b", "c"]);
    expect(wrapper.find(".more").exists()).toBe(false);
  });

  it("gives its parent no intrinsic width to grow from", () => {
    expect(mountFit(["a"]).find('[data-test="fit-items"]').classes()).toContain(
      "[contain:inline-size]",
    );
  });

  it("collapses the rest into +N and keeps them mounted but hidden", async () => {
    mockCell({ current: 100 });
    const wrapper = mountFit(["a", "b", "c"]);
    await settle();
    expect(visibleItems(wrapper)).toEqual(["a"]);
    expect(wrapper.find(".more").text()).toBe("+2");
    expect(wrapper.findAll("[data-fit-item]")).toHaveLength(3);
  });

  it("follows the cell width as it grows and drops +N when everything fits", async () => {
    const width = { current: 100 };
    mockCell(width);
    let fire = () => {};
    const RealObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        fire = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    const wrapper = mountFit(["a", "b", "c"]);
    await settle();
    width.current = 500;
    fire();
    await settle();
    expect(visibleItems(wrapper)).toEqual(["a", "b", "c"]);
    expect(wrapper.find(".more").exists()).toBe(false);
    globalThis.ResizeObserver = RealObserver;
  });

  it("writes no styles when only the cell width changes", async () => {
    const width = { current: 100 };
    mockCell(width);
    let fire = () => {};
    const RealObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        fire = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    const wrapper = mountFit(["a", "b", "c"]);
    await settle();
    const first = wrapper.find("[data-fit-item]").element as HTMLElement;
    const writes = vi.fn();
    Object.defineProperty(first.style, "flexShrink", { set: writes, configurable: true });
    width.current = 105;
    fire();
    await settle();
    expect(wrapper.find(".more").text()).toBe("+2");
    expect(writes).not.toHaveBeenCalled();
    globalThis.ResizeObserver = RealObserver;
  });

  it("recounts when labels change while the item list stays the same", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return (this.textContent ?? "").length * 10;
    });
    const items = ["a", "b", "c"];
    const names = ref<Record<string, string>>({});
    const Parent = defineComponent({
      setup: () => () =>
        h(
          FitItems as any,
          { items },
          {
            default: ({ item }: { item: string }) => h("span", names.value[item] ?? item),
            more: ({ count }: { count: number }) => h("span", { class: "more" }, `+${count}`),
          },
        ),
    });
    const wrapper = mount(Parent);
    await settle();
    expect(wrapper.find(".more").exists()).toBe(false);

    names.value = { a: "Virginia", b: "Ireland", c: "Mumbai" };
    await settle();
    await settle();
    expect(wrapper.find(".more").text()).toBe("+2");
    const first = wrapper.findAll("[data-fit-item]")[0];
    expect(first.text()).toBe("Virginia");
    expect(first.classes()).not.toContain("invisible");
    expect(first.classes()).not.toContain("shrink-0");
  });

  it("recounts when a reused row receives different items", async () => {
    mockCell({ current: 100 });
    const wrapper = mountFit(["a", "b", "c"]);
    await settle();
    await wrapper.setProps({ items: ["x"] });
    await settle();
    expect(visibleItems(wrapper)).toEqual(["x"]);
    expect(wrapper.find(".more").exists()).toBe(false);
    await wrapper.setProps({ items: ["p", "q", "r", "s"] });
    await settle();
    expect(wrapper.find(".more").text()).toBe("+3");
  });
});
