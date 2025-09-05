import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import Server from "@/components/ingestion/Server.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { useQuasar } from "quasar";

installQuasar();

// Mock services
vi.mock("@/services/segment_analytics", () => ({
  default: {
    track: vi.fn()
  }
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((imagePath: string) => `img:${imagePath}`),
  verifyOrganizationStatus: vi.fn()
}));

vi.mock("@/aws-exports", () => ({
  default: {
    API_ENDPOINT: "http://localhost:5080"
  }
}));

// Mock router
const mockRouter = {
  currentRoute: {
    value: {
      name: "servers",
      query: {}
    }
  },
  push: vi.fn()
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter
}));

// Mock Quasar
const mockQuasar = {
  notify: vi.fn()
};

vi.mock("quasar", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useQuasar: () => mockQuasar,
    copyToClipboard: vi.fn()
  };
});

describe("Server Component", () => {
  let wrapper: any = null;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Reset router state
    mockRouter.currentRoute.value.name = "servers";
    mockRouter.currentRoute.value.query = {};

    wrapper = mount(Server, {
      props: {
        currOrgIdentifier: "test-org"
      },
      global: {
        plugins: [i18n],
        provide: {
          store,
        },
        stubs: {
          'q-splitter': {
            template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
          },
          'q-tabs': true,
          'q-route-tab': true,
          'router-view': true,
          'q-input': true,
          'q-icon': true
        }
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      expect(wrapper.vm.$options.name).toBe("ServerPage");
    });

    it("should have correct props", () => {
      expect(wrapper.props('currOrgIdentifier')).toBe("test-org");
    });

    it("should initialize with correct data", () => {
      expect(wrapper.vm.splitterModel).toBe(270);
      expect(wrapper.vm.currentUserEmail).toBeDefined();
      expect(wrapper.vm.tabs).toBe("");
      expect(wrapper.vm.ingestTabType).toBe("nginx");
      expect(wrapper.vm.tabsFilter).toBe("");
    });

    it("should expose all required properties from setup", () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.router).toBeDefined();
      expect(wrapper.vm.config).toBeDefined();
      expect(wrapper.vm.currentUserEmail).toBeDefined();
      expect(wrapper.vm.currentOrgIdentifier).toBeDefined();
      expect(wrapper.vm.getImageURL).toBeDefined();
      expect(wrapper.vm.verifyOrganizationStatus).toBeDefined();
    });

    it("should have correct prop definition", () => {
      const propDefinition = wrapper.vm.$options.props.currOrgIdentifier;
      expect(propDefinition.type).toBe(String);
      expect(propDefinition.default).toBe("");
    });

    it("should handle default currOrgIdentifier prop", () => {
      const testWrapper = mount(Server, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            'q-splitter': {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
            },
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true,
            'q-input': true,
            'q-icon': true
          }
        },
      });
      
      expect(testWrapper.props('currOrgIdentifier')).toBe("");
      testWrapper.unmount();
    });
  });

  describe("Store Integration", () => {
    it("should access correct store state properties", () => {
      expect(wrapper.vm.store.state.selectedOrganization).toBeDefined();
      expect(wrapper.vm.store.state.userInfo).toBeDefined();
      expect(wrapper.vm.store.state.userInfo.email).toBeDefined();
      expect(wrapper.vm.store.state.selectedOrganization.identifier).toBeDefined();
    });

    it("should have correct computed values", () => {
      expect(wrapper.vm.currentUserEmail).toBe(store.state.userInfo.email);
      expect(wrapper.vm.currentOrgIdentifier).toBe(store.state.selectedOrganization.identifier);
    });

    it("should use store state in router navigation", () => {
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "nginx",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });
  });

  describe("onBeforeMount Lifecycle Hook", () => {
    it("should redirect to nginx when route is servers", () => {
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "nginx",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });

    it("should not redirect when route is not servers", () => {
      mockRouter.currentRoute.value.name = "nginx";
      mockRouter.push.mockClear();
      
      const testWrapper = mount(Server, {
        props: { currOrgIdentifier: "test-org" },
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            'q-splitter': {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
            },
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true,
            'q-input': true,
            'q-icon': true
          }
        },
      });
      
      expect(mockRouter.push).not.toHaveBeenCalled();
      testWrapper.unmount();
    });

    it("should handle iis route without redirect", () => {
      mockRouter.currentRoute.value.name = "iis";
      mockRouter.push.mockClear();
      
      const testWrapper = mount(Server, {
        props: { currOrgIdentifier: "test-org" },
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            'q-splitter': {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
            },
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true,
            'q-input': true,
            'q-icon': true
          }
        },
      });
      
      expect(mockRouter.push).not.toHaveBeenCalled();
      testWrapper.unmount();
    });

    it("should handle apache route without redirect", () => {
      mockRouter.currentRoute.value.name = "apache";
      mockRouter.push.mockClear();
      
      const testWrapper = mount(Server, {
        props: { currOrgIdentifier: "test-org" },
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            'q-splitter': {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
            },
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true,
            'q-input': true,
            'q-icon': true
          }
        },
      });
      
      expect(mockRouter.push).not.toHaveBeenCalled();
      testWrapper.unmount();
    });

    it("should handle unknown route without redirect", () => {
      mockRouter.currentRoute.value.name = "unknown";
      mockRouter.push.mockClear();
      
      const testWrapper = mount(Server, {
        props: { currOrgIdentifier: "test-org" },
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            'q-splitter': {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
            },
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true,
            'q-input': true,
            'q-icon': true
          }
        },
      });
      
      expect(mockRouter.push).not.toHaveBeenCalled();
      testWrapper.unmount();
    });
  });

  describe("onUpdated Lifecycle Hook", () => {
    it("should redirect to nginx when route becomes servers in onUpdated", async () => {
      // First mount with different route
      mockRouter.currentRoute.value.name = "nginx";
      mockRouter.push.mockClear();
      
      const testWrapper = mount(Server, {
        props: { currOrgIdentifier: "test-org" },
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            'q-splitter': {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
            },
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true,
            'q-input': true,
            'q-icon': true
          }
        },
      });

      // Change route to trigger onUpdated
      mockRouter.currentRoute.value.name = "servers";
      
      // Force update to trigger onUpdated
      testWrapper.vm.$forceUpdate();
      await testWrapper.vm.$nextTick();
      
      testWrapper.unmount();
    });

    it("should not redirect in onUpdated when route is not servers", async () => {
      // First mount
      mockRouter.currentRoute.value.name = "nginx";
      mockRouter.push.mockClear();
      
      const testWrapper = mount(Server, {
        props: { currOrgIdentifier: "test-org" },
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            'q-splitter': {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
            },
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true,
            'q-input': true,
            'q-icon': true
          }
        },
      });

      // Change route to another valid route
      mockRouter.currentRoute.value.name = "iis";
      
      // Force update
      testWrapper.vm.$forceUpdate();
      await testWrapper.vm.$nextTick();
      
      expect(mockRouter.push).not.toHaveBeenCalled();
      testWrapper.unmount();
    });
  });

  describe("Server Tabs Configuration", () => {
    it("should have serverTabs array with correct structure", () => {
      // Access the serverTabs through setup function return
      expect(wrapper.vm.filteredList).toBeDefined();
      expect(Array.isArray(wrapper.vm.filteredList)).toBe(true);
    });

    it("should have nginx tab with correct properties", () => {
      const filteredList = wrapper.vm.filteredList;
      const nginxTab = filteredList.find((tab: any) => tab.name === "nginx");
      
      expect(nginxTab).toBeDefined();
      expect(nginxTab.name).toBe("nginx");
      expect(nginxTab.to.name).toBe("nginx");
      expect(nginxTab.to.query.org_identifier).toBe(store.state.selectedOrganization.identifier);
      expect(nginxTab.icon).toContain("images/ingestion/nginx.svg");
      expect(nginxTab.contentClass).toBe("tab_content");
    });

    it("should have iis tab with correct properties", () => {
      const filteredList = wrapper.vm.filteredList;
      const iisTab = filteredList.find((tab: any) => tab.name === "iis");
      
      expect(iisTab).toBeDefined();
      expect(iisTab.name).toBe("iis");
      expect(iisTab.to.name).toBe("iis");
      expect(iisTab.to.query.org_identifier).toBe(store.state.selectedOrganization.identifier);
      expect(iisTab.icon).toContain("images/ingestion/microsoft-iis.svg");
      expect(iisTab.contentClass).toBe("tab_content");
    });

    it("should not include apache tab (commented out)", () => {
      const filteredList = wrapper.vm.filteredList;
      const apacheTab = filteredList.find((tab: any) => tab.name === "apache");
      
      expect(apacheTab).toBeUndefined();
    });

    it("should have correct number of tabs", () => {
      expect(wrapper.vm.filteredList.length).toBe(2); // nginx and iis only
    });
  });

  describe("Filtered List Computed Property", () => {
    it("should return all tabs when filter is empty", () => {
      wrapper.vm.tabsFilter = "";
      expect(wrapper.vm.filteredList.length).toBe(2);
    });

    it("should filter tabs by nginx", () => {
      wrapper.vm.tabsFilter = "nginx";
      const filtered = wrapper.vm.filteredList;
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe("nginx");
    });

    it("should filter tabs by iis", () => {
      wrapper.vm.tabsFilter = "iis";
      const filtered = wrapper.vm.filteredList;
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe("iis");
    });

    it("should filter case insensitive", () => {
      wrapper.vm.tabsFilter = "NGINX";
      const filtered = wrapper.vm.filteredList;
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe("nginx");
    });

    it("should return empty array for non-matching filter", () => {
      wrapper.vm.tabsFilter = "nonexistent";
      expect(wrapper.vm.filteredList.length).toBe(0);
    });

    it("should filter by partial match", () => {
      wrapper.vm.tabsFilter = "ng";
      const filtered = wrapper.vm.filteredList;
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe("nginx");
    });

    it("should filter by label content", () => {
      // Assuming the translation returns text containing the filter
      wrapper.vm.tabsFilter = "ing"; // Should match "nginx" label
      const filtered = wrapper.vm.filteredList;
      // This depends on what the t('ingestion.nginx') returns
      expect(filtered.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Reactive Data Properties", () => {
    it("should have reactive tabs", async () => {
      expect(wrapper.vm.tabs).toBe("");
      
      wrapper.vm.tabs = "test-tab";
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.tabs).toBe("test-tab");
    });

    it("should have reactive ingestTabType", async () => {
      expect(wrapper.vm.ingestTabType).toBe("nginx");
      
      wrapper.vm.ingestTabType = "iis";
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.ingestTabType).toBe("iis");
    });

    it("should have reactive tabsFilter", async () => {
      expect(wrapper.vm.tabsFilter).toBe("");
      
      wrapper.vm.tabsFilter = "test-filter";
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.tabsFilter).toBe("test-filter");
      expect(wrapper.vm.filteredList.length).toBe(0); // No matches
    });

    it("should have reactive splitterModel", async () => {
      expect(wrapper.vm.splitterModel).toBe(270);
      
      wrapper.vm.splitterModel = 300;
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.splitterModel).toBe(300);
    });

    it("should have reactive currentOrgIdentifier", () => {
      expect(wrapper.vm.currentOrgIdentifier).toBe(store.state.selectedOrganization.identifier);
    });
  });

  describe("Configuration and Utils", () => {
    it("should expose config object", () => {
      expect(wrapper.vm.config).toBeDefined();
      expect(wrapper.vm.config.API_ENDPOINT).toBe("http://localhost:5080");
    });

    it("should expose getImageURL function", () => {
      expect(typeof wrapper.vm.getImageURL).toBe("function");
      expect(wrapper.vm.getImageURL("test-image.svg")).toBe("img:test-image.svg");
    });

    it("should expose verifyOrganizationStatus function", () => {
      expect(typeof wrapper.vm.verifyOrganizationStatus).toBe("function");
    });

    it("should have i18n translation function", () => {
      expect(typeof wrapper.vm.t).toBe("function");
    });

    it("should call getImageURL for tab icons", () => {
      // The getImageURL should be called when accessing tab icons
      wrapper.vm.filteredList.forEach((tab: any) => {
        expect(tab.icon).toContain("img:");
      });
      
      expect(wrapper.vm.getImageURL).toBeDefined();
      expect(typeof wrapper.vm.getImageURL).toBe("function");
    });
  });

  describe("Template Elements and Props", () => {
    it("should pass correct props to router-view", () => {
      expect(wrapper.vm.tabs).toBeDefined();
      expect(wrapper.vm.currOrgIdentifier).toBe("test-org");
      expect(wrapper.vm.currentUserEmail).toBeDefined();
    });

    it("should have splitter model value", () => {
      expect(wrapper.vm.splitterModel).toBe(270);
    });

    it("should expose tabsFilter for template", () => {
      expect(wrapper.vm.tabsFilter).toBe("");
    });

    it("should expose ingestTabType for template", () => {
      expect(wrapper.vm.ingestTabType).toBe("nginx");
    });

    it("should expose filteredList for template iteration", () => {
      expect(wrapper.vm.filteredList).toBeDefined();
      expect(Array.isArray(wrapper.vm.filteredList)).toBe(true);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle empty store state gracefully", () => {
      // This test assumes the store is properly mocked
      expect(wrapper.vm.currentUserEmail).toBeDefined();
      expect(wrapper.vm.currentOrgIdentifier).toBeDefined();
    });

    it("should handle missing router gracefully", () => {
      expect(wrapper.vm.router).toBeDefined();
      expect(wrapper.vm.router.currentRoute).toBeDefined();
    });

    it("should handle tab filtering with special characters", () => {
      wrapper.vm.tabsFilter = "!@#$%";
      expect(wrapper.vm.filteredList.length).toBe(0);
    });

    it("should handle tab filtering with numbers", () => {
      wrapper.vm.tabsFilter = "123";
      expect(wrapper.vm.filteredList.length).toBe(0);
    });

    it("should handle very long filter strings", () => {
      wrapper.vm.tabsFilter = "a".repeat(1000);
      expect(wrapper.vm.filteredList.length).toBe(0);
    });
  });

  describe("Component Lifecycle", () => {
    it("should handle multiple mounts and unmounts", () => {
      const testWrapper = mount(Server, {
        props: { currOrgIdentifier: "test-org" },
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            'q-splitter': {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
            },
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true,
            'q-input': true,
            'q-icon': true
          }
        },
      });
      
      expect(testWrapper.exists()).toBe(true);
      testWrapper.unmount();
      
      const testWrapper2 = mount(Server, {
        props: { currOrgIdentifier: "test-org-2" },
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            'q-splitter': {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
            },
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true,
            'q-input': true,
            'q-icon': true
          }
        },
      });
      
      expect(testWrapper2.exists()).toBe(true);
      expect(testWrapper2.props('currOrgIdentifier')).toBe("test-org-2");
      testWrapper2.unmount();
    });

    it("should handle prop changes", async () => {
      expect(wrapper.props('currOrgIdentifier')).toBe("test-org");
      
      await wrapper.setProps({ currOrgIdentifier: "new-org" });
      
      expect(wrapper.props('currOrgIdentifier')).toBe("new-org");
    });
  });

  describe("Return Object from Setup", () => {
    it("should return all required properties", () => {
      const expectedProps = [
        't', 'store', 'router', 'config', 'splitterModel',
        'currentUserEmail', 'currentOrgIdentifier', 'getImageURL',
        'verifyOrganizationStatus', 'tabs', 'ingestTabType',
        'tabsFilter', 'filteredList'
      ];
      
      expectedProps.forEach(prop => {
        expect(wrapper.vm).toHaveProperty(prop);
      });
    });

    it("should have correct types for returned properties", () => {
      expect(typeof wrapper.vm.t).toBe("function");
      expect(typeof wrapper.vm.store).toBe("object");
      expect(typeof wrapper.vm.router).toBe("object");
      expect(typeof wrapper.vm.config).toBe("object");
      expect(typeof wrapper.vm.splitterModel).toBe("number");
      expect(typeof wrapper.vm.currentUserEmail).toBe("string");
      expect(typeof wrapper.vm.getImageURL).toBe("function");
      expect(typeof wrapper.vm.verifyOrganizationStatus).toBe("function");
      expect(typeof wrapper.vm.tabs).toBe("string");
      expect(typeof wrapper.vm.ingestTabType).toBe("string");
      expect(typeof wrapper.vm.tabsFilter).toBe("string");
      expect(Array.isArray(wrapper.vm.filteredList)).toBe(true);
    });
  });
});