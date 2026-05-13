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
          "menu-link": {
            template:
              '<a class="q-item" :data-test="\'menu-link-\' + linkName + \'-item\'" @mouseenter="$emit(\'menu-hover\', link)"><slot /></a>',
            props: ["linkName", "mini", "animationIndex", "title", "icon", "link", "name", "exact", "display", "hide"],
            emits: ["menu-hover"],
            inheritAttrs: true,
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
      const links = wrapper.findAll('[data-test^="menu-link-"]');
      expect(links).toHaveLength(3);
    });

    it("should render menu links with correct link names", () => {
      wrapper = mountNavbar();
      expect(wrapper.find('[data-test="menu-link-home-item"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="menu-link-logs-item"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="menu-link-settings-item"]').exists()).toBe(true);
    });

    it("should pass mini prop to menu links", () => {
      wrapper = mountNavbar({ miniMode: true });
      const link = wrapper.findComponent('[data-test="menu-link-home-item"]');
      expect(link.props("mini")).toBe(true);
    });

    it("should set role and aria-label for accessibility", () => {
      wrapper = mountNavbar();
      const nav = wrapper.find('[data-test="navbar-main-nav"]');
      expect(nav.attributes("role")).toBe("navigation");
      expect(nav.attributes("aria-label")).toBe("Main navigation");
    });
  });

  describe("keyboard navigation", () => {
    // jsdom does not update document.activeElement on element.focus().
    // Wire them together so the keyboard handler can read and set focus.
    let activeEl: Element | null;
    let focusSpy: ReturnType<typeof vi.spyOn>;
    let activeElementSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      activeEl = document.body;
      focusSpy = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function () {
        activeEl = this as unknown as Element;
      });
      activeElementSpy = vi.spyOn(document, "activeElement", "get").mockImplementation(() => activeEl as Element);
    });

    afterEach(() => {
      focusSpy.mockRestore();
      activeElementSpy.mockRestore();
    });

    function createMenuLinkElements(count: number): HTMLElement[] {
      return Array.from({ length: count }, (_, i) => {
        const el = document.createElement("a");
        el.href = "#";
        el.setAttribute("data-test", `menu-link-${mockLinks[i]?.name ?? i}-item`);
        return el;
      });
    }

    function setupNavWithLinks(count: number) {
      wrapper = mountNavbar();
      const nav = wrapper.find('[data-test="navbar-main-nav"]').element;
      // Clear stub-rendered elements so only test elements are in the nav
      while (nav.firstChild) nav.removeChild(nav.firstChild);
      const links = createMenuLinkElements(count);
      links.forEach((l) => nav.appendChild(l));
      return { nav, links };
    }

    function setActiveElement(el: Element | null) {
      activeEl = el;
    }

    function getActiveElement(): Element | null {
      return activeEl;
    }

    it("should move focus to next link on ArrowDown", () => {
      const { nav, links } = setupNavWithLinks(3);
      setActiveElement(links[0]);

      const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true });
      nav.dispatchEvent(event);

      expect(getActiveElement()).toBe(links[1]);
    });

    it("should wrap to first link when ArrowDown on last link", () => {
      const { nav, links } = setupNavWithLinks(3);
      setActiveElement(links[2]);

      const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true });
      nav.dispatchEvent(event);

      expect(getActiveElement()).toBe(links[0]);
    });

    it("should move focus to previous link on ArrowUp", () => {
      const { nav, links } = setupNavWithLinks(3);
      setActiveElement(links[1]);

      const event = new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true });
      nav.dispatchEvent(event);

      expect(getActiveElement()).toBe(links[0]);
    });

    it("should wrap to last link when ArrowUp on first link", () => {
      const { nav, links } = setupNavWithLinks(3);
      setActiveElement(links[0]);

      const event = new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true });
      nav.dispatchEvent(event);

      expect(getActiveElement()).toBe(links[2]);
    });

    it("should focus first link on ArrowDown when no link is focused", () => {
      const { nav, links } = setupNavWithLinks(3);
      setActiveElement(null);

      const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true });
      nav.dispatchEvent(event);

      expect(getActiveElement()).toBe(links[0]);
    });

    it("should focus last link on ArrowUp when no link is focused", () => {
      const { nav, links } = setupNavWithLinks(3);
      setActiveElement(null);

      const event = new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true });
      nav.dispatchEvent(event);

      expect(getActiveElement()).toBe(links[2]);
    });

    it("should ignore unhandled keys", () => {
      const { nav, links } = setupNavWithLinks(3);
      setActiveElement(links[0]);

      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      nav.dispatchEvent(event);

      // Focus should remain unchanged — no focus() call made
      expect(getActiveElement()).toBe(links[0]);
    });

    it("should handle keyboard nav when no menu links exist", () => {
      wrapper = mountNavbar();
      const nav = wrapper.find('[data-test="navbar-main-nav"]').element;
      while (nav.firstChild) nav.removeChild(nav.firstChild);

      const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true });
      expect(() => nav.dispatchEvent(event)).not.toThrow();
    });
  });

  describe("menu-hover emit", () => {
    it("should emit menu-hover when a menu link is hovered", async () => {
      wrapper = mountNavbar();
      const link = wrapper.find('[data-test="menu-link-logs-item"]');
      await link.trigger("mouseenter");
      expect(wrapper.emitted("menu-hover")).toBeTruthy();
      expect(wrapper.emitted("menu-hover")![0]).toEqual(["/logs"]);
    });
  });

  describe("props", () => {
    it("should default miniMode to false", () => {
      wrapper = mountNavbar();
      const link = wrapper.findComponent('[data-test="menu-link-home-item"]');
      expect(link.props("mini")).toBe(false);
    });

    it("should default visible to true", () => {
      wrapper = mountNavbar();
      expect(wrapper.find('[data-test="navbar-main-nav"]').isVisible()).toBe(true);
    });
  });
});
