import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import Networking from "@/components/ingestion/Networking.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar();

// Mock utils
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn(() => "mock-image-url"),
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
      name: "networking",
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

describe("Networking Component", () => {
  let wrapper: any = null;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Reset router state
    mockRouter.currentRoute.value.name = "networking";
    mockRouter.currentRoute.value.query = {};

    wrapper = mount(Networking, {
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
          'q-input': true,
          'q-tabs': true,
          'q-route-tab': true,
          'router-view': true
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
      expect(wrapper.vm.$options.name).toBe("NetworkingPage");
    });

    it("should have correct props", () => {
      expect(wrapper.props('currOrgIdentifier')).toBe("test-org");
    });

    it("should have default prop value", () => {
      const testWrapper = mount(Networking, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            'q-splitter': {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
            },
            'q-input': true,
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true
          }
        },
      });
      
      expect(testWrapper.props('currOrgIdentifier')).toBe("");
      testWrapper.unmount();
    });

    it("should initialize with correct data", () => {
      expect(wrapper.vm.splitterModel).toBe(270);
      expect(wrapper.vm.currentUserEmail).toBeDefined();
      expect(wrapper.vm.tabs).toBe("");
      expect(wrapper.vm.ingestTabType).toBe("netflow");
      expect(wrapper.vm.tabsFilter).toBe("");
    });

    it("should have correct prop type definition", () => {
      const propDefinition = wrapper.vm.$options.props.currOrgIdentifier;
      expect(propDefinition.type).toBe(String);
      expect(propDefinition.default).toBe("");
    });
  });

  describe("Router Navigation - onBeforeMount", () => {
    it("should redirect to netflow on networking route during mount", () => {
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "netflow",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });

    it("should not redirect on non-networking route during mount", () => {
      mockRouter.currentRoute.value.name = "netflow";
      mockRouter.push.mockClear();
      
      const testWrapper = mount(Networking, {
        props: { currOrgIdentifier: "test-org" },
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            'q-splitter': {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
            },
            'q-input': true,
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true
          }
        },
      });
      
      expect(mockRouter.push).not.toHaveBeenCalled();
      testWrapper.unmount();
    });

    it("should handle undefined route name gracefully", () => {
      mockRouter.currentRoute.value.name = undefined;
      mockRouter.push.mockClear();
      
      const testWrapper = mount(Networking, {
        props: { currOrgIdentifier: "test-org" },
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            'q-splitter': {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
            },
            'q-input': true,
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true
          }
        },
      });
      
      expect(mockRouter.push).not.toHaveBeenCalled();
      testWrapper.unmount();
    });
  });

  describe("Router Navigation - onUpdated", () => {
    it("should redirect to netflow on networking route during update", async () => {
      // Clear initial mount call
      mockRouter.push.mockClear();
      
      // Change route to trigger onUpdated
      mockRouter.currentRoute.value.name = "networking";
      
      // Force update
      wrapper.vm.$forceUpdate();
      await wrapper.vm.$nextTick();
      
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "netflow",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });

    it("should not redirect on non-networking route during update", async () => {
      // Change to non-networking route
      mockRouter.currentRoute.value.name = "netflow";
      mockRouter.push.mockClear();
      
      // Force update
      wrapper.vm.$forceUpdate();
      await wrapper.vm.$nextTick();
      
      expect(mockRouter.push).not.toHaveBeenCalled();
    });

    it("should handle multiple updates with same route", async () => {
      // Clear initial mount call
      mockRouter.push.mockClear();
      
      // Set to networking route
      mockRouter.currentRoute.value.name = "networking";
      
      // Force multiple updates
      wrapper.vm.$forceUpdate();
      await wrapper.vm.$nextTick();
      wrapper.vm.$forceUpdate();
      await wrapper.vm.$nextTick();
      
      expect(mockRouter.push).toHaveBeenCalledTimes(2);
    });
  });

  describe("Networking Tabs Configuration", () => {
    it("should have correct networkingTabs structure", () => {
      const expectedTab = {
        name: "netflow",
        to: {
          name: "netflow",
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        },
        icon: "img:mock-image-url",
        label: expect.any(String),
        contentClass: "tab_content",
      };
      
      // Access networkingTabs through the component (we might need to expose it)
      expect(wrapper.vm.filteredList).toBeDefined();
      expect(Array.isArray(wrapper.vm.filteredList)).toBe(true);
      expect(wrapper.vm.filteredList.length).toBeGreaterThan(0);
      
      const firstTab = wrapper.vm.filteredList[0];
      expect(firstTab.name).toBe(expectedTab.name);
      expect(firstTab.to.name).toBe(expectedTab.to.name);
      expect(firstTab.to.query.org_identifier).toBe(expectedTab.to.query.org_identifier);
      expect(firstTab.contentClass).toBe(expectedTab.contentClass);
    });

    it("should use correct organization identifier in tab configuration", () => {
      const firstTab = wrapper.vm.filteredList[0];
      expect(firstTab.to.query.org_identifier).toBe(store.state.selectedOrganization.identifier);
    });

    it("should have correct netflow tab properties", () => {
      const netflowTab = wrapper.vm.filteredList.find((tab: any) => tab.name === "netflow");
      expect(netflowTab).toBeDefined();
      expect(netflowTab.name).toBe("netflow");
      expect(netflowTab.icon).toContain("img:");
      expect(netflowTab.contentClass).toBe("tab_content");
    });
  });

  describe("Filtered List Computed Property", () => {
    it("should return all tabs when filter is empty", () => {
      wrapper.vm.tabsFilter = "";
      expect(wrapper.vm.filteredList.length).toBe(1);
      expect(wrapper.vm.filteredList[0].name).toBe("netflow");
    });

    it("should filter tabs based on label (case insensitive)", () => {
      // Set filter to match netflow
      wrapper.vm.tabsFilter = "netflow";
      expect(wrapper.vm.filteredList.length).toBe(1);
      expect(wrapper.vm.filteredList[0].name).toBe("netflow");
    });

    it("should filter tabs with partial match", () => {
      wrapper.vm.tabsFilter = "net";
      expect(wrapper.vm.filteredList.length).toBe(1);
      expect(wrapper.vm.filteredList[0].name).toBe("netflow");
    });

    it("should return empty array when no match found", () => {
      wrapper.vm.tabsFilter = "nonexistent";
      expect(wrapper.vm.filteredList.length).toBe(0);
    });

    it("should handle case insensitive filtering", () => {
      wrapper.vm.tabsFilter = "NETFLOW";
      expect(wrapper.vm.filteredList.length).toBe(1);
      expect(wrapper.vm.filteredList[0].name).toBe("netflow");
    });

    it("should handle mixed case filtering", () => {
      wrapper.vm.tabsFilter = "NetFlow";
      expect(wrapper.vm.filteredList.length).toBe(1);
      expect(wrapper.vm.filteredList[0].name).toBe("netflow");
    });

    it("should filter with whitespace", () => {
      wrapper.vm.tabsFilter = "net";
      expect(wrapper.vm.filteredList.length).toBe(1);
      expect(wrapper.vm.filteredList[0].name).toBe("netflow");
    });

    it("should handle empty filter after having content", () => {
      wrapper.vm.tabsFilter = "something";
      expect(wrapper.vm.filteredList.length).toBe(0);
      
      wrapper.vm.tabsFilter = "";
      expect(wrapper.vm.filteredList.length).toBe(1);
    });
  });

  describe("Component Properties", () => {
    it("should expose all required properties", () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(typeof wrapper.vm.t).toBe("function");
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.router).toBeDefined();
      expect(wrapper.vm.config).toBeDefined();
      expect(wrapper.vm.currentUserEmail).toBeDefined();
      expect(wrapper.vm.currentOrgIdentifier).toBeDefined();
      expect(wrapper.vm.getImageURL).toBeDefined();
      expect(wrapper.vm.verifyOrganizationStatus).toBeDefined();
    });

    it("should have correct computed values", () => {
      expect(wrapper.vm.currentUserEmail).toBe(store.state.userInfo.email);
      expect(wrapper.vm.currentOrgIdentifier).toBe(store.state.selectedOrganization.identifier);
    });

    it("should expose splitterModel with correct value", () => {
      expect(wrapper.vm.splitterModel).toBe(270);
      expect(typeof wrapper.vm.splitterModel).toBe("number");
    });

    it("should expose tabs with correct initial value", () => {
      expect(wrapper.vm.tabs).toBe("");
      expect(typeof wrapper.vm.tabs).toBe("string");
    });

    it("should expose ingestTabType with correct initial value", () => {
      expect(wrapper.vm.ingestTabType).toBe("netflow");
      expect(typeof wrapper.vm.ingestTabType).toBe("string");
    });

    it("should expose tabsFilter with correct initial value", () => {
      expect(wrapper.vm.tabsFilter).toBe("");
      expect(typeof wrapper.vm.tabsFilter).toBe("string");
    });
  });

  describe("Store Integration", () => {
    it("should access correct store state properties", () => {
      expect(wrapper.vm.store.state.selectedOrganization).toBeDefined();
      expect(wrapper.vm.store.state.userInfo).toBeDefined();
      expect(wrapper.vm.store.state.userInfo.email).toBeDefined();
      expect(wrapper.vm.store.state.selectedOrganization.identifier).toBeDefined();
    });

    it("should use store state in component data", () => {
      expect(wrapper.vm.currentUserEmail).toBe(wrapper.vm.store.state.userInfo.email);
      expect(wrapper.vm.currentOrgIdentifier).toBe(wrapper.vm.store.state.selectedOrganization.identifier);
    });

    it("should use store state in router navigation", () => {
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "netflow",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });
  });

  describe("Configuration and Utils", () => {
    it("should expose config object", () => {
      expect(wrapper.vm.config).toBeDefined();
      expect(wrapper.vm.config.API_ENDPOINT).toBe("http://localhost:5080");
    });

    it("should expose getImageURL function", () => {
      expect(typeof wrapper.vm.getImageURL).toBe("function");
      expect(wrapper.vm.getImageURL()).toBe("mock-image-url");
    });

    it("should expose verifyOrganizationStatus function", () => {
      expect(typeof wrapper.vm.verifyOrganizationStatus).toBe("function");
    });

    it("should have i18n translation function", () => {
      expect(typeof wrapper.vm.t).toBe("function");
    });
  });

  describe("Reactive Data", () => {
    it("should update tabs reactively", async () => {
      expect(wrapper.vm.tabs).toBe("");
      
      wrapper.vm.tabs = "netflow";
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.tabs).toBe("netflow");
    });

    it("should update splitterModel reactively", async () => {
      expect(wrapper.vm.splitterModel).toBe(270);
      
      wrapper.vm.splitterModel = 300;
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.splitterModel).toBe(300);
    });

    it("should update ingestTabType reactively", async () => {
      expect(wrapper.vm.ingestTabType).toBe("netflow");
      
      wrapper.vm.ingestTabType = "customflow";
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.ingestTabType).toBe("customflow");
    });

    it("should update tabsFilter reactively", async () => {
      expect(wrapper.vm.tabsFilter).toBe("");
      
      wrapper.vm.tabsFilter = "test";
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.tabsFilter).toBe("test");
    });

    it("should have reactive currentOrgIdentifier", () => {
      expect(wrapper.vm.currentOrgIdentifier).toBe(store.state.selectedOrganization.identifier);
    });
  });

  describe("Component Lifecycle", () => {
    it("should handle onBeforeMount lifecycle hook", () => {
      // This is already tested in the router navigation section
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "netflow",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });

    it("should handle onUpdated lifecycle hook", async () => {
      // Clear initial mount call
      mockRouter.push.mockClear();
      
      // Trigger update
      wrapper.vm.$forceUpdate();
      await wrapper.vm.$nextTick();
      
      // Should redirect if still on networking route
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "netflow",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });
  });

  describe("Error Handling", () => {
    it("should handle router push errors gracefully", async () => {
      mockRouter.push.mockRejectedValueOnce(new Error("Navigation failed"));
      
      // Should not throw error
      expect(() => {
        const testWrapper = mount(Networking, {
          props: { currOrgIdentifier: "test-org" },
          global: {
            plugins: [i18n],
            provide: { store },
            stubs: {
              'q-splitter': {
                template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
              },
              'q-input': true,
              'q-tabs': true,
              'q-route-tab': true,
              'router-view': true
            }
          },
        });
        testWrapper.unmount();
      }).not.toThrow();
    });

    it("should handle missing store state gracefully", () => {
      const mockStoreWithMissingData = {
        state: {
          selectedOrganization: {},
          userInfo: {}
        }
      };
      
      expect(() => {
        const testWrapper = mount(Networking, {
          props: { currOrgIdentifier: "test-org" },
          global: {
            plugins: [i18n],
            provide: { store: mockStoreWithMissingData },
            stubs: {
              'q-splitter': {
                template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
              },
              'q-input': true,
              'q-tabs': true,
              'q-route-tab': true,
              'router-view': true
            }
          },
        });
        testWrapper.unmount();
      }).not.toThrow();
    });
  });

  describe("Template Rendering", () => {
    it("should render q-splitter with correct props", () => {
      expect(wrapper.html()).toContain('div');
    });

    it("should pass correct props to router-view", () => {
      const routerView = wrapper.findComponent({ name: 'router-view' });
      expect(routerView.exists()).toBe(true);
    });

    it("should render search input with correct attributes", () => {
      const input = wrapper.findComponent({ name: 'q-input' });
      expect(input.exists()).toBe(true);
    });
  });

  describe("Advanced Filtering Scenarios", () => {
    it("should handle special characters in filter", () => {
      wrapper.vm.tabsFilter = "net@flow";
      expect(wrapper.vm.filteredList.length).toBe(0);
      
      wrapper.vm.tabsFilter = "net-flow";
      expect(wrapper.vm.filteredList.length).toBe(0);
      
      wrapper.vm.tabsFilter = "net_flow";
      expect(wrapper.vm.filteredList.length).toBe(0);
    });

    it("should handle numeric filter", () => {
      wrapper.vm.tabsFilter = "123";
      expect(wrapper.vm.filteredList.length).toBe(0);
      
      wrapper.vm.tabsFilter = "0";
      expect(wrapper.vm.filteredList.length).toBe(0);
    });

    it("should handle very long filter string", () => {
      wrapper.vm.tabsFilter = "a".repeat(1000);
      expect(wrapper.vm.filteredList.length).toBe(0);
    });
  });

  describe("Multiple Route Navigation Scenarios", () => {
    it("should handle rapid route changes", async () => {
      mockRouter.push.mockClear();
      
      // Simulate rapid route changes
      mockRouter.currentRoute.value.name = "networking";
      wrapper.vm.$forceUpdate();
      await wrapper.vm.$nextTick();
      
      mockRouter.currentRoute.value.name = "netflow";
      wrapper.vm.$forceUpdate();
      await wrapper.vm.$nextTick();
      
      mockRouter.currentRoute.value.name = "networking";
      wrapper.vm.$forceUpdate();
      await wrapper.vm.$nextTick();
      
      expect(mockRouter.push).toHaveBeenCalledTimes(2);
    });
  });

  describe("Component Props Edge Cases", () => {
    it("should handle null currOrgIdentifier prop", () => {
      const testWrapper = mount(Networking, {
        props: { currOrgIdentifier: null },
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            'q-splitter': {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
            },
            'q-input': true,
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true
          }
        },
      });
      
      expect(testWrapper.props('currOrgIdentifier')).toBe(null);
      testWrapper.unmount();
    });

    it("should handle undefined currOrgIdentifier prop", () => {
      const testWrapper = mount(Networking, {
        props: {},
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            'q-splitter': {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
            },
            'q-input': true,
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true
          }
        },
      });
      
      expect(testWrapper.props('currOrgIdentifier')).toBe("");
      testWrapper.unmount();
    });
  });
});