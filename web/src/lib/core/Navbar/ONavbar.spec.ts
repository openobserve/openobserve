// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createI18n } from "vue-i18n";
import ONavbar from "./ONavbar.vue";
import type { NavItem } from "./ONavbar.types";

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/", component: { template: "<div />" } }],
});

// Minimal i18n so ONavbar's useI18n()/group-title t() resolve (keys echo back).
const i18n = createI18n({
  locale: "en",
  legacy: false,
  messages: { en: {} },
  missingWarn: false,
  fallbackWarn: false,
});

// All daily-use (top-level) names — none of these belong to a flyout group, so
// each renders as a standalone MenuLink. See navGroups.ts for membership.
const mockLinks: NavItem[] = [
  { title: "Home", icon: "home", link: "/home", name: "home" },
  { title: "Logs", icon: "list", link: "/logs", name: "logs" },
  { title: "Metrics", icon: "bar-chart", link: "/metrics", name: "metrics" },
];

const menuLinkStub = {
  template:
    '<a :data-test="\'menu-link-\' + linkName + \'-item\'" @mouseenter="$emit(\'menu-hover\', link)"><slot /></a>',
  props: ["linkName", "mini", "title", "icon", "link", "name", "exact", "display", "hide"],
  emits: ["menu-hover"],
  inheritAttrs: true,
};

// Lightweight ONavGroup stub — surfaces the group key, its children, and whether
// it was rendered in link+subnav mode (parentItem) so we can assert ONavbar
// wires entries correctly without a vuex store or the real flyout machinery.
const navGroupStub = {
  template:
    '<div :data-test="\'nav-group-\' + groupKey" :data-children="children.map(c => c.name).join(\',\')" :data-mode="parentItem ? \'link\' : \'group\'" />',
  props: ["groupKey", "title", "icon", "children", "parentItem"],
};

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
        plugins: [router, i18n],
        stubs: {
          "menu-link": menuLinkStub,
          ONavGroup: navGroupStub,
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
      expect(wrapper.find('[data-test="menu-link-metrics-item"]').exists()).toBe(true);
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

  describe("grouping", () => {
    it("absorbs streams+pipeline into Data; RUM stays top-level", () => {
      wrapper = mountNavbar({
        linksList: [
          { title: "Home", icon: "home", link: "/home", name: "home" },
          { title: "Logs", icon: "list", link: "/logs", name: "logs" },
          { title: "RUM", icon: "devices", link: "/rum", name: "rum" },
          { title: "Streams", icon: "window", link: "/streams", name: "streams" },
          { title: "Pipeline", icon: "graph-2", link: "/pipeline", name: "pipeline" },
        ],
      });

      // RUM is a top-level link.
      expect(wrapper.find('[data-test="menu-link-rum-item"]').exists()).toBe(true);
      // Streams and Pipeline are absorbed into Data — not top-level links.
      expect(wrapper.find('[data-test="menu-link-streams-item"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="menu-link-pipeline-item"]').exists()).toBe(false);

      const data = wrapper.find('[data-test="nav-group-data"]');
      expect(data.exists()).toBe(true);
      // Data behaves like a link+subnav tile (click navigates, hover reveals).
      expect(data.attributes("data-mode")).toBe("link");
      expect(data.attributes("data-children")).toBe(
        "logstreams,pipelines,functionList,enrichmentTables",
      );
    });

    it("keeps Alerts and Reports as separate top-level links", () => {
      wrapper = mountNavbar({
        linksList: [
          { title: "Home", icon: "home", link: "/home", name: "home" },
          { title: "Alerts", icon: "shield-alert-outline", link: "/alerts", name: "alertList" },
          { title: "Reports", icon: "description", link: "/reports", name: "reports" },
        ],
      });

      expect(wrapper.find('[data-test="menu-link-alertList-item"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="menu-link-reports-item"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="nav-group-monitoring"]').exists()).toBe(false);
    });

    it("renders IAM / Management / AI as plain links (no submenu)", () => {
      wrapper = mountNavbar({
        linksList: [
          { title: "Home", icon: "home", link: "/home", name: "home" },
          { title: "IAM", icon: "manage-accounts", link: "/iam", name: "iam" },
          { title: "Management", icon: "settings", link: "/settings", name: "settings" },
          { title: "AI", icon: "auto-awesome", link: "/ai", name: "aiObservability" },
        ],
      });
      // Plain top-level links …
      expect(wrapper.find('[data-test="menu-link-iam-item"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="menu-link-settings-item"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="menu-link-aiObservability-item"]').exists()).toBe(true);
      // … not flyout groups.
      expect(wrapper.find('[data-test="nav-group-iam"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="nav-group-settings"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="nav-group-aiObservability"]').exists()).toBe(false);
    });

    it("drops the Data group entirely when no data items are present", () => {
      wrapper = mountNavbar(); // only home/logs/metrics
      expect(wrapper.find('[data-test="nav-group-data"]').exists()).toBe(false);
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
