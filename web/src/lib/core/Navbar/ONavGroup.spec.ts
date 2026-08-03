// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import ONavGroup from "./ONavGroup.vue";
import type { SubnavChild } from "./ONavbar.types";

// Hover debounce delays — keep in sync with OPEN_DELAY / CLOSE_DELAY in
// ONavGroup.vue. The tests drive them with fake timers.
const OPEN_DELAY = 120;
const CLOSE_DELAY = 220;

const children: SubnavChild[] = [
  { titleKey: "menu.streams", icon: "table", name: "logstreams" },
  { titleKey: "menu.pipeline", icon: "graph-2", name: "pipelines" },
];

// Children are gated by router.hasRoute(), so their routes must be registered.
function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div />" } },
      { path: "/streams", name: "logstreams", component: { template: "<div />" } },
      { path: "/pipelines", name: "pipelines", component: { template: "<div />" } },
    ],
  });
}

const store = createStore({
  state: () => ({
    theme: "light",
    zoConfig: {},
    organizationData: {},
    selectedOrganization: { identifier: "default" },
  }),
});

const i18n = createI18n({
  locale: "en",
  legacy: false,
  messages: { en: {} },
  missingWarn: false,
  fallbackWarn: false,
});

// The tile — forwards click/keydown like the real MenuLink without rendering
// its internals (which would need the full icon registry).
const menuLinkStub = {
  template:
    '<a data-test="tile" href="#" @click.prevent="$emit(\'click\')" @keydown="$emit(\'keydown\', $event)">{{ title }}</a>',
  props: ["submenu", "asTrigger", "title", "icon", "link", "active", "expanded", "mini"],
  emits: ["click", "keydown"],
};

const oIconStub = { template: "<span />", props: ["name", "size"] };

describe("ONavGroup", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function mountGroup() {
    return mount(ONavGroup, {
      props: {
        groupKey: "data",
        title: "Data",
        icon: "database",
        children,
        // Link+subnav mode — the tile navigates, the flyout is hover-driven.
        parentItem: { link: "/streams", title: "Data", icon: "database", name: "logstreams" },
      },
      global: {
        plugins: [makeRouter(), store, i18n],
        // Teleport is stubbed so the flyout renders inline and wrapper.find works.
        stubs: { MenuLink: menuLinkStub, OIcon: oIconStub, teleport: true },
      },
    });
  }

  function flyout() {
    return wrapper.find('[data-test="nav-group-flyout-data"]');
  }

  async function hoverOpen() {
    await wrapper.trigger("mouseenter");
    vi.advanceTimersByTime(OPEN_DELAY);
    await flushPromises();
  }

  it("opens the flyout after hovering the tile for the open delay", async () => {
    wrapper = mountGroup();
    expect(flyout().exists()).toBe(false);

    await wrapper.trigger("mouseenter");
    // Still within the debounce window — not open yet.
    vi.advanceTimersByTime(OPEN_DELAY - 1);
    await flushPromises();
    expect(flyout().exists()).toBe(false);

    vi.advanceTimersByTime(1);
    await flushPromises();
    expect(flyout().exists()).toBe(true);
  });

  it("renders only children whose routes are registered", async () => {
    wrapper = mountGroup();
    await wrapper.setProps({
      children: [...children, { titleKey: "menu.ghost", icon: "x", name: "notARoute" }],
    });
    await hoverOpen();

    expect(flyout().find('[data-test="nav-group-item-logstreams"]').exists()).toBe(true);
    expect(flyout().find('[data-test="nav-group-item-pipelines"]').exists()).toBe(true);
    expect(flyout().find('[data-test="nav-group-item-notARoute"]').exists()).toBe(false);
  });

  // Regression: clicking the tile used to close() the flyout while the pointer
  // was still inside the tile — mouseenter could never re-fire, so the submenu
  // was unreachable until the user moved the mouse away and back.
  it("keeps the flyout open when the tile is clicked (link mode)", async () => {
    wrapper = mountGroup();
    await hoverOpen();
    expect(flyout().exists()).toBe(true);

    await wrapper.find('[data-test="tile"]').trigger("click");
    await flushPromises();
    expect(flyout().exists()).toBe(true);
  });

  it("opens the flyout immediately when the tile is clicked during the hover delay", async () => {
    wrapper = mountGroup();
    await wrapper.trigger("mouseenter");
    // Click lands before the 120ms hover debounce elapses.
    vi.advanceTimersByTime(OPEN_DELAY / 2);
    await flushPromises();
    expect(flyout().exists()).toBe(false);

    await wrapper.find('[data-test="tile"]').trigger("click");
    await flushPromises();
    expect(flyout().exists()).toBe(true);
  });

  it("closes the flyout after the pointer leaves the tile", async () => {
    wrapper = mountGroup();
    await hoverOpen();

    await wrapper.trigger("mouseleave");
    vi.advanceTimersByTime(CLOSE_DELAY);
    await flushPromises();
    expect(flyout().exists()).toBe(false);
  });

  it("does not close while the pointer moves from the tile onto the flyout", async () => {
    wrapper = mountGroup();
    await hoverOpen();

    // Leaving the tile schedules the close; entering the flyout cancels it.
    await wrapper.trigger("mouseleave");
    await flyout().trigger("mouseenter");
    vi.advanceTimersByTime(CLOSE_DELAY);
    await flushPromises();
    expect(flyout().exists()).toBe(true);
  });

  it("closes the flyout when a child item is clicked", async () => {
    wrapper = mountGroup();
    await hoverOpen();

    await flyout().find('[data-test="nav-group-item-pipelines"]').trigger("click");
    await flushPromises();
    expect(flyout().exists()).toBe(false);
  });

  it("closes the flyout on Escape from the tile", async () => {
    wrapper = mountGroup();
    await hoverOpen();

    await wrapper.find('[data-test="tile"]').trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(flyout().exists()).toBe(false);
  });

  // Exactly one row may be active. Destinations/Templates are SIBLINGS of
  // Alerts, not sub-pages, so their paths are top-level and flat — that is what
  // keeps them unambiguous. The deepest-match rule below is the second line of
  // defence for genuinely nested sections.
  describe("active state across sibling sections", () => {
    const reliabilityChildren: SubnavChild[] = [
      { titleKey: "menu.alerts", icon: "shield-alert-outline", name: "alertList" },
      { titleKey: "alert_destinations.header", icon: "location-on", name: "alertDestinations" },
      { titleKey: "alert_templates.header", icon: "description", name: "alertTemplates" },
    ];

    function makeReliabilityRouter() {
      return createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: "/", name: "home", component: { template: "<div />" } },
          { path: "/alerts", name: "alertList", component: { template: "<div />" } },
          {
            path: "/alert-destinations",
            name: "alertDestinations",
            component: { template: "<div />" },
          },
          {
            path: "/alert-templates",
            name: "alertTemplates",
            component: { template: "<div />" },
          },
          // A real drill-down under Alerts — this one SHOULD mark Alerts.
          {
            path: "/alerts/detail/:id",
            name: "alertDetail",
            component: { template: "<div />" },
          },
        ],
      });
    }

    async function mountAt(path: string, children = reliabilityChildren) {
      const router = makeReliabilityRouter();
      router.push(path);
      await router.isReady();
      const w = mount(ONavGroup, {
        props: {
          groupKey: "reliability",
          title: "Reliability",
          icon: "shield",
          children,
          parentItem: {
            link: "/alerts",
            title: "Reliability",
            icon: "shield",
            name: "alertList",
          },
        },
        global: {
          plugins: [router, store, i18n],
          stubs: { MenuLink: menuLinkStub, OIcon: oIconStub, teleport: true },
        },
      });
      await w.trigger("mouseenter");
      vi.advanceTimersByTime(OPEN_DELAY);
      await flushPromises();
      return w;
    }

    function activeNames(w: VueWrapper): string[] {
      return w
        .findAll('[data-test^="nav-group-item-"]')
        .filter((el) => el.attributes("aria-current") === "page")
        .map((el) => el.attributes("data-test")!.replace("nav-group-item-", ""));
    }

    it("marks only Notification Destinations on /alert-destinations", async () => {
      wrapper = await mountAt("/alert-destinations");
      expect(activeNames(wrapper)).toEqual(["alertDestinations"]);
    });

    it("marks only Templates on /alert-templates", async () => {
      wrapper = await mountAt("/alert-templates");
      expect(activeNames(wrapper)).toEqual(["alertTemplates"]);
    });

    it("marks only Alerts on /alerts", async () => {
      wrapper = await mountAt("/alerts");
      expect(activeNames(wrapper)).toEqual(["alertList"]);
    });

    it("attributes an alert drill-down to Alerts", async () => {
      wrapper = await mountAt("/alerts/detail/abc");
      expect(activeNames(wrapper)).toEqual(["alertList"]);
    });

    // Guard for any future section that IS nested under a sibling: the deepest
    // matching path wins, so the ancestor no longer lights up alongside it.
    it("gives a nested section to itself, not to its ancestor", async () => {
      wrapper = await mountAt("/alerts/detail/abc", [
        { titleKey: "menu.alerts", icon: "shield-alert-outline", name: "alertList" },
        { titleKey: "menu.alerts", icon: "shield-alert-outline", name: "alertDetail" },
      ]);
      expect(activeNames(wrapper)).toEqual(["alertDetail"]);
    });
  });
});
