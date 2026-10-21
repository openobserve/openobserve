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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeAssistant, fakeRouter } from "../__tests__/fakeAssistant";
import AssistantContainerMenu, {
  defaultWidthRem,
  placementMode,
  type AssistantContainerMenuProps,
} from "./AssistantContainerMenu.vue";

const { fake, track } = vi.hoisted(() => ({ fake: { current: null as any }, track: vi.fn() }));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
}));
vi.mock("@/services/assistantAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/assistantAnalytics")>()),
  trackAssistant: track,
}));

// The menu renders inline so items can be read without driving reka's pointer events.
const stubs = {
  ODropdown: { template: '<div><slot name="trigger" /><div role="menu"><slot /></div></div>' },
  ODropdownGroup: {
    props: ["label"],
    template: '<div v-bind="$attrs"><span>{{ label }}</span><slot /></div>',
  },
  ODropdownItem: {
    props: ["iconLeft"],
    emits: ["select"],
    template:
      '<div role="menuitem" v-bind="$attrs" @click="$emit(\'select\', $event)"><slot name="icon-left" /><slot /></div>',
  },
  ODropdownSeparator: { template: "<hr />" },
};

async function openMenu(props: AssistantContainerMenuProps, path = "/logs", viewportRem = 80) {
  fake.current = fakeAssistant("available", {}, {}, viewportRem);
  const router = fakeRouter();
  await router.push(path);
  const wrapper = mount(AssistantContainerMenu, {
    props,
    global: { plugins: [router], stubs },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrapper, router, store: fake.current.store };
}

const item = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);
const ids = () =>
  [...document.body.querySelectorAll<HTMLElement>('[role="menu"] [data-test]')].map(
    (el) => el.dataset.test,
  );

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = "";
  track.mockClear();
});

describe("AssistantContainerMenu", () => {
  it("offers full view and the width group in the pinned sidebar", async () => {
    await openMenu({ placement: "sidebar" });
    expect(ids()).toEqual([
      "assistant-shell-mode-menu",
      "assistant-shell-open-in-full-view-item",
      "assistant-shell-mode-pinned",
      "assistant-shell-mode-floating",
      "assistant-shell-width-narrow",
      "assistant-shell-width-default",
      "assistant-shell-width-wide",
    ]);
    expect(document.body.textContent).toContain("Layout");
  });

  it("offers only full view in the sheet, and only the sidebar in full and docked", async () => {
    await openMenu({ placement: "sidebar", sheet: true });
    expect(ids()).toEqual(["assistant-shell-mode-menu", "assistant-shell-open-in-full-view-item"]);
    document.body.innerHTML = "";
    await openMenu({ placement: "full" }, "/assistant");
    expect(ids()).toEqual(["assistant-shell-mode-menu", "assistant-shell-open-in-sidebar"]);
    document.body.innerHTML = "";
    await openMenu({ placement: "docked" });
    expect(ids()).toEqual(["assistant-shell-mode-menu", "assistant-shell-open-in-sidebar"]);
  });

  it("moves the session to the full view and pushes its route", async () => {
    const { router, store } = await openMenu({ placement: "sidebar" });
    const sid = store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    item("assistant-shell-open-in-full-view-item")!.click();
    await flushPromises();
    expect(store.state.shell.placement.kind).toBe("full");
    expect(store.state.shell.activeSid).toBe(sid);
    expect(router.currentRoute.value.name).toBe("assistant");
    expect(router.currentRoute.value.params.chatId).toBe(sid);
    expect(track).toHaveBeenCalledWith(
      "ai_container_moved",
      expect.objectContaining({ from: "pinned", to: "full" }),
    );
  });

  it("returns from the full view to the sidebar beside a page", async () => {
    const { router, store } = await openMenu({ placement: "full" }, "/assistant");
    store.createSession({
      origin: { entryKind: "home_launcher", objectKind: "none", container: "full_view" },
    });
    store.open({ kind: "full" }, { focus: "none" });
    item("assistant-shell-open-in-sidebar")!.click();
    await flushPromises();
    expect(store.state.shell.placement).toEqual({ kind: "sidebar", mode: "pinned" });
    expect(store.focusRequest.value?.target).toBe("composer");
    expect(router.currentRoute.value.name).not.toBe("assistant");
  });

  it("checks the width that matches the stored one and stores a pick", async () => {
    const { store } = await openMenu({ placement: "sidebar" });
    store.setSidebarWidth(defaultWidthRem(window.innerWidth / 16));
    await flushPromises();
    expect(item("assistant-shell-width-default")!.getAttribute("aria-checked")).toBe("true");
    expect(item("assistant-shell-width-wide")!.getAttribute("aria-checked")).toBe("false");
    for (const id of ["narrow", "default", "wide"])
      expect(item(`assistant-shell-width-${id}`)!.querySelector("span.size-4")).not.toBeNull();
    expect(item("assistant-shell-width-default")!.querySelector("svg")).not.toBeNull();
    expect(item("assistant-shell-width-wide")!.querySelector("svg")).toBeNull();
    item("assistant-shell-width-wide")!.click();
    await flushPromises();
    expect(store.state.shell.sidebarWidthRem).toBe(32);
  });

  it("offers Pinned and Floating with their hints and remembers a pick", async () => {
    const { store } = await openMenu({ placement: "sidebar" });
    store.open({ kind: "sidebar", mode: "pinned" }, { focus: "none" });
    await flushPromises();
    expect(item("assistant-shell-mode-pinned")!.getAttribute("aria-checked")).toBe("true");
    expect(item("assistant-shell-mode-pinned")!.getAttribute("description")).toBe(
      "Pushes the page aside",
    );
    expect(item("assistant-shell-mode-floating")!.getAttribute("description")).toBe(
      "Sits over the page",
    );
    item("assistant-shell-mode-floating")!.click();
    await flushPromises();
    expect(store.state.shell.sidebarMode).toBe("floating");
    expect(store.state.shell.placement).toEqual({ kind: "sidebar", mode: "floating" });
    expect(store.hasStoredSidebarMode()).toBe(true);
    expect(track).toHaveBeenCalledWith("ai_panel_mode_changed", {
      mode: "floating",
      forced: false,
    });
  });

  it("disables Pinned with the reason while the window cannot hold 20 rem beside 32 rem", async () => {
    await openMenu({ placement: "sidebar" }, "/logs", 56);
    fake.current.store.setSidebarWidth(24);
    await flushPromises();
    const pinned = item("assistant-shell-mode-pinned")!;
    expect(pinned.hasAttribute("disabled")).toBe(true);
    expect(pinned.getAttribute("description")).toBe("Floating because the window is narrow");
    pinned.click();
    await flushPromises();
    expect(fake.current.store.state.shell.sidebarMode).toBe("pinned");
    expect(fake.current.store.hasStoredSidebarMode()).toBe(false);
  });

  it("names placement modes for telemetry", () => {
    expect(placementMode("sidebar", true, "pinned")).toBe("sheet");
    expect(placementMode("sidebar", false, "floating")).toBe("floating");
    expect(placementMode("full", false, "pinned")).toBe("full");
    expect(defaultWidthRem(80)).toBe(24);
    expect(defaultWidthRem(64)).toBe(22);
    expect(defaultWidthRem(120)).toBe(32);
  });
});

describe("AssistantContainerMenu bare", () => {
  it("renders only its groups for a host menu that owns the trigger", async () => {
    await openMenu({ placement: "sidebar", bare: true });
    expect(item("assistant-shell-menu")).toBeNull();
    expect(item("assistant-shell-mode-menu")).not.toBeNull();
    expect(item("assistant-shell-mode-pinned")).not.toBeNull();
  });
});
