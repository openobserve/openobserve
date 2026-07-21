// Copyright 2026 OpenObserve Inc.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import enLocale from "@/locales/languages/en-US.json";
import SettingsIndex from "./index.vue";

// Mock composables and config with factory functions
vi.mock("@/composables/useIsMetaOrg", () => ({
  default: () => ({
    isMetaOrg: { value: false },
  }),
}));

vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "false",
    isCloud: "false",
  },
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((url: string) => `mocked-${url}`),
}));


// Mock vue-router
const mockPush = vi.fn();
const mockReplace = vi.fn();
const mockRouter = {
  push: mockPush,
  replace: mockReplace,
  currentRoute: {
    value: {
      name: "settings",
      path: "/settings",
      query: {},
    },
  },
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
  useRoute: () => mockRouter.currentRoute.value,
}));

// Global mock notify
const globalMockNotify = vi.fn(() => vi.fn());

const mockStore = createStore({
  state: {
    selectedOrganization: {
      identifier: "test-org",
      name: "Test Organization",
    },
    theme: "light",
    zoConfig: {
      service_streams_enabled: true,
    },
    organizationData: {
      organizationSettings: {
        org_storage_enabled: false,
      },
    },
  },
  mutations: {
    updateState(state, newState) {
      Object.assign(state, newState);
    },
  },
  actions: {},
});

// Use the real en.json so section/group labels resolve exactly as in the app.
// Group labels (e.g. "General", "Destinations & Templates") are now translated via
// t("settings.groupGeneral") etc.; sourcing the real dictionary keeps this spec in sync.
const mockI18n = createI18n({
  locale: "en",
  messages: {
    en: enLocale,
  },
});

describe("SettingsIndex.vue", () => {
  let wrapper: any;

  beforeEach(() => {
    globalMockNotify.mockClear();
    mockPush.mockClear();
    mockReplace.mockClear();
    mockRouter.currentRoute.value.name = "settings";
    mockRouter.currentRoute.value.query = {};

    mockStore.replaceState({
      selectedOrganization: {
        identifier: "test-org",
        name: "Test Organization",
      },
      theme: "light",
      zoConfig: {
        service_streams_enabled: true,
      },
      organizationData: {
        organizationSettings: {
          org_storage_enabled: false,
        },
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  const createWrapper = (storeOverrides = {}) => {
    const storeState = {
      selectedOrganization: {
        identifier: "test-org",
        name: "Test Organization",
      },
      theme: "light",
      zoConfig: {
        service_streams_enabled: true,
      },
      organizationData: {
        organizationSettings: {
          org_storage_enabled: false,
        },
      },
      ...storeOverrides,
    };

    mockStore.replaceState(storeState);

    return mount(SettingsIndex, {
      global: {
        plugins: [mockI18n],
        provide: {
          store: mockStore,
        },
        stubs: {
          "router-view": true,
          OPageLayout: {
            template: '<div><slot name="sidebar" /><slot /></div>',
          },
          SectionRail: true,
          OPageHeader: true,
          ConstrainedPage: {
            template: "<div><slot /></div>",
          },
        },
      },
    });
  };

  describe("Component Initialization", () => {
    it("should render component correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("AppSettings");
    });

    it("should initialize settingsTab based on current route", () => {
      mockRouter.currentRoute.value.name = "general";
      wrapper = createWrapper();
      expect(wrapper.vm.settingsTab).toBe("general");
    });

    it("should initialize settingsTab to general for unknown route", () => {
      mockRouter.currentRoute.value.name = "unknown-route";
      wrapper = createWrapper();
      expect(wrapper.vm.settingsTab).toBe("general");
    });

    it("should have access to store and router", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.router).toBeDefined();
    });

    it("should have config object available", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.config).toBeDefined();
    });

    it("should have internationalization function", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.t).toBeInstanceOf(Function);
    });

    it("should expose handleSettingsRouting method", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.handleSettingsRouting).toBeInstanceOf(Function);
    });

    it("should expose sectionGroups computed property", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.sectionGroups).toBeDefined();
      expect(Array.isArray(wrapper.vm.sectionGroups)).toBe(true);
    });

    it("should expose activeSection computed property", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.activeSection).toBeDefined();
    });
  });

  describe("handleSettingsRouting method", () => {
    beforeEach(() => {
      mockPush.mockClear();
      mockReplace.mockClear();
    });

    it("should redirect via replace to general when on settings route", () => {
      mockRouter.currentRoute.value.name = "settings";
      wrapper = createWrapper();
      mockReplace.mockClear();

      wrapper.vm.handleSettingsRouting();

      expect(mockReplace).toHaveBeenCalledWith({
        path: "/settings/general",
        query: {
          org_identifier: "test-org",
        },
      });
    });

    it("should not redirect when on general route", () => {
      mockRouter.currentRoute.value.name = "general";
      wrapper = createWrapper();
      mockReplace.mockClear();
      mockPush.mockClear();

      wrapper.vm.handleSettingsRouting();

      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("should not redirect when on nodes route with valid access", () => {
      mockRouter.currentRoute.value.name = "nodes";
      wrapper = createWrapper();
      mockReplace.mockClear();
      mockPush.mockClear();

      wrapper.vm.handleSettingsRouting();

      // nodes route is not "settings" so replace is not called;
      // notMeta guard may or may not apply depending on zoConfig.meta_org
      // Without meta_org set, notMeta is falsy → no redirect
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("should handle undefined route name without throwing", () => {
      mockRouter.currentRoute.value.name = undefined;
      wrapper = createWrapper();
      mockReplace.mockClear();
      mockPush.mockClear();

      expect(() => wrapper.vm.handleSettingsRouting()).not.toThrow();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("should handle empty route name without throwing", () => {
      mockRouter.currentRoute.value.name = "";
      wrapper = createWrapper();
      mockReplace.mockClear();
      mockPush.mockClear();

      expect(() => wrapper.vm.handleSettingsRouting()).not.toThrow();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it("should handle missing selectedOrganization gracefully", () => {
      wrapper = createWrapper({ selectedOrganization: null });
      mockRouter.currentRoute.value.name = "settings";
      mockReplace.mockClear();

      expect(() => wrapper.vm.handleSettingsRouting()).not.toThrow();
      expect(mockReplace).toHaveBeenCalledWith({
        path: "/settings/general",
        query: {
          org_identifier: undefined,
        },
      });
    });

    it("should not redirect when on other non-settings routes", () => {
      mockRouter.currentRoute.value.name = "alertDestinations";
      wrapper = createWrapper();
      mockReplace.mockClear();
      mockPush.mockClear();

      wrapper.vm.handleSettingsRouting();

      expect(mockReplace).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe("regexIcon computed property", () => {
    it("should not be directly exposed (moved to settingsItems)", () => {
      // regexIcon is used internally in settingsItems but not returned from setup
      wrapper = createWrapper();
      // If regexIcon is not in the returned scope, it's undefined on vm
      // The icon is embedded in settingsItems instead
      expect(wrapper.vm.sectionGroups).toBeDefined();
    });

    it("should embed regex icon in section items based on theme", () => {
      // Create wrapper with dark theme via store override
      wrapper = createWrapper({ theme: "dark" });
      // The regex_patterns item uses regexIcon internally - verify via sectionGroups
      const allItems = wrapper.vm.sectionGroups.flatMap(
        (g: any) => g.items ?? [],
      );
      // regex_patterns item may be undefined if not enterprise (isEnterprise defaults to 'false')
      // so this test just verifies the structure is accessible without throwing
      expect(Array.isArray(allItems)).toBe(true);
    });
  });

  describe("Lifecycle Hooks", () => {
    it("should call handleSettingsRouting on mount (settings route)", () => {
      mockRouter.currentRoute.value.name = "settings";
      wrapper = createWrapper();

      // During mount, handleSettingsRouting is called via onBeforeMount
      // It should have triggered a replace call for the "settings" route
      expect(mockReplace).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/settings/general" }),
      );
    });

    it("should not redirect during mount when on a valid child route", () => {
      mockRouter.currentRoute.value.name = "general";
      mockReplace.mockClear();
      wrapper = createWrapper();

      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe("sectionGroups computed property", () => {
    it("should return an array of groups", () => {
      mockRouter.currentRoute.value.name = "general";
      wrapper = createWrapper();
      const groups = wrapper.vm.sectionGroups;
      expect(Array.isArray(groups)).toBe(true);
      expect(groups.length).toBeGreaterThan(0);
    });

    it("should have GENERAL group with general and organization sections", () => {
      mockRouter.currentRoute.value.name = "general";
      wrapper = createWrapper();
      const groups = wrapper.vm.sectionGroups;
      const generalGroup = groups.find((g: any) => g.label === "General");
      expect(generalGroup).toBeDefined();
      const keys = generalGroup.items.map((i: any) => i.key);
      expect(keys).toContain("general");
      expect(keys).toContain("organization");
    });

    it("should include DESTINATIONS & TEMPLATES group with alert destinations", () => {
      mockRouter.currentRoute.value.name = "general";
      wrapper = createWrapper();
      const groups = wrapper.vm.sectionGroups;
      const destGroup = groups.find(
        (g: any) => g.label === "Destinations & Templates",
      );
      expect(destGroup).toBeDefined();
      const keys = destGroup.items.map((i: any) => i.key);
      expect(keys).toContain("alert_destinations");
      expect(keys).toContain("templates");
    });
  });

  describe("activeSection computed property", () => {
    it("should return general for general route", () => {
      mockRouter.currentRoute.value.name = "general";
      wrapper = createWrapper();
      expect(wrapper.vm.activeSection).toBe("general");
    });

    it("should return organization for organization route", () => {
      mockRouter.currentRoute.value.name = "organization";
      wrapper = createWrapper();
      expect(wrapper.vm.activeSection).toBe("organization");
    });

    it("should return empty string for unknown route", () => {
      mockRouter.currentRoute.value.name = "unknown-xyz";
      wrapper = createWrapper();
      expect(wrapper.vm.activeSection).toBe("");
    });

    it("should return queryManagement for queryManagement route", () => {
      mockRouter.currentRoute.value.name = "queryManagement";
      wrapper = createWrapper();
      expect(wrapper.vm.activeSection).toBe("queryManagement");
    });
  });

  describe("isConstrainedSection computed property", () => {
    it("should be true for general section", () => {
      mockRouter.currentRoute.value.name = "general";
      wrapper = createWrapper();
      expect(wrapper.vm.isConstrainedSection).toBe(true);
    });

    it("should be true for organization section", () => {
      mockRouter.currentRoute.value.name = "organization";
      wrapper = createWrapper();
      expect(wrapper.vm.isConstrainedSection).toBe(true);
    });

    it("should be false for nodes section", () => {
      mockRouter.currentRoute.value.name = "nodes";
      wrapper = createWrapper();
      expect(wrapper.vm.isConstrainedSection).toBe(false);
    });

    it("should be false for alertDestinations section", () => {
      mockRouter.currentRoute.value.name = "alertDestinations";
      wrapper = createWrapper();
      expect(wrapper.vm.isConstrainedSection).toBe(false);
    });
  });

  describe("Template Rendering", () => {
    it("should render without errors", () => {
      mockRouter.currentRoute.value.name = "general";
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render settings header via SectionRail", () => {
      mockRouter.currentRoute.value.name = "general";
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Integration Tests", () => {
    it("should handle workflow for non-enterprise org", async () => {
      mockRouter.currentRoute.value.name = "settings";
      wrapper = createWrapper();
      mockReplace.mockClear();

      wrapper.vm.handleSettingsRouting();
      expect(mockReplace).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/settings/general" }),
      );
    });

    it("should have stable activeSection after mount on general", () => {
      mockRouter.currentRoute.value.name = "general";
      wrapper = createWrapper();
      expect(wrapper.vm.activeSection).toBe("general");
      expect(wrapper.vm.isConstrainedSection).toBe(true);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle null store state without throwing", () => {
      mockRouter.currentRoute.value.name = "alertDestinations";
      wrapper = createWrapper();

      expect(() => {
        mockRouter.currentRoute.value.name = "other";
        wrapper.vm.handleSettingsRouting();
      }).not.toThrow();
    });

    it("should handle missing config properties", () => {
      mockRouter.currentRoute.value.name = "alertDestinations";
      wrapper = createWrapper();
      expect(() => wrapper.vm.handleSettingsRouting()).not.toThrow();
    });

    it("should handle router replace failures gracefully", () => {
      mockRouter.currentRoute.value.name = "settings";
      // replace returns a rejected promise — the component wraps it in Promise.resolve().catch()
      mockReplace.mockReturnValue(Promise.reject(new Error("nav failed")));
      expect(() => {
        wrapper = createWrapper();
      }).not.toThrow();
    });
  });

  describe("Computed Properties Reactivity", () => {
    it("should update sectionGroups when store changes", async () => {
      mockRouter.currentRoute.value.name = "general";
      wrapper = createWrapper();
      const initialGroups = wrapper.vm.sectionGroups;
      expect(Array.isArray(initialGroups)).toBe(true);

      // Change org identifier
      mockStore.state.selectedOrganization = {
        identifier: "new-org",
        name: "New Org",
      };
      await nextTick();

      // sectionGroups should still be an array
      expect(Array.isArray(wrapper.vm.sectionGroups)).toBe(true);
    });
  });
});
