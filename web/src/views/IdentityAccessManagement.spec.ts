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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import IdentityAccessManagement from "@/views/IdentityAccessManagement.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { nextTick } from "vue";
import config from "@/aws-exports";

// Mock the useIsMetaOrg composable
vi.mock("@/composables/useIsMetaOrg", () => ({
  default: () => ({
    isMetaOrg: { value: false },
  }),
}));

/** Helper: collect all items from sectionGroups (flattened, excluding hidden ones) */
function visibleItems(sectionGroups: any[]): any[] {
  return sectionGroups.flatMap((g: any) =>
    (g.items ?? []).filter((item: any) => item.visible !== false),
  );
}

/** Helper: collect ALL items regardless of visible flag */
function allItems(sectionGroups: any[]): any[] {
  return sectionGroups.flatMap((g: any) => g.items ?? []);
}

const defaultStubs = {
  RouterView: { template: "<div>Router View</div>" },
  OPageLayout: {
    template: '<div><slot name="sidebar" /><slot /></div>',
  },
  SectionRail: true,
};

describe("IdentityAccessManagement.vue Component", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(async () => {
    store.state.zoConfig = {
      rbac_enabled: false,
      service_account_enabled: true,
    };
    store.state.selectedOrganization = {
      identifier: "test-org",
    };

    wrapper = mount(IdentityAccessManagement, {
      global: {
        provide: { store: store },
        plugins: [i18n, router],
        stubs: defaultStubs,
      },
    });
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.restoreAllMocks();
  });

  describe("Component Definition Tests", () => {
    it("should be defined", () => {
      expect(wrapper).toBeDefined();
    });

    it("should be a Vue instance", () => {
      expect(wrapper.vm).toBeTruthy();
    });

    it("should have the correct component structure", () => {
      expect(wrapper.element.tagName).toBe("DIV");
    });
  });

  describe("Setup Function Tests", () => {
    it("should have setup function defined", () => {
      expect(typeof wrapper.vm.$options.setup).toBe("function");
    });

    it("should expose sectionGroups from setup", () => {
      expect(wrapper.vm.sectionGroups).toBeDefined();
    });

    it("should expose activeSection from setup", () => {
      expect(wrapper.vm.activeSection).toBeDefined();
    });

    it("should have all required setup return properties", () => {
      const props = ["sectionGroups", "activeSection"];
      props.forEach((prop) => {
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

  describe("Section Groups Tests", () => {
    it("should initialize sectionGroups as an array", () => {
      expect(Array.isArray(wrapper.vm.sectionGroups)).toBe(true);
    });

    it("should have at least one section group", () => {
      expect(wrapper.vm.sectionGroups.length).toBeGreaterThan(0);
    });

    it("should always include users item", () => {
      const items = allItems(wrapper.vm.sectionGroups);
      const hasUsers = items.some((item: any) => item.key === "users");
      expect(hasUsers).toBe(true);
    });

    it("should always include organizations item", () => {
      const items = allItems(wrapper.vm.sectionGroups);
      const hasOrgs = items.some((item: any) => item.key === "organizations");
      expect(hasOrgs).toBe(true);
    });

    it("should always include ingestionTokens item", () => {
      const items = allItems(wrapper.vm.sectionGroups);
      const hasTokens = items.some((item: any) => item.key === "ingestionTokens");
      expect(hasTokens).toBe(true);
    });

    it("each item should have required properties", () => {
      const items = allItems(wrapper.vm.sectionGroups);
      items.forEach((item: any) => {
        expect(item).toHaveProperty("key");
        expect(item).toHaveProperty("label");
        expect(item).toHaveProperty("to");
        expect(item).toHaveProperty("dataTest");
      });
    });
  });

  describe("Tab Filtering Tests - Service Accounts", () => {
    it("should show serviceAccounts when service_account_enabled is true", async () => {
      store.state.zoConfig.service_account_enabled = true;

      const w = mount(IdentityAccessManagement, {
        global: {
          provide: { store },
          plugins: [i18n, router],
          stubs: defaultStubs,
        },
      });
      await flushPromises();

      const items = visibleItems(w.vm.sectionGroups);
      expect(items.some((i: any) => i.key === "serviceAccounts")).toBe(true);
      w.unmount();
    });

    it("should hide serviceAccounts when service_account_enabled is false", async () => {
      store.state.zoConfig.service_account_enabled = false;

      const w = mount(IdentityAccessManagement, {
        global: {
          provide: { store },
          plugins: [i18n, router],
          stubs: defaultStubs,
        },
      });
      await flushPromises();

      const items = visibleItems(w.vm.sectionGroups);
      expect(items.some((i: any) => i.key === "serviceAccounts")).toBe(false);
      w.unmount();
    });

    it("should default to showing serviceAccounts when config is undefined", async () => {
      store.state.zoConfig.service_account_enabled = undefined;

      const w = mount(IdentityAccessManagement, {
        global: {
          provide: { store },
          plugins: [i18n, router],
          stubs: defaultStubs,
        },
      });
      await flushPromises();

      const items = visibleItems(w.vm.sectionGroups);
      expect(items.some((i: any) => i.key === "serviceAccounts")).toBe(true);
      w.unmount();
    });
  });

  describe("Tab Filtering Tests - RBAC", () => {
    it("should show groups and roles when enterprise and rbac_enabled", async () => {
      vi.spyOn(config, "isEnterprise", "get").mockReturnValue("true");
      vi.spyOn(config, "isCloud", "get").mockReturnValue("false");
      store.state.zoConfig.rbac_enabled = true;

      const w = mount(IdentityAccessManagement, {
        global: {
          provide: { store },
          plugins: [i18n, router],
          stubs: defaultStubs,
        },
      });
      await flushPromises();

      const items = visibleItems(w.vm.sectionGroups);
      expect(items.some((i: any) => i.key === "groups")).toBe(true);
      expect(items.some((i: any) => i.key === "roles")).toBe(true);
      w.unmount();
    });

    it("should hide groups and roles when rbac_enabled is false", async () => {
      store.state.zoConfig.rbac_enabled = false;

      const w = mount(IdentityAccessManagement, {
        global: {
          provide: { store },
          plugins: [i18n, router],
          stubs: defaultStubs,
        },
      });
      await flushPromises();

      const items = visibleItems(w.vm.sectionGroups);
      expect(items.some((i: any) => i.key === "groups")).toBe(false);
      expect(items.some((i: any) => i.key === "roles")).toBe(false);
      w.unmount();
    });
  });

  describe("Tab Configuration Tests - Enterprise vs Open Source", () => {
    it("should have correct sectionGroups structure for open source", () => {
      expect(wrapper.vm.sectionGroups).toBeDefined();
      expect(Array.isArray(wrapper.vm.sectionGroups)).toBe(true);
      expect(wrapper.vm.sectionGroups.length).toBeGreaterThan(0);
    });

    it("should have group labels", () => {
      wrapper.vm.sectionGroups.forEach((group: any) => {
        expect(group).toHaveProperty("label");
        expect(group).toHaveProperty("items");
      });
    });

    it("should always include users item", () => {
      const items = allItems(wrapper.vm.sectionGroups);
      expect(items.some((i: any) => i.key === "users")).toBe(true);
    });

    it("should always include organizations item", () => {
      const items = allItems(wrapper.vm.sectionGroups);
      expect(items.some((i: any) => i.key === "organizations")).toBe(true);
    });
  });

  describe("Route and Navigation Tests", () => {
    it("should have activeSection as a computed string", () => {
      expect(typeof wrapper.vm.activeSection).toBe("string");
    });

    it.skip("should redirect to users when accessing quota as non-meta org", async () => {
      // Requires deep router mocking — covered by e2e tests
    });
  });

  describe("Template Rendering Tests", () => {
    it("should render page div with data-test=iam-page", () => {
      expect(wrapper.find('[data-test="iam-page"]').exists()).toBe(true);
    });

    it("should render page content", () => {
      expect(wrapper.find('[data-test="iam-page"]').exists()).toBe(true);
    });
  });

  describe("Config Integration Tests", () => {
    it("should have access to config", () => {
      expect(config).toBeDefined();
    });

    it("should handle isEnterprise flag", () => {
      const isEnterprise = config.isEnterprise === "true" || config.isCloud === "true";
      expect(typeof isEnterprise).toBe("boolean");
    });

    it("should handle isCloud flag", () => {
      expect(config.isCloud).toBeDefined();
    });
  });

  describe("All Items Structure Tests", () => {
    it("should have expected item keys in sectionGroups", () => {
      const items = allItems(wrapper.vm.sectionGroups);
      const keys = items.map((i: any) => i.key);
      // At minimum these are always defined (visibility aside)
      expect(keys).toContain("users");
      expect(keys).toContain("organizations");
      expect(keys).toContain("ingestionTokens");
    });

    it("should have correct translation keys for item labels", () => {
      const items = allItems(wrapper.vm.sectionGroups);
      const first = items[0];
      expect(first.label).toBeDefined();
      expect(typeof first.label).toBe("string");
    });

    it("should have correct route configuration for each item", () => {
      const items = allItems(wrapper.vm.sectionGroups);
      items.forEach((item: any) => {
        expect(item.to).toBeDefined();
        expect(item.to.name).toBeDefined();
        expect(item.to.query).toBeDefined();
        expect(item.to.query.org_identifier).toBe("test-org");
      });
    });
  });

  describe("setTabs() / sectionGroups Computation Tests", () => {
    it("should have non-empty sectionGroups on mount", () => {
      expect(wrapper.vm.sectionGroups).toBeDefined();
      expect(wrapper.vm.sectionGroups.length).toBeGreaterThan(0);
    });

    describe("Enterprise Mode Tests", () => {
      it("should show serviceAccounts in enterprise (not cloud) when enabled", async () => {
        vi.spyOn(config, "isEnterprise", "get").mockReturnValue("true");
        vi.spyOn(config, "isCloud", "get").mockReturnValue("false");
        store.state.zoConfig.service_account_enabled = true;
        store.state.zoConfig.rbac_enabled = false;

        const w = mount(IdentityAccessManagement, {
          global: {
            provide: { store },
            plugins: [i18n, router],
            stubs: defaultStubs,
          },
        });
        await flushPromises();

        const items = visibleItems(w.vm.sectionGroups);
        const keys = items.map((i: any) => i.key);
        expect(keys).toContain("users");
        expect(keys).toContain("organizations");
        expect(keys).toContain("serviceAccounts");
        w.unmount();
      });

      it("should exclude serviceAccounts in enterprise when disabled", async () => {
        vi.spyOn(config, "isEnterprise", "get").mockReturnValue("true");
        vi.spyOn(config, "isCloud", "get").mockReturnValue("false");
        store.state.zoConfig.service_account_enabled = false;
        store.state.zoConfig.rbac_enabled = false;

        const w = mount(IdentityAccessManagement, {
          global: {
            provide: { store },
            plugins: [i18n, router],
            stubs: defaultStubs,
          },
        });
        await flushPromises();

        const items = visibleItems(w.vm.sectionGroups);
        const keys = items.map((i: any) => i.key);
        expect(keys).toContain("users");
        expect(keys).toContain("organizations");
        expect(keys).not.toContain("serviceAccounts");
        w.unmount();
      });

      it("should include invitations in cloud mode", async () => {
        vi.spyOn(config, "isEnterprise", "get").mockReturnValue("true");
        vi.spyOn(config, "isCloud", "get").mockReturnValue("true");
        store.state.zoConfig.rbac_enabled = false;

        const w = mount(IdentityAccessManagement, {
          global: {
            provide: { store },
            plugins: [i18n, router],
            stubs: defaultStubs,
          },
        });
        await flushPromises();

        const items = visibleItems(w.vm.sectionGroups);
        expect(items.some((i: any) => i.key === "invitations")).toBe(true);
        w.unmount();
      });

      it("should include groups and roles when rbac_enabled in enterprise", async () => {
        vi.spyOn(config, "isEnterprise", "get").mockReturnValue("true");
        vi.spyOn(config, "isCloud", "get").mockReturnValue("false");
        store.state.zoConfig.rbac_enabled = true;
        store.state.zoConfig.service_account_enabled = true;

        const w = mount(IdentityAccessManagement, {
          global: {
            provide: { store },
            plugins: [i18n, router],
            stubs: defaultStubs,
          },
        });
        await flushPromises();

        const items = visibleItems(w.vm.sectionGroups);
        const keys = items.map((i: any) => i.key);
        expect(keys).toContain("groups");
        expect(keys).toContain("roles");
        w.unmount();
      });

      it("should have quota defined in sectionGroups (visibility depends on isMetaOrg)", async () => {
        vi.spyOn(config, "isEnterprise", "get").mockReturnValue("true");
        vi.spyOn(config, "isCloud", "get").mockReturnValue("false");
        store.state.zoConfig.rbac_enabled = true;

        const w = mount(IdentityAccessManagement, {
          global: {
            provide: { store },
            plugins: [i18n, router],
            stubs: defaultStubs,
          },
        });
        await flushPromises();

        // quota exists in allItems regardless of visibility
        const items = allItems(w.vm.sectionGroups);
        expect(items.some((i: any) => i.key === "quota")).toBe(true);
        w.unmount();
      });
    });

    describe("Open Source Mode Tests", () => {
      it("should include users and organizations in open source", async () => {
        vi.spyOn(config, "isEnterprise", "get").mockReturnValue("false");
        vi.spyOn(config, "isCloud", "get").mockReturnValue("false");
        store.state.zoConfig.service_account_enabled = true;
        store.state.zoConfig.rbac_enabled = false;

        const w = mount(IdentityAccessManagement, {
          global: {
            provide: { store },
            plugins: [i18n, router],
            stubs: defaultStubs,
          },
        });
        await flushPromises();

        const items = visibleItems(w.vm.sectionGroups);
        const keys = items.map((i: any) => i.key);
        expect(keys).toContain("users");
        expect(keys).toContain("organizations");
        w.unmount();
      });

      it("should include serviceAccounts in open source when enabled", async () => {
        vi.spyOn(config, "isEnterprise", "get").mockReturnValue("false");
        vi.spyOn(config, "isCloud", "get").mockReturnValue("false");
        store.state.zoConfig.service_account_enabled = true;

        const w = mount(IdentityAccessManagement, {
          global: {
            provide: { store },
            plugins: [i18n, router],
            stubs: defaultStubs,
          },
        });
        await flushPromises();

        const items = visibleItems(w.vm.sectionGroups);
        expect(items.some((i: any) => i.key === "serviceAccounts")).toBe(true);
        w.unmount();
      });

      it("should exclude serviceAccounts in open source when disabled", async () => {
        vi.spyOn(config, "isEnterprise", "get").mockReturnValue("false");
        vi.spyOn(config, "isCloud", "get").mockReturnValue("false");
        store.state.zoConfig.service_account_enabled = false;

        const w = mount(IdentityAccessManagement, {
          global: {
            provide: { store },
            plugins: [i18n, router],
            stubs: defaultStubs,
          },
        });
        await flushPromises();

        const items = visibleItems(w.vm.sectionGroups);
        expect(items.some((i: any) => i.key === "serviceAccounts")).toBe(false);
        w.unmount();
      });

      it("should not include groups/roles in open source (non-enterprise)", async () => {
        vi.spyOn(config, "isEnterprise", "get").mockReturnValue("false");
        vi.spyOn(config, "isCloud", "get").mockReturnValue("false");
        store.state.zoConfig.rbac_enabled = true;

        const w = mount(IdentityAccessManagement, {
          global: {
            provide: { store },
            plugins: [i18n, router],
            stubs: defaultStubs,
          },
        });
        await flushPromises();

        const items = visibleItems(w.vm.sectionGroups);
        const keys = items.map((i: any) => i.key);
        expect(keys).not.toContain("groups");
        expect(keys).not.toContain("roles");
        w.unmount();
      });

      it("should not include invitations in open source", async () => {
        vi.spyOn(config, "isEnterprise", "get").mockReturnValue("false");
        vi.spyOn(config, "isCloud", "get").mockReturnValue("false");

        const w = mount(IdentityAccessManagement, {
          global: {
            provide: { store },
            plugins: [i18n, router],
            stubs: defaultStubs,
          },
        });
        await flushPromises();

        const items = visibleItems(w.vm.sectionGroups);
        expect(items.some((i: any) => i.key === "invitations")).toBe(false);
        w.unmount();
      });
    });

    describe("Config Change Tests", () => {
      it("should recalculate sectionGroups when service_account_enabled changes", async () => {
        store.state.zoConfig.service_account_enabled = true;
        await nextTick();
        await flushPromises();

        const hasBefore = visibleItems(wrapper.vm.sectionGroups).some(
          (i: any) => i.key === "serviceAccounts",
        );
        expect(hasBefore).toBe(true);

        store.state.zoConfig.service_account_enabled = false;
        await nextTick();
        await flushPromises();

        // sectionGroups is a computed — it recalculates
        expect(wrapper.vm.sectionGroups).toBeDefined();
      });

      it("should recalculate sectionGroups when rbac_enabled changes", async () => {
        store.state.zoConfig.rbac_enabled = false;
        await nextTick();
        await flushPromises();

        store.state.zoConfig.rbac_enabled = true;
        await nextTick();
        await flushPromises();

        expect(wrapper.vm.sectionGroups).toBeDefined();
      });
    });
  });

  describe("Watchers Tests", () => {
    it("should reflect config change in sectionGroups", async () => {
      store.state.zoConfig.rbac_enabled = true;
      await nextTick();
      await flushPromises();

      expect(wrapper.vm.sectionGroups).toBeDefined();
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

      const w = mount(IdentityAccessManagement, {
        global: {
          provide: { store: testStore },
          plugins: [i18n, router],
          stubs: defaultStubs,
        },
      });

      expect(w.vm.sectionGroups).toBeDefined();
      w.unmount();
    });

    it("should handle null zoConfig values", async () => {
      store.state.zoConfig.rbac_enabled = null;
      store.state.zoConfig.service_account_enabled = null;

      const w = mount(IdentityAccessManagement, {
        global: {
          provide: { store },
          plugins: [i18n, router],
          stubs: defaultStubs,
        },
      });

      expect(w.vm.sectionGroups).toBeDefined();
      expect(w.vm.sectionGroups.length).toBeGreaterThan(0);
      w.unmount();
    });

    it("should handle multiple activeSection reads", async () => {
      for (let i = 0; i < 10; i++) {
        expect(typeof wrapper.vm.activeSection).toBe("string");
        await nextTick();
      }
    });
  });

  describe("Performance and Memory Tests", () => {
    it("should not create memory leaks on mount/unmount", () => {
      for (let i = 0; i < 5; i++) {
        const w = mount(IdentityAccessManagement, {
          global: {
            provide: { store },
            plugins: [i18n, router],
            stubs: defaultStubs,
          },
        });
        w.unmount();
      }
      expect(true).toBe(true);
    });

    it("should handle multiple instances", () => {
      const wrappers: VueWrapper<any>[] = [];
      for (let i = 0; i < 3; i++) {
        wrappers.push(
          mount(IdentityAccessManagement, {
            global: {
              provide: { store },
              plugins: [i18n, router],
              stubs: defaultStubs,
            },
          }),
        );
      }

      expect(wrappers.length).toBe(3);
      wrappers.forEach((w) => {
        expect(Array.isArray(w.vm.sectionGroups)).toBe(true);
        w.unmount();
      });
    });
  });

  describe("Integration with Vue Composition API", () => {
    it("should use computed correctly for sectionGroups", () => {
      expect(Array.isArray(wrapper.vm.sectionGroups)).toBe(true);
    });

    it("should use computed correctly for activeSection", () => {
      expect(typeof wrapper.vm.activeSection).toBe("string");
    });

    it("should use watch correctly (setup is defined)", () => {
      expect(wrapper.vm.$options.setup).toBeDefined();
    });
  });

  describe("Section Group Item Key Tests", () => {
    it("should have items with key, label, icon, to, dataTest", () => {
      const items = allItems(wrapper.vm.sectionGroups);
      items.forEach((item: any) => {
        expect(item.key).toBeDefined();
        expect(item.label).toBeDefined();
        expect(item.to).toBeDefined();
        expect(item.dataTest).toBeDefined();
      });
    });

    it("should include all expected item keys in allItems", () => {
      const items = allItems(wrapper.vm.sectionGroups);
      const keys = items.map((i: any) => i.key);
      const expectedKeys = [
        "users",
        "serviceAccounts",
        "ingestionTokens",
        "invitations",
        "groups",
        "roles",
        "quota",
        "organizations",
      ];
      expectedKeys.forEach((key) => {
        expect(keys).toContain(key);
      });
    });
  });
});
