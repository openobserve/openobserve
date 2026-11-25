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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import i18n from "@/locales";
import store from "@/stores";
import OrganizationSelector from "@/components/OrganizationSelector.vue";
import { orgCreatePending } from "@/utils/orgScopedRoutes";
import { __resetOrgSwitcherPrefsForTest } from "@/composables/useOrgSwitcherPrefs";
import { resetManager } from "@/lib/vue-shortcut-manager";

const KEY = "o2:org-switcher:v1:user@example.com";
const org = (identifier: string, label = identifier) => ({ identifier, label });
const MANY = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf"].map((id) =>
  org(id, id[0].toUpperCase() + id.slice(1)),
);

const makeRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div />" } },
      { path: "/iam/organizations", name: "organizations", component: { template: "<div />" } },
    ],
  });

let wrapper: VueWrapper | null = null;
let router: Router;

const mountSelector = async (
  organizations: { identifier: string; label: string }[],
  current: { identifier: string; label: string } | null = organizations[0] ?? null,
) => {
  wrapper = mount(OrganizationSelector, {
    props: { organizations, current },
    global: { plugins: [i18n, router] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
};

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const input = () => $<HTMLInputElement>('[data-test="organization-search-input"] input')!;
const rowIds = () =>
  $$('[data-test="organization-menu-item-label-item-label"]').map((r) =>
    r.getAttribute("data-test-org-identifier"),
  );
const star = (id: string) =>
  $<HTMLButtonElement>(
    `[data-test="organization-menu-item-favorite"][data-test-org-identifier="${id}"]`,
  )!;
const menuOpen = () => !!$('[data-test="organization-menu-list"]');

const openMenu = async () => {
  await wrapper!.find('[data-test="navbar-organizations-select-trigger"]').trigger("click");
  await flushPromises();
};

const press = async (key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  input().dispatchEvent(event);
  await flushPromises();
  return event;
};

const typeQuery = async (value: string) => {
  const el = input();
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 5));
  await flushPromises();
};

const activeDescendant = () => input().getAttribute("aria-activedescendant");

const seed = (favorites: string[], recents: string[] = []) => {
  localStorage.setItem(KEY, JSON.stringify({ v: 1, favorites, recents }));
  __resetOrgSwitcherPrefsForTest();
};

describe("OrganizationSelector", () => {
  beforeEach(async () => {
    localStorage.clear();
    store.commit("setUserInfo", { email: "user@example.com" });
    __resetOrgSwitcherPrefsForTest();
    orgCreatePending.value = false;
    // jsdom lays nothing out; give the virtual list a viewport so it renders rows.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 376,
      height: 384,
      top: 0,
      left: 0,
      right: 376,
      bottom: 384,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    router = makeRouter();
    await router.push("/");
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.restoreAllMocks();
    resetManager();
    document.body.innerHTML = "";
  });

  describe("trigger", () => {
    it("shows a placeholder in place of the name until the organization is known", async () => {
      await mountSelector([], null);
      expect(wrapper!.find('[data-test="navbar-organizations-select-placeholder"]').exists()).toBe(
        true,
      );
    });

    it("shows the organization name once it is known", async () => {
      await mountSelector([org("default")]);
      expect(wrapper!.find('[data-test="navbar-organizations-select-placeholder"]').exists()).toBe(
        false,
      );
      expect(wrapper!.find('[data-test="navbar-organizations-select-trigger"]').text()).toContain(
        "default",
      );
    });
  });

  describe("panel structure", () => {
    it("D1 is a popover whose combobox input controls a grid", async () => {
      await mountSelector(MANY);
      await openMenu();
      expect($('[role="menu"]')).toBeNull();
      expect($("[data-o-popover-content]")).not.toBeNull();
      const grid = $('[data-test="organization-menu-table"]')!;
      expect(grid.getAttribute("role")).toBe("grid");
      expect(input().getAttribute("role")).toBe("combobox");
      expect(input().getAttribute("aria-haspopup")).toBe("grid");
      expect(input().getAttribute("aria-expanded")).toBe("true");
      expect(input().getAttribute("aria-controls")).toBe(grid.id);
      const row = $('[data-test="organization-menu-item-label-item-label"]')!;
      expect(row.getAttribute("role")).toBe("row");
      expect(
        [...row.querySelectorAll('[role="gridcell"]')].map((c) => c.id.split("-").pop()),
      ).toEqual(["name", "star", "copy"]);
    });

    it("D2 opens with the search focused and nothing active", async () => {
      await mountSelector(MANY);
      await openMenu();
      expect(document.activeElement).toBe(input());
      expect(activeDescendant()).toBeNull();
      expect($$('[role="row"].bg-select-item-hover-bg')).toHaveLength(0);
    });

    it("D14 keeps every existing id, marks the current org selected and links to the orgs page", async () => {
      await mountSelector(MANY, MANY[2]);
      await openMenu();
      for (const id of [
        "organization-menu-list",
        "organization-menu-count",
        "organization-search-input",
        "organization-menu-table",
        "organization-menu-item-copy-id",
        "organization-menu-create-btn",
        "organization-menu-manage-link",
      ]) {
        expect($(`[data-test="${id}"]`), id).not.toBeNull();
      }
      const selected = $$('[role="row"][aria-selected="true"]');
      expect(selected.map((r) => r.getAttribute("data-test-org-identifier"))).toEqual(["charlie"]);

      $('[data-test="organization-menu-manage-link"]')!.click();
      await flushPromises();
      expect(router.currentRoute.value.name).toBe("organizations");
      expect(router.currentRoute.value.query.org_identifier).toBe("charlie");
      expect(menuOpen()).toBe(false);
    });

    it("shows section headings once there are favorites", async () => {
      seed(["golf"], ["bravo"]);
      await mountSelector(MANY);
      await openMenu();
      expect($('[data-test="organization-menu-section-favorites"]')).not.toBeNull();
      expect($('[data-test="organization-menu-section-recent"]')).not.toBeNull();
      expect($('[data-test="organization-menu-section-all"]')).not.toBeNull();
      expect(rowIds().slice(0, 2)).toEqual(["golf", "bravo"]);
      const grid = $('[data-test="organization-menu-table"]')!;
      const rows = [...grid.querySelectorAll('[role="row"]')];
      expect(grid.getAttribute("aria-rowcount")).toBe(String(rows.length));
      expect(rows.map((row) => row.getAttribute("aria-rowindex"))).toEqual(
        rows.map((_, index) => String(index + 1)),
      );
    });
  });

  describe("keyboard", () => {
    it("D3 Up/Down skip headings and wrap; the first Down activates the first row", async () => {
      seed(["golf"]);
      await mountSelector(MANY);
      await openMenu();
      const ids = rowIds();
      await press("ArrowDown");
      expect(activeDescendant()).toMatch(/-1-name$/);
      await press("ArrowUp");
      expect(activeDescendant()).toMatch(new RegExp(`-${ids.length + 1}-name$`));
      await press("ArrowDown");
      expect(activeDescendant()).toMatch(/-1-name$/);
      await press("ArrowDown");
      expect(activeDescendant()).toMatch(/-3-name$/);
    });

    it("D4 Enter with nothing active and an empty query does nothing", async () => {
      await mountSelector(MANY);
      await openMenu();
      await press("Enter");
      expect(wrapper!.emitted("select")).toBeUndefined();
      expect(menuOpen()).toBe(true);
    });

    it("D5 Enter with a query selects the first ranked result", async () => {
      await mountSelector(MANY);
      await openMenu();
      await typeQuery("ec");
      await press("Enter");
      expect(wrapper!.emitted("select")?.[0]?.[0]).toMatchObject({ identifier: "echo" });
    });

    it("D6 Enter while composing is ignored", async () => {
      await mountSelector(MANY);
      await openMenu();
      await typeQuery("ec");
      await press("Enter", { isComposing: true });
      expect(wrapper!.emitted("select")).toBeUndefined();
    });

    it("D7 Right moves name -> star -> copy and Left back, focus stays in the input", async () => {
      await mountSelector(MANY);
      await openMenu();
      await press("ArrowDown");
      await press("ArrowRight");
      expect(activeDescendant()).toMatch(/-0-star$/);
      await press("ArrowRight");
      expect(activeDescendant()).toMatch(/-0-copy$/);
      await press("ArrowRight");
      expect(activeDescendant()).toMatch(/-0-copy$/);
      await press("ArrowLeft");
      expect(activeDescendant()).toMatch(/-0-star$/);
      await press("ArrowLeft");
      expect(activeDescendant()).toMatch(/-0-name$/);
      expect(document.activeElement).toBe(input());
      expect(document.getElementById(activeDescendant()!)).not.toBeNull();
    });

    it("D7 Right leaves the caret alone when it is not at the end of the query", async () => {
      await mountSelector(MANY);
      await openMenu();
      await typeQuery("ec");
      input().setSelectionRange(0, 0);
      const event = await press("ArrowRight");
      expect(event.defaultPrevented).toBe(false);
      expect(activeDescendant()).toMatch(/-name$/);
    });

    it("D8 Enter and Space on the star cell toggle it; Space on the name cell is typed", async () => {
      await mountSelector(MANY);
      await openMenu();
      await press("ArrowDown");
      const nameSpace = await press(" ");
      expect(nameSpace.defaultPrevented).toBe(false);

      await press("ArrowRight");
      await press("Enter");
      expect(star("alpha").getAttribute("aria-pressed")).toBe("true");
      const starSpace = await press(" ");
      expect(starSpace.defaultPrevented).toBe(true);
      expect(star("alpha").getAttribute("aria-pressed")).toBe("false");
      expect(wrapper!.emitted("select")).toBeUndefined();
    });

    it("F12 Space on a star cell scrolled out of view brings its row back before toggling", async () => {
      const orgs = Array.from({ length: 60 }, (_, i) => org(`org${String(i).padStart(2, "0")}`));
      await mountSelector(orgs);
      await openMenu();
      await press("ArrowDown");
      await press("ArrowRight");
      expect(activeDescendant()).toMatch(/-star$/);

      const grid = $('[data-test="organization-menu-table"]')!;
      // jsdom has no scrolling; make the virtualizer's scrollTo move the viewport as a browser would.
      const scrollTo = (opts?: ScrollToOptions | number) => {
        grid.scrollTop = typeof opts === "object" ? (opts.top ?? 0) : 0;
        grid.dispatchEvent(new Event("scroll"));
      };
      grid.scrollTo = scrollTo as typeof grid.scrollTo;
      scrollTo({ top: 2000 });
      await flushPromises();
      expect(activeDescendant()).toBeNull();

      await press(" ");
      await new Promise((r) => setTimeout(r, 50));
      await flushPromises();
      expect(activeDescendant()).toMatch(/-star$/);
      expect(star("org00").getAttribute("aria-pressed")).toBe("true");
    });
  });

  describe("favorites", () => {
    it("D9 a star click toggles in place without selecting or closing", async () => {
      await mountSelector(MANY);
      await openMenu();
      star("delta").click();
      await flushPromises();
      expect(star("delta").getAttribute("aria-pressed")).toBe("true");
      expect(star("delta").getAttribute("aria-label")).toBe("Remove Delta from favorites");
      expect(JSON.parse(localStorage.getItem(KEY)!).favorites).toEqual(["delta"]);
      expect(wrapper!.emitted("select")).toBeUndefined();
      expect(menuOpen()).toBe(true);
    });

    it("D10 sections stay frozen after a star click and a storage event", async () => {
      await mountSelector(MANY);
      await openMenu();
      const before = rowIds();
      star("golf").click();
      await flushPromises();
      localStorage.setItem(KEY, JSON.stringify({ v: 1, favorites: ["golf", "echo"], recents: [] }));
      window.dispatchEvent(new StorageEvent("storage", { key: KEY, storageArea: localStorage }));
      await flushPromises();
      expect(rowIds()).toEqual(before);
      expect($('[data-test="organization-menu-section-favorites"]')).toBeNull();
      expect(star("echo").getAttribute("aria-pressed")).toBe("true");

      await openMenu();
      await openMenu();
      expect(rowIds().slice(0, 2)).toEqual(["golf", "echo"]);
    });

    it("D11 at 10 favorites an unstarred star is disabled but focusable, with the cap reason", async () => {
      const orgs = Array.from({ length: 12 }, (_, i) => org(`o${String(i).padStart(2, "0")}`));
      seed(orgs.slice(0, 10).map((o) => o.identifier));
      await mountSelector(orgs);
      await openMenu();
      const capped = star("o10");
      expect(capped.disabled).toBe(false);
      expect(capped.getAttribute("aria-disabled")).toBe("true");
      const reasonId = capped.getAttribute("aria-describedby")!;
      expect(document.getElementById(reasonId)?.textContent).toBe("Up to 10 favorites");
      capped.click();
      await flushPromises();
      expect(capped.getAttribute("aria-pressed")).toBe("false");
    });
  });

  describe("list changes while open", () => {
    it("keeps the active row on the same org when the list changes under it", async () => {
      await mountSelector(MANY);
      await openMenu();
      await press("ArrowDown");
      await press("ArrowDown");
      expect(activeDescendant()).toMatch(/-1-name$/);
      await wrapper!.setProps({ organizations: [org("aaa", "Aaa"), ...MANY] });
      await flushPromises();
      expect(activeDescendant()).toMatch(/-2-name$/);
      await press("Enter");
      expect(wrapper!.emitted("select")?.[0]?.[0]).toMatchObject({ identifier: "bravo" });
    });

    it("clears the active row when its org leaves the list and the query is empty", async () => {
      await mountSelector(MANY);
      await openMenu();
      await press("ArrowUp");
      expect(activeDescendant()).toMatch(/-6-name$/);
      await wrapper!.setProps({ organizations: MANY.slice(0, 6) });
      await flushPromises();
      expect(activeDescendant()).toBeNull();
    });

    it("keeps the active row and cell when only whitespace changes in the query", async () => {
      await mountSelector(MANY);
      await openMenu();
      await typeQuery("o");
      await press("ArrowDown");
      await press("ArrowRight");
      const before = activeDescendant();
      expect(before).toMatch(/-star$/);
      await typeQuery("o ");
      expect(activeDescendant()).toBe(before);
      await typeQuery("ol");
      expect(activeDescendant()).toMatch(/-0-name$/);
    });

    it("collapses the combobox and drops aria-controls when search finds no matches", async () => {
      await mountSelector(MANY);
      await openMenu();
      await typeQuery("zzz");
      expect($('[data-test="organization-menu-table"]')).toBeNull();
      expect(input().getAttribute("aria-expanded")).toBe("false");
      expect(input().getAttribute("aria-controls")).toBeNull();
    });
  });

  describe("without a storage key", () => {
    it("renders no star and moves Right from the name straight to copy", async () => {
      store.commit("setUserInfo", {});
      await mountSelector(MANY);
      await openMenu();
      expect($('[data-test="organization-menu-item-favorite"]')).toBeNull();
      await press("ArrowDown");
      await press("ArrowRight");
      expect(activeDescendant()).toMatch(/-0-copy$/);
    });
  });

  describe("create", () => {
    it("D12 '+' sets the create flag and opens the orgs page with action=add", async () => {
      await mountSelector(MANY);
      await openMenu();
      $('[data-test="organization-menu-create-btn"]')!.click();
      await flushPromises();
      expect(orgCreatePending.value).toBe(true);
      expect(router.currentRoute.value.name).toBe("organizations");
      expect(router.currentRoute.value.query).toMatchObject({
        action: "add",
        org_identifier: "alpha",
      });
      expect(menuOpen()).toBe(false);
    });

    it("D12 a failed navigation clears the create flag", async () => {
      router.beforeEach((to) => to.name !== "organizations");
      await mountSelector(MANY);
      await openMenu();
      $('[data-test="organization-menu-create-btn"]')!.click();
      await flushPromises();
      expect(orgCreatePending.value).toBe(false);
      expect(router.currentRoute.value.name).toBe("home");
    });

    it("D13 '+' on the orgs page sets the flag without a navigation", async () => {
      await router.push({ name: "organizations", query: { org_identifier: "alpha" } });
      const push = vi.spyOn(router, "push");
      await mountSelector(MANY);
      await openMenu();
      $('[data-test="organization-menu-create-btn"]')!.click();
      await flushPromises();
      expect(orgCreatePending.value).toBe(true);
      expect(push).not.toHaveBeenCalled();
    });
  });

  describe("shortcut", () => {
    it("E2 g then o opens the switcher from the page, not from a text field", async () => {
      await mountSelector(MANY);
      const field = document.createElement("input");
      document.body.appendChild(field);
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "o", bubbles: true }));
      await flushPromises();
      expect(menuOpen()).toBe(false);

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "o", bubbles: true }));
      await flushPromises();
      expect(menuOpen()).toBe(true);
      expect(activeDescendant()).toBeNull();
    });
  });
});
