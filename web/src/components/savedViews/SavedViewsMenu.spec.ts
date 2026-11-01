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
import { h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import SavedViewsMenu from "./SavedViewsMenu.vue";
import SavedViewsSubmenu from "./SavedViewsSubmenu.vue";

const views = [
  { view_id: "a", view_name: "Alpha" },
  { view_id: "b", view_name: "Beta" },
  { view_id: "c", view_name: "Gamma" },
];

let wrapper: ReturnType<typeof mount> | undefined;
afterEach(() => {
  document.documentElement.dir = "ltr";
  wrapper?.unmount();
  wrapper = undefined;
});

const el = (id: string) => document.querySelector<HTMLElement>(`[data-test="${id}"]`);

const mountMenu = async (
  props: Record<string, unknown> = {},
  listeners: Record<string, unknown> = {},
) => {
  wrapper = mount(ODropdown, {
    attachTo: document.body,
    props: { open: true },
    global: { plugins: [i18n] },
    slots: {
      trigger: () => h("button", "Menu"),
      default: () =>
        h(SavedViewsMenu, {
          views,
          favoriteIds: ["b"],
          dataTestPrefix: "sv",
          ...props,
          ...listeners,
        }),
    },
  });
  await flushPromises();
};

describe("SavedViewsMenu", () => {
  it("groups favorites first and the rest under All Saved Views", async () => {
    await mountMenu();
    expect(el("sv-favorites-group")?.textContent).toContain("Favorites (1)");
    expect(el("sv-favorites-group")?.querySelector('[data-test="sv-apply-b"]')).not.toBeNull();
    expect(el("sv-all-group")?.textContent).toContain("All Saved Views");
    expect(el("sv-all-group")?.textContent).not.toContain("(2)");
    expect(el("sv-all-group")?.querySelector('[data-test="sv-apply-a"]')).not.toBeNull();
    expect(el("sv-all-group")?.querySelector('[data-test="sv-apply-b"]')).toBeNull();
    expect(el("sv-search")).not.toBeNull();
  });

  it("hides the favorites group when there are none", async () => {
    await mountMenu({ favoriteIds: [] });
    expect(el("sv-favorites-group")).toBeNull();
    expect(el("sv-all-group")).not.toBeNull();
  });

  it("filters by name and shows the no-match state", async () => {
    await mountMenu();
    const input = el("sv-search")!.querySelector("input")!;
    input.value = "gam";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    expect(el("sv-apply-c")).not.toBeNull();
    expect(el("sv-apply-a")).toBeNull();
    input.value = "zzz";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    expect(el("sv-empty")?.textContent).toContain(i18n.global.t("search.savedViewsNoMatch"));
  });

  it("shows the empty state when there are no views and the loading state while loading", async () => {
    await mountMenu({ views: [] });
    expect(el("sv-empty")?.textContent).toContain(i18n.global.t("search.savedViewsEmpty"));
    wrapper!.unmount();
    await mountMenu({ loading: true });
    expect(el("sv-loading")).not.toBeNull();
  });

  it("uses a generic search placeholder while loading and a counted one after", async () => {
    await mountMenu({ views: [], loading: true });
    expect(el("sv-search")?.querySelector("input")?.getAttribute("placeholder")).toBe(
      "Search saved views",
    );
    wrapper!.unmount();
    await mountMenu();
    expect(el("sv-search")?.querySelector("input")?.getAttribute("placeholder")).toBe(
      "Search 3 saved views",
    );
  });

  it("renders no button inside another button", async () => {
    await mountMenu();
    expect(document.querySelectorAll("button button")).toHaveLength(0);
  });

  it("marks the applied view and keeps the star label constant with aria-pressed", async () => {
    await mountMenu({ appliedViewId: "a" });
    expect(el("sv-applied-a")?.getAttribute("aria-label")).toBe(
      i18n.global.t("search.savedViewApplied"),
    );
    expect(el("sv-applied-b")).toBeNull();
    expect(el("sv-favorite-b")?.getAttribute("aria-pressed")).toBe("true");
    expect(el("sv-favorite-b")?.getAttribute("aria-label")).toBe("Favorite Beta");
    expect(el("sv-favorite-a")?.getAttribute("aria-label")).toBe("Favorite Alpha");
    expect(el("sv-favorite-a")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("emits apply, favorite, update, delete and create", async () => {
    const onApply = vi.fn();
    const onFav = vi.fn();
    const onUpdate = vi.fn();
    const onCreate = vi.fn();
    const onDelete = vi.fn();
    await mountMenu(
      {},
      {
        onApply,
        onToggleFavorite: onFav,
        onUpdate,
        onCreate,
        onDelete,
      },
    );
    el("sv-favorite-a")!.click();
    expect(onFav).toHaveBeenCalledWith(views[0], false);
    el("sv-favorite-b")!.click();
    expect(onFav).toHaveBeenCalledWith(views[1], true);
    expect(el("sv-update-c")?.getAttribute("aria-label")).toBe(
      "Overwrite Gamma with current query",
    );
    el("sv-update-c")!.click();
    expect(onUpdate).toHaveBeenCalledWith(views[2]);
    el("sv-delete-c")!.click();
    expect(onDelete).toHaveBeenCalledWith(views[2]);
    expect(el("sv-delete-c")?.getAttribute("aria-label")).toBe("Delete Gamma");
    expect(onApply).not.toHaveBeenCalled();
    el("sv-apply-a")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushPromises();
    expect(onApply).toHaveBeenCalledWith(views[0]);
  });

  it("applies the first match on Enter in the search box", async () => {
    const onApply = vi.fn();
    await mountMenu({}, { onApply });
    const input = el("sv-search")!.querySelector("input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushPromises();
    expect(onApply).toHaveBeenCalledWith(views[1]);
    expect(wrapper!.emitted("update:open")?.at(-1)).toEqual([false]);
  });

  it("keeps focus on the same star after a favorite toggle moves the row", async () => {
    const favoriteIds = ref<string[]>(["b"]);
    wrapper = mount(ODropdown, {
      attachTo: document.body,
      props: { open: true },
      global: { plugins: [i18n] },
      slots: {
        trigger: () => h("button", "Menu"),
        default: () =>
          h(SavedViewsMenu, {
            views,
            favoriteIds: favoriteIds.value,
            dataTestPrefix: "sv",
            onToggleFavorite: (view: { view_id: string }) => {
              favoriteIds.value = [...favoriteIds.value, view.view_id];
            },
          }),
      },
    });
    await flushPromises();
    el("sv-favorite-a")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    await flushPromises();
    expect(el("sv-favorites-group")?.querySelector('[data-test="sv-apply-a"]')).not.toBeNull();
    expect(document.activeElement).toBe(el("sv-favorite-a"));
  });

  it("highlights the applied row with the selected background", async () => {
    await mountMenu({ appliedViewId: "a" });
    expect(el("sv-apply-a")?.className).toContain("bg-select-item-selected-bg");
    expect(el("sv-apply-c")?.className).not.toContain("bg-select-item-selected-bg");
  });

  it("disables create and edit with the reason when saving is blocked", async () => {
    await mountMenu({ saveReason: raw("Run the query first") });
    expect(el("sv-create")?.getAttribute("aria-disabled")).toBe("true");
    expect(el("sv-update-a")?.getAttribute("aria-disabled")).toBe("true");
    expect(el("sv-create")?.textContent).toContain("Run the query first");
  });

  it("uses the supplied create test id", async () => {
    await mountMenu({ createTestId: "my-create" });
    expect(el("my-create")).not.toBeNull();
    expect(el("sv-manage")).toBeNull();
  });
});

describe("SavedViewsSubmenu", () => {
  it("summarises views and favorites on the trigger", async () => {
    wrapper = mount(ODropdown, {
      attachTo: document.body,
      props: { open: true },
      global: { plugins: [i18n] },
      slots: {
        trigger: () => h("button", "Menu"),
        default: () =>
          h(SavedViewsSubmenu, {
            views,
            favoriteIds: ["a", "b"],
            dataTestPrefix: "sv",
            triggerTestId: "sv-trigger",
          }),
      },
    });
    await flushPromises();
    const text = el("sv-trigger")?.textContent ?? "";
    expect(text).toContain("Saved Views");
    expect(text).toContain("3 views, 2 favorites");
  });

  it("omits the favorites part when there are none and handles no views", async () => {
    wrapper = mount(ODropdown, {
      attachTo: document.body,
      props: { open: true },
      global: { plugins: [i18n] },
      slots: {
        trigger: () => h("button", "Menu"),
        default: () => [
          h(SavedViewsSubmenu, {
            views: [views[0]],
            favoriteIds: [],
            dataTestPrefix: "one",
            triggerTestId: "one-trigger",
          }),
          h(SavedViewsSubmenu, {
            views: [],
            favoriteIds: [],
            dataTestPrefix: "none",
            triggerTestId: "none-trigger",
          }),
        ],
      },
    });
    await flushPromises();
    expect(el("one-trigger")?.textContent).toContain("1 view");
    expect(el("one-trigger")?.textContent).not.toContain("favorite");
    expect(el("none-trigger")?.textContent).toContain("No saved views yet");
  });

  it("shows no empty text on the trigger while loading", async () => {
    wrapper = mount(ODropdown, {
      attachTo: document.body,
      props: { open: true },
      global: { plugins: [i18n] },
      slots: {
        trigger: () => h("button", "Menu"),
        default: () =>
          h(SavedViewsSubmenu, {
            views: [],
            favoriteIds: [],
            loading: true,
            dataTestPrefix: "ld",
            triggerTestId: "ld-trigger",
          }),
      },
    });
    await flushPromises();
    expect(el("ld-trigger")?.textContent).not.toContain("No saved views yet");
  });

  const mountSubmenu = async (
    props: Record<string, unknown> = {},
    slots: Record<string, () => unknown> = {},
  ) => {
    wrapper = mount(ODropdown, {
      attachTo: document.body,
      props: { open: true },
      global: { plugins: [i18n] },
      slots: {
        trigger: () => h("button", "Menu"),
        default: () =>
          h(
            SavedViewsSubmenu,
            {
              views,
              favoriteIds: ["b"],
              dataTestPrefix: "sv",
              triggerTestId: "sv-trigger",
              ...props,
            },
            slots,
          ),
      },
    });
    await flushPromises();
  };

  it("opens the submenu and passes attrs through to the menu", async () => {
    const onApply = vi.fn();
    const onUpdate = vi.fn();
    const onDelete = vi.fn();
    const onFav = vi.fn();
    await mountSubmenu({
      appliedViewId: "a",
      createTestId: "sv-create-custom",
      onApply,
      onUpdate,
      onDelete,
      onToggleFavorite: onFav,
    });
    expect(el("sv-content")).toBeNull();
    el("sv-trigger")!.click();
    await flushPromises();
    expect(el("sv-content")).not.toBeNull();
    expect(el("sv-create-custom")).not.toBeNull();
    expect(el("sv-applied-a")).not.toBeNull();
    expect(el("sv-applied-b")).toBeNull();
    el("sv-update-c")!.click();
    expect(onUpdate).toHaveBeenCalledWith(views[2]);
    el("sv-delete-c")!.click();
    expect(onDelete).toHaveBeenCalledWith(views[2]);
    el("sv-favorite-a")!.click();
    expect(onFav).toHaveBeenCalledWith(views[0], false);
    el("sv-apply-a")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushPromises();
    expect(onApply).toHaveBeenCalledWith(views[0]);
  });

  it("emits open when the submenu opens", async () => {
    const onOpen = vi.fn();
    await mountSubmenu({ onOpen });
    expect(onOpen).not.toHaveBeenCalled();
    el("sv-trigger")!.click();
    await flushPromises();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("keeps the actions slot outside the trigger button", async () => {
    await mountSubmenu({}, { actions: () => h("button", { "data-test": "sv-pin" }, "pin") });
    el("sv-trigger")!.click();
    await flushPromises();
    expect(el("sv-pin")).not.toBeNull();
    expect(el("sv-trigger")?.contains(el("sv-pin"))).toBe(false);
    expect(document.querySelectorAll("button button")).toHaveLength(0);
  });

  it("moves focus between the trigger and the pin with the arrow keys", async () => {
    await mountSubmenu({}, { actions: () => h("button", { "data-test": "sv-pin" }, "pin") });
    el("sv-trigger")!.focus();
    el("sv-trigger")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(el("sv-pin"));
    el("sv-pin")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(el("sv-trigger"));
  });

  it("lets Escape from the pin reach the menu while other keys stay contained", async () => {
    await mountSubmenu({}, { actions: () => h("button", { "data-test": "sv-pin" }, "pin") });
    const seen: string[] = [];
    const listener = (e: KeyboardEvent) => seen.push(e.key);
    document.addEventListener("keydown", listener);
    for (const key of ["Escape", "a"]) {
      el("sv-pin")!.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    }
    document.removeEventListener("keydown", listener);
    expect(seen).toEqual(["Escape"]);
  });

  it("swaps the arrow keys between the trigger and the pin under rtl", async () => {
    document.documentElement.dir = "rtl";
    await mountSubmenu({}, { actions: () => h("button", { "data-test": "sv-pin" }, "pin") });
    el("sv-trigger")!.focus();
    el("sv-trigger")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(el("sv-trigger"));
    el("sv-trigger")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(el("sv-pin"));
    el("sv-pin")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(el("sv-trigger"));
  });
});

describe("SavedViewsMenuRow arrow keys", () => {
  const press = (key: string) =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );

  it("walks star, edit and delete with ArrowRight and back with ArrowLeft", async () => {
    await mountMenu();
    el("sv-favorite-a")!.focus();
    press("ArrowRight");
    expect(document.activeElement).toBe(el("sv-update-a"));
    press("ArrowRight");
    expect(document.activeElement).toBe(el("sv-delete-a"));
    press("ArrowLeft");
    expect(document.activeElement).toBe(el("sv-update-a"));
  });

  it("walks the actions with the swapped keys under rtl", async () => {
    document.documentElement.dir = "rtl";
    await mountMenu();
    el("sv-favorite-a")!.focus();
    press("ArrowLeft");
    expect(document.activeElement).toBe(el("sv-update-a"));
    press("ArrowLeft");
    expect(document.activeElement).toBe(el("sv-delete-a"));
    press("ArrowRight");
    expect(document.activeElement).toBe(el("sv-update-a"));
    press("ArrowRight");
    expect(document.activeElement).toBe(el("sv-favorite-a"));
    press("ArrowRight");
    expect(document.activeElement).toBe(el("sv-apply-a"));
  });
});
