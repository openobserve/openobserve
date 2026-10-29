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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref, type Component } from "vue";
import OChipInput from "./OChipInput.vue";
import { raw } from "@/types/i18n";

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const suggestions = [
  { key: "a", label: raw("a") },
  { key: "b", label: raw("b") },
];

function mountInput(props: Record<string, unknown> = {}, slots: Record<string, unknown> = {}) {
  wrapper = mount(OChipInput, {
    attachTo: document.body,
    props: { modelValue: "", open: false, suggestions, dataTest: "ci", ...props },
    slots,
  });
  return wrapper;
}

const caret = () => document.querySelector<HTMLInputElement>('[data-test="ci-input"]')!;

async function key(name: string, init: KeyboardEventInit = {}) {
  caret().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, ...init }));
  await flushPromises();
}

describe("OChipInput", () => {
  it("lets the default slot place the caret among its chips", async () => {
    const before = ref(true);
    const Host = defineComponent({
      setup() {
        return () =>
          h(
            OChipInput,
            { modelValue: "", open: false, suggestions, inlineCaret: true, dataTest: "ci" },
            {
              default: ({ caret: Caret }: { caret: Component }) => [
                before.value ? h(Caret, { grow: false }) : null,
                h("span", { "data-test": "chip" }, "chip"),
                before.value ? null : h(Caret),
              ],
            },
          );
      },
    });
    wrapper = mount(Host, { attachTo: document.body });
    await flushPromises();
    const place = () => caret().closest("[data-o-chip-caret]")!;
    expect(place().nextElementSibling?.getAttribute("data-test")).toBe("chip");
    expect(caret().classList).toContain("field-sizing-content");
    const input = caret();
    input.focus();
    before.value = false;
    await flushPromises();
    // The same input moved after the chip and kept the focus.
    expect(caret()).toBe(input);
    expect(place().previousElementSibling?.getAttribute("data-test")).toBe("chip");
    expect(document.activeElement).toBe(input);
    expect(caret().classList).toContain("flex-1");
  });

  it("moves the caret with Left and Right only while nothing is typed", async () => {
    const input = mountInput();
    await key("ArrowLeft");
    await key("ArrowRight");
    expect(input.emitted("caret-move")).toEqual([[-1], [1]]);
    await input.setProps({ modelValue: "le" });
    await key("ArrowLeft");
    expect(input.emitted("caret-move")).toHaveLength(2);
  });

  it("emits delete-empty on Delete at an empty caret", async () => {
    const input = mountInput({ open: true });
    await key("Delete");
    expect(input.emitted("delete-empty")).toHaveLength(1);
  });

  it("applies with Ctrl or Cmd + Enter instead of picking the highlighted row", async () => {
    const input = mountInput({ open: true, multiple: true });
    await key("Enter", { ctrlKey: true });
    await key("Enter", { metaKey: true });
    expect(input.emitted("apply")).toHaveLength(2);
    expect(input.emitted("select")).toBeUndefined();
  });

  it("ticks the highlighted row with Space in a multi-select and keeps it highlighted", async () => {
    const input = mountInput({ open: true, multiple: true });
    await key("ArrowDown");
    await key(" ");
    await input.setProps({ autoHighlight: false });
    await key(" ");
    expect(input.emitted("select")).toEqual([["b"], ["b"]]);
  });

  it("keeps the typed character when typing opens the list", async () => {
    const input = mountInput();
    const select = vi.spyOn(HTMLInputElement.prototype, "select");
    caret().value = "l";
    caret().dispatchEvent(new Event("input"));
    await input.setProps({ open: true, modelValue: "l" });
    await flushPromises();
    expect(select).not.toHaveBeenCalled();
  });

  it("caps the field at maxRows lines of chips and scrolls inside it", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    // Four lines of 24px chips, one every 30px: tops at 0, 30, 60, 90.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const line = Number(this.dataset.line ?? -1);
      const top = line < 0 ? 0 : line * 30;
      return { top, bottom: top + 24, height: line < 0 ? 0 : 24, width: 10 } as DOMRect;
    });
    const chips = () => [0, 1, 2, 3].map((line) => h("span", { "data-line": line }, "x"));
    const input = mountInput({ maxRows: 3 }, { default: chips });
    window.dispatchEvent(new Event("resize"));
    await flushPromises();
    const lines = input.find("[data-o-chip-lines]");
    // jsdom loads no stylesheet, so with no row gap the cap ends where the fourth line starts.
    expect(lines.attributes("style")).toContain("max-height: 90px");
    expect(lines.classes()).toContain("overflow-y-auto");
    vi.unstubAllGlobals();
  });

  describe("sideways scrolling", () => {
    // The lines box shows x 100..400 of chips laid out 1000px wide.
    function layout(rects: Record<string, [number, number]>) {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
        this: HTMLElement,
      ) {
        const [left, right] = this.hasAttribute("data-o-chip-lines")
          ? [100, 400]
          : (rects[this.dataset.chip ?? ""] ?? [0, 0]);
        return { left, right, top: 0, bottom: 20, width: right - left, height: 20 } as DOMRect;
      });
    }
    const chipSlot = () =>
      ["near", "far", "behind", "wide"].map((name) => h("button", { "data-chip": name }, name));
    const chip = (name: string) => document.querySelector<HTMLElement>(`[data-chip="${name}"]`)!;
    function scroller(scrollLeft: number) {
      const lines = document.querySelector<HTMLElement>("[data-o-chip-lines]")!;
      Object.defineProperty(lines, "scrollWidth", { value: 1000, configurable: true });
      Object.defineProperty(lines, "clientWidth", { value: 300, configurable: true });
      lines.scrollLeft = scrollLeft;
      return lines;
    }

    it("lets the chips scroll sideways inside the field", () => {
      mountInput();
      expect(document.querySelector("[data-o-chip-lines]")!.classList).toContain("overflow-x-auto");
    });

    it("scrolls a chip that takes focus past either edge to the nearest edge", () => {
      layout({ near: [150, 200], far: [450, 520], behind: [40, 90] });
      mountInput({}, { default: chipSlot });
      const lines = scroller(200);
      chip("near").focus();
      expect(lines.scrollLeft).toBe(200);
      chip("far").focus();
      expect(lines.scrollLeft).toBe(320);
      chip("behind").focus();
      expect(lines.scrollLeft).toBe(260);
    });

    it("lines up a chip wider than the field with its start", () => {
      layout({ wide: [380, 900] });
      mountInput({}, { default: chipSlot });
      const lines = scroller(0);
      chip("wide").focus();
      expect(lines.scrollLeft).toBe(280);
    });

    it("leaves a field with nothing to scroll alone", () => {
      layout({ far: [450, 520] });
      mountInput({}, { default: chipSlot });
      const lines = scroller(0);
      Object.defineProperty(lines, "scrollWidth", { value: 300, configurable: true });
      chip("far").focus();
      expect(lines.scrollLeft).toBe(0);
    });

    it("brings the part the list anchors to into view", async () => {
      layout({ far: [450, 520] });
      const input = mountInput({}, { default: chipSlot });
      await flushPromises();
      const lines = scroller(0);
      await input.setProps({ anchor: chip("far"), open: true, searchInList: true });
      await flushPromises();
      expect(lines.scrollLeft).toBe(120);
    });
  });
});
