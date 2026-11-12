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
import { reactive } from "vue";

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
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/views/OverviewTab.vue", () => ({
  default: {
    name: "OverviewTab",
    template: '<div data-test="overview-tab-stub"><slot name="top" /></div>',
  },
}));
vi.mock("@/components/ai-assistant/welcome/AssistantLauncher.vue", () => ({
  __esModule: true,
  default: { name: "AssistantLauncher", template: '<div data-test="assistant-launcher-stub" />' },
}));
vi.mock("@/views/home/AgentHomeFirstRun.vue", () => ({
  __esModule: true,
  default: { name: "AgentHomeFirstRun", template: '<div data-test="agent-home-first-run-stub" />' },
}));
vi.mock("@/views/home/AssistantHomeTab.vue", () => ({
  __esModule: true,
  default: { name: "AssistantHomeTab", template: '<div data-test="assistant-home-tab-stub" />' },
}));
vi.mock("@/views/AssistantView.vue", () => ({
  __esModule: true,
  default: {
    name: "AssistantView",
    props: { chatId: String, bare: Boolean },
    template: '<div data-test="assistant-view-stub" :data-chat="chatId" :data-bare="bare" />',
  },
}));
vi.mock("@/views/home/HomeChatsRail.vue", () => ({
  __esModule: true,
  default: {
    name: "HomeChatsRail",
    props: { thread: Boolean },
    template: '<div data-test="home-chats-rail-stub" :data-thread="thread" />',
  },
}));
const wide = vi.hoisted(() => ({ value: true }));
vi.mock("@/composables/useBreakpoint", async (importOriginal) => {
  const { computed, reactive } = await import("vue");
  const actual = await importOriginal<typeof import("@/composables/useBreakpoint")>();
  const lg = reactive(wide);
  return { default: () => ({ ...actual.default(), lgUp: computed(() => lg.value) }) };
});
const assistant = vi.hoisted(() => ({ userOrgKey: null as string | null }));
const gate = vi.hoisted(() => ({ value: "available" }));
const pinRead = vi.hoisted(() => ({ controlled: false, answered: false }));
vi.mock("@/composables/useHomeDashboard", async (importOriginal) => {
  const { reactive } = await import("vue");
  const actual = await importOriginal<typeof import("@/composables/useHomeDashboard")>();
  const read = reactive(pinRead);
  return {
    ...actual,
    useHomeDashboard: (t: Parameters<typeof actual.useHomeDashboard>[0]) => {
      const real = actual.useHomeDashboard(t);
      return {
        ...real,
        isLoadedFor: (org: string | undefined) =>
          read.controlled ? read.answered : real.isLoadedFor(org),
        load: (org: string, force?: boolean) =>
          read.controlled ? Promise.resolve() : real.load(org, force),
      };
    },
  };
});
const homeReads = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/composables/assistant", async () => {
  const { computed, reactive } = await import("vue");
  const prefs = await import("@/composables/assistant/prefs");
  const state = reactive(assistant);
  const capability = reactive(gate);
  return {
    assistantStore: { state },
    useAssistantCapability: () => ({ gate: computed(() => capability.value) }),
    migrateHome: (key: string) => {
      homeReads.count += 1;
      return prefs.migrateHome(key);
    },
    writeHome: prefs.writeHome,
  };
});
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

// whether the org holds any stream; true keeps the saved tab the rest of this file tests.
// One ref per call: a test flips the ones made since its mount (`orgData.flip`).
const orgData = vi.hoisted(() => ({
  initial: true as boolean | undefined,
  // the _meta org: no user data, but O2's own streams to ask the assistant about
  ownStreamsOnly: false,
  refs: [] as { value: boolean | undefined }[],
  flip(value: boolean | undefined) {
    this.refs.forEach((r) => (r.value = value));
  },
}));
vi.mock("@/composables/useOrgHasUserData", async () => {
  const { ref } = await import("vue");
  return {
    useOrgHasUserData: () => {
      const hasUserData = ref(orgData.initial);
      orgData.refs.push(hasUserData);
      const hasAnyStream = orgData.ownStreamsOnly ? ref(true) : hasUserData;
      return { hasUserData, isFetching: ref(false), hasAnyStream };
    },
  };
});

import config from "@/aws-exports";
import analytics from "@/services/product_analytics";
import settings from "@/services/settings";
import { resetAssistantV2ForTests } from "@/composables/assistant/flags";
import { readHome, resetPrefsForTests } from "@/composables/assistant/prefs";
import { contextRegistry } from "@/composables/contextProviders/registry";
import { useHomeDashboard } from "@/composables/useHomeDashboard";
import { onOverviewFocusRequest } from "@/composables/goto/goToRequests";
import { getManager, resetManager } from "@/lib/vue-shortcut-manager";
import HomeView from "./HomeView.vue";
import { HOME_RAIL_CLASS } from "./home/homeState";
import { raw } from "@/types/i18n";

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
    // The local .env may turn v2 on for the build, and these tests pin the v2-off Home.
    window.__O2_ASSISTANT_V2__ = false;
    resetAssistantV2ForTests();
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
    delete window.__O2_ASSISTANT_V2__;
    resetAssistantV2ForTests();
    vi.restoreAllMocks();
  });

  describe("a pinned home dashboard", () => {
    const { homeDashboard } = useHomeDashboard(i18n.global.t as never);
    const TAB = "dash:default:d1";

    beforeEach(() => {
      setFlag(false);
      homeDashboard.value = { folderId: "default", dashboardId: "d1", label: raw("Pinned") };
    });
    afterEach(() => {
      homeDashboard.value = null;
    });

    it("should show a lock on the pinned tab when dashboards are locked", async () => {
      store.commit("setConfig", { ...store.state.zoConfig, features: { dashboards: "locked" } });
      wrapper = mountHome();
      await flushPromises();

      expect(has(`home-tab-${TAB}`)).toBe(true);
      expect(has(`home-tab-lock-${TAB}`)).toBe(true);
    });

    it("should show no lock on the pinned tab when dashboards are enabled", async () => {
      store.commit("setConfig", { ...store.state.zoConfig, features: { dashboards: "enabled" } });
      wrapper = mountHome();
      await flushPromises();

      expect(has(`home-tab-${TAB}`)).toBe(true);
      expect(has(`home-tab-lock-${TAB}`)).toBe(false);
    });

    it("tracks a tab the user picks, naming a pinned dashboard by its kind only", async () => {
      wrapper = mountHome();
      await flushPromises();
      vi.mocked(analytics.track).mockClear();
      wrapper.findComponent({ name: "OTabs" }).vm.$emit("change", TAB);
      wrapper.findComponent({ name: "OTabs" }).vm.$emit("change", "overview");
      expect(analytics.track).toHaveBeenCalledWith("home_tab_switched", { tab: "dashboard" });
      expect(analytics.track).toHaveBeenCalledWith("home_tab_switched", { tab: "overview" });
    });

    it("tracks an unpin from the tab's close button once the pin is cleared", async () => {
      vi.spyOn(settings, "deleteOrgSetting").mockResolvedValue({} as never);
      wrapper = mountHome();
      await flushPromises();
      vi.mocked(analytics.track).mockClear();
      await wrapper.find(`[data-test="home-tab-close-${TAB}"]`).trigger("click");
      await flushPromises();
      expect(analytics.track).toHaveBeenCalledWith("home_dashboard_unpinned", {
        source: "home_tab",
      });
    });

    it("does not track an unpin the server refused", async () => {
      vi.spyOn(settings, "deleteOrgSetting").mockRejectedValue({ response: { status: 500 } });
      wrapper = mountHome();
      await flushPromises();
      vi.mocked(analytics.track).mockClear();
      await wrapper.find(`[data-test="home-tab-close-${TAB}"]`).trigger("click");
      await flushPromises();
      expect(analytics.track).not.toHaveBeenCalledWith("home_dashboard_unpinned", {
        source: "home_tab",
      });
    });
  });

  describe("the AI Assistant tab", () => {
    beforeEach(() => setFlag(false));

    it("should stay visible with a lock and show the denied state when ai_assistant is locked", async () => {
      store.commit("setConfig", {
        ...store.state.zoConfig,
        ai_enabled: false,
        features: { ai_assistant: "locked" },
      });
      openTab("ai");
      wrapper = mountHome();
      await flushPromises();

      expect(has("home-tab-ai")).toBe(true);
      expect(has("home-tab-lock-ai")).toBe(true);
      expect(has("home-ai-locked")).toBe(true);
      expect(has("ai-chat-stub")).toBe(false);
    });

    it("should be absent when ai_assistant is not offered", async () => {
      store.commit("setConfig", { ...store.state.zoConfig, ai_enabled: false, features: {} });
      wrapper = mountHome();
      await flushPromises();

      expect(has("home-tab-ai")).toBe(false);
    });

    it("should mount the chat with no lock when ai_assistant is enabled", async () => {
      store.commit("setConfig", {
        ...store.state.zoConfig,
        ai_enabled: true,
        features: { ai_assistant: "enabled" },
      });
      openTab("ai");
      wrapper = mountHome();
      await flushPromises();

      expect(has("home-tab-lock-ai")).toBe(false);
      expect(has("ai-chat-stub")).toBe(true);
    });
  });

  describe("with the empty-data flag off", () => {
    beforeEach(() => setFlag(false));

    it("should render Overview as at BASE with no first-data panel around it", () => {
      wrapper = mountHome();

      expect(has("overview-tab-stub")).toBe(true);
      expect(has("first-data-panel-stub")).toBe(false);
      expect(has("first-data-panel")).toBe(false);
    });

    it("should run the Overview panel edge to edge by cancelling the body inset", () => {
      wrapper = mountHome();
      expect(wrapper.get('[data-test="home-overview-panel"]').classes()).toEqual(
        expect.arrayContaining(["-mx-2.5", "-mb-2.5", "flex-1"]),
      );
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

  describe("an org with no data", () => {
    beforeEach(() => {
      setFlag(false);
      store.commit("setConfig", { ...store.state.zoConfig, ai_enabled: true });
      openTab("ai");
      orgData.refs.length = 0;
    });
    afterEach(() => {
      orgData.initial = true;
      orgData.ownStreamsOnly = false;
    });
    const savedTab = () => localStorage.getItem("o2_home_active_tab");
    const activeTab = () => (wrapper.vm as unknown as { activeHomeTab: string }).activeHomeTab;

    it("opens Overview instead of the assistant, without saving that as the user's tab", async () => {
      orgData.initial = false;
      wrapper = mountHome();
      await flushPromises();

      expect(has("overview-tab-stub")).toBe(true);
      expect(has("ai-chat-stub")).toBe(false);
      expect(savedTab()).toBe("ai");
    });

    it("saves the next tab the user picks", async () => {
      orgData.initial = false;
      wrapper = mountHome();
      await flushPromises();
      (wrapper.vm as unknown as { activeHomeTab: string }).activeHomeTab = "usage";
      await flushPromises();

      expect(savedTab()).toBe("usage");
    });

    it("switches once the data check resolves with no data", async () => {
      orgData.initial = undefined;
      wrapper = mountHome();
      await flushPromises();
      expect(activeTab()).toBe("ai");

      orgData.flip(false);
      await flushPromises();

      expect(activeTab()).toBe("overview");
      expect(savedTab()).toBe("ai");
    });

    it.each([true, undefined])("keeps the assistant when the data check is %s", async (value) => {
      orgData.initial = value;
      wrapper = mountHome();
      await flushPromises();

      expect(has("ai-chat-stub")).toBe(true);
      expect(savedTab()).toBe("ai");
    });

    it("keeps the assistant for an org with only O2's own streams, such as _meta", async () => {
      orgData.initial = false;
      orgData.ownStreamsOnly = true;
      wrapper = mountHome();
      await flushPromises();

      expect(activeTab()).toBe("ai");
      expect(has("ai-chat-stub")).toBe(true);
    });

    it("leaves a saved Usage tab alone", async () => {
      orgData.initial = false;
      openTab("usage");
      wrapper = mountHome();
      await flushPromises();

      expect(activeTab()).toBe("usage");
    });
  });
  describe("assistant v2", () => {
    const flagged = (on: boolean) => {
      window.__O2_ASSISTANT_V2__ = on;
      resetAssistantV2ForTests();
    };

    // The tab bodies are async components, so a render waits for their chunks.
    const settleAsync = async () => {
      await flushPromises();
      await vi.dynamicImportSettled();
      await flushPromises();
    };

    // The mock reads the same reactive proxy, so a write here is the gate settling.
    const setGate = (value: string) => {
      reactive(gate).value = value;
    };

    beforeEach(() => {
      setFlag(false);
      store.commit("setConfig", { ...store.state.zoConfig, ai_enabled: true });
      assistant.userOrgKey = null;
      setGate("available");
      resetPrefsForTests();
    });

    afterEach(() => {
      delete window.__O2_ASSISTANT_V2__;
      resetAssistantV2ForTests();
      localStorage.clear();
    });

    it("keeps today's AI tab, chat and unscoped keys with the flag off", async () => {
      flagged(false);
      openTab("ai");
      wrapper = mountHome();
      await flushPromises();
      expect(has("home-tab-ai")).toBe(true);
      expect(has("ai-chat-stub")).toBe(true);
      expect(has("assistant-launcher-stub")).toBe(false);
      expect(localStorage.getItem("o2_home_active_tab")).toBe("ai");
    });

    it("puts the redesigned AI tab first and opens on it with the flag on", async () => {
      flagged(true);
      localStorage.removeItem("o2_home_active_tab");
      assistant.userOrgKey = "k1";
      wrapper = mountHome();
      await settleAsync();
      expect(tabIds()).toEqual(["home-tab-ai", "home-tab-overview", "home-tab-usage"]);
      expect(wrapper.get('[data-test="home-tab-overview"]').text()).toContain("Overview");
      expect(has("assistant-home-tab-stub")).toBe(true);
      expect(has("ai-chat-stub")).toBe(false);
      expect(has("overview-tab-stub")).toBe(false);
    });

    it("hides the AI tab and opens on Overview when AI is off for the org", async () => {
      flagged(true);
      setGate("off_for_org");
      assistant.userOrgKey = "k1";
      wrapper = mountHome();
      await flushPromises();
      expect(has("home-tab-ai")).toBe(false);
      expect(has("overview-tab-stub")).toBe(true);
    });

    it("hands Home to Overview when the gate settles on no permission", async () => {
      flagged(true);
      localStorage.removeItem("o2_home_active_tab");
      setGate("loading");
      assistant.userOrgKey = "k1";
      wrapper = mountHome();
      await settleAsync();
      expect(has("assistant-home-tab-stub")).toBe(true);
      setGate("no_permission");
      await flushPromises();
      expect(has("home-tab-ai")).toBe(false);
      expect(has("overview-tab-stub")).toBe(true);
      expect(readHome("k1").active ?? null).toBeNull();
      setGate("available");
      await settleAsync();
      expect(has("assistant-home-tab-stub")).toBe(true);
    });

    it("never shows the AI tab while the gate loads when the loaded config says AI is off", async () => {
      flagged(true);
      localStorage.removeItem("o2_home_active_tab");
      store.commit("setConfig", { ...store.state.zoConfig, ai_enabled: false });
      setGate("loading");
      assistant.userOrgKey = "k1";
      wrapper = mountHome();
      expect(has("home-tab-ai")).toBe(false);
      await settleAsync();
      expect(has("home-tab-ai")).toBe(false);
      expect(has("assistant-home-tab-stub")).toBe(false);
      expect(has("overview-tab-stub")).toBe(true);
      setGate("off_for_org");
      await settleAsync();
      expect(has("assistant-home-tab-stub")).toBe(false);
      expect(readHome("k1").active ?? null).toBeNull();
    });

    it("opens a thread link once the late config turns AI on", async () => {
      flagged(true);
      localStorage.removeItem("o2_home_active_tab");
      const { version, ...arriving } = store.state.zoConfig;
      store.commit("setConfig", { ...arriving, ai_enabled: false });
      await router.replace({ name: "home", query: { tab: "ai", thread: "abc" } });
      assistant.userOrgKey = "k1";
      wrapper = mountHome();
      await settleAsync();
      expect(has("home-full-thread")).toBe(false);
      store.commit("setConfig", { ...arriving, version, ai_enabled: true });
      await settleAsync();
      expect(
        wrapper
          .get('[data-test="home-full-thread"] [data-test="assistant-view-stub"]')
          .attributes("data-chat"),
      ).toBe("abc");
      await router.replace({ path: "/" });
    });

    it("applies a saved AI tab once the late config turns AI on", async () => {
      flagged(true);
      localStorage.removeItem("o2_home_active_tab");
      localStorage.setItem(
        "o2.assistant.home:k1",
        JSON.stringify({ active: "ai", migratedFromUnscoped: true }),
      );
      const { version, ...arriving } = store.state.zoConfig;
      store.commit("setConfig", { ...arriving, ai_enabled: false });
      assistant.userOrgKey = "k1";
      wrapper = mountHome();
      await settleAsync();
      expect(has("overview-tab-stub")).toBe(true);
      store.commit("setConfig", { ...arriving, version, ai_enabled: true });
      await settleAsync();
      expect(has("assistant-home-tab-stub")).toBe(true);
      expect(readHome("k1").active).toBe("ai");
    });

    it("drops ?tab=ai from the URL when the user picks another tab", async () => {
      flagged(true);
      await router.replace({ name: "home", query: { tab: "ai", org_identifier: "default" } });
      assistant.userOrgKey = "k1";
      wrapper = mountHome();
      await settleAsync();
      (wrapper.vm as unknown as { activeHomeTab: string }).activeHomeTab = "overview";
      await flushPromises();
      expect(router.currentRoute.value.query).toEqual({ org_identifier: "default" });
      expect(readHome("k1").active).toBe("overview");
      await router.replace({ path: "/" });
    });

    it("hides the AI tab on Open Source and opens Home on Overview", async () => {
      flagged(true);
      config.isEnterprise = "false";
      setGate("not_entitled");
      assistant.userOrgKey = "k1";
      wrapper = mountHome();
      await flushPromises();
      expect(has("home-tab-ai")).toBe(false);
      expect(tabIds()[0]).toBe("home-tab-overview");
      expect(has("overview-tab-stub")).toBe(true);
    });

    it("drops a ?tab=ai link on Open Source at once and opens the saved tab", async () => {
      flagged(true);
      config.isEnterprise = "false";
      setGate("not_entitled");
      localStorage.setItem(
        "o2.assistant.home:k1",
        JSON.stringify({ active: "usage", migratedFromUnscoped: true }),
      );
      await router.replace({
        name: "home",
        query: { tab: "ai", thread: "abc", org_identifier: "default" },
      });
      assistant.userOrgKey = "k1";
      wrapper = mountHome();
      await settleAsync();
      expect(router.currentRoute.value.query).toEqual({ org_identifier: "default" });
      expect(has("usage-tab-stub")).toBe(true);
      await router.replace({ path: "/" });
    });

    it("drops a ?tab=ai link at once when the loaded config hides AI, even while the gate loads", async () => {
      flagged(true);
      store.commit("setConfig", { ...store.state.zoConfig, ai_enabled: false });
      setGate("loading");
      localStorage.setItem(
        "o2.assistant.home:k1",
        JSON.stringify({ active: "usage", migratedFromUnscoped: true }),
      );
      await router.replace({ name: "home", query: { tab: "ai", org_identifier: "default" } });
      assistant.userOrgKey = "k1";
      wrapper = mountHome();
      await settleAsync();
      expect(router.currentRoute.value.query).toEqual({ org_identifier: "default" });
      expect(has("usage-tab-stub")).toBe(true);
      await router.replace({ path: "/" });
    });

    it("drops a ?tab=ai link when the feature map hides AI though the gate is available", async () => {
      flagged(true);
      store.commit("setConfig", {
        ...store.state.zoConfig,
        ai_enabled: true,
        features: { ai_assistant: "hidden" },
      });
      setGate("available");
      await router.replace({ name: "home", query: { tab: "ai", org_identifier: "default" } });
      assistant.userOrgKey = "k1";
      wrapper = mountHome();
      await settleAsync();
      expect(has("home-tab-ai")).toBe(false);
      expect(router.currentRoute.value.query).toEqual({ org_identifier: "default" });
      await router.replace({ path: "/" });
    });

    it("keeps a saved pinned dashboard a refused link held back until its pin loads", async () => {
      flagged(true);
      setGate("loading");
      pinRead.controlled = true;
      pinRead.answered = false;
      localStorage.setItem(
        "o2.assistant.home:k1",
        JSON.stringify({ active: "dash:default:d9", migratedFromUnscoped: true }),
      );
      await router.replace({ name: "home", query: { tab: "ai", org_identifier: "default" } });
      assistant.userOrgKey = "k1";
      wrapper = mountHome();
      await settleAsync();
      expect(has("assistant-home-tab-stub")).toBe(true);
      setGate("no_permission");
      await settleAsync();
      expect(router.currentRoute.value.query).toEqual({ org_identifier: "default" });
      expect((wrapper.vm as unknown as { activeHomeTab: string }).activeHomeTab).toBe(
        "dash:default:d9",
      );
      pinRead.controlled = false;
      await router.replace({ path: "/" });
    });

    describe("the / key", () => {
      const slash = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "/" }));
      // The focus bus is module-level, so a failed assertion must not leave a listener or surface for later tests.
      const cleanups: Array<() => void> = [];
      const listen = () => {
        const focus = vi.fn();
        cleanups.push(onOverviewFocusRequest(focus));
        return focus;
      };
      const focusSurface = (attr: string) => {
        const surface = document.createElement("div");
        surface.setAttribute(attr, "");
        const button = document.createElement("button");
        surface.appendChild(button);
        document.body.appendChild(surface);
        cleanups.push(() => surface.remove());
        button.focus();
      };

      beforeEach(() => {
        flagged(true);
        localStorage.removeItem("o2_home_active_tab");
        resetManager();
      });

      afterEach(() => {
        // Unmount before the reset: unmounting after it makes getManager() build a fresh manager that leaks on.
        wrapper?.unmount();
        wrapper = undefined as unknown as VueWrapper;
        cleanups.splice(0).forEach((stop) => stop());
        resetManager();
      });

      it("binds / once on the AI tab without a scope, and asks the visible Ask box to focus", async () => {
        const assistantScope = getManager()!.acquireScope("assistant");
        cleanups.push(() => getManager()?.releaseScope(assistantScope));
        const focus = listen();
        assistant.userOrgKey = "k1";
        wrapper = mountHome();
        await settleAsync();
        expect(getManager()!.getScope()).toBe("assistant");
        slash();
        expect(focus).toHaveBeenCalledOnce();
        (wrapper.vm as unknown as { activeHomeTab: string }).activeHomeTab = "overview";
        await flushPromises();
        expect(getManager()!.getById("homeFocusAsk")).toBeUndefined();
      });

      it("leaves / to an assistant surface that holds focus", async () => {
        const focus = listen();
        assistant.userOrgKey = "k1";
        wrapper = mountHome();
        await settleAsync();
        focusSurface("data-assistant-root");
        await flushPromises();
        slash();
        expect(focus).not.toHaveBeenCalled();
      });

      it("leaves / to the browser while no Ask box listens", async () => {
        assistant.userOrgKey = "k1";
        wrapper = mountHome();
        await settleAsync();
        expect(getManager()!.getById("homeFocusAsk")).toBeUndefined();
        const event = new KeyboardEvent("keydown", { key: "/", cancelable: true });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        const focus = listen();
        await flushPromises();
        slash();
        expect(focus).toHaveBeenCalledOnce();
      });

      it("sees an assistant surface that already holds focus when Home mounts", async () => {
        const focus = listen();
        focusSurface("data-assistant-window");
        assistant.userOrgKey = "k1";
        wrapper = mountHome();
        await settleAsync();
        expect(getManager()!.getById("homeFocusAsk")).toBeUndefined();
        slash();
        expect(focus).not.toHaveBeenCalled();
      });
    });

    describe("Full density on Home", () => {
      afterEach(async () => {
        reactive(wide).value = true;
        await router.replace({ path: "/" }).catch(() => undefined);
      });

      it("shows ?tab=ai&thread= as that thread inside the AI tab, and goes back to the briefing without it", async () => {
        flagged(true);
        localStorage.setItem(
          "o2.assistant.home:k1",
          JSON.stringify({ active: "usage", migratedFromUnscoped: true }),
        );
        await router.replace({
          name: "home",
          query: { tab: "ai", thread: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" },
        });
        wrapper = mountHome();
        await resolveKey("k1");
        expect(
          wrapper
            .get('[data-test="home-full-thread"] [data-test="assistant-view-stub"]')
            .attributes("data-chat"),
        ).toBe("0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b");
        expect(has("home-tab-bar")).toBe(true);
        expect((wrapper.vm as unknown as { activeHomeTab: string }).activeHomeTab).toBe("ai");
        expect(JSON.parse(localStorage.getItem("o2.assistant.home:k1") ?? "{}").active).toBe(
          "usage",
        );
        await router.replace({ name: "home", query: { tab: "ai" } });
        await flushPromises();
        expect(has("home-full-thread")).toBe(false);
        expect(has("assistant-home-tab-stub")).toBe(true);
      });

      it("settles a thread opened from the AI tab's page in once, and lands a thread link still", async () => {
        const settle = "motion-safe:animate-[assistant-fade-up_0.25s_ease-out_both]";
        flagged(true);
        await router.replace({ name: "home", query: { tab: "ai", thread: "abc" } });
        wrapper = mountHome();
        await resolveKey("k1");
        const thread = () =>
          wrapper.get('[data-test="home-full-thread"] [data-test="assistant-view-stub"]').classes();
        expect(thread()).not.toContain(settle);
        await router.replace({ name: "home", query: { tab: "ai" } });
        await flushPromises();
        expect(has("assistant-home-tab-stub")).toBe(true);
        await router.push({ name: "home", query: { tab: "ai", thread: "def" } });
        await flushPromises();
        expect(thread()).toContain(settle);
        expect(wrapper.get('[data-test="assistant-home-chats"]').classes()).not.toContain(settle);
      });

      it("draws the thread in Home's own layout: the hero's one rail beside a bare chat", async () => {
        flagged(true);
        await router.replace({ name: "home", query: { tab: "ai", thread: "abc" } });
        wrapper = mountHome();
        await resolveKey("k1");
        await settleAsync();
        const rails = wrapper.findAll('[data-test="assistant-home-chats"]');
        expect(rails).toHaveLength(1);
        expect(rails[0].classes()).toEqual(HOME_RAIL_CLASS.split(" "));
        expect(rails[0].get('[data-test="home-chats-rail-stub"]').attributes("data-thread")).toBe(
          "true",
        );
        expect(wrapper.get('[data-test="assistant-view-stub"]').attributes("data-bare")).toBe(
          "true",
        );
        expect(has("home-tab-bar")).toBe(true);
      });

      it("draws no rail beside the chat where the hero draws none", async () => {
        flagged(true);
        reactive(wide).value = false;
        await router.replace({ name: "home", query: { tab: "ai", thread: "abc" } });
        wrapper = mountHome();
        await resolveKey("k1");
        await settleAsync();
        expect(has("assistant-home-chats")).toBe(false);
        expect(wrapper.get('[data-test="assistant-view-stub"]').attributes("data-bare")).toBe(
          "true",
        );
      });

      it("drops the thread when the user leaves the AI tab", async () => {
        flagged(true);
        await router.replace({ name: "home", query: { tab: "ai", thread: "abc" } });
        wrapper = mountHome();
        await resolveKey("k1");
        (wrapper.vm as unknown as { activeHomeTab: string }).activeHomeTab = "overview";
        await flushPromises();
        expect(router.currentRoute.value.query).toEqual({});
        expect(has("overview-tab-stub")).toBe(true);
      });

      it("ignores ?thread= with the flag off", async () => {
        flagged(false);
        await router.replace({ name: "home", query: { thread: "abc" } });
        wrapper = mountHome();
        await flushPromises();
        expect(has("home-full-thread")).toBe(false);
        expect(has("home-page")).toBe(true);
      });
    });

    describe("Back to Home", () => {
      const activeTab = () => (wrapper.vm as unknown as { activeHomeTab: string }).activeHomeTab;

      beforeEach(() => {
        flagged(true);
        localStorage.setItem(
          "o2.assistant.home:k1",
          JSON.stringify({ active: "usage", migratedFromUnscoped: true }),
        );
      });

      afterEach(async () => {
        await router.replace({ path: "/" }).catch(() => undefined);
      });

      it("opens the AI tab over a saved Usage tab, saves nothing and drops home_tab", async () => {
        await router.replace({ name: "home", query: { home_tab: "ai", row: "incident:7" } });
        wrapper = mountHome();
        await resolveKey("k1");
        expect(activeTab()).toBe("ai");
        expect(JSON.parse(localStorage.getItem("o2.assistant.home:k1") ?? "{}").active).toBe(
          "usage",
        );
        expect(router.currentRoute.value.query).toEqual({ row: "incident:7" });
      });

      it("restores the saved tab on a plain visit", async () => {
        await router.replace({ name: "home", query: {} });
        wrapper = mountHome();
        await resolveKey("k1");
        expect(activeTab()).toBe("usage");
      });
    });

    describe("the first-data layout", () => {
      afterEach(() => contextRegistry.cleanup());

      it("shows the first-run state above the hero in the AI tab and tells the assistant there is no data", async () => {
        flagged(true);
        localStorage.removeItem("o2_home_active_tab");
        setFlag(true);
        store.commit("setConfig", { ...store.state.zoConfig, ai_enabled: true });
        panel.layout = "status";
        wrapper = mountHome();
        await resolveKey("k1");
        await settleAsync();
        expect(has("home-first-data-hero")).toBe(true);
        expect(has("agent-home-first-run-stub")).toBe(true);
        expect(wrapper.findAllComponents({ name: "AssistantLauncher" })).toHaveLength(0);
        const page = await contextRegistry.getActiveContext();
        expect(page?.homeNoData).toBe(true);
        expect(page?.page).toBeUndefined();
        wrapper.unmount();
        expect((await contextRegistry.getActiveContext())?.homeNoData).toBeUndefined();
      });

      it("shows the first-run state in the AI tab of an empty org without the takeover flag", async () => {
        flagged(true);
        localStorage.removeItem("o2_home_active_tab");
        setFlag(false);
        store.commit("setConfig", { ...store.state.zoConfig, ai_enabled: true });
        orgData.initial = false;
        // An org with no stream lands on Overview, so the AI tab is the one a link names.
        await router.replace({ name: "home", query: { home_tab: "ai" } });
        try {
          wrapper = mountHome();
          await resolveKey("k1");
          await settleAsync();
          expect(has("home-ai-first-run")).toBe(true);
          expect(has("agent-home-first-run-stub")).toBe(true);
          expect(has("home-ai-panel")).toBe(false);
          expect((await contextRegistry.getActiveContext())?.homeNoData).toBe(true);
        } finally {
          orgData.initial = true;
          await router.replace({ path: "/" }).catch(() => undefined);
        }
      });

      it("keeps the normal AI tab for an org with data when the takeover flag is off", async () => {
        flagged(true);
        localStorage.removeItem("o2_home_active_tab");
        setFlag(false);
        store.commit("setConfig", { ...store.state.zoConfig, ai_enabled: true });
        wrapper = mountHome();
        await resolveKey("k1");
        await settleAsync();
        expect(has("home-ai-first-run")).toBe(false);
        expect(has("agent-home-first-run-stub")).toBe(false);
      });

      it("keeps the launcher out of the v2-off hero", async () => {
        flagged(false);
        setFlag(true);
        panel.layout = "status";
        wrapper = mountHome();
        await flushPromises();
        expect(wrapper.findAllComponents({ name: "AssistantLauncher" })).toHaveLength(0);
        expect(has("agent-home-first-run-stub")).toBe(false);
      });
    });

    const resolveKey = async (key: string) => {
      const { assistantStore } = await import("@/composables/assistant");
      (assistantStore.state as { userOrgKey: string | null }).userOrgKey = key;
      await flushPromises();
    };

    const tabIds = () =>
      wrapper
        .findAll('[data-test="home-tab-bar"] [data-test^="home-tab-"]')
        .map((tab) => tab.attributes("data-test"))
        .filter((id) => !id?.startsWith("home-tab-close"));

    describe("a saved pinned tab", () => {
      const PINNED = "dash:default:abc";
      const activeTab = () => (wrapper.vm as unknown as { activeHomeTab: string }).activeHomeTab;
      const { homeDashboard } = useHomeDashboard((key: string) => key);

      beforeEach(() => {
        flagged(true);
        localStorage.setItem(
          "o2.assistant.home:k1",
          JSON.stringify({ active: PINNED, migratedFromUnscoped: true }),
        );
        pinRead.controlled = true;
        pinRead.answered = false;
      });

      afterEach(() => {
        pinRead.controlled = false;
        homeDashboard.value = null;
      });

      it("stays held behind the skeleton until the pin arrives", async () => {
        wrapper = mountHome();
        await resolveKey("k1");
        expect(activeTab()).toBe(PINNED);
        expect(has("home-skeleton-stub")).toBe(true);
        homeDashboard.value = { dashboardId: "abc", folderId: "default", label: "Pinned" };
        await flushPromises();
        expect(activeTab()).toBe(PINNED);
        expect(has("home-skeleton-stub")).toBe(false);
      });

      it("falls back to the first tab when the read finds no pin", async () => {
        wrapper = mountHome();
        await resolveKey("k1");
        reactive(pinRead).answered = true;
        await flushPromises();
        expect(activeTab()).toBe("ai");
        expect(has("home-skeleton-stub")).toBe(false);
      });
    });

    it("holds the tabs and body behind the skeleton until the saved order applies (IW-07 AC 1)", async () => {
      flagged(true);
      localStorage.setItem(
        "o2.assistant.home:k1",
        JSON.stringify({ order: ["usage", "overview"] }),
      );
      wrapper = mountHome();
      await flushPromises();
      expect(has("home-skeleton-stub")).toBe(true);
      expect(wrapper.get('[data-test="home-tab-bar"]').classes()).toContain("invisible");
      await resolveKey("k1");
      expect(has("home-skeleton-stub")).toBe(false);
      expect(wrapper.get('[data-test="home-tab-bar"]').classes()).not.toContain("invisible");
      expect(tabIds()).toEqual(["home-tab-usage", "home-tab-overview", "home-tab-ai"]);
    });

    it("never reorders the tabs once shown, when the key resolves after the wait", async () => {
      vi.useFakeTimers();
      flagged(true);
      localStorage.setItem(
        "o2.assistant.home:k1",
        JSON.stringify({ order: ["usage", "overview"] }),
      );
      wrapper = mountHome();
      await flushPromises();
      vi.advanceTimersByTime(1_500);
      await flushPromises();
      expect(has("home-skeleton-stub")).toBe(false);
      const painted = tabIds();
      await resolveKey("k1");
      expect(tabIds()).toEqual(painted);
      vi.useRealTimers();
    });

    it("stops reading the prefs once Home unmounts (F6)", async () => {
      flagged(true);
      wrapper = mountHome();
      await flushPromises();
      wrapper.unmount();
      const before = homeReads.count;
      await resolveKey("k2");
      expect(homeReads.count).toBe(before);
    });

    it("keeps a saved AI tab once, under the user+org key, and leaves the old keys alone", async () => {
      flagged(true);
      openTab("ai");
      localStorage.setItem("o2_home_tab_order", JSON.stringify(["usage", "ai", "overview"]));
      wrapper = mountHome();
      assistant.userOrgKey = "k1";
      await flushPromises();
      expect(readHome("k1")).toMatchObject({ active: "ai", migratedFromUnscoped: true });
      expect(
        wrapper
          .findAll(
            '[data-test="home-tab-usage"], [data-test="home-tab-overview"], [data-test="home-tab-ai"]',
          )
          .map((tab) => tab.attributes("data-test")),
      ).toEqual(["home-tab-usage", "home-tab-ai", "home-tab-overview"]);
      expect(localStorage.getItem("o2_home_active_tab")).toBe("ai");
      wrapper.unmount();
      localStorage.setItem("o2_home_active_tab", "usage");
      wrapper = mountHome();
      await flushPromises();
      expect(readHome("k1").active).toBe("ai");
    });
  });
});
