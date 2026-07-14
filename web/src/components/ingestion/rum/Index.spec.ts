// Copyright 2026 OpenObserve Inc.

import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// Mock services
vi.mock("@/services/segment_analytics", () => ({
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

// Mock clipboard utility — handles copy + notifications internally
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: vi.fn().mockResolvedValue(true),
}));

// Mock router
const mockRouter = {
  currentRoute: {
    value: {
      name: "frontendMonitoring",
      query: {},
    },
  },
  push: vi.fn(),
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
  useRoute: () => mockRouter.currentRoute.value,
}));

import IngestRum from "@/components/ingestion/rum/Index.vue";

// Helper to build mount options with O2 component stubs
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
          template:
            '<div><slot name="before"></slot><slot name="after"></slot></div>',
        },
        OTabs: {
          template: '<div><slot /></div>',
        },
        ORouteTab: true,
        "router-view": true,
      },
    },
  };
}

describe("IngestRum Component", () => {
  let wrapper: any = null;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default route for most tests
    mockRouter.currentRoute.value.name = "frontendMonitoring";
    mockRouter.currentRoute.value.query = {};

    wrapper = mount(IngestRum, buildMountOptions());
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
      expect(wrapper.vm.$options.name).toBe("IngestRum");
    });

    it("should initialise splitterModel to 200", () => {
      // IngestRum uses ref(200), not ref(250)
      expect(wrapper.vm.splitterModel).toBe(200);
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

    it("should initialise rumtabs data property to 'rumWebTab'", () => {
      // rumtabs is declared in setup() for IngestRum
      expect(wrapper.vm.rumtabs).toBe("rumWebTab");
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
      const testWrapper = mount(IngestRum, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            OSplitter: {
              template:
                '<div><slot name="before"></slot><slot name="after"></slot></div>',
            },
            OTabs: {
              template: '<div><slot /></div>',
            },
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
  // Route-based Redirection (onMounted — not onBeforeMount)
  // ─────────────────────────────────────────────────────────────────────────
  describe("Route-based Redirection", () => {
    it("should push with org_identifier query when route is 'frontendMonitoring'", () => {
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "frontendMonitoring",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });

    it("should redirect to 'frontendMonitoring' when route name is 'rumMonitoring'", () => {
      mockRouter.currentRoute.value.name = "rumMonitoring";
      const tw = mount(IngestRum, buildMountOptions());
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "frontendMonitoring",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      tw.unmount();
    });

    it("should not call router.push for an unrelated route", () => {
      mockRouter.currentRoute.value.name = "someOtherPage";
      mockRouter.push.mockClear();
      const tw = mount(IngestRum, buildMountOptions());
      expect(mockRouter.push).not.toHaveBeenCalled();
      tw.unmount();
    });

    it("should use the correct org_identifier from the store in navigation query", () => {
      expect(mockRouter.push).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
          },
        }),
      );
    });

    it("should push to 'frontendMonitoring' and not any other named route", () => {
      mockRouter.currentRoute.value.name = "rumMonitoring";
      const tw = mount(IngestRum, buildMountOptions());
      const calls = mockRouter.push.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall.name).toBe("frontendMonitoring");
      tw.unmount();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // copyToClipboardFn
  //
  // The component imports copyToClipboard from @/utils/clipboard and passes
  // successMessage / errorMessage / timeout options. Notifications are handled
  // internally by the clipboard utility — the component does NOT call
  // notify directly. Segment analytics only fire on copy success.
  // ─────────────────────────────────────────────────────────────────────────
  describe("copyToClipboardFn", () => {
    const expectedOptions = {
      successMessage: "Content Copied Successfully!",
      errorMessage: "Error while copy content.",
      timeout: 5000,
    };

    it("should call copyToClipboard with content.innerText and options", async () => {
      const { copyToClipboard } = await import("@/utils/clipboard");

      const mockContent = { innerText: "rum sdk snippet" };
      wrapper.vm.copyToClipboardFn(mockContent);
      await flushPromises();

      expect(copyToClipboard).toHaveBeenCalledWith(
        "rum sdk snippet",
        expectedOptions,
      );
    });

    it("should track segment analytics with page 'RUM Ingestion' on copy success", async () => {
      const { copyToClipboard } = await import("@/utils/clipboard");
      vi.mocked(copyToClipboard).mockResolvedValue(true);

      const segment = await import("@/services/segment_analytics");

      mockRouter.currentRoute.value.name = "frontendMonitoring";
      wrapper.vm.copyToClipboardFn({ innerText: "rum snippet" });
      await flushPromises();

      expect(segment.default.track).toHaveBeenCalledWith("Button Click", {
        button: "Copy to Clipboard",
        ingestion: "frontendMonitoring",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "RUM Ingestion",
      });
    });

    it("should use 'RUM Ingestion' as the page value, not 'Ingestion'", async () => {
      const { copyToClipboard } = await import("@/utils/clipboard");
      vi.mocked(copyToClipboard).mockResolvedValue(true);

      const segment = await import("@/services/segment_analytics");

      wrapper.vm.copyToClipboardFn({ innerText: "check page" });
      await flushPromises();

      const trackCall = vi.mocked(segment.default.track).mock.calls[0];
      expect(trackCall[1].page).toBe("RUM Ingestion");
      expect(trackCall[1].page).not.toBe("Ingestion");
    });

    it("should NOT track segment analytics when clipboard copy fails", async () => {
      // The component only calls segment.track inside .then(success => { if (success) { ... } })
      // When copyToClipboard resolves to false, segment.track is never called.
      const { copyToClipboard } = await import("@/utils/clipboard");
      vi.mocked(copyToClipboard).mockResolvedValue(false);

      const segment = await import("@/services/segment_analytics");

      mockRouter.currentRoute.value.name = "frontendMonitoring";
      wrapper.vm.copyToClipboardFn({ innerText: "fail track" });
      await flushPromises();

      expect(segment.default.track).not.toHaveBeenCalled();
    });

    it("should handle empty innerText gracefully", async () => {
      const { copyToClipboard } = await import("@/utils/clipboard");
      vi.mocked(copyToClipboard).mockResolvedValue(true);

      wrapper.vm.copyToClipboardFn({ innerText: "" });
      await flushPromises();

      expect(copyToClipboard).toHaveBeenCalledWith("", expectedOptions);
    });

    it("should handle undefined innerText gracefully", async () => {
      const { copyToClipboard } = await import("@/utils/clipboard");
      vi.mocked(copyToClipboard).mockResolvedValue(true);

      wrapper.vm.copyToClipboardFn({});
      await flushPromises();

      expect(copyToClipboard).toHaveBeenCalledWith(undefined, expectedOptions);
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
      expect(
        wrapper.vm.store.state.selectedOrganization.identifier,
      ).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Reactive Data
  // ─────────────────────────────────────────────────────────────────────────
  describe("Reactive Data", () => {
    it("should allow splitterModel to be updated reactively", async () => {
      expect(wrapper.vm.splitterModel).toBe(200);
      wrapper.vm.splitterModel = 300;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.splitterModel).toBe(300);
    });

    it("should allow rumtabs to be updated reactively", async () => {
      expect(wrapper.vm.rumtabs).toBe("rumWebTab");
      wrapper.vm.rumtabs = "anotherTab";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.rumtabs).toBe("anotherTab");
    });

    it("should have a different initial splitterModel than the logs/metrics components (200 vs 250)", () => {
      // Confirms RUM uses 200, not the 250 used by IngestLogs/IngestMetrics
      expect(wrapper.vm.splitterModel).toBe(200);
      expect(wrapper.vm.splitterModel).not.toBe(250);
    });
  });
});
