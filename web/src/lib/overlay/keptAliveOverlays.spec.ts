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
import { defineComponent, h, KeepAlive, nextTick, ref, type Component } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ODialog from "./Dialog/ODialog.vue";
import ODrawer from "./Drawer/ODrawer.vue";
import { DialogRoot } from "reka-ui";

const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await nextTick();
    await flushPromises();
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe.each([
  ["ODialog", ODialog, "o-dialog-close-btn"],
  ["ODrawer", ODrawer, "o-drawer-close-btn"],
] as [string, Component, string][])("%s in a kept-alive view", (_name, Overlay, closeId) => {
  let wrapper: VueWrapper | null = null;
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("hides while its view is away and comes back open, without reporting a close", async () => {
    const shown = ref(true);
    const onOpen = vi.fn();
    const View = defineComponent({
      name: "KeptView",
      setup: () => () =>
        h(
          Overlay,
          { open: true, title: "Kept", "onUpdate:open": onOpen },
          { default: () => h("div", { "data-test": "kept-overlay-body" }, "Body") },
        ),
    });
    wrapper = mount(
      defineComponent({ setup: () => () => h(KeepAlive, null, shown.value ? [h(View)] : []) }),
      { attachTo: document.body },
    );
    await settle();
    const body = () => document.querySelector('[data-test="kept-overlay-body"]');
    expect(body()).not.toBeNull();
    shown.value = false;
    await settle();
    expect(body()).toBeNull();
    shown.value = true;
    await settle();
    expect(body()).not.toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("re-attaches its scroll shadow to the body that remounts on return (F3)", async () => {
    const shown = ref(true);
    const View = defineComponent({
      name: "KeptView",
      setup: () => () =>
        h(
          Overlay,
          { open: true, title: "Kept" },
          { default: () => h("div", { "data-test": "kept-overlay-body" }, "Body") },
        ),
    });
    wrapper = mount(
      defineComponent({ setup: () => () => h(KeepAlive, null, shown.value ? [h(View)] : []) }),
      { attachTo: document.body },
    );
    await settle();
    const add = vi.spyOn(HTMLElement.prototype, "addEventListener");
    const remove = vi.spyOn(HTMLElement.prototype, "removeEventListener");
    const scrollOn = (spy: typeof add, el: Element | null) =>
      spy.mock.calls.some(
        (c, i) => c[0] === "scroll" && !!el && (spy.mock.contexts[i] as Element).contains(el),
      );
    try {
      const before = document.querySelector('[data-test="kept-overlay-body"]');
      shown.value = false;
      await settle();
      expect(scrollOn(remove, before)).toBe(true);
      shown.value = true;
      await settle();
      const after = document.querySelector('[data-test="kept-overlay-body"]');
      expect(after).not.toBeNull();
      expect(scrollOn(add, after)).toBe(true);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });

  const body = () => document.querySelector('[data-test="kept-overlay-body"]');
  const overlay = (open: () => boolean, onOpen: (v: boolean) => void) =>
    defineComponent({
      name: "Host",
      setup: () => () =>
        h(
          Overlay,
          { open: open(), title: "Kept", "onUpdate:open": onOpen },
          { default: () => h("div", { "data-test": "kept-overlay-body" }, "Body") },
        ),
    });

  it("outside keep-alive opens, closes and reports a close exactly as before", async () => {
    const open = ref(true);
    const onOpen = vi.fn((v: boolean) => (open.value = v));
    wrapper = mount(
      overlay(() => open.value, onOpen),
      { attachTo: document.body },
    );
    await settle();
    expect(body()).not.toBeNull();
    document.querySelector<HTMLButtonElement>(`[data-test="${closeId}"]`)!.click();
    await settle();
    expect(onOpen).toHaveBeenCalledWith(false);
    expect(body()).toBeNull();
    open.value = true;
    await settle();
    expect(body()).not.toBeNull();
    // reka's root sees exactly the open state it saw before, so focus and dismissal are reka's as before.
    expect(wrapper.findComponent(DialogRoot).props("open")).toBe(true);
    open.value = false;
    await settle();
    expect(wrapper.findComponent(DialogRoot).props("open")).toBe(false);
  });

  it("in an active kept-alive view, the close button still closes and reports it", async () => {
    const open = ref(true);
    const onOpen = vi.fn((v: boolean) => (open.value = v));
    const Host = overlay(() => open.value, onOpen);
    wrapper = mount(defineComponent({ setup: () => () => h(KeepAlive, null, [h(Host)]) }), {
      attachTo: document.body,
    });
    await settle();
    expect(body()).not.toBeNull();
    document.querySelector<HTMLButtonElement>(`[data-test="${closeId}"]`)!.click();
    await settle();
    expect(onOpen).toHaveBeenCalledWith(false);
    expect(body()).toBeNull();
  });
});

describe.each([
  ["ODialog", ODialog, "o-dialog-close-btn"],
  ["ODrawer", ODrawer, "o-drawer-close-btn"],
] as [string, Component, string][])(
  "%s while its kept-alive view is away",
  (_name, Overlay, closeId) => {
    let wrapper: VueWrapper | null = null;
    afterEach(() => {
      wrapper?.unmount();
      wrapper = null;
      document.body.innerHTML = "";
    });

    const mountKept = (shown: { value: boolean }, open: { value: boolean }) => {
      const View = defineComponent({
        name: "KeptView",
        setup: () => () =>
          h("div", [
            h(
              "button",
              { "data-test": "kept-trigger", onClick: () => (open.value = true) },
              "Open",
            ),
            h(
              Overlay,
              {
                open: open.value,
                title: "Kept",
                "onUpdate:open": (v: boolean) => (open.value = v),
              },
              { default: () => h("div", { "data-test": "kept-overlay-body" }, "Body") },
            ),
          ]),
      });
      return mount(
        defineComponent({ setup: () => () => h(KeepAlive, null, shown.value ? [h(View)] : []) }),
        { attachTo: document.body },
      );
    };

    it("stops intercepting focus events on the page that replaced it", async () => {
      const shown = ref(true);
      const open = ref(true);
      wrapper = mountKept(shown, open);
      await settle();
      shown.value = false;
      await settle();
      const popper = document.createElement("div");
      popper.setAttribute("data-reka-popper-content-wrapper", "");
      const input = document.createElement("input");
      popper.appendChild(input);
      document.body.appendChild(popper);
      const seen = vi.fn();
      document.addEventListener("focusin", seen);
      try {
        input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        expect(seen).toHaveBeenCalled();
      } finally {
        document.removeEventListener("focusin", seen);
      }
    });

    it("returns focus to the original trigger when closed after a round trip", async () => {
      const shown = ref(true);
      const open = ref(false);
      wrapper = mountKept(shown, open);
      await settle();
      const trigger = document.querySelector<HTMLButtonElement>('[data-test="kept-trigger"]')!;
      trigger.focus();
      trigger.click();
      await settle();
      expect(document.querySelector('[data-test="kept-overlay-body"]')).not.toBeNull();
      shown.value = false;
      await settle();
      const elsewhere = document.createElement("input");
      document.body.appendChild(elsewhere);
      elsewhere.focus();
      shown.value = true;
      await settle();
      document.querySelector<HTMLButtonElement>(`[data-test="${closeId}"]`)!.click();
      await settle();
      expect(open.value).toBe(false);
      expect(document.activeElement).toBe(document.querySelector('[data-test="kept-trigger"]'));
    });
  },
);

describe("ODrawer anchored or inline in a kept-alive view", () => {
  let wrapper: VueWrapper | null = null;
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("re-measures its anchor on return instead of keeping a resize taken while away", async () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    let top = 120;
    anchor.getBoundingClientRect = () => ({ top, bottom: top + 10 }) as DOMRect;
    const shown = ref(true);
    const View = defineComponent({
      name: "KeptView",
      setup: () => () =>
        h(
          ODrawer,
          { open: true, title: "Kept", anchor },
          { default: () => h("div", { "data-test": "kept-overlay-body" }, "Body") },
        ),
    });
    wrapper = mount(
      defineComponent({ setup: () => () => h(KeepAlive, null, shown.value ? [h(View)] : []) }),
      { attachTo: document.body },
    );
    await settle();
    const panel = () => document.querySelector<HTMLElement>("[data-o2-drawer]");
    expect(panel()?.style.top).toBe("120px");
    shown.value = false;
    await settle();
    top = 0;
    window.dispatchEvent(new Event("resize"));
    top = 120;
    shown.value = true;
    await settle();
    expect(panel()?.style.top).toBe("120px");
  });

  it("keeps an inline drawer open while away, since it moves with its host", async () => {
    const shown = ref(true);
    const View = defineComponent({
      name: "KeptView",
      setup: () => () =>
        h(
          ODrawer,
          { open: true, title: "Kept", inline: true },
          { default: () => h("div", { "data-test": "kept-overlay-body" }, "Body") },
        ),
    });
    wrapper = mount(
      defineComponent({ setup: () => () => h(KeepAlive, null, shown.value ? [h(View)] : []) }),
      { attachTo: document.body },
    );
    await settle();
    const panel = document.querySelector<HTMLElement>("[data-o2-drawer]")!;
    expect(panel.getAttribute("data-state")).toBe("open");
    shown.value = false;
    await settle();
    expect(panel.getAttribute("data-state")).toBe("open");
  });
});
