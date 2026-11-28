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
import { defineComponent, h, provide, ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { DialogContent } from "reka-ui";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import {
  EXPLORER_BACK_KEY,
  createExplorerBack,
  isTypingTarget,
  leaveFieldOnEscape,
  useExplorerDetailKeys,
} from "./useExplorerDetailKeys";

// The drawer renders in place, so the host test can reach its × and panel.
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return { ...actual, DialogPortal: actual.DialogContent };
});

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

  it("arrows inside a tab list, menu, listbox, radio group or slider stay with that widget", () => {
    const handlers = setup();
    const host = html(
      "<div role='tablist'><button role='tab' id='tab'></button></div>" +
        "<div role='menu'><div role='menuitem' id='item' tabindex='0'></div></div>" +
        "<div role='listbox'><div role='option' id='opt'></div></div>" +
        "<div role='radiogroup'><div role='radio' id='radio'></div></div>" +
        "<div role='slider' id='slider' tabindex='0'></div>",
    );
    for (const id of ["tab", "item", "opt", "radio", "slider"]) {
      press("ArrowRight", host.querySelector(`#${id}`)!);
      press("ArrowLeft", host.querySelector(`#${id}`)!);
    }
    expect(handlers.next).not.toHaveBeenCalled();
    expect(handlers.prev).not.toHaveBeenCalled();
  });

  it("an arrow a widget already handled does not step the item too", () => {
    const handlers = setup();
    const host = html("<div id='w' tabindex='0'></div>");
    const widget = host.querySelector("#w")!;
    widget.addEventListener("keydown", (e) => e.preventDefault());
    press("ArrowRight", widget);
    expect(handlers.next).not.toHaveBeenCalled();
  });

  it("Escape in an open menu only closes it; the next Escape goes back to the list", () => {
    const handlers = setup();
    const host = html(
      "<button id='trigger' aria-haspopup='menu' aria-expanded='true'></button>" +
        "<div role='menu'><div role='menuitem' id='item' tabindex='0'></div></div>",
    );
    press("Escape", host.querySelector("#item")!);
    press("Escape", host.querySelector("#trigger")!);
    expect(handlers.back).not.toHaveBeenCalled();
    host.remove();
    press("Escape");
    expect(handlers.back).toHaveBeenCalledTimes(1);
  });

  it("an Escape a widget already used does not go back too", () => {
    const handlers = setup();
    const host = html("<div id='w' tabindex='0'></div>");
    const widget = host.querySelector("#w")!;
    widget.addEventListener("keydown", (e) => e.preventDefault());
    press("Escape", widget);
    expect(handlers.back).not.toHaveBeenCalled();
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

  it("an Escape a field stops itself (an open suggest list) never reaches the drawer", () => {
    const input = document.getElementById("f") as HTMLInputElement;
    input.focus();
    input.addEventListener(
      "keydown",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
      },
      { once: true },
    );
    press(input);
    expect(document.activeElement).toBe(input);
    expect(drawerEscape).not.toHaveBeenCalled();
  });

  it("an Escape a field only marked (a chip bar with its list closed) still leaves the field", () => {
    const input = document.getElementById("f") as HTMLInputElement;
    input.focus();
    input.addEventListener("keydown", (e) => e.preventDefault(), { once: true });
    press(input);
    expect(document.activeElement).not.toBe(input);
    expect(drawerEscape).not.toHaveBeenCalled();
    press(document.body);
    expect(drawerEscape).toHaveBeenCalledTimes(1);
  });

  it("other keys, and Escape on a button, are left alone", () => {
    press(document.getElementById("f")!, { key: "a" });
    press(document.getElementById("b")!);
    expect(drawerEscape).toHaveBeenCalledTimes(2);
  });
});

describe("the drawer steps back from an open item before it closes", () => {
  let wrapper: VueWrapper<any> | null = null;
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  // A drawer host as PanelSchemaRenderer builds it: the real ODrawer, its closeGuard asking the
  // explorer inside, which registers its open item through useExplorerDetailKeys.
  const mountHost = () => {
    const itemOpen = ref(true);
    const drawerOpen = ref(true);
    const back = vi.fn(() => (itemOpen.value = false));
    const Explorer = defineComponent({
      setup() {
        const onKeydown = useExplorerDetailKeys({
          isOpen: () => itemOpen.value,
          prev: () => {},
          next: () => {},
          back,
        });
        return () =>
          h("div", { onKeydown, "data-test": "explorer" }, [
            h("input", { "data-test": "detail-field" }),
            h("button", { "data-test": "detail-tab" }),
          ]);
      },
    });
    const Host = defineComponent({
      setup() {
        const explorerBack = createExplorerBack();
        provide(EXPLORER_BACK_KEY, explorerBack);
        return () =>
          h(
            ODrawer,
            {
              open: drawerOpen.value,
              title: "Explorer",
              closeGuard: () => !explorerBack.back(),
              "onUpdate:open": (v: boolean) => (drawerOpen.value = v),
            },
            { default: () => h(Explorer) },
          );
      },
    });
    wrapper = mount(Host, { attachTo: document.body });
    return { itemOpen, drawerOpen, back };
  };
  const closeBtn = () => wrapper!.find("[data-test='o-drawer-close-btn']");
  const panel = () =>
    wrapper!
      .findAllComponents(DialogContent)
      .find((c) => c.attributes("data-o2-drawer") !== undefined)!;
  const drawerEscape = async () => {
    const e = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    await panel().vm.$emit("escapeKeyDown", e);
    return e;
  };

  it("× with an item open goes back to the list; a second × closes the drawer", async () => {
    const { itemOpen, drawerOpen, back } = mountHost();
    await closeBtn().trigger("click");
    await flushPromises();
    expect(back).toHaveBeenCalledTimes(1);
    expect(itemOpen.value).toBe(false);
    expect(drawerOpen.value).toBe(true);
    await closeBtn().trigger("click");
    await flushPromises();
    expect(back).toHaveBeenCalledTimes(1);
    expect(drawerOpen.value).toBe(false);
  });

  it("an Escape that reaches the drawer with an item open goes back, and is cancelled", async () => {
    const { itemOpen, drawerOpen } = mountHost();
    const first = await drawerEscape();
    expect(first.defaultPrevented).toBe(true);
    expect(itemOpen.value).toBe(false);
    expect(drawerOpen.value).toBe(true);
    await drawerEscape();
    expect(drawerOpen.value).toBe(false);
  });

  it("an outside click with an item open goes back too", async () => {
    const { itemOpen, drawerOpen } = mountHost();
    // reka's DialogRoot reports an outside dismissal as update:open(false).
    const root = wrapper!.findComponent({ name: "DialogRoot" });
    await root.vm.$emit("update:open", false);
    expect(itemOpen.value).toBe(false);
    expect(drawerOpen.value).toBe(true);
  });

  it("Escape in a field inside the open item goes back in one press, never closing the drawer", async () => {
    const { itemOpen, drawerOpen, back } = mountHost();
    const field = wrapper!.find("[data-test='detail-field']").element as HTMLInputElement;
    field.focus();
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    field.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
    expect(itemOpen.value).toBe(false);
    expect(drawerOpen.value).toBe(true);
    expect(document.activeElement).not.toBe(field);
  });

  it("Escape in a field whose popup is open (aria-expanded) only closes the popup", () => {
    const { back, itemOpen } = mountHost();
    const field = wrapper!.find("[data-test='detail-field']").element as HTMLInputElement;
    field.setAttribute("aria-haspopup", "listbox");
    field.setAttribute("aria-expanded", "true");
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(back).not.toHaveBeenCalled();
    expect(itemOpen.value).toBe(true);
  });

  it("an Escape an open suggest list stops in the field stays there", () => {
    const { back } = mountHost();
    const field = wrapper!.find("[data-test='detail-field']").element as HTMLInputElement;
    field.addEventListener("keydown", (e) => e.stopPropagation(), { once: true });
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(back).not.toHaveBeenCalled();
  });

  it("Escape on a detail tab (not a field) goes back", () => {
    const { back, drawerOpen } = mountHost();
    const tab = wrapper!.find("[data-test='detail-tab']").element as HTMLButtonElement;
    tab.focus();
    tab.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(drawerOpen.value).toBe(true);
  });

  it("with no item open, Escape in a field only leaves the field", () => {
    const { itemOpen, back, drawerOpen } = mountHost();
    itemOpen.value = false;
    const field = wrapper!.find("[data-test='detail-field']").element as HTMLInputElement;
    field.focus();
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(back).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(field);
    expect(drawerOpen.value).toBe(true);
  });

  it("an explorer that unmounts stops answering the drawer", () => {
    const explorerBack = createExplorerBack();
    const back = vi.fn();
    const unregister = explorerBack.register({ isOpen: () => true, back });
    expect(explorerBack.back()).toBe(true);
    unregister();
    expect(explorerBack.back()).toBe(false);
    expect(back).toHaveBeenCalledTimes(1);
  });
});
