// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { computed, inject } from "vue";
import { createRouter, createMemoryHistory, useRoute } from "vue-router";
import ONavbar from "./ONavbar.vue";
import { RailNavigationMarkKey, type NavItem } from "./ONavbar.types";

// Breakpoint and paywall are app state; the spec drives both directly.
const { mobile, paywalled } = vi.hoisted(() => ({
  // `set` is filled in by the mock factory once the module is first imported.
  mobile: { set: (_value: boolean) => {} },
  paywalled: new Set<string>(),
}));
vi.mock("@/composables/useBreakpoint", async () => {
  const { computed, ref } = await import("vue");
  const flag = ref(false);
  mobile.set = (value: boolean) => {
    flag.value = value;
  };
  return {
    default: () => ({
      isMobile: computed(() => flag.value),
      isTablet: computed(() => false),
      isDesktop: computed(() => !flag.value),
      mdUp: computed(() => !flag.value),
      lgUp: computed(() => !flag.value),
    }),
  };
});
vi.mock("@/composables/useTrialPaywall", () => ({
  useTrialPaywall: () => ({ isPaywalled: (to: unknown) => paywalled.has(String(to)) }),
}));

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/", component: { template: "<div />" } }],
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
    "<a :data-test=\"'menu-link-' + linkName + '-item'\" :data-paywalled=\"paywalled || undefined\" @mouseenter=\"$emit('menu-hover', link)\"><slot /></a>",
  props: [
    "linkName",
    "mini",
    "title",
    "icon",
    "link",
    "name",
    "exact",
    "display",
    "hide",
    "paywalled",
  ],
  emits: ["menu-hover"],
  inheritAttrs: true,
};

// Lightweight ONavGroup stub — surfaces the group key, its children, and whether
// it was rendered in link+subnav mode (parentItem) so we can assert ONavbar
// wires entries correctly without a vuex store or the real flyout machinery.
const navGroupStub = {
  template:
    "<div :data-test=\"'nav-group-' + groupKey\" :data-children=\"children.map(c => c.name).join(',')\" :data-filtered=\"(filteredChildren || []).map(c => c.name).join(',')\" :data-mode=\"parentItem ? 'link' : 'group'\" />",
  props: ["groupKey", "title", "icon", "children", "filteredChildren", "parentItem"],
};

describe("ONavbar", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
    mobile.set(false);
    paywalled.clear();
    document.body.innerHTML = "";
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

    it("renders no tiles — not even the standalone Infra group — while linksList is empty", () => {
      // Regression: MainLayout keeps `visible` at its default `true` and drives
      // content purely through `linksList`, holding it at `[]` until config
      // settles (menuReady). Infra's default children carry no `requires`, so
      // before the navGroups.ts empty-input guard it would still render alone
      // on refresh — every other group needs an absorbed item to be present.
      wrapper = mountNavbar({ linksList: [] });
      expect(wrapper.findAll('[data-test^="menu-link-"]')).toHaveLength(0);
      expect(wrapper.findAll('[data-test^="nav-group-"]')).toHaveLength(0);
    });

    it("passes the paywall verdict for each plain link's destination to its tile", () => {
      paywalled.add("/logs");
      wrapper = mountNavbar();
      expect(wrapper.find('[data-test="menu-link-logs-item"]').attributes("data-paywalled")).toBe(
        "true",
      );
      expect(
        wrapper.find('[data-test="menu-link-home-item"]').attributes("data-paywalled"),
      ).toBeUndefined();
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
      // The children `requires` removed still reach the group.
      expect(data.attributes("data-filtered")).toBe("workflows,ingestion");
    });

    it("collapses Alerts into Reliability and leaves Reports a separate link", () => {
      wrapper = mountNavbar({
        linksList: [
          { title: "Home", icon: "home", link: "/home", name: "home" },
          { title: "Alerts", icon: "shield-alert-outline", link: "/alerts", name: "alertList" },
          { title: "Reports", icon: "description", link: "/reports", name: "reports" },
        ],
      });

      // Alerts brings Destinations/Templates with it, so it is a group tile
      // rather than a bare link; Dashboards is absent so Reports stays a link.
      // On-Call rides in the same group with its own three entries — Pages,
      // Teams and Routing — since a storeless mount has every gate open.
      expect(wrapper.find('[data-test="menu-link-alertList-item"]').exists()).toBe(false);
      const reliability = wrapper.find('[data-test="nav-group-reliability"]');
      expect(reliability.exists()).toBe(true);
      expect(reliability.attributes("data-children")).toBe(
        "alertList,alertDestinations,alertTemplates,alertLibrary,onCallResponses,onCallTeams,onCallRouting",
      );
      expect(reliability.attributes("data-filtered")).toBe("sloList,incidentList,alertSources");
      expect(wrapper.find('[data-test="menu-link-reports-item"]').exists()).toBe(true);
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
      activeElementSpy = vi
        .spyOn(document, "activeElement", "get")
        .mockImplementation(() => activeEl as Element);
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

    describe("Tab and Shift+Tab (AC-7)", () => {
      let rectsSpy: ReturnType<typeof vi.spyOn>;

      beforeEach(() => {
        // jsdom lays nothing out: an element has rects exactly when it is not display:none.
        rectsSpy = vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (
          this: Element,
        ) {
          const hidden = getComputedStyle(this).display === "none";
          return (hidden ? [] : [{}]) as unknown as DOMRectList;
        });
        document.body.innerHTML = `
          <header class="o2-app-header">
            <button data-test="hamburger" style="display: none">menu</button>
            <a data-test="header-openobserve-logo" href="/web/">logo</a>
            <button data-test="menu-link-ai-item">ai</button>
          </header>
          <div class="o2-content-scroll"><input data-test="content-input" /></div>`;
      });

      afterEach(() => rectsSpy.mockRestore());

      it("Tab from a rail tile focuses the first focusable in the content area", () => {
        const { nav, links } = setupNavWithLinks(3);
        setActiveElement(links[2]);
        nav.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
        expect(getActiveElement()?.getAttribute("data-test")).toBe("content-input");
      });

      it("Shift+Tab focuses the first VISIBLE header control, skipping the hidden hamburger, in 1 key press", () => {
        const { nav, links } = setupNavWithLinks(3);
        setActiveElement(links[2]);
        nav.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
        );
        expect(getActiveElement()?.getAttribute("data-test")).toBe("header-openobserve-logo");
      });

      it("Shift+Tab reaches the hamburger when it is visible", () => {
        (document.querySelector('[data-test="hamburger"]') as HTMLElement).style.display = "";
        const { nav, links } = setupNavWithLinks(3);
        setActiveElement(links[0]);
        nav.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
        );
        expect(getActiveElement()?.getAttribute("data-test")).toBe("hamburger");
      });

      it("leaves focus on the tile without an error when no visible header control exists", () => {
        document.querySelector("header")!.remove();
        const { nav, links } = setupNavWithLinks(3);
        setActiveElement(links[1]);
        expect(() =>
          nav.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
          ),
        ).not.toThrow();
        expect(getActiveElement()).toBe(links[1]);
      });
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

  // A 1000x600 window: a 560 px rail holding twelve 52 px tiles, so the last two sit below the fold.
  describe("short screens (AC-5, AC-6)", () => {
    const TILE = 52;
    const RAIL_TOP = 40;
    const RAIL_BOTTOM = 600;
    const CLIENT_H = RAIL_BOTTOM - RAIL_TOP;
    const names = [
      "home",
      "logs",
      "metrics",
      "x5",
      "ai",
      "x1",
      "x2",
      "x3",
      "iam",
      "x4",
      "plans",
      "settings",
    ];
    const links: NavItem[] = names.map((n) => ({ title: n, icon: "x", link: `/${n}`, name: n }));
    const MAX_SCROLL = names.length * TILE - CLIENT_H;
    const rect = (top: number, bottom: number) =>
      ({ left: 0, top, right: 88, bottom, width: 88, height: bottom - top }) as DOMRect;

    // Active class from the route, like the real tile, plus a real href for the mark.
    const activeTileStub = {
      props: [
        "linkName",
        "mini",
        "title",
        "icon",
        "link",
        "name",
        "exact",
        "display",
        "hide",
        "paywalled",
      ],
      setup(props: { link: string }) {
        const route = useRoute();
        return { isActive: computed(() => route.path === props.link) };
      },
      template:
        "<a :href=\"link\" :data-test=\"'menu-link-' + linkName + '-item'\" :class=\"{ 'nav-menu-item--active': isActive }\">{{ title }}</a>",
    };

    // A teleported flyout cannot bubble to the rail, so it marks through the injected function.
    const markingGroupStub = {
      props: ["groupKey", "title", "icon", "children", "filteredChildren", "parentItem"],
      setup() {
        return { mark: inject(RailNavigationMarkKey) };
      },
      template:
        '<div :data-test="\'nav-group-\' + groupKey"><a :data-test="\'flyout-\' + groupKey" href="/settings" @click.prevent="mark && mark($event)">x</a></div>',
    };

    function shortRouter() {
      return createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: "/", component: { template: "<div />" } },
          ...names.map((n) => ({
            path: `/${n}`,
            name: n,
            component: { template: "<div />" },
            // The paywall guard's shape: a blocked destination lands on Plans.
            ...(n === "logs" ? { beforeEnter: () => ({ path: "/plans" }) } : {}),
          })),
        ],
      });
    }

    let nav: HTMLElement;
    let shortRouterInstance: ReturnType<typeof createRouter>;

    function layout() {
      let scrollTop = 0;
      Object.defineProperty(nav, "scrollTop", {
        configurable: true,
        get: () => scrollTop,
        set: (v: number) => {
          scrollTop = v;
        },
      });
      Object.defineProperty(nav, "scrollHeight", {
        configurable: true,
        get: () => names.length * TILE,
      });
      Object.defineProperty(nav, "clientHeight", { configurable: true, get: () => CLIENT_H });
      nav.getBoundingClientRect = () => rect(RAIL_TOP, RAIL_BOTTOM);
      nav.querySelectorAll<HTMLElement>("a[data-test^='menu-link-']").forEach((a, i) => {
        a.getBoundingClientRect = () =>
          rect(RAIL_TOP + i * TILE - scrollTop, RAIL_TOP + (i + 1) * TILE - scrollTop);
      });
    }

    async function mountShort(extraLinks: NavItem[] = []) {
      shortRouterInstance = shortRouter();
      await shortRouterInstance.push("/");
      wrapper = mount(ONavbar, {
        props: { linksList: [...links, ...extraLinks] },
        attachTo: document.body,
        global: {
          plugins: [shortRouterInstance],
          stubs: { "menu-link": activeTileStub, ONavGroup: markingGroupStub },
        },
      });
      await flushPromises();
      nav = wrapper.find('[data-test="navbar-main-nav"]').element as HTMLElement;
      layout();
    }

    const tile = (name: string) =>
      nav.querySelector<HTMLAnchorElement>(`[data-test="menu-link-${name}-item"]`)!;

    function clickTile(name: string, init: MouseEventInit = {}) {
      tile(name).dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }),
      );
    }

    it("a URL open of a tile below the fold scrolls the rail so the tile is clear of the fade", async () => {
      await mountShort();
      await shortRouterInstance.push("/settings");
      await flushPromises();
      expect(nav.scrollTop).toBe(MAX_SCROLL);
      expect(nav.getAttribute("data-overflow-top")).toBe("true");
      expect(nav.getAttribute("data-overflow-bottom")).toBeNull();
    });

    it("reveals again once the web fonts are ready, so a pre-font layout cannot leave the tile under the fade", async () => {
      let resolveFonts: () => void = () => {};
      const ready = new Promise<void>((resolve) => {
        resolveFonts = resolve;
      });
      Object.defineProperty(document, "fonts", { configurable: true, value: { ready } });
      shortRouterInstance = shortRouter();
      await shortRouterInstance.push("/settings");
      wrapper = mount(ONavbar, {
        props: { linksList: links },
        attachTo: document.body,
        global: {
          plugins: [shortRouterInstance],
          stubs: { "menu-link": activeTileStub, ONavGroup: markingGroupStub },
        },
      });
      await flushPromises();
      nav = wrapper.find('[data-test="navbar-main-nav"]').element as HTMLElement;
      // Geometry only becomes measurable now, as if the font had just landed.
      layout();
      expect(nav.scrollTop).toBe(0);
      resolveFonts();
      await ready;
      await flushPromises();
      expect(nav.scrollTop).toBe(MAX_SCROLL);
      delete (document as Partial<Document>).fonts;
    });

    it("leaves scrollTop alone when the active tile is already visible", async () => {
      await mountShort();
      await shortRouterInstance.push("/metrics");
      await flushPromises();
      expect(nav.scrollTop).toBe(0);
    });

    it("a rail click redirected by beforeEnter to a tile below the fold leaves scrollTop unchanged (R-1)", async () => {
      await mountShort();
      clickTile("logs");
      await shortRouterInstance.push("/logs");
      await flushPromises();
      expect(shortRouterInstance.currentRoute.value.path).toBe("/plans");
      expect(tile("plans").classList.contains("nav-menu-item--active")).toBe(true);
      expect(nav.scrollTop).toBe(0);
    });

    it("a keyboard activation (click detail 0) is a rail click too", async () => {
      await mountShort();
      clickTile("logs", { detail: 0 });
      await shortRouterInstance.push("/logs");
      await flushPromises();
      expect(nav.scrollTop).toBe(0);
    });

    it("a rail click on a half-faded tile leaves it where the pointer is (G-3)", async () => {
      await mountShort();
      nav.scrollTop = 30;
      clickTile("x4");
      await shortRouterInstance.push("/x4");
      await flushPromises();
      expect(nav.scrollTop).toBe(30);
    });

    it("a flyout-item click marks through the injected function", async () => {
      await mountShort([
        { title: "Streams", icon: "x", link: "/streams", name: "streams" },
        { title: "Pipeline", icon: "x", link: "/pipeline", name: "pipeline" },
      ]);
      wrapper
        .find('[data-test="flyout-data"]')
        .element.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
        );
      await shortRouterInstance.push("/settings");
      await flushPromises();
      expect(nav.scrollTop).toBe(0);
    });

    it("a stale mark for a different path still reveals", async () => {
      await mountShort();
      clickTile("metrics");
      await shortRouterInstance.push("/settings");
      await flushPromises();
      expect(nav.scrollTop).toBe(MAX_SCROLL);
    });

    it("a duplicate navigation consumes the mark, so it cannot outlive its click (A-34)", async () => {
      await mountShort();
      clickTile("settings");
      await shortRouterInstance.push("/settings");
      await flushPromises();
      expect(nav.scrollTop).toBe(0);
      await shortRouterInstance.push("/");
      await shortRouterInstance.push("/settings");
      await flushPromises();
      expect(nav.scrollTop).toBe(MAX_SCROLL);
    });

    it("never reveals in the mobile drawer (D-36)", async () => {
      mobile.set(true);
      await mountShort();
      await shortRouterInstance.push("/settings");
      await flushPromises();
      expect(nav.scrollTop).toBe(0);
      expect(nav.getAttribute("data-overflow-bottom")).toBeNull();
    });

    it("moves a keyboard-focused tile out of the bottom fade, and ignores mouse focus (R-3)", async () => {
      await mountShort();
      const target = tile("x4");
      target.matches = (selector: string) => selector === ":focus-visible";
      target.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      // x4 sits at 508..560, 8 px under the 48 px bottom fade (clear band ends at 552).
      expect(nav.scrollTop).toBe(8);

      nav.scrollTop = 0;
      target.matches = () => false;
      target.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      expect(nav.scrollTop).toBe(0);
    });

    it("sets the overflow attributes from scroll position and clears them when nothing overflows", async () => {
      await mountShort();
      nav.dispatchEvent(new Event("scroll"));
      await flushPromises();
      expect(nav.getAttribute("data-overflow-top")).toBeNull();
      expect(nav.getAttribute("data-overflow-bottom")).toBe("true");

      nav.scrollTop = 30;
      nav.dispatchEvent(new Event("scroll"));
      await flushPromises();
      expect(nav.getAttribute("data-overflow-top")).toBe("true");
      expect(nav.getAttribute("data-overflow-bottom")).toBe("true");

      nav.scrollTop = MAX_SCROLL;
      nav.dispatchEvent(new Event("scroll"));
      await flushPromises();
      expect(nav.getAttribute("data-overflow-top")).toBe("true");
      expect(nav.getAttribute("data-overflow-bottom")).toBeNull();

      Object.defineProperty(nav, "scrollHeight", { configurable: true, get: () => CLIENT_H });
      nav.scrollTop = 0;
      nav.dispatchEvent(new Event("scroll"));
      await flushPromises();
      expect(nav.getAttribute("data-overflow-top")).toBeNull();
      expect(nav.getAttribute("data-overflow-bottom")).toBeNull();
    });
  });
});
