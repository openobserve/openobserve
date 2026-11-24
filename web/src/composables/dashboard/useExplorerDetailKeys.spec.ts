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
import { mount, type VueWrapper } from "@vue/test-utils";
import { isTypingTarget, leaveFieldOnEscape, useExplorerDetailKeys } from "./useExplorerDetailKeys";

const html = (markup: string) => {
  const host = document.createElement("div");
  host.innerHTML = markup;
  document.body.appendChild(host);
  return host;
};

describe("isTypingTarget", () => {
  afterEach(() => (document.body.innerHTML = ""));

  it.each([
    ["an input", "<input id='t' />", true],
    ["a textarea", "<textarea id='t'></textarea>", true],
    ["a contenteditable child", "<div contenteditable='true'><span id='t'></span></div>", true],
    ["inside Monaco", "<div class='monaco-editor'><div id='t'></div></div>", true],
    ["a contenteditable=false node", "<div contenteditable='false' id='t'></div>", false],
    ["a plain button", "<button id='t'></button>", false],
  ])("%s: %s", (_name, markup, expected) => {
    html(markup);
    expect(isTypingTarget(document.getElementById("t"))).toBe(expected);
  });

  it("is false for no target", () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("useExplorerDetailKeys", () => {
  let wrapper: VueWrapper | null = null;
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  const setup = (open = true) => {
    const handlers = { isOpen: () => open, prev: vi.fn(), next: vi.fn(), back: vi.fn() };
    wrapper = mount(
      defineComponent({
        setup() {
          useExplorerDetailKeys(handlers);
          return () => h("div");
        },
      }),
      { attachTo: document.body },
    );
    return handlers;
  };
  const press = (key: string, target: EventTarget = document.body) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };

  it("arrows step the open detail and Escape returns to the list", () => {
    const handlers = setup();
    press("ArrowLeft");
    press("ArrowRight");
    const escape = press("Escape");
    expect(handlers.prev).toHaveBeenCalledTimes(1);
    expect(handlers.next).toHaveBeenCalledTimes(1);
    expect(handlers.back).toHaveBeenCalledTimes(1);
    expect(escape.defaultPrevented).toBe(true);
  });

  it("leaves keys typed into a field or editor alone", () => {
    const handlers = setup();
    const host = html(
      "<input id='search' /><div class='monaco-editor'><textarea id='m'></textarea></div>",
    );
    const escape = press("Escape", host.querySelector("#search")!);
    press("ArrowLeft", host.querySelector("#m")!);
    expect(handlers.back).not.toHaveBeenCalled();
    expect(handlers.prev).not.toHaveBeenCalled();
    expect(escape.defaultPrevented).toBe(false);
  });

  it("does nothing while no detail is open, so Escape still closes the drawer", () => {
    const handlers = setup(false);
    const escape = press("Escape");
    expect(handlers.back).not.toHaveBeenCalled();
    expect(escape.defaultPrevented).toBe(false);
  });

  it("stops listening once unmounted", () => {
    const handlers = setup();
    wrapper!.unmount();
    wrapper = null;
    press("ArrowRight");
    expect(handlers.next).not.toHaveBeenCalled();
  });
});

describe("leaveFieldOnEscape", () => {
  // The drawer's own Escape listener: reka-ui's onKeyStroke on window, bubble phase.
  const drawerEscape = vi.fn();
  let root: HTMLElement;
  const press = (target: EventTarget, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
      ...init,
    });
    target.dispatchEvent(e);
    return e;
  };

  beforeEach(() => {
    drawerEscape.mockClear();
    window.addEventListener("keydown", drawerEscape);
    root = html("<input id='f' /><button id='b'></button>");
    root.addEventListener("keydown", leaveFieldOnEscape);
  });
  afterEach(() => {
    window.removeEventListener("keydown", drawerEscape);
    document.body.innerHTML = "";
  });

  it("the first Escape in a field leaves the field and never reaches the drawer", () => {
    const input = document.getElementById("f") as HTMLInputElement;
    input.focus();
    press(input);
    expect(document.activeElement).not.toBe(input);
    expect(drawerEscape).not.toHaveBeenCalled();
    // The next Escape, from outside the field, reaches the drawer as before.
    press(document.body);
    expect(drawerEscape).toHaveBeenCalledTimes(1);
  });

  it("an Escape the field already used (an open suggest list) stays in the field", () => {
    const input = document.getElementById("f") as HTMLInputElement;
    input.focus();
    input.addEventListener("keydown", (e) => e.preventDefault(), { once: true });
    press(input);
    expect(document.activeElement).toBe(input);
    expect(drawerEscape).not.toHaveBeenCalled();
  });

  it("other keys, and Escape on a button, are left alone", () => {
    press(document.getElementById("f")!, { key: "a" });
    press(document.getElementById("b")!);
    expect(drawerEscape).toHaveBeenCalledTimes(2);
  });
});
