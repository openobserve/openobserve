// Copyright 2025 OpenObserve Inc.
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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import SyntaxGuide from "@/plugins/traces/SyntaxGuide.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({
  plugins: [Dialog, Notify],
});

const node = document.createElement("div");
node.setAttribute("id", "app");
node.style.height = "1024px";
document.body.appendChild(node);

describe("SyntaxGuide", () => {
  let wrapper: any;

  beforeEach(async () => {
    wrapper = mount(SyntaxGuide, {
      attachTo: "#app",
      props: {
        sqlmode: false,
      },
      global: {
        provide: {
          store: store,
        },
        plugins: [i18n],
      },
    });
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    // Clean up any menus that might be attached to document body
    const menus = document.querySelectorAll(".q-menu");
    menus.forEach((menu) => menu.remove());
  });

  describe("Component Rendering", () => {
    it("should render the syntax guide button", () => {
      expect(wrapper.find('[data-cy="syntax-guide-button"]').exists()).toBe(
        true,
      );
    });

    it("should render button with help icon text", () => {
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      // Button text comes from the icon name
      expect(button.text()).toBe("help");
    });

    it("should render button with help icon", () => {
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.find(".q-icon").exists()).toBe(true);
    });

    it("should have correct button classes", () => {
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.classes()).toContain("syntax-guide-button");
      expect(button.classes()).toContain("normal-mode");
    });
  });

  describe("Props", () => {
    it("should apply normal-mode class when sqlmode is false", async () => {
      await wrapper.setProps({ sqlmode: false });
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.classes()).toContain("normal-mode");
      expect(button.classes()).not.toContain("sql-mode");
    });

    it("should apply sql-mode class when sqlmode is true", async () => {
      await wrapper.setProps({ sqlmode: true });
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.classes()).toContain("sql-mode");
      expect(button.classes()).not.toContain("normal-mode");
    });

    it("should have sqlmode prop with default value false", () => {
      expect(wrapper.props("sqlmode")).toBe(false);
    });
  });

  describe("Menu Content - Normal Mode", () => {
    beforeEach(async () => {
      await wrapper.setProps({ sqlmode: false });
      await flushPromises();
    });

    it("should show normal mode title", async () => {
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      await button.trigger("click");
      await flushPromises();

      // Menu is attached to document body, so we need to search in document
      const menu = document.querySelector(".q-menu");
      expect(menu).toBeTruthy();

      const title = document.querySelector(".syntax-guide-title .label");
      expect(title?.textContent).toBe("Syntax Guide");
    });

    it("should display normal mode syntax examples", async () => {
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      await button.trigger("click");
      await flushPromises();

      const guideList = document.querySelector(".guide-list");
      expect(guideList).toBeTruthy();

      const listItems = document.querySelectorAll(".guide-list li");
      expect(listItems.length).toBeGreaterThan(0);

      // Check for specific normal mode content
      const text = document.body.textContent || "";
      expect(text).toContain("match_all('error') in query editor");
      expect(text).toContain("str_match(fieldname, 'error')");
      expect(text).toContain("str_match_ignore_case(fieldname, 'Error')");
      expect(text).toContain("code=200");
      expect(text).toContain("stream='stderr'");
    });

    it("should contain link to documentation", async () => {
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      await button.trigger("click");
      await flushPromises();

      const link = document.querySelector(
        'a[href="https://openobserve.ai/docs/example-queries/"]',
      );
      expect(link).toBeTruthy();
      expect(link?.getAttribute("target")).toBe("_blank");
    });
  });

  describe("Menu Content - SQL Mode", () => {
    beforeEach(async () => {
      await wrapper.setProps({ sqlmode: true });
      await flushPromises();
    });

    it("should show SQL mode title", async () => {
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      await button.trigger("click");
      await flushPromises();

      const title = document.querySelector(".syntax-guide-title .label");
      expect(title?.textContent).toBe("Syntax Guide: SQL Mode");
    });

    it("should display SQL mode syntax examples", async () => {
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      await button.trigger("click");
      await flushPromises();

      const guideList = document.querySelector(".guide-list");
      expect(guideList).toBeTruthy();

      const listItems = document.querySelectorAll(".guide-list li");
      expect(listItems.length).toBeGreaterThan(0);

      // Check for specific SQL mode content
      const text = document.body.textContent || "";
      expect(text).toContain("SELECT * FROM stream WHERE match_all('error')");
      expect(text).toContain(
        "SELECT * FROM stream WHERE str_match(fieldname, 'error')",
      );
      expect(text).toContain("SELECT * FROM stream WHERE code=200");
      expect(text).toContain("SELECT * FROM stream WHERE stream='stderr'");
      expect(text).toContain(
        "SELECT extract_ip(log) FROM stream WHERE code=200",
      );
    });

    it("should contain link to documentation in SQL mode", async () => {
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      await button.trigger("click");
      await flushPromises();

      const link = document.querySelector(
        'a[href="https://openobserve.ai/docs/example-queries/"]',
      );
      expect(link).toBeTruthy();
      expect(link?.getAttribute("target")).toBe("_blank");
    });
  });

  describe("User Interactions", () => {
    it("should open menu when button is clicked", async () => {
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      await button.trigger("click");
      await flushPromises();

      const menu = document.querySelector(".q-menu");
      expect(menu).toBeTruthy();
    });
  });

  describe("Styling and Classes", () => {
    it("should have correct button styling classes", () => {
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      // Button classes have been updated to use Tailwind CSS
      // q-ml-xs has been removed, but q-pa-xs and syntax-guide-button remain
      expect(button.classes()).toContain("q-pa-xs");
      expect(button.classes()).toContain("syntax-guide-button");
      // Verify Tailwind classes are present
      expect(button.classes()).toContain("tw:cursor-pointer");
    });
  });

  describe("Accessibility", () => {
    it("should have data-cy attribute for testing", () => {
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.exists()).toBe(true);
    });

    it("should have tooltip component for accessibility", () => {
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      // Check that QTooltip component is present as a child
      const tooltipComponent = button.findComponent({ name: "QTooltip" });
      expect(tooltipComponent.exists()).toBe(true);
    });
  });

  describe("Component Integration", () => {
    it("should work with i18n translations", () => {
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      // Check that QTooltip component is present
      const tooltipComponent = button.findComponent({ name: "QTooltip" });
      expect(tooltipComponent.exists()).toBe(true);
    });

    it("should integrate with Vuex store", () => {
      expect(wrapper.vm.store).toBeDefined();
    });

    it("should use Vue I18n composable", () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(typeof wrapper.vm.t).toBe("function");
    });
  });

  describe("Edge Cases", () => {
    it("should handle undefined sqlmode prop gracefully", async () => {
      await wrapper.setProps({ sqlmode: undefined });
      await flushPromises();

      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.classes()).toContain("normal-mode");
    });

    it("should handle null sqlmode prop gracefully", async () => {
      await wrapper.setProps({ sqlmode: null });
      await flushPromises();

      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.classes()).toContain("normal-mode");
    });
  });
});
