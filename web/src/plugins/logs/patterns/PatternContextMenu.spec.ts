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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));

import PatternContextMenu from "./PatternContextMenu.vue";

installQuasar({
  plugins: [quasar.Notify],
});

const MENU_ITEMS = [
  { dataTest: "filter-in", emit: "filter-in" },
  { dataTest: "filter-out", emit: "filter-out" },
  { dataTest: "create-alert", emit: "create-alert" },
  { dataTest: "copy-sql", emit: "copy-sql" },
  { dataTest: "view-details", emit: "view-details" },
] as const;

describe("PatternContextMenu", () => {
  let wrapper: VueWrapper;
  const mockPattern = { pattern: "test-pattern", sample: "sample log line" };

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  function queryMenu() {
    return document.body.querySelector(
      '[data-test="patterns-patterncontextmenu"]',
    ) as HTMLElement | null;
  }

  function queryMenuItem(dataTest: string) {
    return document.body.querySelector(
      `[data-test="patterns-patterncontextmenu-${dataTest}"]`,
    ) as HTMLElement | null;
  }

  function queryBackdrop() {
    // The backdrop has no data-test attribute, but it's the fixed full-screen overlay
    // sibling immediately after the menu
    const menu = queryMenu();
    if (!menu) return null;
    return menu.nextElementSibling as HTMLElement | null;
  }

  describe("when visible is false", () => {
    beforeEach(() => {
      wrapper = mount(PatternContextMenu, {
        props: {
          visible: false,
          x: 100,
          y: 200,
          pattern: mockPattern,
        },
      });
    });

    it("should not render the context menu", () => {
      expect(queryMenu()).toBeNull();
    });

    it("should not render any menu items", () => {
      for (const item of MENU_ITEMS) {
        expect(queryMenuItem(item.dataTest)).toBeNull();
      }
    });
  });

  describe("when visible is true", () => {
    beforeEach(() => {
      wrapper = mount(PatternContextMenu, {
        props: {
          visible: true,
          x: 100,
          y: 200,
          pattern: mockPattern,
        },
      });
    });

    it("should render the context menu element", () => {
      expect(queryMenu()).not.toBeNull();
    });

    it("should render all 5 menu items", () => {
      expect(queryMenuItem("filter-in")).not.toBeNull();
      expect(queryMenuItem("filter-out")).not.toBeNull();
      expect(queryMenuItem("create-alert")).not.toBeNull();
      expect(queryMenuItem("copy-sql")).not.toBeNull();
      expect(queryMenuItem("view-details")).not.toBeNull();
    });

    it("should render the menu at the correct x,y position", () => {
      const menu = queryMenu();
      expect(menu).not.toBeNull();
      const style = menu!.getAttribute("style");
      expect(style).toContain("top: 200px");
      expect(style).toContain("left: 100px");
    });

    it("should render the backdrop element", () => {
      const backdrop = queryBackdrop();
      expect(backdrop).not.toBeNull();
      expect(backdrop!.classList.contains("tw:fixed")).toBe(true);
      expect(backdrop!.classList.contains("tw:inset-0")).toBe(true);
    });

    describe("menu item click emissions", () => {
      for (const item of MENU_ITEMS) {
        it(`should emit '${item.emit}' with the pattern when '${item.dataTest}' menu item is clicked`, async () => {
          const menuItem = queryMenuItem(item.dataTest);
          expect(menuItem).not.toBeNull();
          menuItem!.click();

          expect(wrapper.emitted(item.emit)).toBeTruthy();
          expect(wrapper.emitted(item.emit)![0]).toEqual([mockPattern]);
        });
      }
    });

    it("should emit 'close' when the backdrop is clicked", async () => {
      const backdrop = queryBackdrop();
      expect(backdrop).not.toBeNull();
      backdrop!.click();

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("should emit 'close' when Escape key is pressed on the backdrop", async () => {
      const backdrop = queryBackdrop();
      expect(backdrop).not.toBeNull();
      backdrop!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("should emit 'close' when Escape key is pressed on the menu itself", async () => {
      const menu = queryMenu();
      expect(menu).not.toBeNull();
      menu!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

      expect(wrapper.emitted("close")).toBeTruthy();
    });
  });
});
