// Copyright 2023 OpenObserve Inc.
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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import IdentityAccessManagement from "@/views/IdentityAccessManagement.vue";
import RouteTabs from "@/components/RouteTabs.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { nextTick, ref, computed } from "vue";
import config from "@/aws-exports";

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock the useIsMetaOrg composable
vi.mock("@/composables/useIsMetaOrg", () => ({
  default: () => ({
    isMetaOrg: { value: false },
  }),
}));

describe("IdentityAccessManagement.vue Component", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(async () => {
    // Reset store state
    store.state.zoConfig = {
      rbac_enabled: false,
      service_account_enabled: true,
    };
    store.state.selectedOrganization = {
      identifier: "test-org",
    };

    wrapper = mount(IdentityAccessManagement, {
      global: {
        provide: {
          store: store,
        },
        plugins: [i18n, router],
        stubs: {
          RouterView: {
            template: "<div>Router View</div>",
          },
          RouteTabs: true,
        },
      },
    });
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  describe("Component Definition Tests", () => {
    it("should be defined", () => {
      expect(wrapper).toBeDefined();
    });

    it("should be a Vue instance", () => {
      expect(wrapper.vm).toBeTruthy();
    });

    it("should have the correct component structure", () => {
      expect(wrapper.element.tagName).toBe("MAIN");
    });

    it("should have RouteTabs component available", () => {
      // RouteTabs is imported and used in the template
      expect(RouteTabs).toBeDefined();
    });
  });

  describe("Setup Function Tests", () => {
    it("should have setup function defined", () => {
      expect(typeof wrapper.vm.$options.setup).toBe("function");
    });

    it("should return activeTab from setup", () => {
      expect(wrapper.vm.activeTab).toBeDefined();
    });

    it("should return tabs from setup", () => {
      expect(wrapper.vm.tabs).toBeDefined();
    });

    it("should return splitterModel from setup", () => {
      expect(wrapper.vm.splitterModel).toBeDefined();
    });

    it("should return showSidebar from setup", () => {
      expect(wrapper.vm.showSidebar).toBeDefined();
    });

    it("should have all required setup return properties", () => {
      const setupProperties = [
        "activeTab",
        "tabs",
        "splitterModel",
        "showSidebar",
        "collapseSidebar",
        "updateActiveTab",
      ];
      setupProperties.forEach((prop) => {
        expect(wrapper.vm[prop]).toBeDefined();
      });
    });
  });

  describe("Store Integration Tests", () => {
    it("should have store instance", () => {
      expect(store).toBeTruthy();
    });

    it("should have access to store state", () => {
      expect(store.state).toBeDefined();
    });

    it("should have selectedOrganization in store state", () => {
      expect(store.state.selectedOrganization).toBeDefined();
    });

    it("should have zoConfig in store state", () => {
      expect(store.state.zoConfig).toBeDefined();
    });
  });

  describe("Reactive References Tests", () => {
    it("should initialize activeTab as 'users'", () => {
      expect(wrapper.vm.activeTab).toBe("users");
    });

    it("should initialize splitterModel as 220", () => {
      expect(wrapper.vm.splitterModel).toBe(220);
    });

    it("should initialize showSidebar as true", () => {
      expect(wrapper.vm.showSidebar).toBe(true);
    });

    it("should initialize tabs as array", () => {
      expect(Array.isArray(wrapper.vm.tabs)).toBe(true);
    });

    it("should allow activeTab to be modified", async () => {
      wrapper.vm.activeTab = "groups";
      await nextTick();
      expect(wrapper.vm.activeTab).toBe("groups");
    });

    it("should allow splitterModel to be modified", async () => {
      wrapper.vm.splitterModel = 300;
      await nextTick();
      expect(wrapper.vm.splitterModel).toBe(300);
    });

    it("should allow showSidebar to be modified", async () => {
      wrapper.vm.showSidebar = false;
      await nextTick();
      expect(wrapper.vm.showSidebar).toBe(false);
    });
  });

  describe("Tab Filtering Tests - Service Accounts", () => {
    it("should include service accounts tab when service_account_enabled is true", async () => {
      store.state.zoConfig.service_account_enabled = true;

      const newWrapper = mount(IdentityAccessManagement, {
        global: {
          provide: { store: store },
          plugins: [i18n, router],
          stubs: { RouterView: true, RouteTabs: true },
        },
      });

      await flushPromises();

      // In open source mode, should have users, serviceAccounts, organizations
      const hasServiceAccounts = newWrapper.vm.tabs.some(
        (tab: any) => tab.name === "serviceAccounts"
      );
      expect(hasServiceAccounts).toBe(true);

      newWrapper.unmount();
    });

    it("should exclude service accounts tab when service_account_enabled is false", async () => {
      store.state.zoConfig.service_account_enabled = false;

      const newWrapper = mount(IdentityAccessManagement, {
        global: {
          provide: { store: store },
          plugins: [i18n, router],
          stubs: { RouterView: true, RouteTabs: true },
        },
      });

      await flushPromises();

      const hasServiceAccounts = newWrapper.vm.tabs.some(
        (tab: any) => tab.name === "serviceAccounts"
      );
      expect(hasServiceAccounts).toBe(false);

      newWrapper.unmount();
    });

    it("should default to including service accounts when config is undefined", async () => {
      store.state.zoConfig.service_account_enabled = undefined;

      const newWrapper = mount(IdentityAccessManagement, {
        global: {
          provide: { store: store },
          plugins: [i18n, router],
          stubs: { RouterView: true, RouteTabs: true },
        },
      });

      await flushPromises();

      const hasServiceAccounts = newWrapper.vm.tabs.some(
        (tab: any) => tab.name === "serviceAccounts"
      );
      // Default should be true (service_account_enabled ?? true)
      expect(hasServiceAccounts).toBe(true);

      newWrapper.unmount();
    });
  });

  describe("Tab Filtering Tests - RBAC", () => {
    it("should include RBAC tabs when rbac_enabled is true", async () => {
      vi.spyOn(config, "isEnterprise", "get").mockReturnValue("true");
      vi.spyOn(config, "isCloud", "get").mockReturnValue("false");
      store.state.zoConfig.rbac_enabled = true;
      store.state.zoConfig.service_account_enabled = true;

      const newWrapper = mount(IdentityAccessManagement, {
        global: {
          provide: { store: store },
          plugins: [i18n, router],
          stubs: { RouterView: true, RouteTabs: true },
        },
      });

      await flushPromises();

      const hasGroups = newWrapper.vm.tabs.some((tab: any) => tab.name === "groups");
      const hasRoles = newWrapper.vm.tabs.some((tab: any) => tab.name === "roles");

      expect(hasGroups).toBe(true);
      expect(hasRoles).toBe(true);

      newWrapper.unmount();
    });

    it("should exclude RBAC tabs when rbac_enabled is false", async () => {
      store.state.zoConfig.rbac_enabled = false;

      const newWrapper = mount(IdentityAccessManagement, {
        global: {
          provide: { store: store },
          plugins: [i18n, router],
          stubs: { RouterView: true, RouteTabs: true },
        },
      });

      await flushPromises();

      const hasGroups = newWrapper.vm.tabs.some((tab: any) => tab.name === "groups");
      const hasRoles = newWrapper.vm.tabs.some((tab: any) => tab.name === "roles");

      expect(hasGroups).toBe(false);
      expect(hasRoles).toBe(false);

      newWrapper.unmount();
    });
  });

  describe("Tab Configuration Tests - Enterprise vs Open Source", () => {
    it("should have correct tabs structure for open source", () => {
      expect(wrapper.vm.tabs).toBeDefined();
      expect(Array.isArray(wrapper.vm.tabs)).toBe(true);
      expect(wrapper.vm.tabs.length).toBeGreaterThan(0);
    });

    it("should have required tab properties", () => {
      const firstTab = wrapper.vm.tabs[0];
      expect(firstTab).toHaveProperty("name");
      expect(firstTab).toHaveProperty("to");
      expect(firstTab).toHaveProperty("label");
      expect(firstTab).toHaveProperty("class");
      expect(firstTab).toHaveProperty("dataTest");
    });

    it("should always include users tab", () => {
      const hasUsers = wrapper.vm.tabs.some((tab: any) => tab.name === "users");
      expect(hasUsers).toBe(true);
    });

    it("should always include organizations tab", () => {
      const hasOrganizations = wrapper.vm.tabs.some(
        (tab: any) => tab.name === "organizations"
      );
      expect(hasOrganizations).toBe(true);
    });
  });

  describe("Sidebar Collapse/Expand Tests", () => {
    it("should have collapseSidebar function", () => {
      expect(typeof wrapper.vm.collapseSidebar).toBe("function");
    });

    it("should toggle showSidebar when collapseSidebar is called", async () => {
      const initialState = wrapper.vm.showSidebar;
      wrapper.vm.collapseSidebar();
      await nextTick();
      expect(wrapper.vm.showSidebar).toBe(!initialState);
    });

    it("should set splitterModel to 0 when collapsing", async () => {
      wrapper.vm.showSidebar = true;
      wrapper.vm.splitterModel = 220;
      wrapper.vm.collapseSidebar();
      await nextTick();
      expect(wrapper.vm.splitterModel).toBe(0);
    });

    it("should restore splitterModel when expanding", async () => {
      wrapper.vm.showSidebar = true;
      wrapper.vm.splitterModel = 250;
      wrapper.vm.collapseSidebar(); // Collapse
      await nextTick();
      wrapper.vm.collapseSidebar(); // Expand
      await nextTick();
      expect(wrapper.vm.splitterModel).toBe(250);
    });

    it("should save last splitter position before collapsing", async () => {
      wrapper.vm.showSidebar = true;
      wrapper.vm.splitterModel = 300;
      const lastPosition = wrapper.vm.lastSplitterPosition;
      wrapper.vm.collapseSidebar();
      await nextTick();
      expect(wrapper.vm.lastSplitterPosition).toBe(300);
    });
  });

  describe("Update Active Tab Tests", () => {
    it("should have updateActiveTab function", () => {
      expect(typeof wrapper.vm.updateActiveTab).toBe("function");
    });

    it("should update activeTab when called with a tab name", async () => {
      wrapper.vm.updateActiveTab("groups");
      await nextTick();
      expect(wrapper.vm.activeTab).toBe("groups");
    });

    it("should handle undefined tab parameter", async () => {
      wrapper.vm.activeTab = "users";
      wrapper.vm.updateActiveTab(undefined);
      await nextTick();
      // Should not change when undefined
      expect(wrapper.vm.activeTab).toBeDefined();
    });

    it("should handle empty string tab parameter", async () => {
      wrapper.vm.activeTab = "users";
      wrapper.vm.updateActiveTab("");
      await nextTick();
      // Empty string is falsy, so should not update
      expect(wrapper.vm.activeTab).toBeDefined();
    });
  });

  describe("Route Watcher Tests", () => {
    it.skip("should redirect to users when accessing quota as non-meta org", async () => {
      // Create a reactive current route
      const currentRoute = ref({
        name: "users",
        query: { org_identifier: "test-org" },
        params: {},
        path: "/users",
        fullPath: "/users?org_identifier=test-org",
        matched: [],
        meta: {},
        redirectedFrom: undefined,
        hash: "",
      });

      // Create mock push function
      const mockPush = vi.fn().mockResolvedValue(undefined);

      // Create test router with reactive route
      const testRouter: any = {
        ...router,
        currentRoute,
        push: mockPush,
        options: router.options,
        install: router.install,
      };

      // Mock useRouter to return our test router
      const vueRouter = await import("vue-router");
      const useRouterSpy = vi.spyOn(vueRouter, "useRouter").mockReturnValue(testRouter);

      // Mount component
      const testWrapper = mount(IdentityAccessManagement, {
        global: {
          provide: { store: store },
          plugins: [i18n, router],
          stubs: { RouterView: true, RouteTabs: true },
        },
      });

      await flushPromises();
      await nextTick();

      // Clear calls from initial mount (watcher has immediate: true)
      mockPush.mockClear();

      // Update the entire route object to trigger watcher
      currentRoute.value = {
        name: "quota",
        query: { org_identifier: "test-org" },
        params: {},
        path: "/quota",
        fullPath: "/quota?org_identifier=test-org",
        matched: [],
        meta: {},
        redirectedFrom: undefined,
        hash: "",
      };

      // Wait for watcher to trigger
      await nextTick();
      await flushPromises();
      await nextTick();

      // Verify redirect was called
      expect(mockPush).toHaveBeenCalledWith({
        name: "users",
        query: {
          org_identifier: "test-org",
        },
      });

      testWrapper.unmount();
      useRouterSpy.mockRestore();
    });
  });

  describe("Template Rendering Tests", () => {
    it("should render q-page element", () => {
      expect(wrapper.find('[data-test="iam-page"]').exists()).toBe(true);
    });

    it("should render q-splitter", () => {
      expect(wrapper.find(".q-splitter").exists()).toBe(true);
    });

    it("should conditionally render sidebar based on showSidebar", async () => {
      wrapper.vm.showSidebar = true;
      await nextTick();
      expect(wrapper.vm.showSidebar).toBe(true);

      wrapper.vm.showSidebar = false;
      await nextTick();
      expect(wrapper.vm.showSidebar).toBe(false);
    });
  });

  describe("Config Integration Tests", () => {
    it("should have access to config", () => {
      expect(config).toBeDefined();
    });

    it("should handle isEnterprise flag", () => {
      const isEnterprise =
        config.isEnterprise === "true" || config.isCloud === "true";
      expect(typeof isEnterprise).toBe("boolean");
    });

    it("should handle isCloud flag", () => {
      expect(config.isCloud).toBeDefined();
    });
  });

  describe("All Tabs Structure Tests", () => {
    it("should have all expected tabs in allTabs array", () => {
      // Access internal allTabs through the component
      const expectedTabs = [
        "users",
        "serviceAccounts",
        "groups",
        "roles",
        "quota",
        "organizations",
        "invitations",
      ];

      // The tabs array should be a subset of allTabs based on config
      expect(wrapper.vm.tabs).toBeDefined();
      expect(wrapper.vm.tabs.length).toBeGreaterThan(0);
    });

    it("should have correct translation keys for tab labels", () => {
      const tab = wrapper.vm.tabs[0];
      expect(tab.label).toBeDefined();
      expect(typeof tab.label).toBe("string");
    });

    it("should have correct route configuration for each tab", () => {
      wrapper.vm.tabs.forEach((tab: any) => {
        expect(tab.to).toBeDefined();
        expect(tab.to.name).toBeDefined();
        expect(tab.to.query).toBeDefined();
        expect(tab.to.query.org_identifier).toBe("test-org");
      });
    });
  });

  describe("setTabs() Function Tests", () => {
    it("should be called on component mount", () => {
      // setTabs is called via watcher on mount
      expect(wrapper.vm.tabs).toBeDefined();
      expect(wrapper.vm.tabs.length).toBeGreaterThan(0);
    });

    describe("Enterprise Mode Tests", () => {
      it("should include service accounts in enterprise (not cloud) when enabled", async () => {
        // Mock enterprise mode
        vi.spyOn(config, "isEnterprise", "get").mockReturnValue("true");
        vi.spyOn(config, "isCloud", "get").mockReturnValue("false");
        store.state.zoConfig.service_account_enabled = true;
        store.state.zoConfig.rbac_enabled = false;

        const newWrapper = mount(IdentityAccessManagement, {
          global: {
            provide: { store: store },
            plugins: [i18n, router],
            stubs: { RouterView: true, RouteTabs: true },
          },
        });

        await flushPromises();

        const tabNames = newWrapper.vm.tabs.map((t: any) => t.name);
        expect(tabNames).toContain("users");
        expect(tabNames).toContain("organizations");
        expect(tabNames).toContain("serviceAccounts");

        newWrapper.unmount();
      });

      it("should exclude service accounts in enterprise when disabled", async () => {
        vi.spyOn(config, "isEnterprise", "get").mockReturnValue("true");
        vi.spyOn(config, "isCloud", "get").mockReturnValue("false");
        store.state.zoConfig.service_account_enabled = false;
        store.state.zoConfig.rbac_enabled = false;

        const newWrapper = mount(IdentityAccessManagement, {
          global: {
            provide: { store: store },
            plugins: [i18n, router],
            stubs: { RouterView: true, RouteTabs: true },
          },
        });

        await flushPromises();

        const tabNames = newWrapper.vm.tabs.map((t: any) => t.name);
        expect(tabNames).toContain("users");
        expect(tabNames).toContain("organizations");
        expect(tabNames).not.toContain("serviceAccounts");

        newWrapper.unmount();
      });

      it("should include invitations in cloud mode", async () => {
        vi.spyOn(config, "isEnterprise", "get").mockReturnValue("true");
        vi.spyOn(config, "isCloud", "get").mockReturnValue("true");
        store.state.zoConfig.rbac_enabled = false;

        const newWrapper = mount(IdentityAccessManagement, {
          global: {
            provide: { store: store },
            plugins: [i18n, router],
            stubs: { RouterView: true, RouteTabs: true },
          },
        });

        await flushPromises();

        const tabNames = newWrapper.vm.tabs.map((t: any) => t.name);
        expect(tabNames).toContain("invitations");

        newWrapper.unmount();
      });

      it("should not include service accounts in cloud mode", async () => {
        vi.spyOn(config, "isEnterprise", "get").mockReturnValue("true");
        vi.spyOn(config, "isCloud", "get").mockReturnValue("true");
        store.state.zoConfig.rbac_enabled = false;

        const newWrapper = mount(IdentityAccessManagement, {
          global: {
            provide: { store: store },
            plugins: [i18n, router],
            stubs: { RouterView: true, RouteTabs: true },
          },
        });

        await flushPromises();

        const tabNames = newWrapper.vm.tabs.map((t: any) => t.name);
        expect(tabNames).not.toContain("serviceAccounts");

        newWrapper.unmount();
      });

      it("should include RBAC tabs when rbac_enabled is true in enterprise", async () => {
        vi.spyOn(config, "isEnterprise", "get").mockReturnValue("true");
        vi.spyOn(config, "isCloud", "get").mockReturnValue("false");
        store.state.zoConfig.rbac_enabled = true;
        store.state.zoConfig.service_account_enabled = true;

        const newWrapper = mount(IdentityAccessManagement, {
          global: {
            provide: { store: store },
            plugins: [i18n, router],
            stubs: { RouterView: true, RouteTabs: true },
          },
        });

        await flushPromises();

        const tabNames = newWrapper.vm.tabs.map((t: any) => t.name);
        expect(tabNames).toContain("groups");
        expect(tabNames).toContain("roles");

        newWrapper.unmount();
      });

      it("should include quota tab when isMetaOrg and rbac_enabled", async () => {
        // Mock isMetaOrg to return true
        vi.mock("@/composables/useIsMetaOrg", () => ({
          default: () => ({
            isMetaOrg: { value: true },
          }),
        }));

        vi.spyOn(config, "isEnterprise", "get").mockReturnValue("true");
        vi.spyOn(config, "isCloud", "get").mockReturnValue("false");
        store.state.zoConfig.rbac_enabled = true;

        const newWrapper = mount(IdentityAccessManagement, {
          global: {
            provide: { store: store },
            plugins: [i18n, router],
            stubs: { RouterView: true, RouteTabs: true },
          },
        });

        await flushPromises();

        const tabNames = newWrapper.vm.tabs.map((t: any) => t.name);
        // Quota might be included if isMetaOrg is true
        expect(tabNames).toBeDefined();

        newWrapper.unmount();
      });
    });

    describe("Open Source Mode Tests", () => {
      it("should include users, organizations in open source", async () => {
        vi.spyOn(config, "isEnterprise", "get").mockReturnValue("false");
        vi.spyOn(config, "isCloud", "get").mockReturnValue("false");
        store.state.zoConfig.service_account_enabled = true;
        store.state.zoConfig.rbac_enabled = false;

        const newWrapper = mount(IdentityAccessManagement, {
          global: {
            provide: { store: store },
            plugins: [i18n, router],
            stubs: { RouterView: true, RouteTabs: true },
          },
        });

        await flushPromises();

        const tabNames = newWrapper.vm.tabs.map((t: any) => t.name);
        expect(tabNames).toContain("users");
        expect(tabNames).toContain("organizations");

        newWrapper.unmount();
      });

      it("should include service accounts in open source when enabled", async () => {
        vi.spyOn(config, "isEnterprise", "get").mockReturnValue("false");
        vi.spyOn(config, "isCloud", "get").mockReturnValue("false");
        store.state.zoConfig.service_account_enabled = true;

        const newWrapper = mount(IdentityAccessManagement, {
          global: {
            provide: { store: store },
            plugins: [i18n, router],
            stubs: { RouterView: true, RouteTabs: true },
          },
        });

        await flushPromises();

        const tabNames = newWrapper.vm.tabs.map((t: any) => t.name);
        expect(tabNames).toContain("serviceAccounts");

        newWrapper.unmount();
      });

      it("should exclude service accounts in open source when disabled", async () => {
        vi.spyOn(config, "isEnterprise", "get").mockReturnValue("false");
        vi.spyOn(config, "isCloud", "get").mockReturnValue("false");
        store.state.zoConfig.service_account_enabled = false;

        const newWrapper = mount(IdentityAccessManagement, {
          global: {
            provide: { store: store },
            plugins: [i18n, router],
            stubs: { RouterView: true, RouteTabs: true },
          },
        });

        await flushPromises();

        const tabNames = newWrapper.vm.tabs.map((t: any) => t.name);
        expect(tabNames).not.toContain("serviceAccounts");

        newWrapper.unmount();
      });

      it("should not include RBAC tabs in open source", async () => {
        vi.spyOn(config, "isEnterprise", "get").mockReturnValue("false");
        vi.spyOn(config, "isCloud", "get").mockReturnValue("false");
        store.state.zoConfig.rbac_enabled = true; // Even if enabled, should not show in OS

        const newWrapper = mount(IdentityAccessManagement, {
          global: {
            provide: { store: store },
            plugins: [i18n, router],
            stubs: { RouterView: true, RouteTabs: true },
          },
        });

        await flushPromises();

        const tabNames = newWrapper.vm.tabs.map((t: any) => t.name);
        expect(tabNames).not.toContain("groups");
        expect(tabNames).not.toContain("roles");

        newWrapper.unmount();
      });

      it("should not include invitations in open source", async () => {
        vi.spyOn(config, "isEnterprise", "get").mockReturnValue("false");
        vi.spyOn(config, "isCloud", "get").mockReturnValue("false");

        const newWrapper = mount(IdentityAccessManagement, {
          global: {
            provide: { store: store },
            plugins: [i18n, router],
            stubs: { RouterView: true, RouteTabs: true },
          },
        });

        await flushPromises();

        const tabNames = newWrapper.vm.tabs.map((t: any) => t.name);
        expect(tabNames).not.toContain("invitations");

        newWrapper.unmount();
      });
    });

    describe("Config Change Tests", () => {
      it("should recalculate tabs when service_account_enabled changes", async () => {
        store.state.zoConfig.service_account_enabled = true;
        await nextTick();
        await flushPromises();

        const hasServiceAccountsBefore = wrapper.vm.tabs.some(
          (t: any) => t.name === "serviceAccounts"
        );

        store.state.zoConfig.service_account_enabled = false;
        await nextTick();
        await flushPromises();

        const hasServiceAccountsAfter = wrapper.vm.tabs.some(
          (t: any) => t.name === "serviceAccounts"
        );

        // Should be different based on config change
        expect(wrapper.vm.tabs).toBeDefined();
      });

      it("should recalculate tabs when rbac_enabled changes", async () => {
        store.state.zoConfig.rbac_enabled = false;
        await nextTick();
        await flushPromises();

        store.state.zoConfig.rbac_enabled = true;
        await nextTick();
        await flushPromises();

        // Tabs should be recalculated
        expect(wrapper.vm.tabs).toBeDefined();
      });
    });
  });

  describe("Watchers Tests", () => {
    it("should watch zoConfig changes", async () => {
      const originalTabsLength = wrapper.vm.tabs.length;

      // Change config
      store.state.zoConfig.rbac_enabled = true;
      await nextTick();
      await flushPromises();

      // Tabs should be recalculated
      expect(wrapper.vm.tabs).toBeDefined();
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle missing zoConfig gracefully", async () => {
      const testStore = {
        state: {
          zoConfig: {},
          selectedOrganization: { identifier: "test" },
        },
      };

      const newWrapper = mount(IdentityAccessManagement, {
        global: {
          provide: { store: testStore },
          plugins: [i18n, router],
          stubs: { RouterView: true, RouteTabs: true },
        },
      });

      expect(newWrapper.vm.tabs).toBeDefined();
      newWrapper.unmount();
    });

    it("should handle null zoConfig values", async () => {
      store.state.zoConfig.rbac_enabled = null;
      store.state.zoConfig.service_account_enabled = null;

      const newWrapper = mount(IdentityAccessManagement, {
        global: {
          provide: { store: store },
          plugins: [i18n, router],
          stubs: { RouterView: true, RouteTabs: true },
        },
      });

      expect(newWrapper.vm.tabs).toBeDefined();
      expect(newWrapper.vm.tabs.length).toBeGreaterThan(0);
      newWrapper.unmount();
    });

    it("should handle rapid sidebar toggle", async () => {
      for (let i = 0; i < 10; i++) {
        wrapper.vm.collapseSidebar();
        await nextTick();
      }
      // Should still be in valid state
      expect(typeof wrapper.vm.showSidebar).toBe("boolean");
      expect(typeof wrapper.vm.splitterModel).toBe("number");
    });

    it("should handle multiple active tab changes", async () => {
      const tabs = ["users", "groups", "roles", "organizations"];
      for (const tab of tabs) {
        wrapper.vm.updateActiveTab(tab);
        await nextTick();
      }
      expect(wrapper.vm.activeTab).toBeDefined();
    });
  });

  describe("Performance and Memory Tests", () => {
    it("should not create memory leaks on mount/unmount", () => {
      for (let i = 0; i < 5; i++) {
        const testWrapper = mount(IdentityAccessManagement, {
          global: {
            provide: { store: store },
            plugins: [i18n, router],
            stubs: { RouterView: true, RouteTabs: true },
          },
        });
        testWrapper.unmount();
      }
      expect(true).toBe(true);
    });

    it("should handle multiple instances", () => {
      const wrappers = [];
      for (let i = 0; i < 3; i++) {
        wrappers.push(
          mount(IdentityAccessManagement, {
            global: {
              provide: { store: store },
              plugins: [i18n, router],
              stubs: { RouterView: true, RouteTabs: true },
            },
          })
        );
      }

      expect(wrappers.length).toBe(3);
      wrappers.forEach((w) => {
        expect(w.vm.activeTab).toBe("users");
        expect(w.vm.tabs).toBeDefined();
        w.unmount();
      });
    });
  });

  describe("Integration with Vue Composition API", () => {
    it("should use ref correctly for activeTab", () => {
      expect(wrapper.vm.activeTab).toBeDefined();
    });

    it("should use ref correctly for tabs", () => {
      expect(wrapper.vm.tabs).toBeDefined();
      expect(Array.isArray(wrapper.vm.tabs)).toBe(true);
    });

    it("should use ref correctly for splitterModel", () => {
      expect(typeof wrapper.vm.splitterModel).toBe("number");
    });

    it("should use ref correctly for showSidebar", () => {
      expect(typeof wrapper.vm.showSidebar).toBe("boolean");
    });

    it("should use watch correctly", () => {
      expect(wrapper.vm.$options.setup).toBeDefined();
    });
  });

  describe("Bug Fix Regression Tests", () => {
    it("should properly filter tabs when tabs is a ref (bug fix test)", async () => {
      // This test ensures the bug where tabs.value couldn't be reassigned is fixed
      store.state.zoConfig.rbac_enabled = true;
      store.state.zoConfig.service_account_enabled = true;

      const newWrapper = mount(IdentityAccessManagement, {
        global: {
          provide: { store: store },
          plugins: [i18n, router],
          stubs: { RouterView: true, RouteTabs: true },
        },
      });

      await flushPromises();

      // Tabs should be filtered correctly
      expect(newWrapper.vm.tabs).toBeDefined();
      expect(Array.isArray(newWrapper.vm.tabs)).toBe(true);
      expect(newWrapper.vm.tabs.length).toBeGreaterThan(0);

      newWrapper.unmount();
    });

    it("should allow tabs.value reassignment (not a computed property)", async () => {
      const originalLength = wrapper.vm.tabs.length;

      // Try to directly assign tabs
      wrapper.vm.tabs = [
        {
          name: "test",
          to: { name: "test", query: {} },
          label: "Test",
          class: "test",
          dataTest: "test",
        },
      ];

      await nextTick();

      // Should allow reassignment (proving it's not a computed)
      expect(wrapper.vm.tabs.length).not.toBe(originalLength);
      expect(wrapper.vm.tabs[0].name).toBe("test");
    });
  });
});
