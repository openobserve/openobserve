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
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { h } from "vue";
import { DialogContent } from "reka-ui";

import ODrawer from "./ODrawer.vue";
import { DRAWER_INSET_ATTR, setDrawerInsetEnd } from "./drawerInset";

vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  const { defineComponent } = await import("vue");
  return {
    ...actual,
    DialogPortal: defineComponent(
      (_, { slots }) =>
        () =>
          slots.default?.(),
    ),
  };
});

enableAutoUnmount(afterEach);

let page: HTMLElement;
let column: HTMLElement;

beforeEach(() => {
  page = document.createElement("main");
  page.innerHTML = '<button data-test="page-btn">Page</button>';
  column = document.createElement("aside");
  column.setAttribute(DRAWER_INSET_ATTR, "");
  column.innerHTML = '<textarea data-test="panel-field"></textarea>';
  document.body.append(page, column);
  setDrawerInsetEnd(400, column);
});

afterEach(() => {
  setDrawerInsetEnd(0);
  document.body.innerHTML = "";
});

const tick = () => new Promise((resolve) => setTimeout(resolve));

function mountDrawer(insetBeside: boolean) {
  return mount(ODrawer, {
    attachTo: document.body,
    props: { open: true, title: "Record", insetBeside },
    slots: {
      default: () => [
        h("button", { "data-test": "first" }, "First"),
        h("button", { "data-test": "last" }, "Last"),
      ],
    },
  });
}

function panelOf(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAllComponents(DialogContent)
    .find((c) => c.attributes("data-o2-drawer") !== undefined)!;
}

describe("ODrawer beside a pinned column (F8)", () => {
  it("stays modal and covers the column when it does not opt in", async () => {
    const wrapper = mountDrawer(false);
    await tick();
    expect(document.body.style.pointerEvents).toBe("none");
    expect(panelOf(wrapper).attributes("style") ?? "").not.toContain("right: 400px");
    expect(
      document.querySelector('[data-test="o-drawer-overlay"]')?.getAttribute("style") ?? "",
    ).not.toContain("right: 400px");
  });

  it("stops at the column with its own scrim and hides only the page from assistive tech", async () => {
    const wrapper = mountDrawer(true);
    await tick();
    await flushPromises();
    expect(document.body.style.pointerEvents).not.toBe("none");
    expect(panelOf(wrapper).attributes("style")).toContain("right: 400px");
    const scrim = document.querySelector<HTMLElement>('[data-test="o-drawer-overlay"]');
    expect(scrim?.style.right).toBe("400px");
    expect(page.getAttribute("aria-hidden")).toBe("true");
    expect(page.hasAttribute("inert")).toBe(true);
    expect(column.getAttribute("aria-hidden")).toBeNull();
    expect(column.hasAttribute("inert")).toBe(false);
    wrapper.unmount();
    expect(page.getAttribute("aria-hidden")).toBeNull();
    expect(page.hasAttribute("inert")).toBe(false);
  });

  it("keeps its Escape, but Escape inside the column never closes it", async () => {
    const wrapper = mountDrawer(true);
    await tick();
    const field = column.querySelector("textarea")!;
    const fromColumn = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    Object.defineProperty(fromColumn, "target", { value: field });
    await panelOf(wrapper).vm.$emit("escapeKeyDown", fromColumn);
    expect(fromColumn.defaultPrevented).toBe(true);
    expect(wrapper.emitted("update:open")).toBeFalsy();
    const inside = document.querySelector('[data-test="first"]')!;
    const fromDrawer = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    Object.defineProperty(fromDrawer, "target", { value: inside });
    await panelOf(wrapper).vm.$emit("escapeKeyDown", fromDrawer);
    expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
  });

  it("does not close on a pointer-down inside the column", async () => {
    const wrapper = mountDrawer(true);
    await tick();
    column.querySelector("textarea")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await tick();
    expect(wrapper.emitted("update:open")).toBeFalsy();
  });

  it("wraps Tab inside the drawer", async () => {
    const wrapper = mountDrawer(true);
    await tick();
    const panel = panelOf(wrapper).element as HTMLElement;
    const buttons = Array.from(panel.querySelectorAll<HTMLElement>("button"));
    for (const el of buttons) el.getClientRects = () => [{}] as unknown as DOMRectList;
    const last = panel.querySelector<HTMLElement>('[data-test="last"]')!;
    last.focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", cancelable: true, bubbles: true });
    last.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("keeps its body mounted when the panel pins or unpins while it is open (F10)", async () => {
    setDrawerInsetEnd(0, null);
    const wrapper = mountDrawer(true);
    await tick();
    await flushPromises();
    const body = document.querySelector('[data-test="first"]');
    expect(page.hasAttribute("inert")).toBe(true);
    setDrawerInsetEnd(400, column);
    await flushPromises();
    expect(document.querySelector('[data-test="first"]')).toBe(body);
    expect(panelOf(wrapper).attributes("style")).toContain("right: 400px");
    expect(column.hasAttribute("inert")).toBe(false);
    setDrawerInsetEnd(0, null);
    await flushPromises();
    expect(document.querySelector('[data-test="first"]')).toBe(body);
    expect(wrapper.emitted("after-close")).toBeFalsy();
  });

  it("stays open and takes focus back when focus lands on the hidden page", async () => {
    const wrapper = mountDrawer(true);
    await tick();
    await flushPromises();
    const pageButton = page.querySelector<HTMLElement>('[data-test="page-btn"]')!;
    const outside = new FocusEvent("focusin");
    Object.defineProperty(outside, "target", { value: pageButton });
    const event = new CustomEvent("interactOutside", {
      cancelable: true,
      detail: { originalEvent: outside },
    });
    await panelOf(wrapper).vm.$emit("interactOutside", event);
    expect(event.defaultPrevented).toBe(true);
    expect(wrapper.emitted("update:open")).toBeFalsy();
    expect(panelOf(wrapper).element.contains(document.activeElement)).toBe(true);
  });

  it("takes focus back when the panel beside it closes", async () => {
    const wrapper = mountDrawer(true);
    await tick();
    await flushPromises();
    column.querySelector("textarea")!.focus();
    setDrawerInsetEnd(0, null);
    await flushPromises();
    expect(panelOf(wrapper).element.contains(document.activeElement)).toBe(true);
    expect(wrapper.emitted("after-close")).toBeFalsy();
  });
});
