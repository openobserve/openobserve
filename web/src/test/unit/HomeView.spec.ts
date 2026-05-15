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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { Quasar, Notify } from "quasar";
import HomeView from "../../views/HomeView.vue";
import store from "./helpers/store";
import i18n from "@/locales";
import { nextTick } from "vue";

vi.mock("../../aws-exports", () => ({
  default: {
    isCloud: "false",
    isEnterprise: "false",
  },
}));

// Mock router
const mockRouter = {
  push: vi.fn(),
  resolve: vi.fn(),
};

const mockRoute = {
  name: "home",
  path: "/home",
};

describe("HomeView.vue", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();

    store.state.selectedOrganization = {
      label: "Test Organization",
      id: 159,
      identifier: "test-org",
      user_email: "test@example.com",
      subscription_type: "premium",
    };
    store.state.theme = "dark";
    store.state.isAiChatEnabled = false;
    store.state.zoConfig = { ai_enabled: false };

    localStorage.clear();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
    localStorage.clear();
  });

  const createWrapper = () => {
    return mount(HomeView, {
      global: {
        plugins: [
          [Quasar, { plugins: [Notify] }],
          i18n,
          store,
        ],
        mocks: {
          $router: mockRouter,
          $route: mockRoute,
        },
        stubs: {
          "router-link": {
            template: '<a><slot /></a>',
            props: ["to"],
          },
          "q-icon": {
            template: '<span class="q-icon-stub"></span>',
            props: ["name", "size"],
          },
          OButton: {
            template:
              '<button class="o-button-stub" @click="$emit(\'click\')"><slot /></button>',
            props: ["variant", "size", "ariaLabel", "title"],
          },
          OverviewTab: {
            template: '<div data-test="overview-tab">OverviewTab</div>',
          },
          UsageTab: {
            template: '<div data-test="usage-tab">UsageTab</div>',
          },
          O2AIChat: {
            template: '<div data-test="o2-ai-chat">O2AIChat</div>',
          },
          HomeChatHistory: {
            template: '<div data-test="home-chat-history">HomeChatHistory</div>',
          },
        },
      },
    });
  };

  // ── Component Initialization ─────────────────────────────────────────────

  describe("Component Initialization", () => {
    it("should render the component successfully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("PageHome");
    });

    it("should access store correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.store).toBe(store);
    });

    it("should initialize i18n translation function", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.t).toBe("function");
    });

    it("should initialize with default tabs", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.tabOrder).toBeDefined();
      expect(wrapper.vm.tabOrder.length).toBeGreaterThan(0);
    });

    it("should set activeHomeTab from localStorage if saved", () => {
      localStorage.setItem("o2_home_active_tab", "usage");
      wrapper = createWrapper();
      expect(wrapper.vm.activeHomeTab).toBe("usage");
    });
  });

  // ── Tab Management ───────────────────────────────────────────────────────

  describe("Tab Management", () => {
    it("should have tabOrder with at least usage tab for non-enterprise", () => {
      wrapper = createWrapper();
      const ids = wrapper.vm.tabOrder.map((t: any) => t.id);
      expect(ids).toContain("usage");
    });

    it("should have activeHomeTab defaulting to first tab", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.activeHomeTab).toBe(wrapper.vm.tabOrder[0].id);
    });

    it("should persist active tab to localStorage on change", async () => {
      wrapper = createWrapper();
      const initialTab = wrapper.vm.activeHomeTab;
      const tabs = wrapper.vm.tabOrder.map((t: any) => t.id);
      const otherTab = tabs.find((id: string) => id !== initialTab);
      if (otherTab) {
        wrapper.vm.activeHomeTab = otherTab;
        await nextTick();
        expect(localStorage.getItem("o2_home_active_tab")).toBe(otherTab);
      }
    });

    it("should restore saved tab order from localStorage", () => {
      localStorage.setItem(
        "o2_home_tab_order",
        JSON.stringify(["usage", "overview"]),
      );
      wrapper = createWrapper();
      const ids = wrapper.vm.tabOrder.map((t: any) => t.id);
      expect(ids[0]).toBe("usage");
    });
  });

  // ── Tab Rendering ────────────────────────────────────────────────────────

  describe("Tab Rendering", () => {
    it("should render OverviewTab when overview tab is active", async () => {
      wrapper = createWrapper();
      // Set isEnterprise so overview tab exists
      vi.mocked(
        (await import("../../aws-exports")).default,
      ).isEnterprise = "true";
      // Re-create wrapper with enterprise config
      wrapper.unmount();
      wrapper = createWrapper();
      // Find overview in tabOrder
      const overviewTab = wrapper.vm.tabOrder.find(
        (t: any) => t.id === "overview",
      );
      if (overviewTab) {
        wrapper.vm.activeHomeTab = "overview";
        await nextTick();
        expect(wrapper.find('[data-test="overview-tab"]').exists()).toBe(true);
      }
    });

    it("should render UsageTab when usage tab is active", async () => {
      wrapper = createWrapper();
      wrapper.vm.activeHomeTab = "usage";
      await nextTick();
      expect(wrapper.find('[data-test="usage-tab"]').exists()).toBe(true);
    });

    it("should show tab bar when multiple tabs exist", async () => {
      // Mock config to have multiple tabs
      vi.mocked(
        (await import("../../aws-exports")).default,
      ).isEnterprise = "true";
      wrapper.unmount();
      wrapper = createWrapper();
      await nextTick();

      if (wrapper.vm.tabOrder.length > 1) {
        expect(wrapper.find(".home-tab-bar").exists()).toBe(true);
      }
    });

    it("should hide tab bar when only one tab exists", () => {
      wrapper = createWrapper();
      if (wrapper.vm.tabOrder.length <= 1) {
        expect(wrapper.find(".home-tab-bar").exists()).toBe(false);
      }
    });
  });

  // ── Drag and Drop ────────────────────────────────────────────────────────

  describe("Tab Drag and Drop", () => {
    it("should set draggingTab on drag start", () => {
      wrapper = createWrapper();
      const tabId = wrapper.vm.tabOrder[0].id;
      const mockEvent = {
        dataTransfer: {
          effectAllowed: "",
          setData: vi.fn(),
        },
      };
      wrapper.vm.onTabDragStart(mockEvent, tabId);
      expect(wrapper.vm.draggingTab).toBe(tabId);
      expect(mockEvent.dataTransfer.effectAllowed).toBe("move");
    });

    it("should clear dragging state on drag end", () => {
      wrapper = createWrapper();
      wrapper.vm.draggingTab = "usage";
      wrapper.vm.dragOverTab = "overview";
      wrapper.vm.onTabDragEnd();
      expect(wrapper.vm.draggingTab).toBeNull();
      expect(wrapper.vm.dragOverTab).toBeNull();
    });

    it("should reorder tabs and persist to localStorage on drop", () => {
      wrapper = createWrapper();
      const tabs = wrapper.vm.tabOrder;
      if (tabs.length >= 2) {
        const fromId = tabs[0].id;
        const toId = tabs[1].id;
        wrapper.vm.dragOverTab = toId;
        wrapper.vm.draggingTab = fromId;

        const mockEvent = {
          preventDefault: vi.fn(),
          dataTransfer: {
            getData: vi.fn().mockReturnValue(fromId),
          },
        };
        wrapper.vm.onTabDrop(mockEvent);
        const newOrder = wrapper.vm.tabOrder.map((t: any) => t.id);
        expect(newOrder[0]).toBe(toId);
        expect(localStorage.getItem("o2_home_tab_order")).toBe(
          JSON.stringify(newOrder),
        );
      }
    });
  });

  // ── Event Listener ───────────────────────────────────────────────────────

  describe("o2:home-switch-tab event", () => {
    it("should switch tab when valid tab is dispatched", () => {
      wrapper = createWrapper();
      const initialTab = wrapper.vm.activeHomeTab;
      const tabs = wrapper.vm.tabOrder.map((t: any) => t.id);
      const targetTab = tabs.find((id: string) => id !== initialTab);
      if (targetTab) {
        window.dispatchEvent(
          new CustomEvent("o2:home-switch-tab", { detail: targetTab }),
        );
        expect(wrapper.vm.activeHomeTab).toBe(targetTab);
      }
    });

    it("should not switch tab when invalid tab is dispatched", () => {
      wrapper = createWrapper();
      const initialTab = wrapper.vm.activeHomeTab;
      window.dispatchEvent(
        new CustomEvent("o2:home-switch-tab", { detail: "nonexistent" }),
      );
      expect(wrapper.vm.activeHomeTab).toBe(initialTab);
    });
  });

  // ── Navigation and Routing ───────────────────────────────────────────────

  describe("Navigation and Routing", () => {
    it("should have router available", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$router).toBeDefined();
    });

    it("should have route available", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$route).toBeDefined();
    });
  });
});
