import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import Billing from "@/enterprise/components/billings/Billing.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// Mock utils — partial so the store (pulled in transitively via usage.vue's
// dashboards renderer import) still resolves useLocalOrganization etc.
vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/zincutils")>();
  return {
    ...actual,
    getImageURL: vi.fn((imagePath: string) => `img:${imagePath}`),
  };
});

// usage.vue (rendered by the Billing shell) imports these; stub them so the
// Billing shell test doesn't pull in the dashboards query pipeline.
vi.mock("@/components/dashboards/PanelSchemaRenderer.vue", () => ({
  default: {
    name: "PanelSchemaRenderer",
    template: "<div class='panel-schema-renderer'></div>",
  },
}));
vi.mock("@/components/DateTimePickerDashboard.vue", () => ({
  default: {
    name: "DateTimePickerDashboard",
    template: "<div class='date-time-picker'></div>",
  },
}));

vi.mock("@/aws-exports", () => ({
  default: {
    API_ENDPOINT: "http://localhost:5080",
  },
}));

// Mock router
const mockRouter = {
  currentRoute: {
    value: {
      name: "billings",
      query: {},
    },
  },
  push: vi.fn(),
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
  useRoute: () => mockRouter.currentRoute.value,
}));

// Mock billing service - using factory function to avoid hoisting issues
vi.mock("@/services/billings", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list_subscription: vi.fn(),
    },
  });
});

// Import after mocking
import BillingService from "@/services/billings";
import config from "@/aws-exports";

describe("Billing Component", () => {
  let wrapper: any = null;

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();

    // Mock billing service response
    (BillingService.list_subscription as any).mockResolvedValue({
      data: { provider: "stripe" },
    });

    // Reset router state
    mockRouter.currentRoute.value.name = "billings";
    mockRouter.currentRoute.value.query = {};

    wrapper = mount(Billing, {
      global: {
        plugins: [i18n],
        provide: {
          store,
        },
        stubs: {
          "router-view": true,
          OIcon: true,
          ConfirmDialog: true,
          Usage: true,
          AppTabs: {
            template: "<div></div>",
            props: ["tabs", "activeTab"],
            emits: ["update:activeTab"],
          },
        },
      },
    });

    // Wait for onMounted to complete
    await wrapper.vm.$nextTick();
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

    it("should expose all required properties from setup", () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.router).toBeDefined();
      expect(wrapper.vm.config).toBeDefined();
      expect(wrapper.vm.billingtab).toBeDefined();
      expect(wrapper.vm.getImageURL).toBeDefined();
      expect(wrapper.vm.headerBasedOnRoute).toBeDefined();
      expect(wrapper.vm.isUsageRoute).toBeDefined();
    });
  });

  describe("onMounted Lifecycle Hook", () => {
    it("should redirect to plans when route is billings", async () => {
      // The wrapper was already mounted in beforeEach and onMounted completed
      expect(mockRouter.push).toHaveBeenCalledWith({
        path: "/billings/plans",
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
      expect(wrapper.vm.billingtab).toBe("plans");
    });

    it("should redirect to plans when route is plans", async () => {
      // Reset router state and clear mocks before mounting
      mockRouter.currentRoute.value.name = "plans";
      mockRouter.currentRoute.value.query = {};

      // Mock billing service response for this test
      (BillingService.list_subscription as any).mockResolvedValue({
        data: { provider: "stripe" },
      });

      const testWrapper = mount(Billing, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            "router-view": true,
            OIcon: true,
            ConfirmDialog: true,
            Usage: true,
            AppTabs: {
              template: "<div></div>",
              props: ["tabs", "activeTab"],
              emits: ["update:activeTab"],
            },
          },
        },
      });

      // Wait for onMounted to complete (including fetchBillingInfo)
      await testWrapper.vm.$nextTick();
      await testWrapper.vm.$nextTick();

      // The router.push should have been called during onMounted
      expect(mockRouter.push).toHaveBeenCalledWith({
        path: "/billings/plans",
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
      expect(testWrapper.vm.billingtab).toBe("plans");
      testWrapper.unmount();
    });

    it("should not redirect when route is usage", async () => {
      mockRouter.currentRoute.value.name = "usage";
      mockRouter.push.mockClear();

      const testWrapper = mount(Billing, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            "router-view": true,
            OIcon: true,
            ConfirmDialog: true,
            Usage: true,
            AppTabs: {
              template: "<div></div>",
              props: ["tabs", "activeTab"],
              emits: ["update:activeTab"],
            },
          },
        },
      });

      // Wait for onMounted to complete
      await testWrapper.vm.$nextTick();

      expect(mockRouter.push).not.toHaveBeenCalled();
      testWrapper.unmount();
    });
  });

  describe("trial landing and strip", () => {
    const DAY_US = 24 * 60 * 60 * 1_000_000;
    let savedSettings: any;

    const mountAt = async (routeName: string, provider: string, expiry?: number) => {
      wrapper?.unmount();
      wrapper = null;
      mockRouter.push.mockClear();
      mockRouter.currentRoute.value.name = routeName;
      mockRouter.currentRoute.value.query = {};
      store.state.organizationData.organizationSettings = {
        ...savedSettings,
        free_trial_expiry: expiry,
      };
      (BillingService.list_subscription as any).mockClear();
      (BillingService.list_subscription as any).mockResolvedValue({ data: { provider } });
      const testWrapper = mount(Billing, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            "router-view": true,
            OIcon: true,
            ConfirmDialog: true,
            Usage: true,
            AppTabs: { template: "<div></div>", props: ["tabs", "activeTab"] },
          },
        },
      });
      await flushPromises();
      return testWrapper;
    };

    beforeEach(() => {
      savedSettings = { ...store.state.organizationData.organizationSettings };
    });

    afterEach(() => {
      store.state.organizationData.organizationSettings = savedSettings;
    });

    it("lands a trial org on Usage", async () => {
      const w = await mountAt("billings", "stripe", Date.now() * 1000 + 9 * DAY_US);

      expect(w.vm.billingtab).toBe("usage");
      expect(mockRouter.push).toHaveBeenCalledTimes(1);
      expect(mockRouter.push).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/billings/usage" }),
      );
      w.unmount();
    });

    it("lands an org without free_trial_expiry on Plans exactly as today", async () => {
      const w = await mountAt("billings", "stripe", undefined);

      expect(w.vm.billingtab).toBe("plans");
      expect(mockRouter.push).toHaveBeenCalledWith({
        path: "/billings/plans",
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
      w.unmount();
    });

    it("lands an AWS-billed trial org on Plans", async () => {
      const w = await mountAt("billings", "aws", Date.now() * 1000 + 9 * DAY_US);

      expect(w.vm.billingtab).toBe("plans");
      expect(mockRouter.push).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/billings/plans" }),
      );
      w.unmount();
    });

    it("keeps an explicit Plans route on Plans for a trial org", async () => {
      const w = await mountAt("plans", "stripe", Date.now() * 1000 + 9 * DAY_US);

      expect(w.vm.billingtab).toBe("plans");
      w.unmount();
    });

    it("shows the trial strip on Usage with the provider it already loaded", async () => {
      const w = await mountAt("usage", "stripe", Date.now() * 1000 + 9 * DAY_US);

      const strip = w.find('[data-test="trial-period-container"]');
      expect(strip.exists()).toBe(true);
      expect(strip.attributes("data-tone")).toBe("info");
      expect(w.find('[data-test="trial-period-compare-plans-btn"]').exists()).toBe(true);
      expect(w.find('[data-test="trial-period-end-rule"]').exists()).toBe(true);
      expect(BillingService.list_subscription).toHaveBeenCalledTimes(1);
      w.unmount();
    });

    it("renders each billing tab id exactly once", async () => {
      (config as { isCloud?: string }).isCloud = "true";
      const w = await mountAt("usage", "stripe", undefined);

      for (const id of [
        "billing-tab-plans",
        "billing-tab-usage",
        "billing-tab-invoices",
        "billing-tab-group",
      ]) {
        expect(w.findAll(`[data-test="${id}"]`)).toHaveLength(1);
      }
      w.unmount();
      delete (config as { isCloud?: string }).isCloud;
    });

    it("hides the trial strip for an AWS-billed org", async () => {
      const w = await mountAt("usage", "aws", Date.now() * 1000 + 9 * DAY_US);

      expect(w.find('[data-test="trial-period-container"]').exists()).toBe(false);
      w.unmount();
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
    it("should return true when route is usage", async () => {
      // Must mount with route=usage before mount because mock router is not reactive
      mockRouter.currentRoute.value.name = "usage";
      const testWrapper = mount(Billing, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            "router-view": true,
            OIcon: true,
            ConfirmDialog: true,
            Usage: true,
            AppTabs: {
              template: "<div></div>",
              props: ["tabs", "activeTab"],
              emits: ["update:activeTab"],
            },
          },
        },
      });
      await testWrapper.vm.$nextTick();
      expect(testWrapper.vm.isUsageRoute).toBe(true);
      testWrapper.unmount();
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

  describe("Reactive Data Properties", () => {
    it("should have reactive billingtab", async () => {
      wrapper.vm.billingtab = "usage";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.billingtab).toBe("usage");
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

  describe("Edge Cases and Error Handling", () => {
    it("should handle missing router gracefully", () => {
      expect(wrapper.vm.router).toBeDefined();
      expect(wrapper.vm.router.currentRoute).toBeDefined();
    });

    it("should handle empty store state gracefully", () => {
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state).toBeDefined();
    });
  });

  describe("fetchBillingInfo — billing info TypeError/401 regression", () => {
    it("does not throw and keeps the provider when the response has no customer_id", async () => {
      // Reproduces the production TypeError: the real /billing/info response
      // for an org with no active plan omits customer_id entirely.
      (BillingService.list_subscription as any).mockResolvedValue({
        data: { provider: "stripe" },
      });

      const testWrapper = mount(Billing, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            "router-view": true,
            OIcon: true,
            ConfirmDialog: true,
            Usage: true,
            AppTabs: {
              template: "<div></div>",
              props: ["tabs", "activeTab"],
              emits: ["update:activeTab"],
            },
          },
        },
      });

      await testWrapper.vm.$nextTick();
      await testWrapper.vm.$nextTick();

      // Previously this threw inside the try block, which reset the
      // provider to "" and hid the Invoice tab even though the fetch had
      // actually succeeded.
      expect(testWrapper.vm.billingProvider).toBe("stripe");
      expect(testWrapper.vm.isPaidUser).toBe(false);
      expect(testWrapper.vm.showInvoiceTab).toBe(true);

      testWrapper.unmount();
    });

    it("treats a non-empty customer_id as a paid user", async () => {
      (BillingService.list_subscription as any).mockResolvedValue({
        data: { provider: "stripe", customer_id: "cus_123" },
      });

      const testWrapper = mount(Billing, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            "router-view": true,
            OIcon: true,
            ConfirmDialog: true,
            Usage: true,
            AppTabs: {
              template: "<div></div>",
              props: ["tabs", "activeTab"],
              emits: ["update:activeTab"],
            },
          },
        },
      });

      await testWrapper.vm.$nextTick();
      await testWrapper.vm.$nextTick();

      expect(testWrapper.vm.isPaidUser).toBe(true);

      testWrapper.unmount();
    });

    it("does not log a 401 as an error — it's an expected session-expiry race already handled globally", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const unauthorizedError: any = new Error("Request failed with status code 401");
      unauthorizedError.response = { status: 401 };
      (BillingService.list_subscription as any).mockRejectedValue(unauthorizedError);

      const testWrapper = mount(Billing, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            "router-view": true,
            OIcon: true,
            ConfirmDialog: true,
            Usage: true,
            AppTabs: {
              template: "<div></div>",
              props: ["tabs", "activeTab"],
              emits: ["update:activeTab"],
            },
          },
        },
      });

      await testWrapper.vm.$nextTick();
      await testWrapper.vm.$nextTick();

      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(testWrapper.vm.billingProvider).toBe("");

      consoleErrorSpy.mockRestore();
      testWrapper.unmount();
    });

    it("does not log a 403, which only means the user has no billing access", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const forbiddenError: any = new Error("Request failed with status code 403");
      forbiddenError.response = { status: 403 };
      (BillingService.list_subscription as any).mockRejectedValue(forbiddenError);

      const testWrapper = mount(Billing, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            "router-view": true,
            OIcon: true,
            ConfirmDialog: true,
            Usage: true,
            AppTabs: {
              template: "<div></div>",
              props: ["tabs", "activeTab"],
              emits: ["update:activeTab"],
            },
          },
        },
      });

      await testWrapper.vm.$nextTick();
      await testWrapper.vm.$nextTick();

      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(testWrapper.vm.billingProvider).toBe("");

      consoleErrorSpy.mockRestore();
      testWrapper.unmount();
    });

    it("still logs billing errors other than 401 and 403", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      (BillingService.list_subscription as any).mockRejectedValue(new Error("Network error"));

      const testWrapper = mount(Billing, {
        global: {
          plugins: [i18n],
          provide: { store },
          stubs: {
            "router-view": true,
            OIcon: true,
            ConfirmDialog: true,
            Usage: true,
            AppTabs: {
              template: "<div></div>",
              props: ["tabs", "activeTab"],
              emits: ["update:activeTab"],
            },
          },
        },
      });

      await testWrapper.vm.$nextTick();
      await testWrapper.vm.$nextTick();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to fetch billing info:",
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
      testWrapper.unmount();
    });
  });
});
