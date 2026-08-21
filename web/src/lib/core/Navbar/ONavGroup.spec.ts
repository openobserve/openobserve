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

  // The Infra tile holds ONE child (Database Monitoring) behind the
  // `databaseMonitoring` runtime gate. Rendering the tile regardless of its
  // children would leave a dead "Infra" entry on every build with the feature
  // off — it would open nothing, and clicking it would land on a page the route
  // guard bounces straight back. The tile must not exist at all.
  describe("a group whose children are all filtered out", () => {
    // A store whose zoConfig can be set per test, unlike the shared one above.
    function makeGatedStore(databaseMonitoringEnabled: boolean) {
      return createStore({
        state: () => ({
          theme: "light",
          zoConfig: { database_monitoring_enabled: databaseMonitoringEnabled },
          organizationData: {},
          selectedOrganization: { identifier: "default" },
        }),
      });
    }

    // Infra's real shape: one gated child, routes registered (they always are —
    // the guard, not the router, is what turns the feature off).
    function mountInfra(databaseMonitoringEnabled: boolean) {
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: "/", name: "home", component: { template: "<div />" } },
          {
            path: "/traces/databases",
            name: "dbmDatabases",
            component: { template: "<div />" },
          },
        ],
      });
      return mount(ONavGroup, {
        props: {
          groupKey: "infra",
          title: "Infra",
          icon: "dns",
          children: [
            {
              titleKey: "menu.databases",
              icon: "database",
              name: "dbmDatabases",
              gate: "databaseMonitoring",
            },
          ] as SubnavChild[],
          parentItem: {
            link: "/traces/databases",
            title: "Infra",
            icon: "dns",
            name: "infra",
          },
        },
        global: {
          plugins: [router, makeGatedStore(databaseMonitoringEnabled), i18n],
          stubs: { MenuLink: menuLinkStub, OIcon: oIconStub, teleport: true },
        },
      });
    }

    it("renders the Infra tile when the databaseMonitoring gate passes", () => {
      wrapper = mountInfra(true);
      expect(wrapper.find('[data-test="nav-group-infra"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="tile"]').exists()).toBe(true);
    });

    it("renders NO Infra tile when the databaseMonitoring gate fails", () => {
      wrapper = mountInfra(false);
      // The whole wrapper element is gone — not merely an empty flyout.
      expect(wrapper.find('[data-test="nav-group-infra"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="tile"]').exists()).toBe(false);
    });

    it("renders no tile when every child's route is missing from the build", async () => {
      // The other half of the filter: `router.hasRoute` rather than `gate`.
      wrapper = mountGroup();
      await wrapper.setProps({
        children: [{ titleKey: "menu.ghost", icon: "x", name: "notARoute" }] as SubnavChild[],
      });
      expect(wrapper.find('[data-test="nav-group-data"]').exists()).toBe(false);
    });
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

  describe("query-tab navigation and active state", () => {
    const tracesChildren: SubnavChild[] = [
      {
        titleKey: "traces.spansTab",
        icon: "layers",
        name: "traces",
        tab: "spans",
      },
      {
        titleKey: "menu.traces",
        icon: "account-tree",
        name: "traces",
        tab: "traces",
        defaultForRoute: true,
      },
      {
        titleKey: "menu.serviceGraph",
        icon: "share",
        name: "traces",
        tab: "service-graph",
      },
      {
        titleKey: "menu.services",
        icon: "menu-book",
        name: "traces",
        tab: "services-catalog",
      },
    ];

    function makeTracesRouter() {
      return createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: "/", name: "home", component: { template: "<div />" } },
          { path: "/traces", name: "traces", component: { template: "<div />" } },
        ],
      });
    }

    async function mountAt(path: string) {
      const router = makeTracesRouter();
      router.push(path);
      await router.isReady();
      const w = mount(ONavGroup, {
        props: {
          groupKey: "traces",
          title: "Traces",
          icon: "account-tree",
          children: tracesChildren,
          parentItem: {
            link: "/traces",
            title: "Traces",
            icon: "account-tree",
            name: "traces",
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

    function activeTabs(w: VueWrapper): string[] {
      return w
        .findAll('[data-test^="nav-group-item-"]')
        .filter((el) => el.attributes("aria-current") === "page")
        .map((el) => el.attributes("data-test")!.replace("nav-group-item-traces-", ""));
    }

    it("marks Traces on plain /traces", async () => {
      wrapper = await mountAt("/traces");
      expect(activeTabs(wrapper)).toEqual(["traces"]);
    });

    it("marks Traces on /traces?tab=traces", async () => {
      wrapper = await mountAt("/traces?tab=traces");
      expect(activeTabs(wrapper)).toEqual(["traces"]);
    });

    it("marks Service Graph, not Traces, on /traces?tab=service-graph", async () => {
      wrapper = await mountAt("/traces?tab=service-graph");
      expect(activeTabs(wrapper)).toEqual(["service-graph"]);
    });

    it("marks Service Catalog, not Traces, on /traces?tab=services-catalog", async () => {
      wrapper = await mountAt("/traces?tab=services-catalog");
      expect(activeTabs(wrapper)).toEqual(["services-catalog"]);
    });

    it("marks Spans on /traces?tab=spans", async () => {
      wrapper = await mountAt("/traces?tab=spans");
      expect(activeTabs(wrapper)).toEqual(["spans"]);
    });

    it("builds canonical Traces URLs for every flyout item", async () => {
      wrapper = await mountAt("/traces");

      expect(wrapper.get('[data-test="nav-group-item-traces-traces"]').attributes("href")).toBe(
        "/traces?org_identifier=default&tab=traces",
      );
      expect(wrapper.get('[data-test="nav-group-item-traces-spans"]').attributes("href")).toBe(
        "/traces?org_identifier=default&tab=spans",
      );
      expect(
        wrapper.get('[data-test="nav-group-item-traces-service-graph"]').attributes("href"),
      ).toBe("/traces?org_identifier=default&tab=service-graph");
      expect(
        wrapper.get('[data-test="nav-group-item-traces-services-catalog"]').attributes("href"),
      ).toBe("/traces?org_identifier=default&tab=services-catalog");
    });

    it("preserves the current Traces query when switching tabs", async () => {
      wrapper = await mountAt(
        "/traces?org_identifier=default&tab=traces&search_mode=spans&stream=default&period=15m&query=c2VydmljZQ%3D%3D",
      );

      const href = wrapper.get('[data-test="nav-group-item-traces-spans"]').attributes("href");
      const query = new URL(href, "http://localhost").searchParams;

      expect(query.get("org_identifier")).toBe("default");
      expect(query.get("tab")).toBe("spans");
      expect(query.has("search_mode")).toBe(false);
      expect(query.get("stream")).toBe("default");
      expect(query.get("period")).toBe("15m");
      expect(query.get("query")).toBe("c2VydmljZQ==");
    });
  });
});
