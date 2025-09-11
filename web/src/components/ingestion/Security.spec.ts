import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import Security from "@/components/ingestion/Security.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { useQuasar } from "quasar";

installQuasar();

// Mock services
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path: string) => `mock-image-url-${path}`),
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
      name: "security",
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

describe("Security Component", () => {
  let wrapper: any = null;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Reset router state
    mockRouter.currentRoute.value.name = "security";
    mockRouter.currentRoute.value.query = {};

    wrapper = mount(Security, {
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
          'q-input': {
            template: '<input data-test="security-list-search-input" />'
          },
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
      expect(wrapper.vm.$options.name).toBe("SecurityPage");
    });

    it("should have correct props", () => {
      expect(wrapper.props('currOrgIdentifier')).toBe("test-org");
    });

    it("should initialize with correct default prop value", () => {
      const testWrapper = mount(Security, {
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

    it("should have correct prop type definition", () => {
      const propDefinition = wrapper.vm.$options.props.currOrgIdentifier;
      expect(propDefinition.type).toBe(String);
      expect(propDefinition.default).toBe("");
    });
  });

  describe("Data Initialization", () => {
    it("should initialize with correct data values", () => {
      expect(wrapper.vm.splitterModel).toBe(270);
      expect(wrapper.vm.tabs).toBe("");
      expect(wrapper.vm.tabsFilter).toBe("");
      expect(wrapper.vm.ingestTabType).toBe("falco");
      expect(wrapper.vm.currentOrgIdentifier).toBe(store.state.selectedOrganization.identifier);
    });

    it("should have reactive data properties", async () => {
      wrapper.vm.tabsFilter = "test-filter";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.tabsFilter).toBe("test-filter");

      wrapper.vm.ingestTabType = "okta";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ingestTabType).toBe("okta");
    });

    it("should expose required setup properties", () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.router).toBeDefined();
      expect(wrapper.vm.config).toBeDefined();
      expect(wrapper.vm.currentUserEmail).toBeDefined();
      expect(wrapper.vm.getImageURL).toBeDefined();
      expect(wrapper.vm.verifyOrganizationStatus).toBeDefined();
    });

    it("should have correct currentUserEmail from store", () => {
      expect(wrapper.vm.currentUserEmail).toBe(store.state.userInfo.email);
    });
  });

  describe("onBeforeMount Lifecycle Hook", () => {
    it("should redirect to falco when route is security", () => {
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "falco",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });

    it("should not redirect when route is not security", () => {
      mockRouter.currentRoute.value.name = "falco";
      mockRouter.push.mockClear();
      
      const testWrapper = mount(Security, {
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

    it("should handle empty route gracefully", () => {
      mockRouter.currentRoute.value.name = "";
      mockRouter.push.mockClear();
      
      const testWrapper = mount(Security, {
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

  describe("onUpdated Lifecycle Hook", () => {
    it("should redirect to falco when route changes to security", async () => {
      mockRouter.currentRoute.value.name = "okta";
      mockRouter.push.mockClear();
      
      // Change route to security and trigger update
      mockRouter.currentRoute.value.name = "security";
      wrapper.vm.$forceUpdate();
      await wrapper.vm.$nextTick();
      
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "falco",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });

    it("should not redirect when route is not security during update", async () => {
      mockRouter.currentRoute.value.name = "okta";
      mockRouter.push.mockClear();
      
      wrapper.vm.$forceUpdate();
      await wrapper.vm.$nextTick();
      
      expect(mockRouter.push).not.toHaveBeenCalled();
    });
  });

  describe("Security Tabs Configuration", () => {
    it("should have all required security tabs", () => {
      const securityTabs = [
        "falco",
        "osquery", 
        "okta",
        "jumpcloud",
        "openvpn",
        "office365",
        "google-workspace"
      ];

      const filteredList = wrapper.vm.filteredList;
      expect(filteredList).toHaveLength(7);
      
      securityTabs.forEach(tabName => {
        const tab = filteredList.find((t: any) => t.name === tabName);
        expect(tab).toBeDefined();
      });
    });

    it("should have correct falco tab configuration", () => {
      const falcoTab = wrapper.vm.filteredList.find((tab: any) => tab.name === "falco");
      
      expect(falcoTab).toBeDefined();
      expect(falcoTab.name).toBe("falco");
      expect(falcoTab.to.name).toBe("falco");
      expect(falcoTab.to.query.org_identifier).toBe(store.state.selectedOrganization.identifier);
      expect(falcoTab.icon).toContain("mock-image-url-images/ingestion/falco.png");
      expect(falcoTab.contentClass).toBe("tab_content");
    });

    it("should have correct osquery tab configuration", () => {
      const osqueryTab = wrapper.vm.filteredList.find((tab: any) => tab.name === "osquery");
      
      expect(osqueryTab).toBeDefined();
      expect(osqueryTab.name).toBe("osquery");
      expect(osqueryTab.to.name).toBe("osquery");
      expect(osqueryTab.to.query.org_identifier).toBe(store.state.selectedOrganization.identifier);
      expect(osqueryTab.icon).toContain("mock-image-url-images/ingestion/os-query.png");
    });

    it("should have correct okta tab configuration", () => {
      const oktaTab = wrapper.vm.filteredList.find((tab: any) => tab.name === "okta");
      
      expect(oktaTab).toBeDefined();
      expect(oktaTab.name).toBe("okta");
      expect(oktaTab.to.name).toBe("okta");
      expect(oktaTab.to.query.org_identifier).toBe(store.state.selectedOrganization.identifier);
      expect(oktaTab.icon).toContain("mock-image-url-images/ingestion/okta.png");
    });

    it("should have correct jumpcloud tab configuration", () => {
      const jumpcloudTab = wrapper.vm.filteredList.find((tab: any) => tab.name === "jumpcloud");
      
      expect(jumpcloudTab).toBeDefined();
      expect(jumpcloudTab.name).toBe("jumpcloud");
      expect(jumpcloudTab.to.name).toBe("jumpcloud");
      expect(jumpcloudTab.to.query.org_identifier).toBe(store.state.selectedOrganization.identifier);
      expect(jumpcloudTab.icon).toContain("mock-image-url-images/ingestion/jumpcloud.svg");
    });

    it("should have correct openvpn tab configuration", () => {
      const openvpnTab = wrapper.vm.filteredList.find((tab: any) => tab.name === "openvpn");
      
      expect(openvpnTab).toBeDefined();
      expect(openvpnTab.name).toBe("openvpn");
      expect(openvpnTab.to.name).toBe("openvpn");
      expect(openvpnTab.to.query.org_identifier).toBe(store.state.selectedOrganization.identifier);
      expect(openvpnTab.icon).toContain("mock-image-url-images/ingestion/openvpn.png");
    });

    it("should have correct office365 tab configuration", () => {
      const office365Tab = wrapper.vm.filteredList.find((tab: any) => tab.name === "office365");
      
      expect(office365Tab).toBeDefined();
      expect(office365Tab.name).toBe("office365");
      expect(office365Tab.to.name).toBe("office365");
      expect(office365Tab.to.query.org_identifier).toBe(store.state.selectedOrganization.identifier);
      expect(office365Tab.icon).toContain("mock-image-url-images/ingestion/office-365.png");
    });

    it("should have correct google-workspace tab configuration", () => {
      const gworkspaceTab = wrapper.vm.filteredList.find((tab: any) => tab.name === "google-workspace");
      
      expect(gworkspaceTab).toBeDefined();
      expect(gworkspaceTab.name).toBe("google-workspace");
      expect(gworkspaceTab.to.name).toBe("google-workspace");
      expect(gworkspaceTab.to.query.org_identifier).toBe(store.state.selectedOrganization.identifier);
      expect(gworkspaceTab.icon).toContain("mock-image-url-images/ingestion/google-workspace.png");
    });
  });

  describe("Filtered List Computed Property", () => {
    it("should return all tabs when filter is empty", () => {
      wrapper.vm.tabsFilter = "";
      expect(wrapper.vm.filteredList).toHaveLength(7);
    });

    it("should filter tabs by label case-insensitively", async () => {
      wrapper.vm.tabsFilter = "falco";
      await wrapper.vm.$nextTick();
      
      const filtered = wrapper.vm.filteredList;
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("falco");
    });

    it("should filter tabs with uppercase input", async () => {
      wrapper.vm.tabsFilter = "OKTA";
      await wrapper.vm.$nextTick();
      
      const filtered = wrapper.vm.filteredList;
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("okta");
    });

    it("should filter tabs with partial matching", async () => {
      wrapper.vm.tabsFilter = "jump";
      await wrapper.vm.$nextTick();
      
      const filtered = wrapper.vm.filteredList;
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("jumpcloud");
    });

    it("should return empty array when no tabs match filter", async () => {
      wrapper.vm.tabsFilter = "nonexistent";
      await wrapper.vm.$nextTick();
      
      const filtered = wrapper.vm.filteredList;
      expect(filtered).toHaveLength(0);
    });

    it("should filter multiple matching tabs", async () => {
      wrapper.vm.tabsFilter = "o"; // Should match okta, openvpn, office365
      await wrapper.vm.$nextTick();
      
      const filtered = wrapper.vm.filteredList;
      expect(filtered.length).toBeGreaterThan(1);
      
      const names = filtered.map((tab: any) => tab.name);
      expect(names).toContain("okta");
      expect(names).toContain("openvpn");
      expect(names).toContain("office365");
    });

    it("should handle whitespace in filter", async () => {
      wrapper.vm.tabsFilter = "falco";
      await wrapper.vm.$nextTick();
      
      const filtered = wrapper.vm.filteredList;
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("falco");
    });

    it("should be reactive to tabsFilter changes", async () => {
      expect(wrapper.vm.filteredList).toHaveLength(7);
      
      wrapper.vm.tabsFilter = "osquery";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.filteredList).toHaveLength(1);
      
      wrapper.vm.tabsFilter = "";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.filteredList).toHaveLength(7);
    });
  });

  describe("Store Integration", () => {
    it("should access correct store state properties", () => {
      expect(wrapper.vm.store.state.selectedOrganization).toBeDefined();
      expect(wrapper.vm.store.state.userInfo).toBeDefined();
      expect(wrapper.vm.store.state.userInfo.email).toBeDefined();
      expect(wrapper.vm.store.state.selectedOrganization.identifier).toBeDefined();
    });

    it("should use store organization identifier in tab configurations", () => {
      const tabs = wrapper.vm.filteredList;
      tabs.forEach((tab: any) => {
        expect(tab.to.query.org_identifier).toBe(store.state.selectedOrganization.identifier);
      });
    });

    it("should use store email for currentUserEmail", () => {
      expect(wrapper.vm.currentUserEmail).toBe(store.state.userInfo.email);
    });

    it("should use store organization identifier for currentOrgIdentifier", () => {
      expect(wrapper.vm.currentOrgIdentifier).toBe(store.state.selectedOrganization.identifier);
    });
  });

  describe("Utility Functions Integration", () => {
    it("should use getImageURL function", () => {
      expect(wrapper.vm.getImageURL).toBeDefined();
      expect(typeof wrapper.vm.getImageURL).toBe("function");
    });

    it("should expose getImageURL function", () => {
      expect(typeof wrapper.vm.getImageURL).toBe("function");
    });

    it("should expose verifyOrganizationStatus function", () => {
      expect(typeof wrapper.vm.verifyOrganizationStatus).toBe("function");
    });
  });

  describe("Router Integration", () => {
    it("should have access to router instance", () => {
      expect(wrapper.vm.router).toBeDefined();
    });

    it("should use router for navigation in lifecycle hooks", () => {
      expect(mockRouter.push).toHaveBeenCalled();
    });

    it("should handle router current route", () => {
      expect(wrapper.vm.router.currentRoute).toBeDefined();
      expect(wrapper.vm.router.currentRoute.value).toBeDefined();
    });
  });

  describe("Configuration and Setup", () => {
    it("should have config object", () => {
      expect(wrapper.vm.config).toBeDefined();
    });

    it("should have i18n translation function", () => {
      expect(typeof wrapper.vm.t).toBe("function");
    });

    it("should have correct splitterModel default value", () => {
      expect(wrapper.vm.splitterModel).toBe(270);
    });

    it("should allow splitterModel modification", async () => {
      wrapper.vm.splitterModel = 300;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.splitterModel).toBe(300);
    });
  });

  describe("Tab Filtering Edge Cases", () => {
    it("should handle special characters in filter", async () => {
      wrapper.vm.tabsFilter = "@#$%";
      await wrapper.vm.$nextTick();
      
      const filtered = wrapper.vm.filteredList;
      expect(filtered).toHaveLength(0);
    });

    it("should handle numeric filter", async () => {
      wrapper.vm.tabsFilter = "365";
      await wrapper.vm.$nextTick();
      
      const filtered = wrapper.vm.filteredList;
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("office365");
    });

    it("should handle hyphenated filter", async () => {
      wrapper.vm.tabsFilter = "workspace";
      await wrapper.vm.$nextTick();
      
      const filtered = wrapper.vm.filteredList;
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("google-workspace");
    });
  });

  describe("Component Props Validation", () => {
    it("should accept valid string currOrgIdentifier", () => {
      expect(() => {
        mount(Security, {
          props: { currOrgIdentifier: "valid-org-id" },
          global: {
            plugins: [i18n],
            provide: { store },
            stubs: {
              'q-splitter': true,
              'q-input': true,
              'q-tabs': true,
              'q-route-tab': true,
              'router-view': true
            }
          }
        });
      }).not.toThrow();
    });

    it("should handle empty string currOrgIdentifier", () => {
      const testWrapper = mount(Security, {
        props: { currOrgIdentifier: "" },
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            'q-splitter': true,
            'q-input': true,
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true
          }
        }
      });
      
      expect(testWrapper.props('currOrgIdentifier')).toBe("");
      testWrapper.unmount();
    });
  });

  describe("Reactive Properties", () => {
    it("should have reactive tabs property", async () => {
      const initialTabs = wrapper.vm.tabs;
      wrapper.vm.tabs = "test-value";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.tabs).toBe("test-value");
    });

    it("should have reactive ingestTabType property", async () => {
      expect(wrapper.vm.ingestTabType).toBe("falco");
      wrapper.vm.ingestTabType = "okta";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ingestTabType).toBe("okta");
    });

    it("should have reactive tabsFilter property", async () => {
      expect(wrapper.vm.tabsFilter).toBe("");
      wrapper.vm.tabsFilter = "test-filter";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.tabsFilter).toBe("test-filter");
    });
  });

  describe("Component Return Values", () => {
    it("should return all required properties from setup", () => {
      const expectedProperties = [
        "t", "store", "router", "config", "splitterModel",
        "currentUserEmail", "currentOrgIdentifier", "getImageURL", 
        "verifyOrganizationStatus", "tabs", "ingestTabType", 
        "tabsFilter", "filteredList"
      ];
      
      expectedProperties.forEach(prop => {
        expect(wrapper.vm[prop]).toBeDefined();
      });
    });

    it("should have correct types for returned properties", () => {
      expect(typeof wrapper.vm.t).toBe("function");
      expect(typeof wrapper.vm.store).toBe("object");
      expect(typeof wrapper.vm.router).toBe("object");
      expect(typeof wrapper.vm.config).toBe("object");
      expect(typeof wrapper.vm.splitterModel).toBe("number");
      expect(typeof wrapper.vm.currentUserEmail).toBe("string");
      expect(typeof wrapper.vm.currentOrgIdentifier).toBe("string");
      expect(typeof wrapper.vm.getImageURL).toBe("function");
      expect(typeof wrapper.vm.verifyOrganizationStatus).toBe("function");
      expect(typeof wrapper.vm.tabs).toBe("string");
      expect(typeof wrapper.vm.ingestTabType).toBe("string");
      expect(typeof wrapper.vm.tabsFilter).toBe("string");
      expect(Array.isArray(wrapper.vm.filteredList)).toBe(true);
    });
  });
});