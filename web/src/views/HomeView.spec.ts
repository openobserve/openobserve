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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import i18n from "@/locales";

// the panel's own layout rules are FirstDataPanel.spec's; here only HomeView's reading of them is pinned
const panel = vi.hoisted(() => ({ layout: "none" as string }));

vi.mock("@/components/ingestion/FirstDataPanel.vue", async () => {
  const { defineComponent: define, h: render } = await import("vue");
  const statusLine = define({
    name: "StatusLineStub",
    setup: () => () => render("div", { "data-test": "first-data-panel", "data-pick": "none" }),
  });
  return {
    default: define({
      name: "FirstDataPanel",
      props: ["signal", "variant", "arrived", "statusInSlot", "context"],
      emits: ["detected", "dismiss", "open"],
      setup(props, { slots }) {
        return () =>
          render(
            "div",
            {
              "data-test": props.arrived ? "first-data-panel-arrived" : "first-data-panel-stub",
              "data-context": props.context,
            },
            slots.default?.({ layout: panel.layout, statusLine }),
          );
      },
    }),
  };
});
vi.mock("@/views/OverviewTab.vue", () => ({
  default: { name: "OverviewTab", template: '<div data-test="overview-tab-stub" />' },
}));
vi.mock("@/views/UsageTab.vue", () => ({
  default: { name: "UsageTab", template: '<div data-test="usage-tab-stub" />' },
}));
vi.mock("@/components/O2AIChat.vue", () => ({
  default: { name: "O2AIChat", template: '<div data-test="ai-chat-stub" />' },
}));
vi.mock("@/views/HomeChatHistory.vue", () => ({
  default: { name: "HomeChatHistory", template: "<div />" },
}));
vi.mock("@/views/PinnedDashboardTab.vue", () => ({
  default: { name: "PinnedDashboardTab", template: '<div data-test="pinned-tab-stub" />' },
}));
vi.mock("@/enterprise/components/billings/TrialPeriod.vue", () => ({
  default: {
    name: "TrialPeriod",
    props: ["currentPage"],
    template: '<div data-test="trial-period-container" :data-page="currentPage" />',
  },
}));
vi.mock("@/components/shared/HomeViewSkeleton.vue", () => ({
  default: { name: "HomeViewSkeleton", template: '<div data-test="home-skeleton-stub" />' },
}));

import config from "@/aws-exports";
import HomeView from "./HomeView.vue";

const mountHome = () =>
  mount(HomeView, {
    global: { plugins: [i18n, store, router] },
  });

describe("HomeView", () => {
  let wrapper: VueWrapper;
  let originalZoConfig: Record<string, unknown>;
  let originalFlags: { isEnterprise: string; isCloud: string };

  const setFlag = (on: boolean) =>
    store.commit("setConfig", { ...originalZoConfig, restricted_routes_on_empty_data: on });
  const openTab = (tab: string) => localStorage.setItem("o2_home_active_tab", tab);
  const has = (testId: string) => wrapper.find(`[data-test="${testId}"]`).exists();

  beforeEach(() => {
    originalZoConfig = { ...store.state.zoConfig, ai_enabled: false };
    originalFlags = { isEnterprise: config.isEnterprise, isCloud: config.isCloud };
    config.isEnterprise = "true";
    config.isCloud = "false";
    localStorage.removeItem("o2_home_tab_order");
    panel.layout = "none";
    openTab("overview");
  });

  afterEach(() => {
    wrapper?.unmount();
    store.commit("setConfig", originalZoConfig);
    config.isEnterprise = originalFlags.isEnterprise;
    config.isCloud = originalFlags.isCloud;
    localStorage.removeItem("o2_home_active_tab");
    vi.restoreAllMocks();
  });

  describe("with the empty-data flag off", () => {
    beforeEach(() => setFlag(false));

    it("should render Overview as at BASE with no first-data panel around it", () => {
      wrapper = mountHome();

      expect(has("overview-tab-stub")).toBe(true);
      expect(has("first-data-panel-stub")).toBe(false);
      expect(has("first-data-panel")).toBe(false);
    });

    it("should render Usage as at BASE with no first-data panel around it", () => {
      openTab("usage");
      wrapper = mountHome();

      expect(has("usage-tab-stub")).toBe(true);
      expect(has("first-data-panel-stub")).toBe(false);
      expect(has("home-first-data-hero")).toBe(false);
    });
  });

  describe("with the empty-data flag on", () => {
    beforeEach(() => setFlag(true));

    it("should hold the skeleton and never mount Overview while the lists are unknown", () => {
      panel.layout = "pending";
      wrapper = mountHome();

      expect(has("home-skeleton-stub")).toBe(true);
      expect(has("overview-tab-stub")).toBe(false);
    });

    it("should show the no-pick hero with the status line inside and no Overview", () => {
      panel.layout = "status";
      wrapper = mountHome();

      const hero = wrapper.find('[data-test="home-first-data-hero"]');
      expect(hero.exists()).toBe(true);
      expect(hero.find('[data-test="first-data-panel"]').exists()).toBe(true);
      expect(hero.text()).toContain("Start sending data to OpenObserve");
      expect(hero.text()).toContain("Incidents, anomalies and service health show here");
      expect(has("home-no-data-all-sources-link")).toBe(true);
      expect(has("overview-tab-stub")).toBe(false);
      expect(wrapper.find('[data-test="first-data-panel-stub"]').attributes("data-context")).toBe(
        "overview",
      );
    });

    it("should name the org by its name, not its identifier, in the hero sentence", () => {
      panel.layout = "status";
      store.commit("setSelectedOrganization", {
        ...store.state.selectedOrganization,
        identifier: "3KPKhisT86rLZBaFRKbdvi1TIsm",
        label: "onboarding_test",
      });
      wrapper = mountHome();

      const text = wrapper.find('[data-test="home-no-data-description"]').text();
      expect(text).toContain("onboarding_test");
      expect(text).not.toContain("3KPKhisT86rLZBaFRKbdvi1TIsm");
    });

    it("should put the alternatives block under the card when a pick is known", () => {
      panel.layout = "card";
      wrapper = mountHome();

      const alternatives = wrapper.find('[data-test="home-first-data-alternatives"]');
      expect(alternatives.exists()).toBe(true);
      expect(alternatives.text()).toContain("Or start another way");
      expect(has("home-first-data-hero")).toBe(false);
      expect(has("overview-tab-stub")).toBe(false);
    });

    it("should put the trial strip with the usage actions above the Usage block", () => {
      panel.layout = "status";
      openTab("usage");
      wrapper = mountHome();

      const trial = wrapper.find('[data-test="trial-period-container"]');
      expect(trial.attributes("data-page")).toBe("usage");
      expect(wrapper.find('[data-test="home-first-data-hero"]').text()).toContain(
        "Streams, events and ingested size show here",
      );
      expect(has("usage-tab-stub")).toBe(false);
      expect(wrapper.find('[data-test="first-data-panel-stub"]').attributes("data-context")).toBe(
        "usage",
      );
    });

    it("should show the no-access state alone on Overview when the stream lists answer 403", () => {
      panel.layout = "forbidden";
      wrapper = mountHome();

      expect(has("home-no-access-empty-state")).toBe(true);
      expect(has("home-first-data-hero")).toBe(false);
      expect(has("overview-tab-stub")).toBe(false);
      expect(has("trial-period-container")).toBe(false);
    });

    it("should keep the trial strip above the no-access state on Usage", () => {
      panel.layout = "forbidden";
      openTab("usage");
      wrapper = mountHome();

      expect(has("trial-period-container")).toBe(true);
      expect(has("home-no-access-empty-state")).toBe(true);
      expect(has("usage-tab-stub")).toBe(false);
    });

    it("should mount the tab itself once the org is not empty", () => {
      wrapper = mountHome();

      expect(has("overview-tab-stub")).toBe(true);
      expect(has("home-first-data-hero")).toBe(false);
    });

    it("should show the arrival strip and mount Overview in place when the first record arrives", async () => {
      panel.layout = "status";
      wrapper = mountHome();
      const result = {
        streamName: "default",
        streamType: "logs",
        count: 1204,
        rangeStart: 1_000_000,
        rangeEnd: 2_000_000,
      };

      panel.layout = "none";
      wrapper.findComponent({ name: "FirstDataPanel" }).vm.$emit("detected", result);
      await flushPromises();

      expect(has("first-data-panel-arrived")).toBe(true);
      expect(has("overview-tab-stub")).toBe(true);
    });

    it("should open the arrived stream in Logs from the arrival strip", async () => {
      const push = vi.spyOn(router, "push").mockResolvedValue(undefined);
      wrapper = mountHome();
      wrapper.findComponent({ name: "FirstDataPanel" }).vm.$emit("detected", {
        streamName: "default",
        streamType: "logs",
        count: 1,
        rangeStart: 1_000_000,
        rangeEnd: 2_000_000,
      });
      await flushPromises();

      const arrival = wrapper
        .findAllComponents({ name: "FirstDataPanel" })
        .find((c) => c.props("arrived"));
      arrival?.vm.$emit("open");
      await flushPromises();

      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "logs",
          query: expect.objectContaining({ from: "1000000", to: "2000000" }),
        }),
      );
    });

    it("should not wrap a pinned dashboard tab in the first-data panel", async () => {
      panel.layout = "status";
      wrapper = mountHome();
      (wrapper.vm as unknown as { activeHomeTab: string }).activeHomeTab = "dash:default:abc";
      await flushPromises();

      expect(has("first-data-panel-stub")).toBe(false);
      expect(has("home-first-data-hero")).toBe(false);
    });
  });
});
