// Copyright 2026 OpenObserve Inc.
// Licensed under AGPL v3.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { Quasar } from "quasar";
import { createStore } from "vuex";
import { createRouter, createMemoryHistory } from "vue-router";
import i18n from "@/locales";

const vibrateSpy = vi.fn();
vi.mock("@/composables/useHaptics", () => ({
  useHaptics: () => ({
    vibrate: vibrateSpy,
    supportsVibrate: { value: true },
  }),
}));

import MobileBottomNav from "./MobileBottomNav.vue";

const makeRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div/>" }, name: "home" },
      { path: "/logs", component: { template: "<div/>" }, name: "logs" },
      {
        path: "/dashboards",
        component: { template: "<div/>" },
        name: "dashboards",
      },
      {
        path: "/alerts",
        component: { template: "<div/>" },
        name: "alertList",
      },
    ],
  });

const makeStore = () =>
  createStore({
    state: {
      selectedOrganization: { identifier: "default" },
    },
  });

const links = [
  { title: "Home", icon: "home", link: "/", name: "home", display: true },
  { title: "Logs", icon: "list", link: "/logs", name: "logs", display: true },
  {
    title: "Dashboards",
    icon: "dashboard",
    link: "/dashboards",
    name: "dashboards",
    display: true,
  },
  {
    title: "Alerts",
    icon: "alert",
    link: "/alerts",
    name: "alertList",
    display: true,
  },
];

describe("MobileBottomNav haptics", () => {
  beforeEach(() => {
    vibrateSpy.mockReset();
  });

  it("fires a selection haptic when tapping an inactive tab", async () => {
    const router = makeRouter();
    const store = makeStore();
    await router.push("/logs");
    const wrapper = mount(MobileBottomNav, {
      props: { links },
      global: { plugins: [Quasar, store, router, i18n] },
    });

    const homeTab = wrapper.find('[aria-label="Home"]');
    await homeTab.trigger("click");

    expect(vibrateSpy).toHaveBeenCalledWith("selection");
  });

  it("does not fire a haptic when tapping the already-active tab", async () => {
    const router = makeRouter();
    const store = makeStore();
    await router.push("/logs");
    const wrapper = mount(MobileBottomNav, {
      props: { links },
      global: { plugins: [Quasar, store, router, i18n] },
    });

    const logsTab = wrapper.find('[aria-label="Logs"]');
    await logsTab.trigger("click");

    expect(vibrateSpy).not.toHaveBeenCalled();
  });

  it("fires a selection haptic when opening the More sheet", async () => {
    const router = makeRouter();
    const store = makeStore();
    const wrapper = mount(MobileBottomNav, {
      props: { links },
      global: { plugins: [Quasar, store, router, i18n] },
    });

    const moreBtn = wrapper.find('[aria-label="More navigation options"]');
    await moreBtn.trigger("click");

    expect(vibrateSpy).toHaveBeenCalledWith("selection");
  });
});

describe("MobileBottomNav active-state", () => {
  beforeEach(() => {
    vibrateSpy.mockReset();
  });

  // /logs vs /logstreams collision: prefix matching without a trailing-slash
  // guard would incorrectly highlight the Logs tab on the LogStreams page.
  it("uses exact-or-trailing-slash matching for active state", async () => {
    const router = makeRouter();
    router.addRoute({
      path: "/logstreams",
      component: { template: "<div/>" },
      name: "logstreams",
    });
    const store = makeStore();
    await router.push("/logstreams");
    const wrapper = mount(MobileBottomNav, {
      props: { links },
      global: { plugins: [Quasar, store, router, i18n] },
    });

    const logsTab = wrapper.find('[aria-label="Logs"]');
    expect(logsTab.classes()).not.toContain("mobile-bottom-nav__item--active");
  });

  it("recomputes the active tab when the route changes", async () => {
    const router = makeRouter();
    const store = makeStore();
    await router.push("/logs");
    const wrapper = mount(MobileBottomNav, {
      props: { links },
      global: { plugins: [Quasar, store, router, i18n] },
    });

    expect(wrapper.find('[aria-label="Logs"]').classes()).toContain(
      "mobile-bottom-nav__item--active",
    );

    await router.push("/dashboards");
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[aria-label="Logs"]').classes()).not.toContain(
      "mobile-bottom-nav__item--active",
    );
    expect(wrapper.find('[aria-label="Dashboards"]').classes()).toContain(
      "mobile-bottom-nav__item--active",
    );
  });
});

describe("MobileBottomNav overflow sheet", () => {
  beforeEach(() => {
    vibrateSpy.mockReset();
  });

  const linksWithOverflow = [
    ...links,
    {
      title: "Settings",
      icon: "settings",
      link: "/settings",
      name: "settings",
      display: true,
    },
  ];

  it("opens the More sheet when the More button is tapped", async () => {
    const router = makeRouter();
    const store = makeStore();
    const wrapper = mount(MobileBottomNav, {
      props: { links: linksWithOverflow },
      global: { plugins: [Quasar, store, router, i18n] },
    });

    expect(wrapper.vm.showMoreSheet).toBe(false);
    await wrapper
      .find('[aria-label="More navigation options"]')
      .trigger("click");
    expect(wrapper.vm.showMoreSheet).toBe(true);
  });

  it("classifies non-primary links as overflow items", () => {
    const router = makeRouter();
    const store = makeStore();
    const wrapper = mount(MobileBottomNav, {
      props: { links: linksWithOverflow },
      global: { plugins: [Quasar, store, router, i18n] },
    });

    const overflowNames = wrapper.vm.overflowItems.map((i: any) => i.name);
    expect(overflowNames).toEqual(["settings"]);
  });
});

describe("MobileBottomNav org-identifier handling", () => {
  // selectedOrganization can be null during early hydration / sign-out;
  // the component should still render and omit org_identifier from the
  // router-link query rather than serialize `undefined`.
  it("renders without crashing when selectedOrganization is null", async () => {
    const router = makeRouter();
    const store = createStore({
      state: {
        selectedOrganization: null,
      },
    });
    expect(() =>
      mount(MobileBottomNav, {
        props: { links },
        global: { plugins: [Quasar, store, router, i18n] },
      }),
    ).not.toThrow();
  });

  it("omits org_identifier from router-link query when no org is selected", () => {
    const router = makeRouter();
    const store = createStore({
      state: {
        selectedOrganization: null,
      },
    });
    const wrapper = mount(MobileBottomNav, {
      props: { links },
      global: { plugins: [Quasar, store, router, i18n] },
    });

    const hrefs = wrapper
      .findAll("a")
      .map((a) => a.attributes("href") ?? "");
    expect(hrefs.every((h) => !h.includes("org_identifier"))).toBe(true);
  });
});
