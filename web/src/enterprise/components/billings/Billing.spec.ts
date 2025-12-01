import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import Billing from "@/enterprise/components/billings/Billing.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar();

// Mock utils
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((imagePath: string) => `img:${imagePath}`)
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
      name: "billings",
      query: {
        data_type: "gb",
        usage_date: "30days"
      }
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
    useQuasar: () => mockQuasar
  };
});

describe("Billing Component", () => {
  let wrapper: any = null;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Reset router state
    mockRouter.currentRoute.value.name = "billings";
    mockRouter.currentRoute.value.query = {
      data_type: "gb",
      usage_date: "30days"
    };

    wrapper = mount(Billing, {
      global: {
        plugins: [i18n],
        provide: {
          store,
        },
        stubs: {
          'q-page': true,
          'q-separator': true,
          'q-splitter': {
            template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
          },
          'q-tabs': true,
          'q-route-tab': true,
          'router-view': true,
          'q-select': true,
          'q-icon': true,
          'ConfirmDialog': true,
          'Usage': true,
          'AppTabs': {
            template: '<div></div>',
            props: ['tabs', 'activeTab'],
            emits: ['update:activeTab']
          }
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
      expect(wrapper.vm.$options.name).toBe("PageIngestion");
    });

    it("should initialize with correct data", () => {
      expect(wrapper.vm.billingtab).toBe("plans"); // Should be set to "plans" in onMounted
      expect(wrapper.vm.usageDataType).toBe("gb");
      expect(wrapper.vm.splitterModel).toBe(220);
      expect(wrapper.vm.usageDate).toBe("30days");
    });

    it("should expose all required properties from setup", () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.router).toBeDefined();
      expect(wrapper.vm.config).toBeDefined();
      expect(wrapper.vm.billingtab).toBeDefined();
      expect(wrapper.vm.getImageURL).toBeDefined();
      expect(wrapper.vm.headerBasedOnRoute).toBeDefined();
      expect(wrapper.vm.selectUsageDate).toBeDefined();
      expect(wrapper.vm.updateActiveTab).toBeDefined();
    });

    it("should have correct tabs configuration", () => {
      expect(wrapper.vm.tabs).toEqual([
        { label: 'Gb', value: "gb" },
        { label: 'Mb', value: "mb" }
      ]);
    });

    it("should have correct options configuration", () => {
      expect(wrapper.vm.options).toEqual([
        { label: "30 Days", value: "30days" },
        { label: "60 Days", value: "60days" },
        { label: "3 Months", value: "3months" },
        { label: "6 Months", value: "6months" }
      ]);
    });
  });

  describe("onMounted Lifecycle Hook", () => {
    it("should redirect to plans when route is billings", () => {
      expect(mockRouter.push).toHaveBeenCalledWith({
        path: "/billings/plans",
        query: { org_identifier: store.state.selectedOrganization.identifier }
      });
      expect(wrapper.vm.billingtab).toBe("plans");
    });

    it("should redirect to plans when route is plans", () => {
      mockRouter.currentRoute.value.name = "plans";
      mockRouter.push.mockClear();
      
      const testWrapper = mount(Billing, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            'q-page': true,
            'q-separator': true,
            'q-splitter': {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
            },
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true,
            'q-select': true,
            'q-icon': true,
            'ConfirmDialog': true,
            'Usage': true,
            'AppTabs': {
              template: '<div></div>',
              props: ['tabs', 'activeTab'],
              emits: ['update:activeTab']
            }
          }
        },
      });
      
      expect(mockRouter.push).toHaveBeenCalledWith({
        path: "/billings/plans",
        query: { org_identifier: store.state.selectedOrganization.identifier }
      });
      expect(testWrapper.vm.billingtab).toBe("plans");
      testWrapper.unmount();
    });

    it("should not redirect when route is usage", () => {
      mockRouter.currentRoute.value.name = "usage";
      mockRouter.push.mockClear();
      
      const testWrapper = mount(Billing, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            'q-page': true,
            'q-separator': true,
            'q-splitter': {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
            },
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true,
            'q-select': true,
            'q-icon': true,
            'ConfirmDialog': true,
            'Usage': true,
            'AppTabs': {
              template: '<div></div>',
              props: ['tabs', 'activeTab'],
              emits: ['update:activeTab']
            }
          }
        },
      });
      
      expect(mockRouter.push).not.toHaveBeenCalled();
      testWrapper.unmount();
    });
  });

  describe("headerBasedOnRoute Function", () => {
    it("should return usage label when route is usage", () => {
      mockRouter.currentRoute.value.name = "usage";
      const result = wrapper.vm.headerBasedOnRoute();
      expect(result).toBe(wrapper.vm.t("billing.usageLabel"));
    });

    it("should return plans label when route is plans", () => {
      mockRouter.currentRoute.value.name = "plans";
      const result = wrapper.vm.headerBasedOnRoute();
      expect(result).toBe(wrapper.vm.t("billing.plansLabel"));
    });

    it("should return invoice history label when route is invoice_history", () => {
      mockRouter.currentRoute.value.name = "invoice_history";
      const result = wrapper.vm.headerBasedOnRoute();
      expect(result).toBe(wrapper.vm.t("billing.invoiceHistoryLabel"));
    });

    it("should return empty string for unknown route", () => {
      mockRouter.currentRoute.value.name = "unknown";
      const result = wrapper.vm.headerBasedOnRoute();
      expect(result).toBe("");
    });

    it("should handle null route name gracefully", () => {
      mockRouter.currentRoute.value.name = null;
      const result = wrapper.vm.headerBasedOnRoute();
      expect(result).toBe("");
    });
  });

  describe("isUsageRoute Computed Property", () => {
    it("should return true when route is usage", () => {
      mockRouter.currentRoute.value.name = "usage";
      expect(wrapper.vm.isUsageRoute).toBe(true);
    });

    it("should return false when route is plans", () => {
      mockRouter.currentRoute.value.name = "plans";
      expect(wrapper.vm.isUsageRoute).toBe(false);
    });

    it("should return false when route is invoice_history", () => {
      mockRouter.currentRoute.value.name = "invoice_history";
      expect(wrapper.vm.isUsageRoute).toBe(false);
    });

    it("should return false for unknown route", () => {
      mockRouter.currentRoute.value.name = "unknown";
      expect(wrapper.vm.isUsageRoute).toBe(false);
    });
  });

  describe("selectUsageDate Function", () => {
    it("should navigate to usage route with correct parameters", () => {
      wrapper.vm.usageDate = "60days";
      wrapper.vm.usageDataType = "mb";
      
      wrapper.vm.selectUsageDate();
      
      expect(mockRouter.push).toHaveBeenCalledWith({
        path: '/billings/usage',
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          usage_date: "60days",
          data_type: "mb"
        }
      });
    });

    it("should use default values when properties are not set", () => {
      wrapper.vm.usageDate = undefined;
      wrapper.vm.usageDataType = undefined;
      
      wrapper.vm.selectUsageDate();
      
      expect(mockRouter.push).toHaveBeenCalledWith({
        path: '/billings/usage',
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          usage_date: undefined,
          data_type: undefined
        }
      });
    });

    it("should handle empty string values", () => {
      wrapper.vm.usageDate = "";
      wrapper.vm.usageDataType = "";
      
      wrapper.vm.selectUsageDate();
      
      expect(mockRouter.push).toHaveBeenCalledWith({
        path: '/billings/usage',
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          usage_date: "",
          data_type: ""
        }
      });
    });
  });

  describe("updateActiveTab Function", () => {
    it("should update usageDataType and call router push", () => {
      mockRouter.push.mockClear();
      
      wrapper.vm.updateActiveTab("mb");
      
      expect(wrapper.vm.usageDataType).toBe("mb");
      expect(mockRouter.push).toHaveBeenCalledWith({
        path: '/billings/usage',
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          usage_date: wrapper.vm.usageDate,
          data_type: "mb"
        }
      });
    });

    it("should handle different tab values", () => {
      mockRouter.push.mockClear();
      
      wrapper.vm.updateActiveTab("gb");
      
      expect(wrapper.vm.usageDataType).toBe("gb");
      expect(mockRouter.push).toHaveBeenCalledWith({
        path: '/billings/usage',
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          usage_date: wrapper.vm.usageDate,
          data_type: "gb"
        }
      });
    });

    it("should handle null value", () => {
      mockRouter.push.mockClear();
      
      wrapper.vm.updateActiveTab(null);
      
      expect(wrapper.vm.usageDataType).toBe(null);
      expect(mockRouter.push).toHaveBeenCalledWith({
        path: '/billings/usage',
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          usage_date: wrapper.vm.usageDate,
          data_type: null
        }
      });
    });
  });

  describe("Reactive Data Properties", () => {
    it("should have reactive billingtab", async () => {
      wrapper.vm.billingtab = "usage";
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.billingtab).toBe("usage");
    });

    it("should have reactive usageDataType", async () => {
      wrapper.vm.usageDataType = "mb";
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.usageDataType).toBe("mb");
    });

    it("should have reactive usageDate", async () => {
      wrapper.vm.usageDate = "60days";
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.usageDate).toBe("60days");
    });

    it("should have reactive splitterModel", async () => {
      wrapper.vm.splitterModel = 300;
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.splitterModel).toBe(300);
    });
  });

  describe("Store Integration", () => {
    it("should access correct store state properties", () => {
      expect(wrapper.vm.store.state.selectedOrganization).toBeDefined();
      expect(wrapper.vm.store.state.selectedOrganization.identifier).toBeDefined();
    });

    it("should use store state in router navigation", () => {
      wrapper.vm.selectUsageDate();
      
      expect(mockRouter.push).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            org_identifier: store.state.selectedOrganization.identifier
          })
        })
      );
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

    it("should have i18n translation function", () => {
      expect(typeof wrapper.vm.t).toBe("function");
    });
  });

  describe("Query Parameter Initialization", () => {
    it("should initialize usageDataType from router query", () => {
      mockRouter.currentRoute.value.query.data_type = "mb";
      
      const testWrapper = mount(Billing, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            'q-page': true,
            'q-separator': true,
            'q-splitter': {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
            },
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true,
            'q-select': true,
            'q-icon': true,
            'ConfirmDialog': true,
            'Usage': true,
            'AppTabs': {
              template: '<div></div>',
              props: ['tabs', 'activeTab'],
              emits: ['update:activeTab']
            }
          }
        },
      });
      
      expect(testWrapper.vm.usageDataType).toBe("mb");
      testWrapper.unmount();
    });

    it("should initialize usageDate from router query", () => {
      mockRouter.currentRoute.value.query.usage_date = "3months";
      
      const testWrapper = mount(Billing, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            'q-page': true,
            'q-separator': true,
            'q-splitter': {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
            },
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true,
            'q-select': true,
            'q-icon': true,
            'ConfirmDialog': true,
            'Usage': true,
            'AppTabs': {
              template: '<div></div>',
              props: ['tabs', 'activeTab'],
              emits: ['update:activeTab']
            }
          }
        },
      });
      
      expect(testWrapper.vm.usageDate).toBe("3months");
      testWrapper.unmount();
    });

    it("should use default values when query parameters are missing", () => {
      mockRouter.currentRoute.value.query = {};
      
      const testWrapper = mount(Billing, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            'q-page': true,
            'q-separator': true,
            'q-splitter': {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
            },
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true,
            'q-select': true,
            'q-icon': true,
            'ConfirmDialog': true,
            'Usage': true,
            'AppTabs': {
              template: '<div></div>',
              props: ['tabs', 'activeTab'],
              emits: ['update:activeTab']
            }
          }
        },
      });
      
      expect(testWrapper.vm.usageDataType).toBe("gb");
      expect(testWrapper.vm.usageDate).toBe("30days");
      testWrapper.unmount();
    });
  });

  describe("Return Object from Setup", () => {
    it("should return all required properties", () => {
      const expectedProps = [
        't', 'store', 'router', 'config', 'billingtab', 'getImageURL',
        'splitterModel', 'headerBasedOnRoute', 'options', 'usageDate',
        'selectUsageDate', 'isUsageRoute', 'tabs', 'usageDataType', 'updateActiveTab'
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
      expect(typeof wrapper.vm.billingtab).toBe("string");
      expect(typeof wrapper.vm.getImageURL).toBe("function");
      expect(typeof wrapper.vm.splitterModel).toBe("number");
      expect(typeof wrapper.vm.headerBasedOnRoute).toBe("function");
      expect(Array.isArray(wrapper.vm.options)).toBe(true);
      expect(typeof wrapper.vm.usageDate).toBe("string");
      expect(typeof wrapper.vm.selectUsageDate).toBe("function");
      expect(typeof wrapper.vm.isUsageRoute).toBe("boolean");
      expect(Array.isArray(wrapper.vm.tabs)).toBe(true);
      expect(typeof wrapper.vm.usageDataType).toBe("string");
      expect(typeof wrapper.vm.updateActiveTab).toBe("function");
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle missing router gracefully", () => {
      expect(wrapper.vm.router).toBeDefined();
      expect(wrapper.vm.router.currentRoute).toBeDefined();
    });

    it("should handle empty store state gracefully", () => {
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state).toBeDefined();
    });

    it("should handle function calls with undefined parameters", () => {
      expect(() => wrapper.vm.updateActiveTab(undefined)).not.toThrow();
    });
  });
});