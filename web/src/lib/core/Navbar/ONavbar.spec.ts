// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import ONavbar from "./ONavbar.vue";
import type { NavItem } from "./ONavbar.types";

const mockLinks: NavItem[] = [
  { title: "Home", icon: "home", link: "/home", name: "home" },
  { title: "Logs", icon: "list", link: "/logs", name: "logs" },
  { title: "Settings", icon: "settings", link: "/settings", name: "settings" },
];

describe("ONavbar", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  function mountNavbar(props: Record<string, unknown> = {}) {
    return mount(ONavbar, {
      props: {
        linksList: mockLinks,
        ...props,
      },
      global: {
        stubs: {
          "q-list": {
            template: '<div class="q-list leftNavList" :data-test="$attrs[\'data-test\']"><slot /></div>',
            inheritAttrs: false,
          },
          "menu-link": {
            template:
              '<a class="q-item" :data-test="\'navbar-menu-link-\' + linkName" @mouseenter="$emit(\'menu-hover\', link)"><slot /></a>',
            props: ["linkName", "mini", "animationIndex", "title", "icon", "link", "name", "exact", "display", "hide"],
            emits: ["menu-hover"],
            inheritAttrs: false,
          },
        },
      },
    });
  }

  describe("rendering", () => {
    it("should render the nav element when visible", () => {
      wrapper = mountNavbar();
      expect(wrapper.find('[data-test="navbar-main-nav"]').exists()).toBe(true);
    });

    it("should hide the nav when visible is false", () => {
      wrapper = mountNavbar({ visible: false });
      expect(wrapper.find('[data-test="navbar-main-nav"]').isVisible()).toBe(false);
    });

    it("should render the correct number of menu links", () => {
      wrapper = mountNavbar();
      const links = wrapper.findAll('[data-test^="navbar-menu-link-"]');
      expect(links).toHaveLength(3);
    });

    it("should render menu links with correct link names", () => {
      wrapper = mountNavbar();
      expect(wrapper.find('[data-test="navbar-menu-link-home"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="navbar-menu-link-logs"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="navbar-menu-link-settings"]').exists()).toBe(true);
    });

    it("should pass mini prop to menu links", () => {
      wrapper = mountNavbar({ miniMode: true });
      const link = wrapper.find('[data-test="navbar-menu-link-home"]');
      expect(link.attributes("mini")).toBe("true");
    });

    it("should set role and aria-label for accessibility", () => {
      wrapper = mountNavbar();
      const nav = wrapper.find('[data-test="navbar-main-nav"]');
      expect(nav.attributes("role")).toBe("navigation");
      expect(nav.attributes("aria-label")).toBe("Main navigation");
    });
  });

  describe("keyboard navigation", () => {
    function createMenuLinkElements(count: number): HTMLElement[] {
      return Array.from({ length: count }, (_, i) => {
        const el = document.createElement("a");
        el.classList.add("q-item");
        el.setAttribute("data-test", `navbar-menu-link-${mockLinks[i]?.name ?? i}`);
        return el;
      });
    }

    it("should move focus to next link on ArrowDown", () => {
      wrapper = mountNavbar();
      const nav = wrapper.find('[data-test="navbar-main-nav"]').element;
      const links = createMenuLinkElements(3);
      links.forEach((l) => nav.appendChild(l));
      links[0].focus();

      const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true });
      nav.dispatchEvent(event);

      // Focus should move to the second element
      expect(document.activeElement).toBe(links[1]);
    });

    it("should wrap to first link when ArrowDown on last link", () => {
      wrapper = mountNavbar();
      const nav = wrapper.find('[data-test="navbar-main-nav"]').element;
      const links = createMenuLinkElements(3);
      links.forEach((l) => nav.appendChild(l));
      links[2].focus();

      const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true });
      nav.dispatchEvent(event);

      expect(document.activeElement).toBe(links[0]);
    });

    it("should move focus to previous link on ArrowUp", () => {
      wrapper = mountNavbar();
      const nav = wrapper.find('[data-test="navbar-main-nav"]').element;
      const links = createMenuLinkElements(3);
      links.forEach((l) => nav.appendChild(l));
      links[1].focus();

      const event = new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true });
      nav.dispatchEvent(event);

      expect(document.activeElement).toBe(links[0]);
    });

    it("should wrap to last link when ArrowUp on first link", () => {
      wrapper = mountNavbar();
      const nav = wrapper.find('[data-test="navbar-main-nav"]').element;
      const links = createMenuLinkElements(3);
      links.forEach((l) => nav.appendChild(l));
      links[0].focus();

      const event = new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true });
      nav.dispatchEvent(event);

      expect(document.activeElement).toBe(links[2]);
    });

    it("should focus first link on ArrowDown when no link is focused", () => {
      wrapper = mountNavbar();
      const nav = wrapper.find('[data-test="navbar-main-nav"]').element;
      const links = createMenuLinkElements(3);
      links.forEach((l) => nav.appendChild(l));

      const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true });
      nav.dispatchEvent(event);

      expect(document.activeElement).toBe(links[0]);
    });

    it("should focus last link on ArrowUp when no link is focused", () => {
      wrapper = mountNavbar();
      const nav = wrapper.find('[data-test="navbar-main-nav"]').element;
      const links = createMenuLinkElements(3);
      links.forEach((l) => nav.appendChild(l));

      const event = new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true });
      nav.dispatchEvent(event);

      expect(document.activeElement).toBe(links[2]);
    });

    it("should ignore unhandled keys", () => {
      wrapper = mountNavbar();
      const nav = wrapper.find('[data-test="navbar-main-nav"]').element;
      const links = createMenuLinkElements(3);
      links.forEach((l) => nav.appendChild(l));
      links[0].focus();

      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      nav.dispatchEvent(event);

      // Focus should remain unchanged
      expect(document.activeElement).toBe(links[0]);
    });

    it("should handle keyboard nav when no menu links exist", () => {
      wrapper = mountNavbar();
      const nav = wrapper.find('[data-test="navbar-main-nav"]').element;

      const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true });
      expect(() => nav.dispatchEvent(event)).not.toThrow();
    });
  });

  describe("menu-hover emit", () => {
    it("should emit menu-hover when a menu link is hovered", async () => {
      wrapper = mountNavbar();
      const link = wrapper.find('[data-test="navbar-menu-link-logs"]');
      await link.trigger("mouseenter");
      expect(wrapper.emitted("menu-hover")).toBeTruthy();
      expect(wrapper.emitted("menu-hover")![0]).toEqual(["/logs"]);
    });
  });

  describe("props", () => {
    it("should default miniMode to false", () => {
      wrapper = mountNavbar();
      const link = wrapper.find('[data-test="navbar-menu-link-home"]');
      expect(link.attributes("mini")).toBe("false");
    });

    it("should default visible to true", () => {
      wrapper = mountNavbar();
      expect(wrapper.find('[data-test="navbar-main-nav"]').isVisible()).toBe(true);
    });
  });
});
