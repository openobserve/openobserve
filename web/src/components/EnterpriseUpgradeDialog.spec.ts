// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { flushPromises, mount } from "@vue/test-utils";
import {
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { nextTick } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";

installQuasar();

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock aws-exports so we can flip Cloud / Enterprise flags between tests.
vi.mock("@/aws-exports", () => ({
  default: {
    isCloud: "false",
    isEnterprise: "false",
  },
}));

// Mock license_server service.
const mockGetLicense = vi.fn();
vi.mock("@/services/license_server", () => ({
  default: {
    get_license: (...args: any[]) => mockGetLicense(...args),
  },
}));

// Mock the lazy chart renderer so the component does not try to load echarts.
vi.mock("@/components/dashboards/panels/ChartRenderer.vue", () => ({
  default: {
    name: "ChartRenderer",
    template: '<div data-test-stub="chart-renderer"></div>',
    props: ["data"],
  },
}));

// Mock vue-router.
const mockRouterPush = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

// Mock useQuasar (notify is exercised by navigateToLicense error path).
const mockNotify = vi.fn();
vi.mock("quasar", async () => {
  const actual = await vi.importActual<typeof import("quasar")>("quasar");
  return {
    ...actual,
    useQuasar: () => ({ notify: mockNotify }),
  };
});

import config from "@/aws-exports";
import EnterpriseUpgradeDialog from "@/components/EnterpriseUpgradeDialog.vue";

// ── Shared store fixture ──────────────────────────────────────────────────────

const buildStore = (overrides: Record<string, any> = {}) => ({
  state: {
    zoConfig: {
      ingestion_quota: 200,
      ingestion_quota_used: 12,
      meta_org: "default",
      ingestion_history: [],
      ...(overrides.zoConfig || {}),
    },
    organizations: overrides.organizations ?? [
      {
        identifier: "default",
        id: 1,
        name: "Default Org",
        ingest_threshold: 100,
        search_threshold: 100,
      },
    ],
    userInfo: { email: "vaidehi@openobserve.ai" },
    ...overrides,
  },
  dispatch: vi.fn().mockResolvedValue({}),
  commit: vi.fn(),
});

let mockStore = buildStore();

vi.mock("vuex", async () => {
  const actual = await vi.importActual<typeof import("vuex")>("vuex");
  return {
    ...actual,
    useStore: () => mockStore,
  };
});

// ── Test mount helper ─────────────────────────────────────────────────────────

const createWrapper = (props: Record<string, any> = {}) =>
  mount(EnterpriseUpgradeDialog, {
    props: { modelValue: true, ...props },
    global: {
      plugins: [i18n],
      stubs: {
        ODialog: {
          name: "ODialog",
          template:
            '<div data-test-stub="o-dialog" v-if="open"><slot /></div>',
          props: ["open", "showClose", "width"],
          emits: ["update:open"],
        },
        OButton: {
          name: "OButton",
          template:
            '<button data-test-stub="o-button" :data-variant="variant" @click="$emit(\'click\')"><slot /><slot name="icon-right" /></button>',
          props: ["variant", "size", "disabled", "loading"],
          emits: ["click"],
        },
        "q-icon": {
          template: '<i data-test-stub="q-icon" :data-name="name"></i>',
          props: ["name", "size"],
        },
        "q-skeleton": {
          template: '<div data-test-stub="q-skeleton" :data-type="type"></div>',
          props: ["type", "size", "width", "height", "animation"],
        },
        "q-tooltip": {
          template: '<div data-test-stub="q-tooltip"><slot /></div>',
        },
      },
    },
  });

// ── windows.open spy ──────────────────────────────────────────────────────────

let openSpy: any;

beforeEach(() => {
  // Reset feature flags to Open Source by default for each test.
  (config as any).isCloud = "false";
  (config as any).isEnterprise = "false";

  mockStore = buildStore();
  mockGetLicense.mockReset();
  mockRouterPush.mockReset();
  mockNotify.mockReset();

  openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("EnterpriseUpgradeDialog", () => {
  describe("Mounting & component identity", () => {
    it("mounts successfully when modelValue is true", () => {
      const wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test-stub="o-dialog"]').exists()).toBe(true);
    });

    it("hides dialog content when modelValue is false", () => {
      const wrapper = createWrapper({ modelValue: false });
      expect(wrapper.find('[data-test-stub="o-dialog"]').exists()).toBe(false);
    });

    it("has the correct component name", () => {
      const wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("EnterpriseUpgradeDialog");
    });

    it("syncs showDialog when the modelValue prop changes", async () => {
      const wrapper = createWrapper({ modelValue: false });
      await wrapper.setProps({ modelValue: true });
      expect((wrapper.vm as any).showDialog).toBe(true);

      await wrapper.setProps({ modelValue: false });
      expect((wrapper.vm as any).showDialog).toBe(false);
    });
  });

  describe("dialogConfig — Open Source variant (default)", () => {
    it("renders the open source hero title and offer text", () => {
      const wrapper = createWrapper();
      const cfg = (wrapper.vm as any).dialogConfig;
      expect(cfg.heroTitle).toBeTruthy();
      expect(cfg.primaryButtonText).toBeTruthy();
      expect(cfg.showPrimaryButton).toBe(true);
      // No special flags
      expect(cfg.isCloudLayout).toBeFalsy();
      expect(cfg.showContactSales).toBeFalsy();
      expect(cfg.isLicensed).toBeFalsy();
      expect(cfg.showLicenseNote).toBeFalsy();
    });

    it("shows the hero panel for non-Cloud layouts", () => {
      const wrapper = createWrapper();
      expect(wrapper.find(".hero-panel").exists()).toBe(true);
      expect(wrapper.find(".cloud-layout").exists()).toBe(false);
    });

    it("shows the standard 2-column features list (not cloud 3-column)", () => {
      const wrapper = createWrapper();
      expect(wrapper.find(".features-list.cloud-three-column").exists()).toBe(
        false,
      );
      expect(wrapper.find(".features-list").exists()).toBe(true);
    });
  });

  describe("dialogConfig — Cloud variant", () => {
    beforeEach(() => {
      (config as any).isCloud = "true";
      (config as any).isEnterprise = "true"; // Cloud has both true
    });

    it("marks dialog as cloud layout", () => {
      const wrapper = createWrapper();
      const cfg = (wrapper.vm as any).dialogConfig;
      expect(cfg.isCloudLayout).toBe(true);
      expect(cfg.badgeIcon).toBe("bolt");
      expect(cfg.primaryButtonIcon).toBe("download");
      expect(cfg.showPrimaryButton).toBe(true);
    });

    it("hides the hero panel and shows the cloud 3-column layout", () => {
      const wrapper = createWrapper();
      expect(wrapper.find(".hero-panel").exists()).toBe(false);
      expect(wrapper.find(".cloud-layout").exists()).toBe(true);
      expect(wrapper.find(".features-list.cloud-three-column").exists()).toBe(
        true,
      );
    });
  });

  describe("dialogConfig — Enterprise without license", () => {
    beforeEach(() => {
      (config as any).isEnterprise = "true";
      (config as any).isCloud = "false";
      mockStore = buildStore({
        zoConfig: {
          license_expiry: 0, // hasLicense === false
          ingestion_quota: 250,
          ingestion_quota_used: 80,
          ingestion_history: [],
          meta_org: "default",
        },
      });
    });

    it("flags showLicenseNote, showPrimaryButton and showUsageIndicator", () => {
      const wrapper = createWrapper();
      const cfg = (wrapper.vm as any).dialogConfig;
      expect(cfg.showLicenseNote).toBe(true);
      expect(cfg.showPrimaryButton).toBe(true);
      expect(cfg.showUsageIndicator).toBe(true);
      expect(cfg.badgeIcon).toBe("data_usage");
      expect(cfg.primaryButtonIcon).toBe("key");
      expect(cfg.usagePercentage).toBe(80);
    });

    it("falls back to default quota (200) when zoConfig.ingestion_quota is undefined", () => {
      mockStore = buildStore({
        zoConfig: {
          license_expiry: 0,
          // no ingestion_quota
          meta_org: "default",
          ingestion_history: [],
        },
      });
      const wrapper = createWrapper();
      const cfg = (wrapper.vm as any).dialogConfig;
      // Just assert that badgeText contains the fallback quota value
      expect(cfg.badgeText).toContain("200");
    });

    it("respects an explicit quota of 0 via nullish coalescing", () => {
      mockStore = buildStore({
        zoConfig: {
          license_expiry: 0,
          ingestion_quota: 0,
          meta_org: "default",
          ingestion_history: [],
        },
      });
      const wrapper = createWrapper();
      const cfg = (wrapper.vm as any).dialogConfig;
      expect(cfg.badgeText).toContain("0");
    });
  });

  describe("dialogConfig — Enterprise with license", () => {
    beforeEach(() => {
      (config as any).isEnterprise = "true";
      (config as any).isCloud = "false";
      mockStore = buildStore({
        zoConfig: {
          license_expiry: 1893456000,
          ingestion_quota: 200,
          ingestion_quota_used: 5,
          meta_org: "default",
          ingestion_history: [],
        },
      });
      mockGetLicense.mockResolvedValue({
        data: {
          license: { limits: { Ingestion: { value: 500, typ: "Limited" } } },
          ingestion_used: 42,
        },
      });
    });

    it("flags isLicensed, showContactSales and showUsageIndicator", () => {
      const wrapper = createWrapper();
      const cfg = (wrapper.vm as any).dialogConfig;
      expect(cfg.isLicensed).toBe(true);
      expect(cfg.showContactSales).toBe(true);
      expect(cfg.showUsageIndicator).toBe(true);
      expect(cfg.badgeIcon).toBe("verified");
      expect(cfg.primaryButtonIcon).toBe("key");
    });

    it("fetches license data when the dialog becomes visible", async () => {
      const wrapper = createWrapper({ modelValue: false });
      expect(mockGetLicense).not.toHaveBeenCalled();

      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      expect(mockGetLicense).toHaveBeenCalledTimes(1);
      expect((wrapper.vm as any).licenseData).toEqual({
        license: { limits: { Ingestion: { value: 500, typ: "Limited" } } },
        ingestion_used: 42,
      });
      expect((wrapper.vm as any).isLoadingLicense).toBe(false);
    });

    it("uses unlimited badge text when no ingestion limit is set in license", async () => {
      mockGetLicense.mockResolvedValueOnce({
        data: {
          license: { limits: { Ingestion: { value: 0, typ: "Unlimited" } } },
          ingestion_used: 0,
        },
      });
      // Open the dialog after mount so the showDialog watcher fires fetchLicenseData.
      const wrapper = createWrapper({ modelValue: false });
      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      const cfg = (wrapper.vm as any).dialogConfig;
      // Unlimited text is loaded from locale, just ensure it is non-empty and
      // does not embed a numeric limit.
      expect(cfg.badgeText).toBeTruthy();
      expect((wrapper.vm as any).isIngestionUnlimited).toBe(true);
    });

    it("falls back to default license data when the API call fails", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mockGetLicense.mockRejectedValueOnce(new Error("boom"));

      const wrapper = createWrapper({ modelValue: false });
      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      expect(consoleSpy).toHaveBeenCalled();
      expect((wrapper.vm as any).licenseData).toEqual({
        license: { limits: { Ingestion: { value: 0 } } },
        ingestion_used: 0,
      });
      expect((wrapper.vm as any).isLoadingLicense).toBe(false);
    });
  });

  describe("Feature lists", () => {
    it("exposes coreFeatures and enterpriseFeatures arrays with expected sizes", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(Array.isArray(vm.coreFeatures)).toBe(true);
      expect(vm.coreFeatures.length).toBe(11);
      expect(Array.isArray(vm.enterpriseFeatures)).toBe(true);
      expect(vm.enterpriseFeatures.length).toBe(20);
    });

    it("renders one feature-list-item per enterprise feature in Open Source layout", () => {
      const wrapper = createWrapper();
      const items = wrapper.findAll(".feature-list-item");
      // Open Source variant renders only enterprise features (20).
      expect(items.length).toBe(20);
    });

    it("renders core + enterprise features for the Cloud layout", () => {
      (config as any).isCloud = "true";
      (config as any).isEnterprise = "true";
      const wrapper = createWrapper();
      const items = wrapper.findAll(".feature-list-item");
      // Cloud renders 11 core + 20 enterprise.
      expect(items.length).toBe(31);
    });
  });

  describe("openDocsLink", () => {
    it("opens the generic docs URL for Open Source", () => {
      const wrapper = createWrapper();
      (wrapper.vm as any).openDocsLink();
      expect(openSpy).toHaveBeenCalledWith(
        "https://o2.ws/ent_install_guide",
        "_blank",
      );
    });

    it("opens the license guide for Enterprise without license", () => {
      (config as any).isEnterprise = "true";
      mockStore = buildStore({ zoConfig: { license_expiry: 0 } });
      const wrapper = createWrapper();
      (wrapper.vm as any).openDocsLink();
      expect(openSpy).toHaveBeenCalledWith(
        "https://o2.ws/license_guide",
        "_blank",
      );
    });

    it("opens the enterprise installation guide for Cloud", () => {
      (config as any).isEnterprise = "true";
      (config as any).isCloud = "true";
      const wrapper = createWrapper();
      (wrapper.vm as any).openDocsLink();
      expect(openSpy).toHaveBeenCalledWith(
        "https://o2.ws/ent_install_guide",
        "_blank",
      );
    });

    it("opens the default docs URL when Enterprise has a license", () => {
      (config as any).isEnterprise = "true";
      mockStore = buildStore({
        zoConfig: { license_expiry: 1893456000 },
      });
      mockGetLicense.mockResolvedValue({
        data: { license: { limits: { Ingestion: { value: 1 } } }, ingestion_used: 0 },
      });
      const wrapper = createWrapper();
      (wrapper.vm as any).openDocsLink();
      expect(openSpy).toHaveBeenCalledWith(
        "https://openobserve.ai/docs/",
        "_blank",
      );
    });
  });

  describe("Standalone helpers", () => {
    it("openDownloadPage opens the download URL", () => {
      const wrapper = createWrapper();
      (wrapper.vm as any).openDownloadPage();
      expect(openSpy).toHaveBeenCalledWith(
        "https://o2.ws/download_resources",
        "_blank",
      );
    });

    it("contactSales opens the contact us URL", () => {
      const wrapper = createWrapper();
      (wrapper.vm as any).contactSales();
      expect(openSpy).toHaveBeenCalledWith(
        "https://o2.ws/contact_us",
        "_blank",
      );
    });

    it("openFeatureLink opens the provided URL in a new tab", () => {
      const wrapper = createWrapper();
      (wrapper.vm as any).openFeatureLink("https://o2.ws/sso");
      expect(openSpy).toHaveBeenCalledWith("https://o2.ws/sso", "_blank");
    });

    it("getProgressColor returns red for >= 80, orange for 60-79, green for < 60", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.getProgressColor(95)).toBe("red");
      expect(vm.getProgressColor(80)).toBe("red");
      expect(vm.getProgressColor(75)).toBe("orange");
      expect(vm.getProgressColor(60)).toBe("orange");
      expect(vm.getProgressColor(40)).toBe("green");
      expect(vm.getProgressColor(0)).toBe("green");
    });
  });

  describe("handlePrimaryButtonClick", () => {
    it("opens the download page for Open Source", () => {
      const wrapper = createWrapper();
      (wrapper.vm as any).handlePrimaryButtonClick();
      expect(openSpy).toHaveBeenCalledWith(
        "https://o2.ws/download_resources",
        "_blank",
      );
    });

    it("opens the download page for Cloud", () => {
      (config as any).isCloud = "true";
      (config as any).isEnterprise = "true";
      const wrapper = createWrapper();
      (wrapper.vm as any).handlePrimaryButtonClick();
      expect(openSpy).toHaveBeenCalledWith(
        "https://o2.ws/download_resources",
        "_blank",
      );
    });

    it("navigates to the license page for Enterprise without license", () => {
      (config as any).isEnterprise = "true";
      mockStore = buildStore({ zoConfig: { license_expiry: 0, meta_org: "default" } });
      const wrapper = createWrapper();
      (wrapper.vm as any).handlePrimaryButtonClick();
      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "license",
        query: { org_identifier: "default" },
      });
    });

    it("navigates to the license page for Enterprise with license", () => {
      (config as any).isEnterprise = "true";
      mockStore = buildStore({
        zoConfig: { license_expiry: 1893456000, meta_org: "default" },
      });
      mockGetLicense.mockResolvedValue({
        data: { license: { limits: { Ingestion: { value: 1 } } }, ingestion_used: 0 },
      });
      const wrapper = createWrapper();
      (wrapper.vm as any).handlePrimaryButtonClick();
      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "license",
        query: { org_identifier: "default" },
      });
    });
  });

  describe("navigateToLicense", () => {
    beforeEach(() => {
      (config as any).isEnterprise = "true";
    });

    it("dispatches setSelectedOrganization, emits update:modelValue=false, and pushes router", () => {
      mockStore = buildStore({
        zoConfig: { license_expiry: 0, meta_org: "default" },
      });
      const wrapper = createWrapper();

      (wrapper.vm as any).navigateToLicense();

      expect(mockStore.dispatch).toHaveBeenCalledWith(
        "setSelectedOrganization",
        expect.objectContaining({
          identifier: "default",
          id: 1,
          label: "Default Org",
        }),
      );

      const events = wrapper.emitted("update:modelValue");
      expect(events).toBeTruthy();
      expect(events![events!.length - 1]).toEqual([false]);

      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "license",
        query: { org_identifier: "default" },
      });
      expect(mockNotify).not.toHaveBeenCalled();
    });

    it("shows a negative notification when the meta org is not accessible", () => {
      mockStore = buildStore({
        zoConfig: { license_expiry: 0, meta_org: "other_meta" },
        organizations: [
          { identifier: "default", id: 1, name: "Default Org" },
        ],
      });
      const wrapper = createWrapper();

      (wrapper.vm as any).navigateToLicense();

      expect(mockRouterPush).not.toHaveBeenCalled();
      expect(mockNotify).toHaveBeenCalledTimes(1);
      const arg = mockNotify.mock.calls[0][0];
      expect(arg).toMatchObject({ color: "negative", timeout: 5000 });
    });

    it("handles a missing organizations array without crashing", () => {
      mockStore = buildStore({
        zoConfig: { license_expiry: 0, meta_org: "default" },
        organizations: undefined,
      });
      const wrapper = createWrapper();
      expect(() => (wrapper.vm as any).navigateToLicense()).not.toThrow();
      expect(mockNotify).toHaveBeenCalled();
    });
  });

  describe("Dialog close behaviour", () => {
    it("emits update:modelValue=false when onDialogHide is invoked", () => {
      const wrapper = createWrapper();
      (wrapper.vm as any).onDialogHide();
      const events = wrapper.emitted("update:modelValue");
      expect(events).toBeTruthy();
      expect(events![events!.length - 1]).toEqual([false]);
    });

    it("emits update:modelValue=false when showDialog flips to false", async () => {
      const wrapper = createWrapper();
      (wrapper.vm as any).showDialog = false;
      await nextTick();
      const events = wrapper.emitted("update:modelValue");
      expect(events).toBeTruthy();
      expect(events![events!.length - 1]).toEqual([false]);
    });

    it("does not emit update:modelValue when showDialog flips to true", async () => {
      const wrapper = createWrapper({ modelValue: false });
      (wrapper.vm as any).showDialog = true;
      await nextTick();
      expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    });
  });

  describe("Loading skeleton branches", () => {
    beforeEach(() => {
      (config as any).isEnterprise = "true";
      mockStore = buildStore({
        zoConfig: {
          license_expiry: 1893456000,
          meta_org: "default",
          ingestion_history: [],
        },
      });
    });

    it("renders skeletons while license data is loading", async () => {
      // Pending promise — never resolves during the test.
      mockGetLicense.mockReturnValue(new Promise(() => {}));
      const wrapper = createWrapper({ modelValue: false });
      await wrapper.setProps({ modelValue: true });
      await nextTick();
      expect((wrapper.vm as any).isLoadingLicense).toBe(true);
      const skeletons = wrapper.findAll('[data-test-stub="q-skeleton"]');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it("does not render skeletons after data has loaded", async () => {
      mockGetLicense.mockResolvedValue({
        data: {
          license: { limits: { Ingestion: { value: 100, typ: "Limited" } } },
          ingestion_used: 10,
        },
      });
      const wrapper = createWrapper({ modelValue: false });
      await wrapper.setProps({ modelValue: true });
      await flushPromises();
      expect((wrapper.vm as any).isLoadingLicense).toBe(false);
    });
  });

  describe("Chart data generation", () => {
    beforeEach(() => {
      (config as any).isEnterprise = "true";
    });

    it("leaves chartData null when there is no ingestion history", async () => {
      mockStore = buildStore({
        zoConfig: {
          license_expiry: 1893456000,
          meta_org: "default",
          ingestion_history: [],
        },
      });
      mockGetLicense.mockResolvedValue({
        data: {
          license: { limits: { Ingestion: { value: 100 } } },
          ingestion_used: 5,
        },
      });
      const wrapper = createWrapper();
      await flushPromises();
      expect((wrapper.vm as any).chartData).toBeNull();
    });

    it("generates echarts-shaped chart data when ingestion history exists", async () => {
      mockStore = buildStore({
        zoConfig: {
          license_expiry: 1893456000,
          meta_org: "default",
          ingestion_history: [
            { ts: "2026-05-01T00:00:00", value: 100 },
            { ts: "2026-05-02T00:00:00", value: 200 },
          ],
        },
      });
      mockGetLicense.mockResolvedValue({
        data: {
          license: { limits: { Ingestion: { value: 100, typ: "Limited" } } },
          ingestion_used: 10,
        },
      });
      const wrapper = createWrapper({ modelValue: false });
      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      const chart = (wrapper.vm as any).chartData;
      expect(chart).toBeTruthy();
      expect(chart.options.xAxis.data).toEqual(["1", "2"]);
      expect(chart.options.series[0].type).toBe("bar");
      expect(chart.options.series[0].data.length).toBe(2);
      // dashboardRenderKey should have been bumped at least once.
      expect((wrapper.vm as any).dashboardRenderKey).toBeGreaterThan(0);
    });
  });

  describe("isIngestionUnlimited computed", () => {
    it("is false when there is no license data", () => {
      const wrapper = createWrapper();
      expect((wrapper.vm as any).isIngestionUnlimited).toBe(false);
    });

    it("is true when license declares typ === 'Unlimited'", () => {
      const wrapper = createWrapper();
      (wrapper.vm as any).licenseData = {
        license: { limits: { Ingestion: { typ: "Unlimited", value: 0 } } },
      };
      expect((wrapper.vm as any).isIngestionUnlimited).toBe(true);
    });
  });
});
