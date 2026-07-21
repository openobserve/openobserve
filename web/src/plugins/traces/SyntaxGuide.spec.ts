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

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import SyntaxGuide from "@/plugins/traces/SyntaxGuide.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";


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
    // Clean up any portaled ODropdown content attached to document body.
    document
      .querySelectorAll('[data-test="syntax-guide-menu"]')
      .forEach((menu) => menu.remove());
    document
      .querySelectorAll('[data-reka-popper-content-wrapper]')
      .forEach((menu) => menu.remove());
  });

  describe("Component Rendering", () => {
    it("should render the syntax guide button", () => {
      expect(wrapper.find('[data-cy="syntax-guide-button"]').exists()).toBe(
        true,
      );
    });

    it("should render button with help icon", () => {
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      // HelpCircle (lucide) renders as an SVG inside the button
      expect(button.find("svg").exists()).toBe(true);
    });

    it("should have correct button classes", () => {
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      // traces SyntaxGuide uses OButton with only mode class (no syntax-guide-button class)
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

      // ODropdown content is portaled to document.body; the migrated component
      // wraps the panel in a div with data-test="syntax-guide-menu".
      const menu = document.querySelector('[data-test="syntax-guide-menu"]');
      expect(menu).toBeTruthy();

      // The .syntax-guide-title hook was removed when the rule moved to template

      // utilities; the title still renders as .label inside the menu panel.

      const title = document.querySelector('[data-test="syntax-guide-menu"] .label');
      expect(title?.textContent).toBe("Syntax Guide");
    });

    it("should display normal mode syntax examples", async () => {
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      await button.trigger("click");
      await flushPromises();

      // .guide-list hook removed with its rule; the list is the panel's own <ul>.

      const guideList = document.querySelector('[data-test="syntax-guide-menu"] ul');
      expect(guideList).toBeTruthy();

      const listItems = document.querySelectorAll('[data-test="syntax-guide-menu"] ul li');
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

      // The .syntax-guide-title hook was removed when the rule moved to template

      // utilities; the title still renders as .label inside the menu panel.

      const title = document.querySelector('[data-test="syntax-guide-menu"] .label');
      expect(title?.textContent).toBe("Syntax Guide: SQL Mode");
    });

    it("should display SQL mode syntax examples", async () => {
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      await button.trigger("click");
      await flushPromises();

      // .guide-list hook removed with its rule; the list is the panel's own <ul>.

      const guideList = document.querySelector('[data-test="syntax-guide-menu"] ul');
      expect(guideList).toBeTruthy();

      const listItems = document.querySelectorAll('[data-test="syntax-guide-menu"] ul li');
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

      // ODropdown portals content to document.body; the wrapper div is tagged
      // with data-test="syntax-guide-menu" in the migrated source.
      const menu = document.querySelector('[data-test="syntax-guide-menu"]');
      expect(menu).toBeTruthy();
    });
  });

  describe("Styling and Classes", () => {
    it("should have correct button styling classes", () => {
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      // OButton uses Tailwind CSS classes; mode class is applied via :class binding
      expect(button.exists()).toBe(true);
      expect(button.classes()).toContain("normal-mode");
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
      const tooltipComponent = button.findComponent({ name: "OTooltip" });
      expect(tooltipComponent.exists()).toBe(true);
    });
  });

  describe("Component Integration", () => {
    it("should work with i18n translations", () => {
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      // Check that QTooltip component is present
      const tooltipComponent = button.findComponent({ name: "OTooltip" });
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

  // ─── New tests covering functionality added after Dec 29 2025 ───────────────

  // Theming contract: `.dark` on <html> + --color-* tokens that flip
  // automatically. The menu no longer carries a per-theme root class; it is
  // styled solely by `.syntax-guide-menu` + tokens. These tests assert what the
  // menu renders now AND guard that the legacy mechanism has not come back.
  describe("Menu theme class", () => {
    afterEach(() => {
      store.state.theme = "dark"; // restore shared store default
      document
        .querySelectorAll('[data-test="syntax-guide-menu"]')
        .forEach((m) => m.remove());
      document
        .querySelectorAll('[data-reka-popper-content-wrapper]')
        .forEach((m) => m.remove());
    });

    it("should style the menu with tokens, not a theme-light class, when store theme is light", async () => {
      store.state.theme = "light";
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      await button.trigger("click");
      await flushPromises();

      const menu = document.querySelector('[data-test="syntax-guide-menu"]');
      expect(menu).not.toBeNull();
      expect(menu?.classList.contains("syntax-guide-menu")).toBe(true);
      expect(menu?.classList.contains("theme-light")).toBe(false);
      expect(menu?.classList.contains("light-mode")).toBe(false);
    });

    it("should style the menu with tokens, not a theme-dark class, when store theme is dark", async () => {
      store.state.theme = "dark";
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      await button.trigger("click");
      await flushPromises();

      const menu = document.querySelector('[data-test="syntax-guide-menu"]');
      expect(menu).not.toBeNull();
      expect(menu?.classList.contains("syntax-guide-menu")).toBe(true);
      expect(menu?.classList.contains("theme-dark")).toBe(false);
      expect(menu?.classList.contains("dark-mode")).toBe(false);
    });

    it("should render the same menu classes regardless of store theme", async () => {
      // Theme is not a render input for the menu: its class list must be
      // identical across themes, since the visual difference comes from
      // --color-* token values resolved in CSS.
      const classesForTheme = async (theme: string) => {
        store.state.theme = theme;
        const w = mount(SyntaxGuide, {
          attachTo: "#app",
          props: { sqlmode: false },
          global: { provide: { store }, plugins: [i18n] },
        });
        await flushPromises();
        await w.find('[data-cy="syntax-guide-button"]').trigger("click");
        await flushPromises();
        const menu = document.querySelector('[data-test="syntax-guide-menu"]');
        const classes = [...(menu?.classList ?? [])].sort().join(" ");
        w.unmount();
        document
          .querySelectorAll('[data-test="syntax-guide-menu"]')
          .forEach((m) => m.remove());
        return classes;
      };

      const light = await classesForTheme("light");
      const dark = await classesForTheme("dark");

      expect(light).toContain("syntax-guide-menu");
      expect(dark).toBe(light);
    });
  });

  describe("str_match_ignore_case only in normal mode", () => {
    it("should contain str_match_ignore_case example only in normal mode", async () => {
      await wrapper.setProps({ sqlmode: false });
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      await button.trigger("click");
      await flushPromises();

      const text = document.body.textContent || "";
      expect(text).toContain("str_match_ignore_case");
    });

    it("should NOT contain str_match_ignore_case in SQL mode", async () => {
      await wrapper.setProps({ sqlmode: true });
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      await button.trigger("click");
      await flushPromises();

      const text = document.body.textContent || "";
      expect(text).not.toContain("str_match_ignore_case");
    });
  });

  describe("extract_ip query function example only in SQL mode", () => {
    afterEach(() => {
      document
        .querySelectorAll('[data-test="syntax-guide-menu"]')
        .forEach((m) => m.remove());
      document
        .querySelectorAll('[data-reka-popper-content-wrapper]')
        .forEach((m) => m.remove());
    });

    it("should contain extract_ip example in SQL mode", async () => {
      await wrapper.setProps({ sqlmode: true });
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      await button.trigger("click");
      await flushPromises();

      const text = document.body.textContent || "";
      expect(text).toContain("extract_ip");
    });

    it("should NOT contain extract_ip example in normal mode", async () => {
      await wrapper.setProps({ sqlmode: false });
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      await button.trigger("click");
      await flushPromises();

      const text = document.body.textContent || "";
      expect(text).not.toContain("extract_ip");
    });
  });

  describe("sqlmode prop toggle between modes", () => {
    afterEach(() => {
      document
        .querySelectorAll('[data-test="syntax-guide-menu"]')
        .forEach((m) => m.remove());
      document
        .querySelectorAll('[data-reka-popper-content-wrapper]')
        .forEach((m) => m.remove());
    });

    it("should switch button class from normal-mode to sql-mode dynamically", async () => {
      await wrapper.setProps({ sqlmode: false });
      let button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.classes()).toContain("normal-mode");

      await wrapper.setProps({ sqlmode: true });
      button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.classes()).toContain("sql-mode");
    });

    it("should switch button class from sql-mode back to normal-mode dynamically", async () => {
      await wrapper.setProps({ sqlmode: true });
      await wrapper.setProps({ sqlmode: false });
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      expect(button.classes()).toContain("normal-mode");
      expect(button.classes()).not.toContain("sql-mode");
    });
  });

  describe("Documentation link present in both modes", () => {
    afterEach(() => {
      document
        .querySelectorAll('[data-test="syntax-guide-menu"]')
        .forEach((m) => m.remove());
      document
        .querySelectorAll('[data-reka-popper-content-wrapper]')
        .forEach((m) => m.remove());
    });

    it("normal mode: docs link opens in new tab", async () => {
      await wrapper.setProps({ sqlmode: false });
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      await button.trigger("click");
      await flushPromises();

      const link = document.querySelector(
        'a[href="https://openobserve.ai/docs/example-queries/"]',
      );
      expect(link?.getAttribute("target")).toBe("_blank");
    });

    it("sql mode: docs link opens in new tab", async () => {
      await wrapper.setProps({ sqlmode: true });
      const button = wrapper.find('[data-cy="syntax-guide-button"]');
      await button.trigger("click");
      await flushPromises();

      const link = document.querySelector(
        'a[href="https://openobserve.ai/docs/example-queries/"]',
      );
      expect(link?.getAttribute("target")).toBe("_blank");
    });
  });
});
