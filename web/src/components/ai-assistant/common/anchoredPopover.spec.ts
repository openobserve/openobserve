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
import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";

import { DIALOG_DEPTH_KEY } from "@/lib/overlay/Dialog/dialogStacking";

import { useAnchorFocusReturn, usePopoverZIndex } from "./anchoredPopover";

function dom() {
  document.body.innerHTML = `
    <p id="anchor"><button id="one">One</button><button id="two">Two</button></p>
    <div data-o-popover-content><button id="inside">Inside</button></div>
    <button id="outside">Outside</button>`;
  const get = (id: string) => document.getElementById(id) as HTMLElement;
  return { get, focus: useAnchorFocusReturn(() => get("anchor")) };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useAnchorFocusReturn", () => {
  it("hands focus from inside the popover back to the anchor's first control", () => {
    const { get, focus } = dom();
    get("inside").focus();
    focus.onClose();
    expect(document.activeElement).toBe(get("one"));
  });

  it("focuses the anchor itself when it is the control", () => {
    document.body.innerHTML = `<button id="anchor">Open</button>`;
    const anchor = document.getElementById("anchor")!;
    useAnchorFocusReturn(() => anchor).onClose();
    expect(document.activeElement).toBe(anchor);
  });

  it("leaves focus where the caller already put it when the popover closes (V1)", () => {
    const { get, focus } = dom();
    get("outside").focus();
    focus.onClose();
    expect(document.activeElement).toBe(get("outside"));
  });

  it("returns nothing after a click outside, then returns again on the next close", () => {
    const { get, focus } = dom();
    get("inside").focus();
    focus.onPointerDownOutside(new Event("pointerdown"));
    focus.onClose();
    expect(document.activeElement).toBe(get("inside"));
    focus.onClose();
    expect(document.activeElement).toBe(get("one"));
  });

  it("ignores an outside press the popover kept open for a nested overlay", () => {
    const { get, focus } = dom();
    get("inside").focus();
    const press = new Event("pointerdown", { cancelable: true });
    press.preventDefault();
    focus.onPointerDownOutside(press);
    focus.onClose();
    expect(document.activeElement).toBe(get("one"));
  });
});

describe("usePopoverZIndex", () => {
  const read = (provide: Record<string, number>) => {
    let z = 0;
    mount(
      defineComponent({
        setup: () => () =>
          h(defineComponent({ setup: () => ((z = usePopoverZIndex()), () => null) })),
      }),
      { global: { provide } },
    );
    return z;
  };

  it("sits above the page's app header and drawer by default", () => {
    expect(read({})).toBe(6000);
  });

  it("takes the layer above the dialog, sheet or drawer it opens in", () => {
    expect(read({ [DIALOG_DEPTH_KEY]: 1 })).toBe(7000);
    expect(read({ o2DrawerDepth: 2, [DIALOG_DEPTH_KEY]: 1 })).toBe(8000);
  });
});
