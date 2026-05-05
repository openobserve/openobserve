import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import IngestLogs from "@/components/ingestion/logs/Index.vue";
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
      name: "curl",
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

describe("IngestLogs Component", () => {
  let wrapper: any = null;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default route for most tests
    mockRouter.currentRoute.value.name = "curl";
    mockRouter.currentRoute.value.query = {};

    wrapper = mount(IngestLogs, buildMountOptions());
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
      expect(wrapper.vm.$options.name).toBe("IngestLogs");
    });

    it("should initialise splitterModel to 250", () => {
      expect(wrapper.vm.splitterModel).toBe(250);
    });

    it("should expose currentUserEmail from the store", () => {
      expect(wrapper.vm.currentUserEmail).toBe(store.state.userInfo.email);
    });

    it("should expose currentOrgIdentifier from the store", () => {
      expect(wrapper.vm.currentOrgIdentifier).toBe(
        store.state.selectedOrganization.identifier,
      );
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

    it("should expose ingestiontabs ref", () => {
      expect(wrapper.vm.ingestiontabs).toBeDefined();
    });

    it("should expose the ingestRoutes array", () => {
      expect(Array.isArray(wrapper.vm.ingestRoutes)).toBe(true);
      expect(wrapper.vm.ingestRoutes).toEqual([
        "curl",
        "fluentbit",
        "fluentd",
        "vector",
        "syslogNg",
      ]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Component Props
  // ─────────────────────────────────────────────────────────────────────────
  describe("Component Props and Data", () => {
    it("should accept and reflect the currOrgIdentifier prop", () => {
      expect(wrapper.props("currOrgIdentifier")).toBe("test-org");
    });

    it("should use empty string as the default for currOrgIdentifier", () => {
      const testWrapper = mount(IngestLogs, {
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

    it("should expose the config object", () => {
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
    it("should push with org_identifier query when route is 'curl'", () => {
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "curl",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });

    it("should push with org_identifier query when route is 'fluentbit'", () => {
      mockRouter.currentRoute.value.name = "fluentbit";
      const tw = mount(IngestLogs, buildMountOptions());
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "fluentbit",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      tw.unmount();
    });

    it("should push with org_identifier query when route is 'fluentd'", () => {
      mockRouter.currentRoute.value.name = "fluentd";
      const tw = mount(IngestLogs, buildMountOptions());
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "fluentd",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      tw.unmount();
    });

    it("should push with org_identifier query when route is 'vector'", () => {
      mockRouter.currentRoute.value.name = "vector";
      const tw = mount(IngestLogs, buildMountOptions());
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "vector",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      tw.unmount();
    });

    it("should push with org_identifier query when route is 'syslogNg'", () => {
      mockRouter.currentRoute.value.name = "syslogNg";
      const tw = mount(IngestLogs, buildMountOptions());
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "syslogNg",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      tw.unmount();
    });

    it("should redirect to 'curl' when route name is 'ingestLogs'", () => {
      mockRouter.currentRoute.value.name = "ingestLogs";
      const tw = mount(IngestLogs, buildMountOptions());
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "curl",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      tw.unmount();
    });

    it("should not call router.push for an unrelated route", () => {
      mockRouter.currentRoute.value.name = "someOtherPage";
      mockRouter.push.mockClear();
      const tw = mount(IngestLogs, buildMountOptions());
      expect(mockRouter.push).not.toHaveBeenCalled();
      tw.unmount();
    });

    it("should redirect to 'curl' in onUpdated when route name is 'ingestLogs'", async () => {
      // Mount with a valid ingest route first
      mockRouter.currentRoute.value.name = "curl";
      const tw = mount(IngestLogs, buildMountOptions());
      mockRouter.push.mockClear();

      // Simulate navigation to the parent route, then trigger update
      mockRouter.currentRoute.value.name = "ingestLogs";
      tw.vm.$forceUpdate();
      await tw.vm.$nextTick();

      expect(mockRouter.push).toHaveBeenCalledWith({
        name: "curl",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
      tw.unmount();
    });

    it("should NOT call router.push in onUpdated when route name is not 'ingestLogs'", async () => {
      mockRouter.currentRoute.value.name = "fluentbit";
      const tw = mount(IngestLogs, buildMountOptions());
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
    it("should call copyToClipboard with content.innerText", async () => {
      const { copyToClipboard } = await import("quasar");
      vi.mocked(copyToClipboard).mockResolvedValue();

      const mockContent = { innerText: "log ingestion snippet" };
      await wrapper.vm.copyToClipboardFn(mockContent);

      expect(copyToClipboard).toHaveBeenCalledWith("log ingestion snippet");
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

    it("should track segment analytics with correct payload on copy", async () => {
      const { copyToClipboard } = await import("quasar");
      vi.mocked(copyToClipboard).mockResolvedValue();
      const segment = await import("@/services/segment_analytics");

      mockRouter.currentRoute.value.name = "curl";
      await wrapper.vm.copyToClipboardFn({ innerText: "track this" });

      expect(segment.default.track).toHaveBeenCalledWith("Button Click", {
        button: "Copy to Clipboard",
        ingestion: "curl",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "Ingestion",
      });
    });

    it("should track segment analytics even when copy fails", async () => {
      const { copyToClipboard } = await import("quasar");
      vi.mocked(copyToClipboard).mockRejectedValueOnce(new Error("fail"));
      const segment = await import("@/services/segment_analytics");

      mockRouter.currentRoute.value.name = "fluentbit";
      wrapper.vm.copyToClipboardFn({ innerText: "fail track" });
      await new Promise((r) => setTimeout(r, 0));

      expect(segment.default.track).toHaveBeenCalledWith("Button Click", {
        button: "Copy to Clipboard",
        ingestion: "fluentbit",
        user_org: store.state.selectedOrganization.identifier,
        user_id: store.state.userInfo.email,
        page: "Ingestion",
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
  // showCloudIngestionOptions computed
  // ─────────────────────────────────────────────────────────────────────────
  describe("showCloudIngestionOptions computed", () => {
    it("should return false when config.isCloud is 'false'", () => {
      // aws-exports mock returns isCloud: "false"
      expect(wrapper.vm.showCloudIngestionOptions).toBe(false);
    });

    it("should return true when config.isCloud is 'true'", async () => {
      // Override the config on the vm instance to simulate cloud mode
      wrapper.vm.config.isCloud = "true";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.showCloudIngestionOptions).toBe(true);
    });

    it("should return false when config.isCloud is any other string", async () => {
      wrapper.vm.config.isCloud = "yes";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.showCloudIngestionOptions).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Store Integration
  // ─────────────────────────────────────────────────────────────────────────
  describe("Store Integration", () => {
    it("should read selectedOrganization.identifier from the store", () => {
      expect(wrapper.vm.currentOrgIdentifier).toBe(
        store.state.selectedOrganization.identifier,
      );
    });

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
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Reactive Data
  // ─────────────────────────────────────────────────────────────────────────
  describe("Reactive Data", () => {
    it("should allow splitterModel to be updated reactively", async () => {
      expect(wrapper.vm.splitterModel).toBe(250);
      wrapper.vm.splitterModel = 320;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.splitterModel).toBe(320);
    });

    it("should allow ingestiontabs to be updated reactively", async () => {
      wrapper.vm.ingestiontabs = "curl";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ingestiontabs).toBe("curl");
    });
  });
});
