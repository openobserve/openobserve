import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import IngestRum from "@/components/ingestion/rum/Index.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar();

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

// Mock Quasar
const mockQuasar = {
  notify: vi.fn(),
};

vi.mock("quasar", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useQuasar: () => mockQuasar,
    copyToClipboard: vi.fn(),
  };
});

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
        "q-splitter": {
          template:
            '<div><slot name="before"></slot><slot name="after"></slot></div>',
        },
        "q-tabs": true,
        "q-route-tab": true,
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
      // rumtabs is declared in data() for IngestRum
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
            "q-splitter": {
              template:
                '<div><slot name="before"></slot><slot name="after"></slot></div>',
            },
            "q-tabs": true,
            "q-route-tab": true,
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
  // ─────────────────────────────────────────────────────────────────────────
  describe("copyToClipboardFn", () => {
    it("should call copyToClipboard with content.innerText", async () => {
      const { copyToClipboard } = await import("quasar");
      vi.mocked(copyToClipboard).mockResolvedValue();

      const mockContent = { innerText: "rum sdk snippet" };
      await wrapper.vm.copyToClipboardFn(mockContent);

      expect(copyToClipboard).toHaveBeenCalledWith("rum sdk snippet");
    });

    it("should show positive notify on successful copy", async () => {
      const { copyToClipboard } = await import("quasar");
      vi.mocked(copyToClipboard).mockResolvedValue();

      await wrapper.vm.copyToClipboardFn({ innerText: "some text" });
      await new Promise((r) => setTimeout(r, 0));

      expect(mockQuasar.notify).toHaveBeenCalledWith({
        type: "positive",
        message: "Content Copied Successfully!",
        timeout: 5000,
      });
    });

    it("should show negative notify on copy failure", async () => {
      const { copyToClipboard } = await import("quasar");
      vi.mocked(copyToClipboard).mockRejectedValueOnce(
        new Error("clipboard denied"),
      );

      wrapper.vm.copyToClipboardFn({ innerText: "fail text" });
      await new Promise((r) => setTimeout(r, 0));

      expect(mockQuasar.notify).toHaveBeenCalledWith({
        type: "negative",
        message: "Error while copy content.",
        timeout: 5000,
      });
    });

    it("should track segment analytics with page 'RUM Ingestion' on copy", async () => {
      const { copyToClipboard } = await import("quasar");
      vi.mocked(copyToClipboard).mockResolvedValue();
      const segment = await import("@/services/segment_analytics");

      mockRouter.currentRoute.value.name = "frontendMonitoring";
      await wrapper.vm.copyToClipboardFn({ innerText: "rum snippet" });

      expect(segment.default.track).toHaveBeenCalledWith("Button Click", {
        button: "Copy to Clipboard",
        ingestion: "frontendMonitoring",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "RUM Ingestion",
      });
    });

    it("should use 'RUM Ingestion' as the page value, not 'Ingestion'", async () => {
      const { copyToClipboard } = await import("quasar");
      vi.mocked(copyToClipboard).mockResolvedValue();
      const segment = await import("@/services/segment_analytics");

      await wrapper.vm.copyToClipboardFn({ innerText: "check page" });

      const trackCall = vi.mocked(segment.default.track).mock.calls[0];
      expect(trackCall[1].page).toBe("RUM Ingestion");
      expect(trackCall[1].page).not.toBe("Ingestion");
    });

    it("should track segment analytics even when copy fails", async () => {
      const { copyToClipboard } = await import("quasar");
      vi.mocked(copyToClipboard).mockRejectedValueOnce(new Error("fail"));
      const segment = await import("@/services/segment_analytics");

      mockRouter.currentRoute.value.name = "frontendMonitoring";
      wrapper.vm.copyToClipboardFn({ innerText: "fail track" });
      await new Promise((r) => setTimeout(r, 0));

      expect(segment.default.track).toHaveBeenCalledWith("Button Click", {
        button: "Copy to Clipboard",
        ingestion: "frontendMonitoring",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "RUM Ingestion",
      });
    });

    it("should handle empty innerText gracefully", async () => {
      const { copyToClipboard } = await import("quasar");
      vi.mocked(copyToClipboard).mockResolvedValue();

      await wrapper.vm.copyToClipboardFn({ innerText: "" });
      expect(copyToClipboard).toHaveBeenCalledWith("");
    });

    it("should handle undefined innerText gracefully", async () => {
      const { copyToClipboard } = await import("quasar");
      vi.mocked(copyToClipboard).mockResolvedValue();

      await wrapper.vm.copyToClipboardFn({});
      expect(copyToClipboard).toHaveBeenCalledWith(undefined);
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
