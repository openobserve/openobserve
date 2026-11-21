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

import AssistantResizeHandle, { clampRem, dragWidth } from "./AssistantResizeHandle.vue";

function setup(widthRem = 24, maxRem = 40) {
  const wrapper = mount(AssistantResizeHandle, {
    props: { widthRem, minRem: 20, maxRem },
    attachTo: document.body,
  });
  const handle = wrapper.get('[data-test="assistant-shell-resize-handle"]');
  return { wrapper, handle, el: handle.element as HTMLElement };
}

const key = (el: HTMLElement, name: string) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));

describe("AssistantResizeHandle", () => {
  it("is a named, focusable vertical separator reporting rem bounds and value", () => {
    const { handle, wrapper } = setup(24.04);
    expect(handle.attributes()).toMatchObject({
      role: "separator",
      "aria-orientation": "vertical",
      "aria-label": "Resize assistant",
      "aria-valuemin": "20",
      "aria-valuemax": "40",
      "aria-valuenow": "24",
      "aria-valuetext": "24 rem",
      tabindex: "0",
    });
    wrapper.unmount();
  });

  it("steps 1 rem with the arrows (the page-side arrow widens) and jumps with Home / End", () => {
    const { el, wrapper } = setup(24);
    key(el, "ArrowLeft");
    key(el, "ArrowRight");
    key(el, "Home");
    key(el, "End");
    expect(wrapper.emitted("commit")).toEqual([[25], [23], [20], [40]]);
    wrapper.unmount();
  });

  it("clamps key steps and ignores keys it does not own", () => {
    const { el, wrapper } = setup(40);
    key(el, "ArrowLeft");
    key(el, "a");
    expect(wrapper.emitted("commit")).toEqual([[40]]);
    wrapper.unmount();
  });

  it("follows the pointer live and stores once on release", () => {
    const { el, wrapper } = setup(24);
    el.setPointerCapture = () => undefined;
    el.releasePointerCapture = () => undefined;
    el.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 800, pointerId: 1 }));
    el.dispatchEvent(new PointerEvent("pointermove", { clientX: 640, pointerId: 1 }));
    el.dispatchEvent(new PointerEvent("pointermove", { clientX: 400, pointerId: 1 }));
    expect(wrapper.emitted("resize")).toEqual([[34], [40]]);
    expect(wrapper.emitted("commit")).toBeUndefined();
    el.dispatchEvent(new PointerEvent("pointerup", { clientX: 400, pointerId: 1 }));
    expect(wrapper.emitted("commit")).toEqual([[40]]);
    wrapper.unmount();
  });

  it("resets on double-click", () => {
    const { el, wrapper } = setup();
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(wrapper.emitted("reset")).toHaveLength(1);
    wrapper.unmount();
  });

  it("measures the drag from the panel's inner edge, mirrored in RTL", () => {
    const bounds = { minRem: 20, maxRem: 40 };
    expect(dragWidth({ clientX: 800, widthRem: 24 }, 784, false, bounds)).toBe(25);
    expect(dragWidth({ clientX: 800, widthRem: 24 }, 816, true, bounds)).toBe(25);
    expect(clampRem(10, bounds)).toBe(20);
    expect(clampRem(30, { minRem: 20, maxRem: 10 })).toBe(20);
  });
});
