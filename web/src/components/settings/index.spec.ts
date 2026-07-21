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

import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import SettingsIndex from "./index.vue";
import i18n from "@/locales";
import { nextTick } from "vue";
import { createRouter, createWebHistory } from "vue-router";

// Mock external dependencies
vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "true",
    isCloud: "true",
  },
}));

vi.mock("@/composables/useIsMetaOrg", () => ({
  default: () => ({
    isMetaOrg: { value: true },
  }),
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path) => `mocked-${path}`),
}));


// Mock Vuex store
const mockStore = {
  state: {
    theme: "light",
    selectedOrganization: {
      identifier: "test-org",
    },
    organizationData: {
      organizationSettings: {
        org_storage_enabled: false,
      },
    },
    zoConfig: {
      service_streams_enabled: true,
    },
  },
};

// Create a real router instance for proper injection
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "settings", component: SettingsIndex },
    { path: "/nodes", name: "nodes", component: SettingsIndex },
    { path: "/general", name: "general", component: SettingsIndex },
  ],
});

// Mock the router methods we need to test
const mockRouterPush = vi.fn();
const mockRouterReplace = vi.fn().mockResolvedValue(undefined);
router.push = mockRouterPush;
router.replace = mockRouterReplace;

const createWrapper = (props = {}, options = {}) => {
  return mount(SettingsIndex, {
    props: {
      ...props,
    },
    global: {
      plugins: [i18n, router],
      mocks: {
        $store: mockStore,
      },
      provide: {
        store: mockStore,
      },
      stubs: {
        OPageLayout: {
          template: `<div data-test-stub="page-layout">
            <slot name="sidebar"></slot>
            <slot></slot>
          </div>`,
          props: ["sidebarWidth"],
        },
        SectionRail: {
          template: `<div data-test-stub="section-rail"></div>`,
          props: ["groups", "activeKey", "title"],
        },
        OPageHeader: {
          template: `<div data-test-stub="app-page-header">
            <slot name="title"></slot>
          </div>`,
          props: ["title", "subtitle", "icon", "class"],
        },
        ConstrainedPage: {
          template: `<div data-test-stub="constrained-page"><slot></slot></div>`,
          props: ["size", "class"],
        },
        RouterView: {
          template: "<div data-test-stub='router-view'></div>",
          props: ["title"],
        },
      },
    },
    attachTo: document.body,
    ...options,
  });
};

describe("SettingsIndex", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockStore.state.theme = "light";
    mockStore.state.selectedOrganization = { identifier: "test-org" };
    mockStore.state.zoConfig = { service_streams_enabled: true };
    mockRouterPush.mockClear();
    mockRouterReplace.mockClear();

    // Set up router state
    await router.push("/");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Component mounting", () => {
    it("should mount successfully", () => {
      const wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the settings page layout", () => {
      const wrapper = createWrapper();
      const layout = wrapper.find('[data-test-stub="page-layout"]');
      expect(layout.exists()).toBe(true);
    });

    it("should render the section rail in the sidebar", () => {
      const wrapper = createWrapper();
      const rail = wrapper.find('[data-test-stub="section-rail"]');
      expect(rail.exists()).toBe(true);
    });

    it("should render the router view", () => {
      const wrapper = createWrapper();
      const routerView = wrapper.find('[data-test-stub="router-view"]');
      expect(routerView.exists()).toBe(true);
    });
  });

  describe("Settings items configuration", () => {
    const getAllItems = (wrapper: any): any[] => {
      const groups = wrapper.vm.sectionGroups as any[];
      return groups.flatMap((g: any) => g.items ?? []);
    };

    it("should include general settings item", () => {
      const wrapper = createWrapper();
      const items = getAllItems(wrapper);
      expect(items.some((i: any) => i.key === "general")).toBe(true);
    });

    it("should include organization settings item", () => {
      const wrapper = createWrapper();
      const items = getAllItems(wrapper);
      expect(items.some((i: any) => i.key === "organization")).toBe(true);
    });

    it("should include alert-destinations item", () => {
      const wrapper = createWrapper();
      const items = getAllItems(wrapper);
      expect(items.some((i: any) => i.dataTest === "alert-destinations-tab")).toBe(true);
    });

    it("should include alert-templates item", () => {
      const wrapper = createWrapper();
      const items = getAllItems(wrapper);
      expect(items.some((i: any) => i.dataTest === "alert-templates-tab")).toBe(true);
    });

    it("should include enterprise items when isEnterprise is true", () => {
      const wrapper = createWrapper();
      const items = getAllItems(wrapper);
      const cipherItem = items.find((i: any) => i.dataTest === "management-cipher-key-tab");
      const regexItem = items.find((i: any) => i.dataTest === "regex-patterns-tab");
      const pipelineItem = items.find((i: any) => i.dataTest === "pipeline-destinations-tab");

      // visible=true when isEnterprise=true
      expect(cipherItem?.visible).toBe(true);
      expect(regexItem?.visible).toBe(true);
      expect(pipelineItem?.visible).toBe(true);
    });

    it("should include meta org items when isMetaOrg is true and enterprise", () => {
      const wrapper = createWrapper();
      const items = getAllItems(wrapper);
      const queryItem = items.find((i: any) => i.key === "queryManagement");
      const nodesItem = items.find((i: any) => i.dataTest === "nodes-tab");
      const domainItem = items.find((i: any) => i.dataTest === "domain-management-tab");
      const orgManagementItem = items.find((i: any) => i.dataTest === "organization-management-tab");

      expect(queryItem?.visible).toBe(true);
      expect(nodesItem?.visible).toBe(true);
      expect(domainItem?.visible).toBe(true);
      expect(orgManagementItem?.visible).toBe(true);
    });
  });

  describe("Router integration", () => {
    it("should redirect to /settings/general on settings root route", () => {
      createWrapper();
      expect(mockRouterReplace).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/settings/general",
        }),
      );
    });

    it("should include org_identifier in redirect query", () => {
      createWrapper();
      expect(mockRouterReplace).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { org_identifier: "test-org" },
        }),
      );
    });
  });

  describe("Theme integration", () => {
    // regexIcon is computed internally and used in settingsItems icon field
    // (not directly exposed on vm), so we verify it via the sectionGroups items.
    it("should use light regex icon for light theme", () => {
      mockStore.state.theme = "light";
      const wrapper = createWrapper();
      const groups = wrapper.vm.sectionGroups as any[];
      const allItems = groups.flatMap((g: any) => g.items ?? []);
      const regexItem = allItems.find((i: any) => i.dataTest === "regex-patterns-tab");
      expect(regexItem?.icon).toContain("regex_icon_light.svg");
    });

    it("should use dark regex icon for dark theme", () => {
      mockStore.state.theme = "dark";
      const wrapper = createWrapper();
      const groups = wrapper.vm.sectionGroups as any[];
      const allItems = groups.flatMap((g: any) => g.items ?? []);
      const regexItem = allItems.find((i: any) => i.dataTest === "regex-patterns-tab");
      expect(regexItem?.icon).toContain("regex_icon_dark.svg");
    });
  });

  describe("Section groups", () => {
    it("should build section groups from settings items", () => {
      const wrapper = createWrapper();
      const groups = wrapper.vm.sectionGroups as any[];
      expect(groups.length).toBeGreaterThan(0);
    });

    it("should contain a GENERAL group", () => {
      const wrapper = createWrapper();
      const groups = wrapper.vm.sectionGroups as any[];
      const generalGroup = groups.find((g: any) => g.label === "General");
      expect(generalGroup).toBeDefined();
    });

    it("should contain DESTINATIONS & TEMPLATES group", () => {
      const wrapper = createWrapper();
      const groups = wrapper.vm.sectionGroups as any[];
      const destGroup = groups.find(
        (g: any) => g.label === "Destinations & Templates",
      );
      expect(destGroup).toBeDefined();
    });
  });

  describe("Conditional rendering", () => {
    const getAllItems = (wrapper: any): any[] => {
      const groups = wrapper.vm.sectionGroups as any[];
      return groups.flatMap((g: any) => g.items ?? []);
    };

    it("should mark enterprise-only items as not visible when not enterprise", async () => {
      const config = await import("@/aws-exports");
      vi.mocked(config.default).isEnterprise = "false";

      const wrapper = createWrapper();
      const items = getAllItems(wrapper);
      const cipherItem = items.find((i: any) => i.dataTest === "management-cipher-key-tab");
      const nodesItem = items.find((i: any) => i.dataTest === "nodes-tab");
      const pipelineItem = items.find((i: any) => i.dataTest === "pipeline-destinations-tab");
      const regexItem = items.find((i: any) => i.dataTest === "regex-patterns-tab");

      expect(cipherItem?.visible).toBe(false);
      expect(nodesItem?.visible).toBe(false);
      expect(pipelineItem?.visible).toBe(false);
      expect(regexItem?.visible).toBe(false);
    });

    it("should mark cloud-only items as not visible when not cloud", async () => {
      const config = await import("@/aws-exports");
      vi.mocked(config.default).isCloud = "false";

      const wrapper = createWrapper();
      const items = getAllItems(wrapper);
      const orgManagementItem = items.find(
        (i: any) => i.dataTest === "organization-management-tab",
      );
      expect(orgManagementItem?.visible).toBe(false);
    });
  });

  describe("Active section computation", () => {
    it("should initialize settingsTab to general on settings route", async () => {
      await router.push("/");
      const wrapper = createWrapper();
      expect(wrapper.vm.settingsTab).toBe("general");
    });

    it("should expose isHub computed property", () => {
      const wrapper = createWrapper();
      // On '/' route named 'settings', isHub is true
      expect(typeof wrapper.vm.isHub).toBe("boolean");
    });
  });

  describe("Edge cases", () => {
    it("should handle missing organization identifier", () => {
      mockStore.state.selectedOrganization = { identifier: undefined };
      const wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle different router routes", async () => {
      await router.push("/nodes");
      const wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });
  });
});
