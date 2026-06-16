// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import ONavbar from "./ONavbar.vue";
import type { NavItem } from "./ONavbar.types";

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/", component: { template: "<div />" } }],
});

const mockLinks: NavItem[] = [
  { title: "Home", icon: "home", link: "/home", name: "home", group: "observe" },
  { title: "Logs", icon: "list", link: "/logs", name: "logs", group: "observe" },
  { title: "Dashboards", icon: "dashboard", link: "/dashboards", name: "dashboards", group: "analyze" },
  { title: "Settings", icon: "settings", link: "/settings", name: "settings", group: "admin" },
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
        plugins: [router],
        stubs: {
          "menu-link": {
            template:
              '<a class="q-item" :data-test="\'menu-link-\' + linkName + \'-item\'" @mouseenter="$emit(\'menu-hover\', link)"><slot /></a>',
            props: ["linkName", "mini", "animationIndex", "title", "icon", "link", "name", "exact", "display", "hide", "group"],
            emits: ["menu-hover"],
            inheritAttrs: true,
          },
          "OIcon": { template: '<span />', props: ["name", "size"] },
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
      expect(links).toHaveLength(4);
    });

    it("should render menu links with correct link names", () => {
      wrapper = mountNavbar();
      expect(wrapper.find('[data-test="menu-link-home-item"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="menu-link-logs-item"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="menu-link-dashboards-item"]').exists()).toBe(true);
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

  describe("group labels", () => {
    it("renders group label for observe group", () => {
      wrapper = mountNavbar();
      expect(wrapper.find('[data-test="navbar-group-observe"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="navbar-group-observe"]').text()).toContain("Observe");
    });

    it("renders group label for analyze group", () => {
      wrapper = mountNavbar();
      expect(wrapper.find('[data-test="navbar-group-analyze"]').exists()).toBe(true);
    });

    it("renders group label for admin group", () => {
      wrapper = mountNavbar();
      expect(wrapper.find('[data-test="navbar-group-admin"]').exists()).toBe(true);
    });

    it("does not render manage group label when no manage items exist", () => {
      wrapper = mountNavbar();
      // mockLinks has no manage items
      expect(wrapper.find('[data-test="navbar-group-manage"]').exists()).toBe(false);
    });

    it("renders items under their correct group — observe label comes before logs link", () => {
      wrapper = mountNavbar();
      const allDataTests = wrapper.findAll('[data-test]').map((el) => el.attributes('data-test'));
      const observeIdx = allDataTests.indexOf('navbar-group-observe');
      const logsIdx = allDataTests.indexOf('menu-link-logs-item');
      expect(observeIdx).toBeGreaterThanOrEqual(0);
      expect(logsIdx).toBeGreaterThanOrEqual(0);
      expect(observeIdx).toBeLessThan(logsIdx);
    });
  });

  describe("logo and footer", () => {
    it("renders logo when logoSrc is provided", () => {
      wrapper = mountNavbar({ logoSrc: "/logo.svg" });
      const logo = wrapper.find('[data-test="navbar-logo"]');
      expect(logo.exists()).toBe(true);
      expect(logo.attributes("src")).toBe("/logo.svg");
    });

    it("does not render logo when logoSrc is not provided", () => {
      wrapper = mountNavbar();
      expect(wrapper.find('[data-test="navbar-logo"]').exists()).toBe(false);
    });

    it("renders org switcher when orgName is provided", () => {
      wrapper = mountNavbar({ orgName: "my-org" });
      const switcher = wrapper.find('[data-test="navbar-org-switcher"]');
      expect(switcher.exists()).toBe(true);
      expect(switcher.text()).toContain("my-org");
    });

    it("emits go-to-home when logo is clicked", async () => {
      wrapper = mountNavbar({ logoSrc: "/logo.svg" });
      await wrapper.find('[data-test="navbar-logo"]').trigger("click");
      expect(wrapper.emitted("go-to-home")).toBeTruthy();
    });

    it("renders AI chat toggle when isAiEnabled is true", () => {
      wrapper = mountNavbar({ isAiEnabled: true });
      expect(wrapper.find('[data-test="navbar-ai-chat-toggle"]').exists()).toBe(true);
    });

    it("does not render AI chat toggle when isAiEnabled is false", () => {
      wrapper = mountNavbar({ isAiEnabled: false });
      expect(wrapper.find('[data-test="navbar-ai-chat-toggle"]').exists()).toBe(false);
    });

    it("emits toggle-ai-chat when AI button is clicked", async () => {
      wrapper = mountNavbar({ isAiEnabled: true });
      await wrapper.find('[data-test="navbar-ai-chat-toggle"]').trigger("click");
      expect(wrapper.emitted("toggle-ai-chat")).toBeTruthy();
    });

    it("renders user section when userName is provided", () => {
      wrapper = mountNavbar({ userName: "Ashish K.", userEmail: "ashish@openobserve.ai" });
      const userMenu = wrapper.find('[data-test="navbar-user-menu"]');
      expect(userMenu.exists()).toBe(true);
      expect(userMenu.text()).toContain("Ashish K.");
    });

    it("renders theme toggle button", () => {
      wrapper = mountNavbar();
      expect(wrapper.find('[data-test="navbar-theme-toggle"]').exists()).toBe(true);
    });

    it("emits open-predefined-themes when theme button is clicked", async () => {
      wrapper = mountNavbar();
      await wrapper.find('[data-test="navbar-theme-toggle"]').trigger("click");
      expect(wrapper.emitted("open-predefined-themes")).toBeTruthy();
    });

    it("renders slack button", () => {
      wrapper = mountNavbar();
      expect(wrapper.find('[data-test="navbar-slack"]').exists()).toBe(true);
    });

    it("emits open-slack when slack button is clicked", async () => {
      wrapper = mountNavbar();
      await wrapper.find('[data-test="navbar-slack"]').trigger("click");
      expect(wrapper.emitted("open-slack")).toBeTruthy();
    });

    it("renders help button", () => {
      wrapper = mountNavbar();
      expect(wrapper.find('[data-test="navbar-help"]').exists()).toBe(true);
    });

    it("emits open-help when help button is clicked", async () => {
      wrapper = mountNavbar();
      await wrapper.find('[data-test="navbar-help"]').trigger("click");
      expect(wrapper.emitted("open-help")).toBeTruthy();
    });
  });

  describe("keyboard navigation", () => {
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
      nav.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      expect(getActiveElement()).toBe(links[1]);
    });

    it("should wrap to first link when ArrowDown on last link", () => {
      const { nav, links } = setupNavWithLinks(3);
      setActiveElement(links[2]);
      nav.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      expect(getActiveElement()).toBe(links[0]);
    });

    it("should move focus to previous link on ArrowUp", () => {
      const { nav, links } = setupNavWithLinks(3);
      setActiveElement(links[1]);
      nav.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      expect(getActiveElement()).toBe(links[0]);
    });

    it("should wrap to last link when ArrowUp on first link", () => {
      const { nav, links } = setupNavWithLinks(3);
      setActiveElement(links[0]);
      nav.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      expect(getActiveElement()).toBe(links[2]);
    });

    it("should focus first link on ArrowDown when no link is focused", () => {
      const { nav, links } = setupNavWithLinks(3);
      setActiveElement(null);
      nav.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      expect(getActiveElement()).toBe(links[0]);
    });

    it("should focus last link on ArrowUp when no link is focused", () => {
      const { nav, links } = setupNavWithLinks(3);
      setActiveElement(null);
      nav.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
      expect(getActiveElement()).toBe(links[2]);
    });

    it("should ignore unhandled keys", () => {
      const { nav, links } = setupNavWithLinks(3);
      setActiveElement(links[0]);
      nav.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(getActiveElement()).toBe(links[0]);
    });

    it("should handle keyboard nav when no menu links exist", () => {
      wrapper = mountNavbar();
      const nav = wrapper.find('[data-test="navbar-main-nav"]').element;
      while (nav.firstChild) nav.removeChild(nav.firstChild);
      expect(() => nav.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))).not.toThrow();
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
