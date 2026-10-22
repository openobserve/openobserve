import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import IngestMetrics from "@/components/ingestion/metrics/Index.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// Mock services
vi.mock("@/services/product_analytics", () => ({
  default: {
    track: vi.fn(),
  },
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn(() => "mock-image-url"),
  verifyOrganizationStatus: vi.fn(),
}));

vi.mock("../../../aws-exports", () => ({
  default: {
    API_ENDPOINT: "http://localhost:5080",
    isCloud: "false",
  },
}));

// Mock clipboard utility
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}));

// Mock router
const mockRouter = {
  currentRoute: {
    value: {
      name: "prometheus",
      query: {},
    },
  },
  push: vi.fn(),
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
  useRoute: () => mockRouter.currentRoute.value,
}));

// Helper to build mount options
function buildMountOptions() {
  return {
    props: {
      currOrgIdentifier: "test-org",
    },
    global: {
      plugins: [i18n],
      provide: {
        store,
      },
      stubs: {
        OSplitter: {
          template: '<div><slot name="before"></slot><slot name="after"></slot></div>',
        },
        OTabs: true,
        ORouteTab: true,
        "router-view": true,
      },
    },
  };
}

describe("IngestMetrics Component", () => {
  let wrapper: any = null;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default route for most tests
    mockRouter.currentRoute.value.name = "prometheus";
    mockRouter.currentRoute.value.query = {};

    wrapper = mount(IngestMetrics, buildMountOptions());
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Component Initialization
  // ─────────────────────────────────────────────────────────────────────────
  describe("Component Initialization", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should have the correct component name", () => {
      expect(wrapper.vm.$options.name).toBe("IngestMetrics");
    });

    it("should expose currentUserEmail from the store", () => {
      expect(wrapper.vm.currentUserEmail).toBe(store.state.userInfo.email);
    });

    it("should expose copyToClipboardFn as a function", () => {
      expect(typeof wrapper.vm.copyToClipboardFn).toBe("function");
    });

    it("should expose showUpdateDialogFn as a function", () => {
      expect(typeof wrapper.vm.showUpdateDialogFn).toBe("function");
    });

    it("should initialise confirmUpdate to false", () => {
      expect(wrapper.vm.confirmUpdate).toBe(false);
    });

    it("should initialise ingestiontabs data property to empty string", () => {
      // ingestiontabs is declared in data() for IngestMetrics
      expect(wrapper.vm.ingestiontabs).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Component Props and Data
  // ─────────────────────────────────────────────────────────────────────────
  describe("Component Props and Data", () => {
    it("should accept and reflect the currOrgIdentifier prop", () => {
      expect(wrapper.props("currOrgIdentifier")).toBe("test-org");
    });

    it("should use empty string as the default for currOrgIdentifier", () => {
      const testWrapper = mount(IngestMetrics, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            OSplitter: {
              template: '<div><slot name="before"></slot><slot name="after"></slot></div>',
            },
            OTabs: true,
            ORouteTab: true,
            "router-view": true,
          },
        },
      });
      expect(testWrapper.props("currOrgIdentifier")).toBe("");
      testWrapper.unmount();
    });

    it("should have correct prop type definition for currOrgIdentifier", () => {
      const propDef = wrapper.vm.$options.props.currOrgIdentifier;
      expect(propDef.type).toBe(String);
      expect(propDef.default).toBe("");
    });

    it("should expose the config object with API_ENDPOINT", () => {
      expect(wrapper.vm.config).toBeDefined();
      expect(wrapper.vm.config.API_ENDPOINT).toBe("http://localhost:5080");
    });

    it("should expose getImageURL as a function", () => {
      expect(typeof wrapper.vm.getImageURL).toBe("function");
      expect(wrapper.vm.getImageURL("any")).toBe("mock-image-url");
    });

    it("should expose the i18n translation function t", () => {
      expect(typeof wrapper.vm.t).toBe("function");
    });

    it("should expose the store instance", () => {
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state.selectedOrganization).toBeDefined();
    });

    it("should expose the router instance", () => {
      expect(wrapper.vm.router).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Route-based Redirection (onBeforeMount)
  // ─────────────────────────────────────────────────────────────────────────
  describe("Route-based Redirection", () => {
    it("should push with org_identifier query when route is 'prometheus'", () => {
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "prometheus",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });

    it("should push with org_identifier query when route is 'vmagent'", () => {
      mockRouter.currentRoute.value.name = "vmagent";
      const tw = mount(IngestMetrics, buildMountOptions());
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "vmagent",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      tw.unmount();
    });

    it("should push with org_identifier query when route is 'nightingale'", () => {
      mockRouter.currentRoute.value.name = "nightingale";
      const tw = mount(IngestMetrics, buildMountOptions());
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "nightingale",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      tw.unmount();
    });

    it("should push with org_identifier query when route is 'categraf'", () => {
      mockRouter.currentRoute.value.name = "categraf";
      const tw = mount(IngestMetrics, buildMountOptions());
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "categraf",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      tw.unmount();
    });

    it("should push with org_identifier query when route is 'otelCollector'", () => {
      mockRouter.currentRoute.value.name = "otelCollector";
      const tw = mount(IngestMetrics, buildMountOptions());
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "otelCollector",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      tw.unmount();
    });

    it("should push with org_identifier query when route is 'telegraf'", () => {
      mockRouter.currentRoute.value.name = "telegraf";
      const tw = mount(IngestMetrics, buildMountOptions());
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "telegraf",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      tw.unmount();
    });

    it("should push with org_identifier query when route is 'cloudwatchMetrics'", () => {
      mockRouter.currentRoute.value.name = "cloudwatchMetrics";
      const tw = mount(IngestMetrics, buildMountOptions());
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "cloudwatchMetrics",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      tw.unmount();
    });

    it("should redirect to 'prometheus' when route name is 'ingestMetrics'", () => {
      mockRouter.currentRoute.value.name = "ingestMetrics";
      const tw = mount(IngestMetrics, buildMountOptions());
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "prometheus",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      tw.unmount();
    });

    it("should not call router.push for an unrelated route", () => {
      mockRouter.currentRoute.value.name = "someOtherPage";
      mockRouter.push.mockClear();
      const tw = mount(IngestMetrics, buildMountOptions());
      expect(mockRouter.push).not.toHaveBeenCalled();
      tw.unmount();
    });

    it("should redirect to 'prometheus' in onUpdated when route is 'ingestMetrics'", async () => {
      mockRouter.currentRoute.value.name = "prometheus";
      const tw = mount(IngestMetrics, buildMountOptions());
      mockRouter.push.mockClear();

      mockRouter.currentRoute.value.name = "ingestMetrics";
      tw.vm.$forceUpdate();
      await tw.vm.$nextTick();

      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "prometheus",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      tw.unmount();
    });

    it("should NOT call router.push in onUpdated when route is not 'ingestMetrics'", async () => {
      mockRouter.currentRoute.value.name = "telegraf";
      const tw = mount(IngestMetrics, buildMountOptions());
      mockRouter.push.mockClear();

      tw.vm.$forceUpdate();
      await tw.vm.$nextTick();

      expect(mockRouter.push).not.toHaveBeenCalled();
      tw.unmount();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // copyToClipboardFn
  // ─────────────────────────────────────────────────────────────────────────
  describe("copyToClipboardFn", () => {
    it("should call copyToClipboard with content.innerText and options", async () => {
      const { copyToClipboard } = await import("@/utils/clipboard");

      const mockContent = { innerText: "prometheus config snippet" };
      wrapper.vm.copyToClipboardFn(mockContent);

      expect(copyToClipboard).toHaveBeenCalledWith(
        "prometheus config snippet",
        expect.any(Function),
        {
          successMessage: "Content Copied Successfully!",
          errorMessage: "Error while copy content.",
          timeout: 5000,
        },
      );
    });

    it("should pass correct success options when copying", async () => {
      const { copyToClipboard } = await import("@/utils/clipboard");

      wrapper.vm.copyToClipboardFn({ innerText: "some text" });

      expect(copyToClipboard).toHaveBeenCalledWith("some text", expect.any(Function), {
        successMessage: "Content Copied Successfully!",
        errorMessage: "Error while copy content.",
        timeout: 5000,
      });
    });

    it("should pass correct error options when copy may fail", async () => {
      const { copyToClipboard } = await import("@/utils/clipboard");

      wrapper.vm.copyToClipboardFn({ innerText: "fail text" });

      expect(copyToClipboard).toHaveBeenCalledWith("fail text", expect.any(Function), {
        successMessage: "Content Copied Successfully!",
        errorMessage: "Error while copy content.",
        timeout: 5000,
      });
    });

    it("should track product analytics on successful copy", async () => {
      const { copyToClipboard } = await import("@/utils/clipboard");
      vi.mocked(copyToClipboard).mockResolvedValueOnce(true);
      const analytics = await import("@/services/product_analytics");

      mockRouter.currentRoute.value.name = "otelCollector";
      wrapper.vm.copyToClipboardFn({ innerText: "otel snippet" });
      await flushPromises();

      expect(analytics.default.track).toHaveBeenCalledWith("Button Click", {
        button: "Copy to Clipboard",
        ingestion: "otelCollector",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "Ingestion",
      });
    });

    it("should NOT track product analytics when copy fails", async () => {
      const { copyToClipboard } = await import("@/utils/clipboard");
      vi.mocked(copyToClipboard).mockRejectedValueOnce(new Error("fail"));
      const analytics = await import("@/services/product_analytics");

      mockRouter.currentRoute.value.name = "telegraf";
      wrapper.vm.copyToClipboardFn({ innerText: "telegraf snippet" });
      await flushPromises();

      expect(analytics.default.track).not.toHaveBeenCalled();
    });

    it("should NOT track product analytics when copy resolves false", async () => {
      const { copyToClipboard } = await import("@/utils/clipboard");
      vi.mocked(copyToClipboard).mockResolvedValueOnce(false);
      const analytics = await import("@/services/product_analytics");

      mockRouter.currentRoute.value.name = "prometheus";
      wrapper.vm.copyToClipboardFn({ innerText: "some snippet" });
      await flushPromises();

      expect(analytics.default.track).not.toHaveBeenCalled();
    });

    it("should handle empty innerText gracefully", async () => {
      const { copyToClipboard } = await import("@/utils/clipboard");

      wrapper.vm.copyToClipboardFn({ innerText: "" });

      expect(copyToClipboard).toHaveBeenCalledWith("", expect.any(Function), {
        successMessage: "Content Copied Successfully!",
        errorMessage: "Error while copy content.",
        timeout: 5000,
      });
    });

    it("should handle undefined innerText gracefully", async () => {
      const { copyToClipboard } = await import("@/utils/clipboard");

      wrapper.vm.copyToClipboardFn({});

      expect(copyToClipboard).toHaveBeenCalledWith(undefined, expect.any(Function), {
        successMessage: "Content Copied Successfully!",
        errorMessage: "Error while copy content.",
        timeout: 5000,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // showUpdateDialogFn
  // ─────────────────────────────────────────────────────────────────────────
  describe("showUpdateDialogFn", () => {
    it("should set confirmUpdate to true when called", () => {
      expect(wrapper.vm.confirmUpdate).toBe(false);
      wrapper.vm.showUpdateDialogFn();
      expect(wrapper.vm.confirmUpdate).toBe(true);
    });

    it("should keep confirmUpdate true on subsequent calls", () => {
      wrapper.vm.showUpdateDialogFn();
      wrapper.vm.showUpdateDialogFn();
      expect(wrapper.vm.confirmUpdate).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Store Integration
  // ─────────────────────────────────────────────────────────────────────────
  describe("Store Integration", () => {
    it("should read userInfo.email from the store", () => {
      expect(wrapper.vm.currentUserEmail).toBe(store.state.userInfo.email);
    });

    it("should use store org identifier in router navigation query", () => {
      expect(mockRouter.push).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        }),
      );
    });

    it("should expose store state.selectedOrganization", () => {
      expect(wrapper.vm.store.state.selectedOrganization).toBeDefined();
      expect(wrapper.vm.store.state.selectedOrganization.identifier).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Reactive Data
  // ─────────────────────────────────────────────────────────────────────────
  describe("Reactive Data", () => {
    it("should allow ingestiontabs to be updated reactively", async () => {
      wrapper.vm.ingestiontabs = "prometheus";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ingestiontabs).toBe("prometheus");
    });
  });
});

describe("IngestMetrics: Get started pick", () => {
  const PICK_KEY = `o2.onboarding.firstSource.${store.state.selectedOrganization.identifier}`;
  const mountRail = () => {
    const options = buildMountOptions();
    options.global.stubs.OTabs = { template: "<div><slot /></div>" } as any;
    return mount(IngestMetrics, options);
  };
  const tabNames = (wrapper: any): string[] =>
    wrapper.findAllComponents({ name: "ORouteTab" }).map((c: any) => c.props("name"));

  afterEach(() => {
    localStorage.clear();
  });

  it("moves the OTel collector guide to the top under Your pick, the rest under Metrics", () => {
    localStorage.setItem(PICK_KEY, "otel");
    const wrapper = mountRail();
    expect(wrapper.find('[data-test="ingestion-metrics-pick-group"]').text()).toBe("Your pick");
    expect(wrapper.find('[data-test="ingestion-metrics-rest-group"]').text()).toBe("Metrics");
    expect(wrapper.find('[data-test="ingestion-metrics-pick-tab-otelCollector"]').exists()).toBe(
      true,
    );
    const names = tabNames(wrapper);
    expect(names[0]).toBe("otelCollector");
    expect(names.filter((n) => n === "otelCollector")).toHaveLength(1);
    wrapper.unmount();
  });

  it("keeps today's order with no pick", () => {
    const wrapper = mountRail();
    expect(wrapper.find('[data-test="ingestion-metrics-pick-group"]').exists()).toBe(false);
    expect(tabNames(wrapper)).toEqual([
      "prometheus",
      "vmagent",
      "nightingale",
      "categraf",
      "otelCollector",
      "telegraf",
      "cloudwatchMetrics",
    ]);
    wrapper.unmount();
  });
});
