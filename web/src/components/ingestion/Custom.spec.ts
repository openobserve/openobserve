import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import Custom from "@/components/ingestion/Custom.vue";
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
  getImageURL: vi.fn(() => "mock-image-url")
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
      name: "custom",
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

describe("Custom Component", () => {
  let wrapper: any = null;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Reset router state
    mockRouter.currentRoute.value.name = "custom";
    mockRouter.currentRoute.value.query = {};

    wrapper = mount(Custom, {
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

    it("should have correct props", () => {
      expect(wrapper.props('currOrgIdentifier')).toBe("test-org");
    });

    it("should initialize with correct data", () => {
      expect(wrapper.vm.splitterModel).toBe(250);
      expect(wrapper.vm.currentUserEmail).toBeDefined();
      expect(wrapper.vm.tabs).toBeDefined();
      expect(typeof wrapper.vm.copyToClipboardFn).toBe("function");
    });

    it("should have route arrays defined", () => {
      expect(Array.isArray(wrapper.vm.rumRoutes)).toBe(true);
      expect(Array.isArray(wrapper.vm.traceRoutes)).toBe(true);
      expect(Array.isArray(wrapper.vm.metricRoutes)).toBe(true);
      
      expect(wrapper.vm.metricRoutes).toEqual([
        "prometheus",
        "otelCollector", 
        "telegraf",
        "cloudwatchMetrics"
      ]);
      
      expect(wrapper.vm.traceRoutes).toEqual(["tracesOTLP"]);
      expect(wrapper.vm.rumRoutes).toEqual(["frontendMonitoring"]);
    });
  });

  describe("Route-based Tab Setting", () => {
    it("should set tabs to 'ingestLogs' for log routes", () => {
      mockRouter.currentRoute.value.name = "curl";
      
      wrapper = mount(Custom, {
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
            'router-view': true
          }
        },
      });
      
      expect(wrapper.vm.tabs).toBe("ingestLogs");
    });

    it("should set tabs to 'ingestMetrics' for metric routes", () => {
      mockRouter.currentRoute.value.name = "prometheus";
      
      wrapper = mount(Custom, {
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
            'router-view': true
          }
        },
      });
      
      expect(wrapper.vm.tabs).toBe("ingestMetrics");
    });

    it("should set tabs to 'ingestTraces' for trace routes", () => {
      mockRouter.currentRoute.value.name = "tracesOTLP";
      
      wrapper = mount(Custom, {
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
            'router-view': true
          }
        },
      });
      
      expect(wrapper.vm.tabs).toBe("ingestTraces");
    });

    it("should handle custom route by redirecting to curl", () => {
      // The custom route case is already tested in the default beforeEach
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "curl",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      expect(wrapper.vm.tabs).toBe("ingestLogs");
    });

    it("should handle ingest routes by updating query params", () => {
      mockRouter.currentRoute.value.name = "ingestLogs";
      
      wrapper = mount(Custom, {
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
            'router-view': true
          }
        },
      });
      
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "ingestLogs",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });
  });

  describe("copyToClipboardFn", () => {
    it("should copy content and show success notification", async () => {
      const { copyToClipboard } = await import("quasar");
      vi.mocked(copyToClipboard).mockResolvedValue();
      
      const mockContent = {
        innerText: "test content to copy"
      };
      
      await wrapper.vm.copyToClipboardFn(mockContent);
      
      expect(copyToClipboard).toHaveBeenCalledWith("test content to copy");
      expect(mockQuasar.notify).toHaveBeenCalledWith({
        type: "positive",
        message: "Content Copied Successfully!",
        timeout: 5000,
      });
    });

    it("should show error notification when copy fails", async () => {
      const { copyToClipboard } = await import("quasar");
      vi.mocked(copyToClipboard).mockRejectedValueOnce(new Error("Copy failed"));
      
      const mockContent = {
        innerText: "test content to copy"
      };
      
      try {
        await wrapper.vm.copyToClipboardFn(mockContent);
      } catch (error) {
        // Expected error
      }
      
      expect(copyToClipboard).toHaveBeenCalledWith("test content to copy");
      
      // Wait for the promise to resolve
      await new Promise(resolve => setTimeout(resolve, 0));
      
      expect(mockQuasar.notify).toHaveBeenCalledWith({
        type: "negative",
        message: "Error while copy content.",
        timeout: 5000,
      });
    });

    it("should track segment analytics for copy action", async () => {
      const { copyToClipboard } = await import("quasar");
      vi.mocked(copyToClipboard).mockResolvedValue();
      
      const segment = await import("@/services/segment_analytics");
      
      const mockContent = {
        innerText: "test content"
      };
      
      await wrapper.vm.copyToClipboardFn(mockContent);
      
      expect(segment.default.track).toHaveBeenCalledWith("Button Click", {
        button: "Copy to Clipboard",
        ingestion: mockRouter.currentRoute.value.name,
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "Ingestion",
      });
    });
  });

  describe("Route Arrays Content", () => {
    it("should have correct log routes array", () => {
      const logRoutes = [
        "curl",
        "fluentbit", 
        "fluentd",
        "kinesisfirehose",
        "vector",
        "filebeat",
        "gcpLogs",
      ];
      
      // Test each log route sets correct tab
      logRoutes.forEach(route => {
        mockRouter.currentRoute.value.name = route;
        const testWrapper = mount(Custom, {
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
              'router-view': true
            }
          },
        });
        
        expect(testWrapper.vm.tabs).toBe("ingestLogs");
        testWrapper.unmount();
      });
    });

    it("should handle rum routes", () => {
      mockRouter.currentRoute.value.name = "frontendMonitoring";
      
      const testWrapper = mount(Custom, {
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
            'router-view': true
          }
        },
      });
      
      expect(testWrapper.vm.tabs).toBe("rumMonitoring");
      testWrapper.unmount();
    });
  });

  describe("Component Props and Data", () => {
    it("should expose all required properties", () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.router).toBeDefined();
      expect(wrapper.vm.config).toBeDefined();
      expect(wrapper.vm.currentUserEmail).toBeDefined();
      expect(wrapper.vm.currentOrgIdentifier).toBeDefined();
      expect(wrapper.vm.getImageURL).toBeDefined();
    });

    it("should have correct computed values", () => {
      expect(wrapper.vm.currentUserEmail).toBe(store.state.userInfo.email);
      expect(wrapper.vm.currentOrgIdentifier).toBe(store.state.selectedOrganization.identifier);
    });
  });

  describe("Additional Route Combinations", () => {
    it("should handle otelCollector metric route", () => {
      mockRouter.currentRoute.value.name = "otelCollector";
      
      const testWrapper = mount(Custom, {
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
            'router-view': true
          }
        },
      });
      
      expect(testWrapper.vm.tabs).toBe("ingestMetrics");
      testWrapper.unmount();
    });

    it("should handle telegraf metric route", () => {
      mockRouter.currentRoute.value.name = "telegraf";
      
      const testWrapper = mount(Custom, {
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
            'router-view': true
          }
        },
      });
      
      expect(testWrapper.vm.tabs).toBe("ingestMetrics");
      testWrapper.unmount();
    });

    it("should handle cloudwatchMetrics metric route", () => {
      mockRouter.currentRoute.value.name = "cloudwatchMetrics";
      
      const testWrapper = mount(Custom, {
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
            'router-view': true
          }
        },
      });
      
      expect(testWrapper.vm.tabs).toBe("ingestMetrics");
      testWrapper.unmount();
    });

    it("should handle ingestTraces route", () => {
      mockRouter.currentRoute.value.name = "ingestTraces";
      
      const testWrapper = mount(Custom, {
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
            'router-view': true
          }
        },
      });
      
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "ingestTraces",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });

    it("should handle ingestMetrics route", () => {
      mockRouter.currentRoute.value.name = "ingestMetrics";
      
      const testWrapper = mount(Custom, {
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
            'router-view': true
          }
        },
      });
      
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "ingestMetrics",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });

    it("should handle rumMonitoring route", () => {
      mockRouter.currentRoute.value.name = "rumMonitoring";
      
      const testWrapper = mount(Custom, {
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
            'router-view': true
          }
        },
      });
      
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "rumMonitoring",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });

    it("should handle unknown route", () => {
      mockRouter.currentRoute.value.name = "unknownRoute";
      
      const testWrapper = mount(Custom, {
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
            'router-view': true
          }
        },
      });
      
      // Should default to empty tabs or handle gracefully
      expect(testWrapper.vm.tabs).toBe("");
      testWrapper.unmount();
    });
  });

  describe("Individual Log Routes", () => {
    it("should handle fluentbit route", () => {
      mockRouter.currentRoute.value.name = "fluentbit";
      
      const testWrapper = mount(Custom, {
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
            'router-view': true
          }
        },
      });
      
      expect(testWrapper.vm.tabs).toBe("ingestLogs");
      testWrapper.unmount();
    });

    it("should handle fluentd route", () => {
      mockRouter.currentRoute.value.name = "fluentd";
      
      const testWrapper = mount(Custom, {
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
            'router-view': true
          }
        },
      });
      
      expect(testWrapper.vm.tabs).toBe("ingestLogs");
      testWrapper.unmount();
    });

    it("should handle kinesisfirehose route", () => {
      mockRouter.currentRoute.value.name = "kinesisfirehose";
      
      const testWrapper = mount(Custom, {
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
            'router-view': true
          }
        },
      });
      
      expect(testWrapper.vm.tabs).toBe("ingestLogs");
      testWrapper.unmount();
    });

    it("should handle vector route", () => {
      mockRouter.currentRoute.value.name = "vector";
      
      const testWrapper = mount(Custom, {
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
            'router-view': true
          }
        },
      });
      
      expect(testWrapper.vm.tabs).toBe("ingestLogs");
      testWrapper.unmount();
    });

    it("should handle filebeat route", () => {
      mockRouter.currentRoute.value.name = "filebeat";
      
      const testWrapper = mount(Custom, {
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
            'router-view': true
          }
        },
      });
      
      expect(testWrapper.vm.tabs).toBe("ingestLogs");
      testWrapper.unmount();
    });

    it("should handle gcpLogs route", () => {
      mockRouter.currentRoute.value.name = "gcpLogs";
      
      const testWrapper = mount(Custom, {
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
            'router-view': true
          }
        },
      });
      
      expect(testWrapper.vm.tabs).toBe("ingestLogs");
      testWrapper.unmount();
    });
  });

  describe("onUpdated Lifecycle Hook", () => {
    it("should handle custom route in onUpdated", async () => {
      // First mount with different route
      mockRouter.currentRoute.value.name = "curl";
      
      const testWrapper = mount(Custom, {
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
            'router-view': true
          }
        },
      });

      // Reset mock call count
      mockRouter.push.mockClear();
      
      // Change route to trigger onUpdated
      mockRouter.currentRoute.value.name = "custom";
      
      // Force update
      await testWrapper.vm.$nextTick();
      testWrapper.vm.$forceUpdate();
      await testWrapper.vm.$nextTick();
      
      testWrapper.unmount();
    });
  });

  describe("Component Name and Props", () => {
    it("should have correct component name", () => {
      expect(wrapper.vm.$options.name).toBe("CustomPage");
    });

    it("should handle default currOrgIdentifier prop", () => {
      const testWrapper = mount(Custom, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            'q-splitter': {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>'
            },
            'q-tabs': true,
            'q-route-tab': true,
            'router-view': true
          }
        },
      });
      
      expect(testWrapper.props('currOrgIdentifier')).toBe("");
      testWrapper.unmount();
    });

    it("should handle custom currOrgIdentifier prop", () => {
      expect(wrapper.props('currOrgIdentifier')).toBe("test-org");
    });

    it("should have correct prop type", () => {
      const propDefinition = wrapper.vm.$options.props.currOrgIdentifier;
      expect(propDefinition.type).toBe(String);
      expect(propDefinition.default).toBe("");
    });
  });

  describe("Segment Analytics", () => {
    it("should track analytics with correct parameters for different routes", async () => {
      const { copyToClipboard } = await import("quasar");
      vi.mocked(copyToClipboard).mockResolvedValue();
      
      const segment = await import("@/services/segment_analytics");
      
      // Test with different route
      mockRouter.currentRoute.value.name = "prometheus";
      
      const mockContent = {
        innerText: "test analytics content"
      };
      
      await wrapper.vm.copyToClipboardFn(mockContent);
      
      expect(segment.default.track).toHaveBeenCalledWith("Button Click", {
        button: "Copy to Clipboard",
        ingestion: "prometheus",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "Ingestion",
      });
    });

    it("should track analytics even when copy fails", async () => {
      const { copyToClipboard } = await import("quasar");
      vi.mocked(copyToClipboard).mockRejectedValueOnce(new Error("Copy failed"));
      
      const segment = await import("@/services/segment_analytics");
      
      const mockContent = {
        innerText: "test analytics content"
      };
      
      try {
        await wrapper.vm.copyToClipboardFn(mockContent);
      } catch (error) {
        // Expected error
      }
      
      // Wait for promises to resolve
      await new Promise(resolve => setTimeout(resolve, 0));
      
      expect(segment.default.track).toHaveBeenCalledWith("Button Click", {
        button: "Copy to Clipboard",
        ingestion: mockRouter.currentRoute.value.name,
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "Ingestion",
      });
    });
  });

  describe("Error Handling", () => {
    it("should handle clipboard copy with empty content", async () => {
      const { copyToClipboard } = await import("quasar");
      vi.mocked(copyToClipboard).mockResolvedValue();
      
      const mockContent = {
        innerText: ""
      };
      
      await wrapper.vm.copyToClipboardFn(mockContent);
      
      expect(copyToClipboard).toHaveBeenCalledWith("");
    });

    it("should handle clipboard copy with null content", async () => {
      const { copyToClipboard } = await import("quasar");
      vi.mocked(copyToClipboard).mockResolvedValue();
      
      const mockContent = {
        innerText: null
      };
      
      await wrapper.vm.copyToClipboardFn(mockContent);
      
      expect(copyToClipboard).toHaveBeenCalledWith(null);
    });

    it("should handle missing innerText property", async () => {
      const { copyToClipboard } = await import("quasar");
      vi.mocked(copyToClipboard).mockResolvedValue();
      
      const mockContent = {};
      
      await wrapper.vm.copyToClipboardFn(mockContent);
      
      expect(copyToClipboard).toHaveBeenCalledWith(undefined);
    });
  });

  describe("Reactive Data", () => {
    it("should update tabs reactively", async () => {
      expect(wrapper.vm.tabs).toBe("ingestLogs");
      
      wrapper.vm.tabs = "ingestMetrics";
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.tabs).toBe("ingestMetrics");
    });

    it("should have reactive splitterModel", async () => {
      expect(wrapper.vm.splitterModel).toBe(250);
      
      wrapper.vm.splitterModel = 300;
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.splitterModel).toBe(300);
    });

    it("should have reactive currentOrgIdentifier", () => {
      expect(wrapper.vm.currentOrgIdentifier).toBe(store.state.selectedOrganization.identifier);
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
      // Already tested in beforeEach setup where custom route triggers navigation
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "curl",
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

    it("should have i18n translation function", () => {
      expect(typeof wrapper.vm.t).toBe("function");
    });
  });
});