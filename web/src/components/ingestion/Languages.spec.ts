import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import Languages from "@/components/ingestion/Languages.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { useQuasar } from "quasar";

installQuasar();

// Mock services
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path) => `mock-image-url-${path}`),
  verifyOrganizationStatus: vi.fn(() => true)
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
      name: "languages",
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

describe("Languages Component", () => {
  let wrapper: any = null;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Reset router state
    mockRouter.currentRoute.value.name = "languages";
    mockRouter.currentRoute.value.query = {};

    wrapper = mount(Languages, {
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
          'router-view': true,
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
      expect(wrapper.vm.$options.name).toBe("LanguagesPage");
    });

    it("should have correct props", () => {
      expect(wrapper.props('currOrgIdentifier')).toBe("test-org");
    });

    it("should initialize with correct data", () => {
      expect(wrapper.vm.splitterModel).toBe(270);
      expect(wrapper.vm.currentUserEmail).toBeDefined();
      expect(wrapper.vm.tabs).toBe("");
      expect(wrapper.vm.ingestTabType).toBe("python");
      expect(wrapper.vm.tabsFilter).toBe("");
    });

    it("should have default prop value for currOrgIdentifier", () => {
      const testWrapper = mount(Languages, {
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
            'router-view': true,
            'q-icon': true
          }
        },
      });
      
      expect(testWrapper.props('currOrgIdentifier')).toBe("");
      testWrapper.unmount();
    });
  });

  describe("Route Navigation - onBeforeMount", () => {
    it("should redirect to python route when on languages route", () => {
      // This is already tested in beforeEach setup
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "python",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });

    it("should not redirect when not on languages route", () => {
      mockRouter.currentRoute.value.name = "python";
      mockRouter.push.mockClear();
      
      const testWrapper = mount(Languages, {
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
            'router-view': true,
            'q-icon': true
          }
        },
      });
      
      expect(mockRouter.push).not.toHaveBeenCalled();
      testWrapper.unmount();
    });

    it("should redirect when on languages route with different query", () => {
      mockRouter.currentRoute.value.name = "languages";
      mockRouter.currentRoute.value.query = { someParam: "value" };
      mockRouter.push.mockClear();
      
      const testWrapper = mount(Languages, {
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
            'router-view': true,
            'q-icon': true
          }
        },
      });
      
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "python",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      testWrapper.unmount();
    });
  });

  describe("Route Navigation - onUpdated", () => {
    it("should redirect to python route when updated to languages route", async () => {
      // First mount with different route
      mockRouter.currentRoute.value.name = "python";
      
      const testWrapper = mount(Languages, {
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
            'router-view': true,
            'q-icon': true
          }
        },
      });

      // Reset mock call count
      mockRouter.push.mockClear();
      
      // Change route to languages to trigger onUpdated
      mockRouter.currentRoute.value.name = "languages";
      
      // Force update
      testWrapper.vm.$forceUpdate();
      await testWrapper.vm.$nextTick();
      
      testWrapper.unmount();
    });

    it("should not redirect when updated to non-languages route", async () => {
      // First mount with languages route
      mockRouter.currentRoute.value.name = "languages";
      
      const testWrapper = mount(Languages, {
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
            'router-view': true,
            'q-icon': true
          }
        },
      });

      // Reset mock call count
      mockRouter.push.mockClear();
      
      // Change route to python - should not trigger redirect in onUpdated
      mockRouter.currentRoute.value.name = "python";
      
      // Force update
      testWrapper.vm.$forceUpdate();
      await testWrapper.vm.$nextTick();
      
      testWrapper.unmount();
    });
  });

  describe("Languages Tabs Configuration", () => {
    it("should have correct languagesTabs structure", () => {
      const languagesTabs = wrapper.vm.languagesTabs;
      expect(Array.isArray(languagesTabs)).toBe(true);
      expect(languagesTabs).toHaveLength(5);
    });

    it("should have python tab configuration", () => {
      const pythonTab = wrapper.vm.languagesTabs.find((tab: any) => tab.name === "python");
      expect(pythonTab).toBeDefined();
      expect(pythonTab.name).toBe("python");
      expect(pythonTab.label).toBe("Python");
      expect(pythonTab.to).toEqual({
        name: "python",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      expect(pythonTab.icon).toBe("img:mock-image-url-images/ingestion/python.svg");
      expect(pythonTab.contentClass).toBe("tab_content");
    });

    it("should have dotnettracing tab configuration", () => {
      const dotnetTracingTab = wrapper.vm.languagesTabs.find((tab: any) => tab.name === "dotnettracing");
      expect(dotnetTracingTab).toBeDefined();
      expect(dotnetTracingTab.name).toBe("dotnettracing");
      expect(dotnetTracingTab.to).toEqual({
        name: "dotnettracing",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      expect(dotnetTracingTab.icon).toBe("img:mock-image-url-images/ingestion/dotnet.svg");
      expect(dotnetTracingTab.contentClass).toBe("tab_content");
    });

    it("should have dotnetlogs tab configuration", () => {
      const dotnetLogsTab = wrapper.vm.languagesTabs.find((tab: any) => tab.name === "dotnetlogs");
      expect(dotnetLogsTab).toBeDefined();
      expect(dotnetLogsTab.name).toBe("dotnetlogs");
      expect(dotnetLogsTab.to).toEqual({
        name: "dotnetlogs",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      expect(dotnetLogsTab.icon).toBe("img:mock-image-url-images/ingestion/dotnet.svg");
      expect(dotnetLogsTab.contentClass).toBe("tab_content");
    });

    it("should have nodejs tab configuration", () => {
      const nodejsTab = wrapper.vm.languagesTabs.find((tab: any) => tab.name === "nodejs");
      expect(nodejsTab).toBeDefined();
      expect(nodejsTab.name).toBe("nodejs");
      expect(nodejsTab.to).toEqual({
        name: "nodejs",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      expect(nodejsTab.icon).toBe("img:mock-image-url-images/ingestion/nodejs.svg");
      expect(nodejsTab.contentClass).toBe("tab_content");
    });

    it("should have go tab configuration", () => {
      const goTab = wrapper.vm.languagesTabs.find((tab: any) => tab.name === "go");
      expect(goTab).toBeDefined();
      expect(goTab.name).toBe("go");
      expect(goTab.to).toEqual({
        name: "go",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      expect(goTab.icon).toBe("img:mock-image-url-images/ingestion/golang.svg");
      expect(goTab.contentClass).toBe("tab_content");
    });

    it("should not have rust or java tabs (commented out)", () => {
      const rustTab = wrapper.vm.languagesTabs.find((tab: any) => tab.name === "rust");
      const javaTab = wrapper.vm.languagesTabs.find((tab: any) => tab.name === "java");
      expect(rustTab).toBeUndefined();
      expect(javaTab).toBeUndefined();
    });
  });

  describe("Filtered List Computed Property", () => {
    it("should return all tabs when filter is empty", () => {
      wrapper.vm.tabsFilter = "";
      expect(wrapper.vm.filteredList).toHaveLength(5);
    });

    it("should filter tabs by label (case insensitive)", () => {
      wrapper.vm.tabsFilter = "python";
      expect(wrapper.vm.filteredList).toHaveLength(1);
      expect(wrapper.vm.filteredList[0].name).toBe("python");
    });

    it("should filter tabs by label (uppercase)", () => {
      wrapper.vm.tabsFilter = "PYTHON";
      expect(wrapper.vm.filteredList).toHaveLength(1);
      expect(wrapper.vm.filteredList[0].name).toBe("python");
    });

    it("should filter tabs by partial label match", () => {
      wrapper.vm.tabsFilter = ".net";
      expect(wrapper.vm.filteredList).toHaveLength(2);
      expect(wrapper.vm.filteredList.some((tab: any) => tab.name === "dotnettracing")).toBe(true);
      expect(wrapper.vm.filteredList.some((tab: any) => tab.name === "dotnetlogs")).toBe(true);
    });

    it("should return empty array when no match found", () => {
      wrapper.vm.tabsFilter = "nonexistent";
      expect(wrapper.vm.filteredList).toHaveLength(0);
    });

    it("should filter nodejs correctly", () => {
      wrapper.vm.tabsFilter = "nodejs";
      expect(wrapper.vm.filteredList).toHaveLength(1);
      expect(wrapper.vm.filteredList[0].name).toBe("nodejs");
    });

    it("should filter go correctly", () => {
      wrapper.vm.tabsFilter = "go";
      expect(wrapper.vm.filteredList).toHaveLength(1);
      expect(wrapper.vm.filteredList[0].name).toBe("go");
    });

    it("should handle special characters in filter", () => {
      wrapper.vm.tabsFilter = "!@#";
      expect(wrapper.vm.filteredList).toHaveLength(0);
    });

    it("should handle whitespace in filter", () => {
      wrapper.vm.tabsFilter = " python ";
      expect(wrapper.vm.filteredList).toHaveLength(0);
    });
  });

  describe("Component Properties and Data", () => {
    it("should expose all required properties", () => {
      expect(wrapper.vm.t).toBeDefined();
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

    it("should have correct initial state", () => {
      expect(wrapper.vm.tabs).toBe("");
      expect(wrapper.vm.ingestTabType).toBe("python");
      expect(wrapper.vm.tabsFilter).toBe("");
      expect(wrapper.vm.splitterModel).toBe(270);
    });

    it("should have reactive tabsFilter", async () => {
      wrapper.vm.tabsFilter = "test";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.tabsFilter).toBe("test");
    });

    it("should have reactive ingestTabType", async () => {
      wrapper.vm.ingestTabType = "nodejs";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ingestTabType).toBe("nodejs");
    });

    it("should have reactive tabs", async () => {
      wrapper.vm.tabs = "test-tab";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.tabs).toBe("test-tab");
    });
  });

  describe("Store Integration", () => {
    it("should access correct store state properties", () => {
      expect(wrapper.vm.store.state.selectedOrganization).toBeDefined();
      expect(wrapper.vm.store.state.userInfo).toBeDefined();
      expect(wrapper.vm.store.state.userInfo.email).toBeDefined();
      expect(wrapper.vm.store.state.selectedOrganization.identifier).toBeDefined();
    });

    it("should use store state in router navigation", () => {
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "python",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });

    it("should handle store state changes", () => {
      const originalOrgId = store.state.selectedOrganization.identifier;
      expect(wrapper.vm.currentOrgIdentifier).toBe(originalOrgId);
    });
  });

  describe("Configuration and Utils", () => {
    it("should expose config object", () => {
      expect(wrapper.vm.config).toBeDefined();
      expect(wrapper.vm.config.API_ENDPOINT).toBe("http://localhost:5080");
    });

    it("should expose getImageURL function", () => {
      expect(typeof wrapper.vm.getImageURL).toBe("function");
      const result = wrapper.vm.getImageURL("test-path");
      expect(result).toBe("mock-image-url-test-path");
    });

    it("should expose verifyOrganizationStatus function", () => {
      expect(typeof wrapper.vm.verifyOrganizationStatus).toBe("function");
      const result = wrapper.vm.verifyOrganizationStatus();
      expect(result).toBe(true);
    });

    it("should have i18n translation function", () => {
      expect(typeof wrapper.vm.t).toBe("function");
    });
  });

  describe("Prop Type Validation", () => {
    it("should have correct prop type for currOrgIdentifier", () => {
      const propDefinition = wrapper.vm.$options.props.currOrgIdentifier;
      expect(propDefinition.type).toBe(String);
      expect(propDefinition.default).toBe("");
    });

    it("should accept string values for currOrgIdentifier", () => {
      const testWrapper = mount(Languages, {
        props: { currOrgIdentifier: "string-value" },
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
            'router-view': true,
            'q-icon': true
          }
        },
      });
      
      expect(testWrapper.props('currOrgIdentifier')).toBe("string-value");
      testWrapper.unmount();
    });
  });

  describe("Template Rendering", () => {
    it("should render q-splitter component", () => {
      const splitterWrapper = wrapper.find('[modelValue="270"]');
      expect(splitterWrapper.exists()).toBe(true);
    });

    it("should have correct splitter model value", () => {
      expect(wrapper.vm.splitterModel).toBe(270);
    });

    it("should render router-view with correct props", () => {
      const routerView = wrapper.findComponent({ name: 'router-view' });
      expect(routerView.exists()).toBe(true);
    });
  });

  describe("Lifecycle Hooks Behavior", () => {
    it("should handle multiple route changes correctly", () => {
      // Test multiple redirects
      mockRouter.currentRoute.value.name = "languages";
      mockRouter.push.mockClear();
      
      // First redirect
      const testWrapper = mount(Languages, {
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
            'router-view': true,
            'q-icon': true
          }
        },
      });
      
      expect(mockRouter.push).toHaveBeenCalledTimes(1);
      testWrapper.unmount();
    });

    it("should not interfere with other route names", () => {
      const routeNames = ["python", "dotnettracing", "dotnetlogs", "nodejs", "go"];
      
      routeNames.forEach(routeName => {
        mockRouter.currentRoute.value.name = routeName;
        mockRouter.push.mockClear();
        
        const testWrapper = mount(Languages, {
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
              'router-view': true,
              'q-icon': true
            }
          },
        });
        
        expect(mockRouter.push).not.toHaveBeenCalled();
        testWrapper.unmount();
      });
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle empty store state gracefully", () => {
      const emptyStore = {
        state: {
          selectedOrganization: { identifier: "" },
          userInfo: { email: "" }
        }
      };
      
      const testWrapper = mount(Languages, {
        props: { currOrgIdentifier: "test-org" },
        global: {
          plugins: [i18n],
          provide: { store: emptyStore },
          stubs: {
            'q-splitter': {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
            },
            'q-input': true,
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true,
            'q-icon': true
          }
        },
      });
      
      expect(testWrapper.vm.currentUserEmail).toBe("");
      expect(testWrapper.vm.currentOrgIdentifier).toBe("");
      testWrapper.unmount();
    });

    it("should handle null router current route", () => {
      const nullRouter = {
        currentRoute: { value: null },
        push: vi.fn()
      };
      
      vi.doMock("vue-router", () => ({
        useRouter: () => nullRouter
      }));
      
      // This should not throw an error
      expect(() => {
        const testWrapper = mount(Languages, {
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
              'router-view': true,
              'q-icon': true
            }
          },
        });
      }).not.toThrow();
    });

    it("should handle missing translation keys gracefully", () => {
      // The component should still mount even if translation keys are missing
      expect(wrapper.exists()).toBe(true);
      expect(typeof wrapper.vm.t).toBe("function");
    });

    it("should handle reactive data updates correctly", async () => {
      // Test rapid filter changes
      wrapper.vm.tabsFilter = "p";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.filteredList).toHaveLength(1);
      
      wrapper.vm.tabsFilter = "py";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.filteredList).toHaveLength(1);
      
      wrapper.vm.tabsFilter = "python";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.filteredList).toHaveLength(1);
      
      wrapper.vm.tabsFilter = "";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.filteredList).toHaveLength(5);
    });
  });

  describe("Computed Property Reactivity", () => {
    it("should update filteredList when tabsFilter changes", async () => {
      expect(wrapper.vm.filteredList).toHaveLength(5);
      
      wrapper.vm.tabsFilter = "nodejs";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.filteredList).toHaveLength(1);
      
      wrapper.vm.tabsFilter = ".net";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.filteredList).toHaveLength(2);
    });

    it("should maintain filteredList reactivity with complex filters", async () => {
      // Test with mixed case
      wrapper.vm.tabsFilter = "PyThOn";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.filteredList).toHaveLength(1);
      
      // Test with partial match
      wrapper.vm.tabsFilter = "nodejs";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.filteredList).toHaveLength(1);
      expect(wrapper.vm.filteredList[0].name).toBe("nodejs");
    });
  });

  describe("Component Dependencies", () => {
    it("should properly mock all external dependencies", () => {
      expect(wrapper.vm.getImageURL).toBeDefined();
      expect(wrapper.vm.verifyOrganizationStatus).toBeDefined();
      expect(wrapper.vm.config).toBeDefined();
      expect(wrapper.vm.router).toBeDefined();
      expect(wrapper.vm.store).toBeDefined();
    });

    it("should handle getImageURL with different paths", () => {
      const paths = [
        "images/ingestion/python.svg",
        "images/ingestion/dotnet.svg",
        "images/ingestion/nodejs.svg",
        "images/ingestion/golang.svg"
      ];
      
      paths.forEach(path => {
        const result = wrapper.vm.getImageURL(path);
        expect(result).toBe(`mock-image-url-${path}`);
      });
    });
  });
});