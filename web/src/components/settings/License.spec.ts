import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import License from "./License.vue";
import { makeLicenseSchema } from "./License.schema";
import licenseServer from "@/services/license_server";
import { createStore } from "vuex";
import i18n from "@/locales";
import type { AxiosResponse } from "axios";
import zo_config from "@/services/config";
import { LICENSE_BOUNDARY_RETRY_MS, LICENSE_REFRESH_SETTLE_MS } from "@/utils/licenseWaivers";

// Helper to create mock Axios responses
const createAxiosResponse = <T = any>(data: T): AxiosResponse<T> => ({
  data,
  status: 200,
  statusText: "OK",
  headers: {},
  config: {} as any,
});

// Stub ODialog so tests are deterministic (no Portal/Reka teleport)
// and so we can assert on the props the component forwards + emit
// the click events the component listens to.
const ODialogStub = {
  name: "ODialog",
  inheritAttrs: false,
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "persistent",
    "showClose",
    "width",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryButtonVariant",
    "secondaryButtonVariant",
    "neutralButtonVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test="o-dialog-stub"
      :data-open="String(open)"
      :data-size="size"
      :data-title="title"
      :data-primary-label="primaryButtonLabel"
      :data-secondary-label="secondaryButtonLabel"
      :data-primary-disabled="String(primaryButtonDisabled)"
    >
      <span data-test="o-dialog-stub-title">{{ title }}</span>
      <slot name="header" />
      <slot />
      <slot name="footer" />
      <button
        data-test="o-dialog-stub-primary"
        :disabled="primaryButtonDisabled"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
      <button
        data-test="o-dialog-stub-secondary"
        @click="$emit('click:secondary')"
      >{{ secondaryButtonLabel }}</button>
    </div>
  `,
};

// Mock the license server service
vi.mock("@/services/license_server", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      get_license: vi.fn(),
      update_license: vi.fn(),
      check_license: vi.fn(),
      refresh_license_limits: vi.fn(),
    },
  });
});

vi.mock("@/services/config", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { get_config_full: vi.fn() },
  });
});

// Mock the LicensePeriod component
vi.mock("@/enterprise/components/billings/LicensePeriod.vue", () => ({
  default: {
    name: "LicensePeriod",
    template: '<div data-test="license-period">License Period</div>',
    emits: ["updateLicense"],
  },
}));

const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockToast(...args),
}));

const mockDialog = vi.fn().mockReturnValue({
  onOk: vi.fn().mockReturnThis(),
  onCancel: vi.fn().mockReturnThis(),
});

enableAutoUnmount(afterEach);

describe("License.vue", () => {
  let store: any;
  let wrapper: any;

  const mockLicenseData = {
    installation_id: "test-installation-123",
    key: "test-license-key-12345678901234567890",
    license: {
      license_id: "license-123",
      active: true,
      created_at: 1704067200000000, // 2024-01-01 00:00:00
      expires_at: 1735689600000000, // 2025-01-01 00:00:00
      company: "Test Company",
      contact_name: "John Doe",
      contact_email: "john@example.com",
      limits: {
        Ingestion: {
          typ: "PerDayCount",
          value: 50,
        },
      },
    },
    ingestion_used: 45.5,
    ingestion_exceeded: 2,
  };

  const createWrapper = (options = {}) => {
    store = createStore({
      state: {
        zoConfig: {
          license_server_url: "https://license.example.com",
          license_expiry: null,
        },
      },
    });

    return mount(License, {
      global: {
        plugins: [store, i18n],
        stubs: {
          LicensePeriod: true,
          ODialog: ODialogStub,
        },
      },
      ...options,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockToast.mockClear();
    mockDialog.mockClear();
    // Mock window.location
    delete (window as any).location;
    window.location = {
      href: "http://localhost:3000",
      origin: "http://localhost:3000",
      search: "",
    } as any;
  });

  describe("Component Mounting", () => {
    it("should mount successfully", () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should show loading spinner while fetching license data", async () => {
      vi.mocked(licenseServer.get_license).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(createAxiosResponse(mockLicenseData)), 100),
          ),
      );
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      // Check if loading text is present initially
      const hasLoadingText = wrapper.text().includes("Loading license information");
      expect(hasLoadingText).toBe(true);
    });

    it("should call loadLicenseData on mount", async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      await flushPromises();

      expect(licenseServer.get_license).toHaveBeenCalledTimes(1);
    });
  });

  describe("No License State", () => {
    const noLicenseData = {
      installation_id: "test-installation-123",
      license: null,
    };

    beforeEach(async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(noLicenseData));
      wrapper = createWrapper();
      await flushPromises();
    });

    it('should display "No License Found" message when license is null', () => {
      expect(wrapper.text()).toContain("No License Found");
    });

    it("should display installation ID", () => {
      expect(wrapper.text()).toContain("Installation ID:");
      expect(wrapper.text()).toContain("test-installation-123");
    });

    it("should show license key input textarea", () => {
      const textarea = wrapper.find('textarea[placeholder="Paste your license key here..."]');
      expect(textarea.exists()).toBe(true);
    });

    it('should show "Get License" button', () => {
      const buttons = wrapper.findAll("button");
      const getLicenseBtn = buttons.find((btn: any) => btn.text().includes("Get License"));
      expect(getLicenseBtn).toBeTruthy();
    });

    it("keeps the Update License button enabled even when empty (R3 — schema-gated)", () => {
      const updateBtn = wrapper
        .findAll("button")
        .find((btn: any) => btn.text().includes("Update License"));
      expect(updateBtn?.attributes("disabled")).toBeUndefined();
    });

    it("should keep the Update License button enabled when a key is entered", async () => {
      const textarea = wrapper.find("textarea");
      await textarea.setValue("new-license-key-value");
      await wrapper.vm.$nextTick();

      const updateBtn = wrapper
        .findAll("button")
        .find((btn: any) => btn.text().includes("Update License"));
      expect(updateBtn?.attributes("disabled")).toBeUndefined();
    });

    it("blocks the submit and does NOT call update_license when the key is empty (real OForm)", async () => {
      vi.mocked(licenseServer.update_license).mockResolvedValue(
        createAxiosResponse({ success: true }),
      );
      const form = wrapper.findComponent({ name: "OForm" });
      expect(form.exists()).toBe(true);
      await (form.vm as any).form.handleSubmit();
      await flushPromises();

      expect((form.vm as any).form.state.isValid).toBe(false);
      expect(licenseServer.update_license).not.toHaveBeenCalled();
    });

    it("submits when a valid key is entered (real OForm)", async () => {
      vi.mocked(licenseServer.update_license).mockResolvedValue(
        createAxiosResponse({ success: true }),
      );
      const textarea = wrapper.find("textarea");
      await textarea.setValue("a-valid-license-key");
      await wrapper.vm.$nextTick();

      const form = wrapper.findComponent({ name: "OForm" });
      await (form.vm as any).form.handleSubmit();
      await flushPromises();

      expect(licenseServer.update_license).toHaveBeenCalledWith("a-valid-license-key");
    });
  });

  describe("Active License State", () => {
    beforeEach(async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      await flushPromises();
    });

    it("should display license information when license exists", () => {
      expect(wrapper.text()).toContain("License Information");
      expect(wrapper.text()).toContain("license-123");
      expect(wrapper.text()).toContain("Test Company");
    });

    it("should display installation ID", () => {
      expect(wrapper.text()).toContain("test-installation-123");
    });

    it("should display license status as badge", () => {
      expect(wrapper.text()).toContain("Active");
    });

    it("should display company name", () => {
      expect(wrapper.text()).toContain("Test Company");
    });

    it("should display contact information", () => {
      expect(wrapper.text()).toContain("John Doe");
      expect(wrapper.text()).toContain("john@example.com");
    });

    it("should display masked license key", () => {
      expect(wrapper.text()).toContain("test-");
      expect(wrapper.text()).toContain("*****");
    });

    it('should show "Request new License" button', () => {
      const buttons = wrapper.findAll("button");
      const requestBtn = buttons.find((btn: any) => btn.text().includes("Request new License"));
      expect(requestBtn).toBeTruthy();
    });

    it('should show "Add New License Key" button', () => {
      const buttons = wrapper.findAll("button");
      const addBtn = buttons.find((btn: any) => btn.text().includes("Add New License Key"));
      expect(addBtn).toBeTruthy();
    });

    it("should hide update form by default", () => {
      expect(wrapper.vm.showUpdateForm).toBe(false);
    });

    it('should show update form when "Add New License Key" is clicked', async () => {
      wrapper.vm.showUpdateFormAndFocus();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showUpdateForm).toBe(true);
    });
  });

  describe("Usage Information", () => {
    beforeEach(async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      await flushPromises();
    });

    it("should display usage information section", () => {
      expect(wrapper.text()).toContain("Usage Information");
      expect(wrapper.text()).toContain("50 GB of data ingestion per day");
    });

    it("should calculate ingestion usage percentage correctly", () => {
      expect(wrapper.vm.ingestionUsagePercent).toBe(45.5);
    });

    it("should display ingestion limit", () => {
      expect(wrapper.text()).toContain("50 GB of data ingestion per day");
    });

    it("should display ingestion type", () => {
      // The ingestion type is not directly displayed in the new UI
      // It's used internally for the limit calculation
      expect(wrapper.vm.licenseData.license.limits.Ingestion.typ).toBe("PerDayCount");
    });

    it("should display limit exceeded count", () => {
      expect(wrapper.text()).toContain("The limit was exceeded on 2 days this month");
    });

    it("should show green color for usage under 60%", () => {
      expect(wrapper.vm.getIngestionUsageColor()).toBe("green");
    });

    it("should show orange color for usage between 60-90%", async () => {
      const highUsageData = {
        ...mockLicenseData,
        ingestion_used: 75,
      };
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(highUsageData));
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.getIngestionUsageColor()).toBe("orange");
    });

    it("should show red color for usage above 90%", async () => {
      const criticalUsageData = {
        ...mockLicenseData,
        ingestion_used: 95,
      };
      vi.mocked(licenseServer.get_license).mockResolvedValue(
        createAxiosResponse(criticalUsageData),
      );
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.getIngestionUsageColor()).toBe("red");
    });
  });

  describe("Unlimited License", () => {
    const unlimitedLicenseData = {
      ...mockLicenseData,
      license: {
        ...mockLicenseData.license,
        limits: {
          Ingestion: {
            typ: "Unlimited",
            value: 0,
          },
        },
      },
    };

    beforeEach(async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(
        createAxiosResponse(unlimitedLicenseData),
      );
      wrapper = createWrapper();
      await flushPromises();
    });

    it("should identify unlimited license type", () => {
      expect(wrapper.vm.isIngestionUnlimited).toBe(true);
    });

    it("should show 0% usage for unlimited license", () => {
      expect(wrapper.vm.ingestionUsagePercent).toBe(0);
    });

    it('should display "Unlimited" in usage section', () => {
      // For unlimited license, the component displays a disclaimer instead of "Unlimited" text
      // Check that the disclaimer is displayed
      expect(wrapper.text()).toContain("Usage shows 0% for unlimited plans");
    });

    it("should show disclaimer for unlimited plans", () => {
      expect(wrapper.text()).toContain("Usage shows 0% for unlimited plans");
    });
  });

  describe("License state reload after apply", () => {
    const setConfig = vi.fn();

    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      setConfig.mockClear();
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      vi.mocked(zo_config.get_config_full).mockResolvedValue(
        createAxiosResponse({ license_search_allowed: true }),
      );
      store = createStore({
        state: {
          zoConfig: { license_server_url: "https://license.example.com", license_expiry: null },
          selectedOrganization: { identifier: "acme" },
        },
        actions: { setConfig },
      });
      wrapper = mount(License, {
        global: { plugins: [store, i18n], stubs: { LicensePeriod: true, ODialog: ODialogStub } },
      });
      await flushPromises();
    });

    afterEach(() => vi.useRealTimers());

    it("applying a key reloads license state after the settle delay", async () => {
      vi.mocked(licenseServer.update_license).mockResolvedValue(
        createAxiosResponse({ success: true }),
      );
      wrapper.vm.licenseKey = "new-license-key";
      await wrapper.vm.updateLicense();
      await flushPromises();
      await vi.advanceTimersByTimeAsync(LICENSE_REFRESH_SETTLE_MS - 1);
      expect(setConfig).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await flushPromises();
      expect(setConfig).toHaveBeenCalledTimes(1);
    });

    it("the page data reloads when the settle delay elapses", async () => {
      vi.mocked(licenseServer.update_license).mockResolvedValue(
        createAxiosResponse({ success: true }),
      );
      wrapper.vm.licenseKey = "new-license-key";
      await wrapper.vm.updateLicense();
      await flushPromises();
      const before = vi.mocked(licenseServer.get_license).mock.calls.length;
      await vi.advanceTimersByTimeAsync(LICENSE_REFRESH_SETTLE_MS);
      await flushPromises();
      expect(vi.mocked(licenseServer.get_license).mock.calls.length).toBe(before + 1);
    });

    it("text typed into the update form survives the immediate and scheduled reloads", async () => {
      const onlineData = {
        ...mockLicenseData,
        can_update_license: true,
        refresh: {
          mode: "online",
          registration: "registered",
          server_host: "license.openobserve.ai",
          key_id: "synthetic-id",
          last_success_at: null,
          key_at_rest: "encrypted",
          last_outcome: null,
        },
      };
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(onlineData));
      vi.mocked(licenseServer.refresh_license_limits).mockResolvedValue(
        createAxiosResponse({ outcome: "unchanged" }),
      );
      wrapper.vm.licenseData = onlineData;
      wrapper.vm.showUpdateForm = true;
      await flushPromises();
      const field = () => wrapper.find('textarea[data-test="update-license-key-input-field"]');
      await field().setValue("half-typed-key");

      await wrapper.get('[data-test="license-online-refresh"]').trigger("click");
      await flushPromises();
      expect(field().element.value).toBe("half-typed-key");

      await vi.advanceTimersByTimeAsync(LICENSE_REFRESH_SETTLE_MS);
      await flushPromises();
      expect(wrapper.text()).not.toContain("Loading license information");
      expect(field().element.value).toBe("half-typed-key");
    });

    it("refresh button lives in the online card", async () => {
      wrapper.vm.licenseData = {
        ...mockLicenseData,
        refresh: {
          mode: "online",
          registration: "registered",
          server_host: "license.openobserve.ai",
          key_id: "synthetic-id",
          last_success_at: null,
          key_at_rest: "encrypted",
          last_outcome: null,
        },
        can_update_license: true,
      };
      await flushPromises();
      expect(wrapper.find('[data-test="refresh-license-limits-btn"]').exists()).toBe(false);
      expect(
        wrapper
          .find('[data-test="license-online-card"] [data-test="license-online-refresh"]')
          .text(),
      ).toBe("Refresh now");
    });

    it("unmounting before the delay cancels the reload", async () => {
      vi.mocked(licenseServer.update_license).mockResolvedValue(
        createAxiosResponse({ success: true }),
      );
      wrapper.vm.licenseKey = "new-license-key";
      await wrapper.vm.updateLicense();
      await flushPromises();
      wrapper.unmount();
      await vi.advanceTimersByTimeAsync(LICENSE_REFRESH_SETTLE_MS * 2);
      expect(setConfig).not.toHaveBeenCalled();
    });

    it("passes the high-water warning and permission to the status card", async () => {
      const warning = {
        source: "db",
        license_id: "lic_1",
        loaded_rev: Date.UTC(2026, 9, 14) * 1000,
        hwm_rev: Date.UTC(2026, 9, 20) * 1000,
      };
      vi.mocked(licenseServer.get_license).mockResolvedValue(
        createAxiosResponse({
          ...mockLicenseData,
          decision: {
            search_allowed: true,
            blocks: [],
            exceeded_days: 0,
            allowed_days: 3,
            limit_today_gb: 200,
            used_today_gb: 122,
            waiver_ids_applied: [],
          },
          rev_hwm_warning: warning,
          can_update_license: true,
        }),
      );
      wrapper.unmount();
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.find('[data-test="license-status-rev-hwm"]').text()).toContain("stored key");
      await wrapper.find('[data-test="license-status-rev-hwm-add-key"]').trigger("click");
      expect(wrapper.vm.showUpdateForm).toBe(true);
    });
    it("a rev_rollback 409 shows both issue dates inline", async () => {
      vi.mocked(licenseServer.update_license).mockRejectedValue({
        response: {
          status: 409,
          data: {
            code: 409,
            reason: "rev_rollback",
            message: "older",
            license_id: "lic_1",
            loaded_rev: Date.UTC(2026, 9, 20) * 1000,
            pasted_rev: Date.UTC(2026, 9, 14) * 1000,
          },
        },
      });
      wrapper.vm.licenseKey = "new-license-key";
      await wrapper.vm.updateLicense();
      await flushPromises();
      expect(wrapper.find('[data-test="license-key-check-banner"]').text()).toContain(
        "Oct 20, 2026",
      );
      expect(wrapper.find('[data-test="license-key-check-banner"]').text()).toContain(
        "Oct 14, 2026",
      );
      expect(mockToast).not.toHaveBeenCalled();
    });
    it("Check key calls check_license and never update_license", async () => {
      vi.mocked(licenseServer.check_license).mockResolvedValue(
        createAxiosResponse({
          dry_run: true,
          outcome: "accept",
          license_id: "lic_1",
          message: "",
          same_license: true,
          loaded_rev: 1,
          pasted_rev: 2,
          waivers_added: [],
          waivers_removed: [],
        }),
      );
      wrapper.vm.showUpdateForm = true;
      await flushPromises();
      await wrapper
        .find('textarea[data-test="update-license-key-input-field"]')
        .setValue("checked-key");
      await wrapper.find('[data-test="check-update-license-btn"]').trigger("click");
      await flushPromises();
      expect(licenseServer.check_license).toHaveBeenCalledWith("checked-key");
      expect(licenseServer.update_license).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("same waivers");
    });
    it("draft edits discard a pending preview and block accidental updates", async () => {
      let resolve: (response: AxiosResponse) => void = () => {};
      vi.mocked(licenseServer.check_license).mockImplementation(
        () => new Promise((r) => (resolve = r)),
      );
      wrapper.vm.showUpdateForm = true;
      await flushPromises();
      const field = wrapper.find('textarea[data-test="update-license-key-input-field"]');
      await field.setValue("first-key");
      await wrapper.find('[data-test="check-update-license-btn"]').trigger("click");
      await field.setValue("second-key");
      await wrapper.vm.updateLicense({ licenseKey: "second-key" });
      expect(licenseServer.update_license).not.toHaveBeenCalled();
      resolve(
        createAxiosResponse({
          dry_run: true,
          outcome: "accept",
          license_id: "lic_1",
          message: "",
          same_license: true,
          loaded_rev: 1,
          pasted_rev: 2,
          waivers_added: [],
          waivers_removed: [],
        }),
      );
      await flushPromises();
      expect(wrapper.find('[data-test="license-key-check-banner"]').exists()).toBe(false);
    });
    it("cancel clears the form-owned draft even when the incoming key was empty", async () => {
      wrapper.vm.showUpdateForm = true;
      await flushPromises();
      const field = () => wrapper.find('textarea[data-test="update-license-key-input-field"]');
      await field().setValue("typed-key");
      await wrapper.find('[data-test="cancel-update-license-btn"]').trigger("click");
      wrapper.vm.showUpdateForm = true;
      await flushPromises();
      expect(field().element.value).toBe("");
    });
    it("editing a completed preview clears it", async () => {
      vi.mocked(licenseServer.check_license).mockResolvedValue(
        createAxiosResponse({
          dry_run: true,
          outcome: "accept",
          license_id: "lic_1",
          message: "",
          same_license: true,
          loaded_rev: 1,
          pasted_rev: 2,
          waivers_added: [],
          waivers_removed: [],
        }),
      );
      wrapper.vm.showUpdateForm = true;
      await flushPromises();
      const field = wrapper.find('textarea[data-test="update-license-key-input-field"]');
      await field.setValue("first-key");
      await wrapper.find('[data-test="check-update-license-btn"]').trigger("click");
      await flushPromises();
      expect(wrapper.find('[data-test="license-key-check-banner"]').exists()).toBe(true);
      await field.setValue("second-key");
      expect(wrapper.find('[data-test="license-key-check-banner"]').exists()).toBe(false);
    });
    it("an accept preview lists added and removed waivers", async () => {
      const waiver = {
        id: "added",
        type: "search_unblock",
        starts_at: 1,
        ends_at: Date.UTC(2026, 9, 30) * 1000,
        note: "Added waiver",
      };
      vi.mocked(licenseServer.check_license).mockResolvedValue(
        createAxiosResponse({
          dry_run: true,
          outcome: "accept",
          license_id: "lic_1",
          message: "",
          same_license: true,
          loaded_rev: 1,
          pasted_rev: 2,
          waivers_added: [waiver],
          waivers_removed: [{ ...waiver, id: "removed", note: "Removed waiver" }],
        }),
      );
      wrapper.vm.showUpdateForm = true;
      await flushPromises();
      await wrapper
        .find('textarea[data-test="update-license-key-input-field"]')
        .setValue("checked-key");
      await wrapper.find('[data-test="check-update-license-btn"]').trigger("click");
      await flushPromises();
      const text = wrapper.find('[data-test="license-key-check"]').text();
      expect(text).toContain("Added (1)");
      expect(text).toContain("Removed (1)");
      expect(text).toContain("Added waiver");
      expect(text).toContain("Removed waiver");
    });
    it("a 409 without a rev reason still toasts the server message", async () => {
      vi.mocked(licenseServer.update_license).mockRejectedValue({
        response: {
          status: 409,
          data: { code: 409, reason: "future_reason", message: "Generic conflict" },
        },
      });
      await wrapper.vm.updateLicense({ licenseKey: "checked-key" });
      await flushPromises();
      expect(mockToast.mock.calls.at(-1)?.[0].message).toContain("Generic conflict");
    });
    for (const status of [400, 403]) {
      it(`a failed check (${status}) appears inline`, async () => {
        vi.mocked(licenseServer.check_license).mockRejectedValue({
          response: { status, data: { message: "the license key could not be decoded." } },
        });
        wrapper.vm.showUpdateForm = true;
        await flushPromises();
        await wrapper
          .find('textarea[data-test="update-license-key-input-field"]')
          .setValue("checked-key");
        await wrapper.find('[data-test="check-update-license-btn"]').trigger("click");
        await flushPromises();
        expect(wrapper.find('[data-test="license-key-check-error"]').text()).toContain(
          status === 403 ? "permission" : "could not be decoded",
        );
        expect(licenseServer.update_license).not.toHaveBeenCalled();
      });
    }
    it("a malformed preview is shown as a failed check", async () => {
      vi.mocked(licenseServer.check_license).mockResolvedValue(
        createAxiosResponse({ outcome: "accept" }),
      );
      wrapper.vm.showUpdateForm = true;
      await flushPromises();
      await wrapper
        .find('textarea[data-test="update-license-key-input-field"]')
        .setValue("checked-key");
      await wrapper.find('[data-test="check-update-license-btn"]').trigger("click");
      await flushPromises();
      expect(wrapper.find('[data-test="license-key-check-error"]').text()).toContain(
        "Couldn’t check this key",
      );
    });
    it("a 409 from the env key shows the server message", async () => {
      vi.mocked(licenseServer.update_license).mockRejectedValue({
        response: { status: 409, data: { message: "Remove O2_LICENSE_KEY first" } },
      });
      wrapper.vm.licenseKey = "new-license-key";
      await wrapper.vm.updateLicense();
      await flushPromises();
      expect(mockToast.mock.calls.at(-1)?.[0].message).toContain("O2_LICENSE_KEY");
      await vi.advanceTimersByTimeAsync(LICENSE_REFRESH_SETTLE_MS * 2);
      await flushPromises();
      expect(setConfig).not.toHaveBeenCalled();
    });
  });

  describe("Update License Functionality", () => {
    afterEach(() => vi.useRealTimers());

    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      await flushPromises();
    });

    it("should call update_license API when updating license", async () => {
      vi.mocked(licenseServer.update_license).mockResolvedValue(
        createAxiosResponse({ success: true }),
      );

      // Set license key directly
      wrapper.vm.licenseKey = "new-license-key";

      // Call update
      await wrapper.vm.updateLicense();
      await flushPromises();

      expect(licenseServer.update_license).toHaveBeenCalledWith("new-license-key");
    });

    it("should show success notification on successful update", async () => {
      vi.mocked(licenseServer.update_license).mockResolvedValue(
        createAxiosResponse({ success: true }),
      );

      wrapper.vm.licenseKey = "new-license-key";
      await wrapper.vm.updateLicense();
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "success",
          message: "License updated successfully",
        }),
      );
    });

    it("should show error notification on failed update", async () => {
      vi.mocked(licenseServer.update_license).mockRejectedValue(new Error("Update failed"));

      wrapper.vm.licenseKey = "invalid-license-key";
      await wrapper.vm.updateLicense();
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: expect.stringContaining("Failed to update license"),
        }),
      );
    });

    it("should clear license key after successful update", async () => {
      vi.mocked(licenseServer.update_license).mockResolvedValue(
        createAxiosResponse({ success: true }),
      );

      wrapper.vm.licenseKey = "new-license-key";
      await wrapper.vm.updateLicense();
      await flushPromises();

      expect(wrapper.vm.licenseKey).toBe("");
    });

    it("should hide update form after successful update", async () => {
      vi.mocked(licenseServer.update_license).mockResolvedValue(
        createAxiosResponse({ success: true }),
      );

      wrapper.vm.showUpdateForm = true;
      wrapper.vm.licenseKey = "new-license-key";
      await wrapper.vm.updateLicense();
      await flushPromises();

      expect(wrapper.vm.showUpdateForm).toBe(false);
    });

    it("should reload license data after successful update", async () => {
      vi.mocked(licenseServer.update_license).mockResolvedValue(
        createAxiosResponse({ success: true }),
      );
      vi.mocked(licenseServer.get_license).mockClear();

      wrapper.vm.licenseKey = "new-license-key";
      await wrapper.vm.updateLicense();
      await flushPromises();

      expect(licenseServer.get_license).toHaveBeenCalled();
    });
  });

  describe("License Key Masking", () => {
    beforeEach(async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      await flushPromises();
    });

    it("should mask license key correctly", () => {
      const maskedKey = wrapper.vm.maskKey("test-license-key-12345678901234567890");
      expect(maskedKey).toContain("test-");
      expect(maskedKey).toContain("*****");
      expect(maskedKey).toContain("67890");
    });

    it("should return original key if too short", () => {
      const shortKey = "short";
      const maskedKey = wrapper.vm.maskKey(shortKey);
      expect(maskedKey).toBe(shortKey);
    });

    it("should show visibility button for license key", () => {
      const oIcons = wrapper.findAllComponents({ name: "OIcon" });
      const visibilityIcon = oIcons.find((icon: any) => icon.props("name") === "visibility");
      expect(visibilityIcon).toBeTruthy();
    });

    it("should open modal when visibility button is clicked", async () => {
      wrapper.vm.showLicenseKeyModal = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showLicenseKeyModal).toBe(true);
    });
  });

  describe("License Key Modal", () => {
    beforeEach(async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      await flushPromises();
    });

    it("should render ODialog stub for license key modal", () => {
      expect(wrapper.find('[data-test="o-dialog-stub"]').exists()).toBe(true);
    });

    it("should pass title prop to ODialog", () => {
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("title")).toBe("License Key");
    });

    it('should pass size="md" prop to ODialog', () => {
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("size")).toBe("md");
    });

    it("should pass persistent prop to ODialog", () => {
      const dialog = wrapper.findComponent(ODialogStub);
      // Vue passes valueless boolean attributes through as an empty string for
      // string-typed props; either value satisfies the persistent contract.
      expect(["", true]).toContain(dialog.props("persistent"));
    });

    it('should pass primaryButtonLabel "Copy Key" to ODialog', () => {
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("primaryButtonLabel")).toBe("Copy Key");
    });

    it('should pass secondaryButtonLabel "Cancel" to ODialog', () => {
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("secondaryButtonLabel")).toBe("Cancel");
    });

    it("should bind open prop from showLicenseKeyModal state", async () => {
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("open")).toBe(false);

      wrapper.vm.showLicenseKeyModal = true;
      await wrapper.vm.$nextTick();
      expect(dialog.props("open")).toBe(true);
    });

    it("should disable primary button when license key is empty", async () => {
      // Set license data with no key
      wrapper.vm.licenseData = { ...wrapper.vm.licenseData, key: "" };
      await wrapper.vm.$nextTick();

      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("primaryButtonDisabled")).toBe(true);
    });

    it("should enable primary button when license key exists", () => {
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("primaryButtonDisabled")).toBe(false);
    });

    it("should show full license key in modal", async () => {
      wrapper.vm.showLicenseKeyModal = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showLicenseKeyModal).toBe(true);
    });

    it("should copy license key to clipboard when click:primary is emitted", async () => {
      const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: clipboardWriteText,
        },
      });

      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:primary");
      await flushPromises();

      expect(clipboardWriteText).toHaveBeenCalledWith(mockLicenseData.key);
    });

    it("should copy license key to clipboard via method", async () => {
      const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: clipboardWriteText,
        },
      });

      await wrapper.vm.copyLicenseKey();

      expect(clipboardWriteText).toHaveBeenCalledWith(mockLicenseData.key);
    });

    it("should show success notification after copying", async () => {
      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn().mockResolvedValue(undefined),
        },
      });

      await wrapper.vm.copyLicenseKey();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "success",
          message: expect.stringContaining("copied"),
        }),
      );
    });

    it("should close modal after copying", async () => {
      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn().mockResolvedValue(undefined),
        },
      });

      wrapper.vm.showLicenseKeyModal = true;
      await wrapper.vm.copyLicenseKey();

      expect(wrapper.vm.showLicenseKeyModal).toBe(false);
    });

    it("should close modal when click:secondary is emitted", async () => {
      wrapper.vm.showLicenseKeyModal = true;
      await wrapper.vm.$nextTick();

      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:secondary");
      await flushPromises();

      expect(wrapper.vm.showLicenseKeyModal).toBe(false);
    });
  });

  describe("Get License Redirect", () => {
    beforeEach(async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      await flushPromises();
    });

    it("should open license request URL in new tab", () => {
      const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null);

      wrapper.vm.redirectToGetLicense();

      expect(windowOpenSpy).toHaveBeenCalledWith(
        expect.stringContaining("license.example.com"),
        "_blank",
      );
    });

    it("should include installation ID in license request URL", () => {
      const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null);

      wrapper.vm.redirectToGetLicense();

      expect(windowOpenSpy).toHaveBeenCalledWith(
        expect.stringContaining("test-installation-123"),
        "_blank",
      );
    });

    it("should include base URL in license request", () => {
      const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null);

      wrapper.vm.redirectToGetLicense();

      expect(windowOpenSpy).toHaveBeenCalledWith(expect.stringContaining("base_url="), "_blank");
    });
  });

  describe("URL Auto-fill License Key", () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
    afterEach(() => vi.useRealTimers());

    it("should auto-fill license key from URL parameters", async () => {
      window.location.search = "?installation_id=test-installation-123&license_key=auto-filled-key";

      const noLicenseData = {
        installation_id: "test-installation-123",
        license: null,
      };

      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(noLicenseData));
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.licenseKey).toBe("auto-filled-key");
      expect(wrapper.vm.isLicenseKeyAutoFilled).toBe(true);
    });

    it("should show auto-fill banner when license key is from URL", async () => {
      window.location.search = "?installation_id=test-installation-123&license_key=auto-filled-key";

      const noLicenseData = {
        installation_id: "test-installation-123",
        license: null,
      };

      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(noLicenseData));
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.text()).toContain("License key auto-filled from URL");
    });

    it("should clear URL parameters after successful update", async () => {
      window.location.search = "?installation_id=test-installation-123&license_key=auto-filled-key";
      const replaceStateSpy = vi.spyOn(window.history, "replaceState");

      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      vi.mocked(licenseServer.update_license).mockResolvedValue(
        createAxiosResponse({ success: true }),
      );

      wrapper = createWrapper();
      await flushPromises();

      wrapper.vm.licenseKey = "new-key";
      await wrapper.vm.updateLicense();
      await flushPromises();

      expect(replaceStateSpy).toHaveBeenCalled();
    });

    it("should not auto-fill if installation IDs do not match", async () => {
      window.location.search = "?installation_id=different-id&license_key=auto-filled-key";

      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.licenseKey).toBe("");
      expect(wrapper.vm.isLicenseKeyAutoFilled).toBe(false);
    });
  });

  describe("Date Formatting", () => {
    beforeEach(async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      await flushPromises();
    });

    it("should format timestamp to readable date", () => {
      const timestamp = 1704067200000000; // 2024-01-01 00:00:00
      const formatted = wrapper.vm.formatDate(timestamp);
      expect(formatted).toBeTruthy();
      expect(typeof formatted).toBe("string");
    });

    it("should display formatted created date", () => {
      expect(wrapper.text()).toContain("Created At");
    });

    it("should display formatted expiry date", () => {
      expect(wrapper.text()).toContain("Expires At");
    });
  });

  describe("Error Handling", () => {
    it("should show error notification when loading license fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      vi.mocked(licenseServer.get_license).mockRejectedValue(new Error("Network error"));

      wrapper = createWrapper();
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: expect.stringContaining("Failed to load"),
        }),
      );

      consoleErrorSpy.mockRestore();
    });

    it("should handle clipboard copy failure gracefully", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      await flushPromises();

      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn().mockRejectedValue(new Error("Clipboard error")),
        },
      });

      await wrapper.vm.copyLicenseKey();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: expect.stringContaining("Failed to copy"),
        }),
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("limitBreachAllowedCount", () => {
    it("should return limit_breach_allowed_count from license when version >= 2", async () => {
      const v2LicenseData = {
        ...mockLicenseData,
        license: {
          ...mockLicenseData.license,
          version: 2,
          limit_breach_allowed_count: 2,
        },
      };
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(v2LicenseData));
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.limitBreachAllowedCount).toBe(2);
    });

    it("should return limit_breach_allowed_count when version is 3 (>= 2)", async () => {
      const v3LicenseData = {
        ...mockLicenseData,
        license: {
          ...mockLicenseData.license,
          version: 3,
          limit_breach_allowed_count: 5,
        },
      };
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(v3LicenseData));
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.limitBreachAllowedCount).toBe(5);
    });

    it("should return 3 when license has no version (v1 implied)", async () => {
      const v1LicenseData = {
        ...mockLicenseData,
        license: {
          ...mockLicenseData.license,
          // no version field
        },
      };
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(v1LicenseData));
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.limitBreachAllowedCount).toBe(3);
    });

    it("should return 3 when license version is 1", async () => {
      const v1LicenseData = {
        ...mockLicenseData,
        license: {
          ...mockLicenseData.license,
          version: 1,
          limit_breach_allowed_count: 10,
        },
      };
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(v1LicenseData));
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.limitBreachAllowedCount).toBe(3);
    });

    it("should return 3 when license is null", async () => {
      const noLicenseData = {
        installation_id: "test-installation-123",
        license: null,
      };
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(noLicenseData));
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.limitBreachAllowedCount).toBe(3);
    });

    it("should fall back to 3 when version >= 2 but limit_breach_allowed_count is missing", async () => {
      const v2NoCountData = {
        ...mockLicenseData,
        license: {
          ...mockLicenseData.license,
          version: 2,
          // limit_breach_allowed_count not set
        },
      };
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(v2NoCountData));
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.vm.limitBreachAllowedCount).toBe(3);
    });

    it("should use limitBreachAllowedCount in remaining days calculation", async () => {
      const v2LicenseData = {
        ...mockLicenseData,
        license: {
          ...mockLicenseData.license,
          version: 2,
          limit_breach_allowed_count: 2,
        },
        ingestion_exceeded: 1,
      };
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(v2LicenseData));
      wrapper = createWrapper();
      await flushPromises();

      // With limit_breach_allowed_count=2 and ingestion_exceeded=1, remaining=1
      expect(wrapper.vm.limitBreachAllowedCount - wrapper.vm.licenseData.ingestion_exceeded).toBe(
        1,
      );
    });
  });

  describe("Backend search decision", () => {
    it("passes GET waiver data to the status card", async () => {
      const date = new Date();
      const now = date.getTime() * 1000;
      const monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) * 1000;
      const monthEnd = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) * 1000;
      vi.mocked(licenseServer.get_license).mockResolvedValue(
        createAxiosResponse({
          ...withDecision({ allowed_days: 5, exceeded_days: 4 }),
          base: { ...decision, allowed_days: 3, exceeded_days: 4 },
          waivers: [
            {
              id: "breach",
              type: "breach_days",
              extra: 2,
              starts_at: monthStart,
              ends_at: monthEnd,
              note: "",
            },
            {
              id: "grace",
              type: "report_grace",
              starts_at: now - 1000000,
              ends_at: now + 1000000,
              note: "",
            },
          ],
        }),
      );
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.find("[data-test=license-status-days]").text()).toContain(
        "3 allowed this month + 2 from a waiver · 4 used",
      );
      expect(wrapper.find("[data-test=license-status-reporting]").text()).toContain(
        "features stay on while reports catch up",
      );
    });
    const decision = {
      search_allowed: true,
      blocks: [],
      exceeded_days: 0,
      allowed_days: 3,
      limit_today_gb: 50,
      used_today_gb: 10,
      waiver_ids_applied: [],
    };
    const withDecision = (over: Record<string, unknown>) => ({
      ...mockLicenseData,
      license: { ...mockLicenseData.license, version: 2, limit_breach_allowed_count: 3 },
      ingestion_exceeded: 4,
      decision: { ...decision, ...over },
    });

    it("does not claim features are restricted when the backend allows search", async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(
        createAxiosResponse(withDecision({ search_allowed: true })),
      );
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.html()).not.toContain("some application features may be temporarily");
    });

    it("a pause for a report failure under the day limit claims no over-limit days", async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(
        createAxiosResponse({
          ...withDecision({ search_allowed: false, blocks: ["report_failure"], exceeded_days: 2 }),
          ingestion_exceeded: 2,
        }),
      );
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.html()).toContain("allowance left of 3 max");
      expect(wrapper.html()).not.toContain("some application features may be temporarily");
    });

    it("days over the limit with search still on claim no restriction", async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(
        createAxiosResponse(
          withDecision({ search_allowed: true, blocks: ["usage_over_limit"], exceeded_days: 4 }),
        ),
      );
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.html()).not.toContain("some application features may be temporarily");
    });

    it("an unevaluated pause states the limit from the counters", async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(
        createAxiosResponse({
          ...withDecision({ search_allowed: false, blocks: [], exceeded_days: 4 }),
          evaluated_at: 0,
        }),
      );
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.html()).toContain("some application features may be temporarily");
    });

    it("a pause for days over the limit states the limit", async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(
        createAxiosResponse(
          withDecision({ search_allowed: false, blocks: ["usage_over_limit"], exceeded_days: 4 }),
        ),
      );
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.html()).toContain("some application features may be temporarily");
    });

    it("renders the status card when the backend sends a decision", async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(withDecision({})));
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find("[data-test=license-status-card]").exists()).toBe(true);
    });

    it("uses the licence grace count until the backend has evaluated", async () => {
      const synthesised = withDecision({ allowed_days: 3 });
      synthesised.license.limit_breach_allowed_count = 5;
      vi.mocked(licenseServer.get_license).mockResolvedValue(
        createAxiosResponse({ ...synthesised, evaluated_at: 0 }),
      );
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.limitBreachAllowedCount).toBe(5);

      vi.mocked(licenseServer.get_license).mockResolvedValue(
        createAxiosResponse({ ...synthesised, evaluated_at: 1792000000000000 }),
      );
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.limitBreachAllowedCount).toBe(3);
    });

    it("keeps Add New License Key enabled while the env key is in use", async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(
        createAxiosResponse({ ...withDecision({}), env_key_active: true, env_key_in_use: true }),
      );
      wrapper = createWrapper();
      await flushPromises();

      const btn = wrapper.find("[data-test=add-license-key-btn]");
      expect(btn.attributes("aria-disabled")).toBeUndefined();
      expect(btn.attributes("disabled")).toBeUndefined();
      await btn.trigger("click");
      expect(wrapper.vm.showUpdateForm).toBe(true);
    });

    it("keeps Add New License Key enabled without the env key", async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(
        createAxiosResponse({ ...withDecision({}), env_key_active: false }),
      );
      wrapper = createWrapper();
      await flushPromises();

      const btn = wrapper.find("[data-test=add-license-key-btn]");
      expect(btn.attributes("aria-disabled")).toBeUndefined();
      await btn.trigger("click");
      expect(wrapper.vm.showUpdateForm).toBe(true);
    });

    it("renders the waivers card only when waivers arrive", async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(
        createAxiosResponse({
          ...withDecision({}),
          waivers: [
            {
              id: "wv_1",
              type: "search_unblock",
              starts_at: 1,
              ends_at: 4102444800000000,
              note: "n",
            },
          ],
        }),
      );
      wrapper = createWrapper();
      await flushPromises();

      expect(wrapper.find("[data-test=license-waivers-card]").exists()).toBe(true);
    });
  });

  describe("Waiver boundary refetch", () => {
    const now = Date.UTC(2026, 9, 20, 12);
    const unblockEndUs = (now + 1000) * 1000;
    const graceEndUs = (now + 1300) * 1000;
    const decision = {
      search_allowed: true,
      blocks: [],
      exceeded_days: 4,
      allowed_days: 3,
      limit_today_gb: 50,
      used_today_gb: 10,
      waiver_ids_applied: ["unblock"],
    };
    const base = { ...decision, search_allowed: false, waiver_ids_applied: [] };
    const waivers = [
      {
        id: "unblock",
        type: "search_unblock",
        starts_at: (now - 86400000) * 1000,
        ends_at: unblockEndUs,
        note: "Unblock",
      },
      {
        id: "grace",
        type: "report_grace",
        starts_at: (now - 86400000) * 1000,
        ends_at: graceEndUs,
        note: "Grace",
      },
    ];
    const response = (over: Record<string, unknown>) =>
      createAxiosResponse({
        ...mockLicenseData,
        license: { ...mockLicenseData.license, version: 2, limit_breach_allowed_count: 3 },
        decision,
        base,
        waivers,
        evaluated_at: now * 1000,
        ...over,
      });
    const paused = {
      decision: { ...base, blocks: ["usage_over_limit"] },
      evaluated_at: graceEndUs + 1000,
    };
    const search = () => wrapper.find("[data-test=license-status-search]").text();

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      vi.setSystemTime(now);
    });
    afterEach(() => vi.useRealTimers());

    it("refetches the licence once after a burst of boundaries and shows the new decision", async () => {
      vi.mocked(licenseServer.get_license)
        .mockResolvedValueOnce(response({}))
        .mockResolvedValue(response(paused));
      wrapper = createWrapper();
      await flushPromises();
      expect(licenseServer.get_license).toHaveBeenCalledTimes(1);
      expect(search()).toContain("Restored by a waiver");

      await vi.advanceTimersByTimeAsync(1500);
      expect(licenseServer.get_license).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      await flushPromises();
      expect(licenseServer.get_license).toHaveBeenCalledTimes(2);
      expect(search()).toContain("Paused");
      expect(search()).not.toContain("Restored by a waiver");

      await vi.advanceTimersByTimeAsync(LICENSE_BOUNDARY_RETRY_MS * 3);
      expect(licenseServer.get_license).toHaveBeenCalledTimes(2);
    });

    it("fetches again while the server decision predates the boundary", async () => {
      vi.mocked(licenseServer.get_license)
        .mockResolvedValueOnce(response({}))
        .mockResolvedValueOnce(response({}))
        .mockResolvedValue(response(paused));
      wrapper = createWrapper();
      await flushPromises();
      await vi.advanceTimersByTimeAsync(2500);
      await flushPromises();
      expect(licenseServer.get_license).toHaveBeenCalledTimes(2);
      expect(search()).toContain("Restored by a waiver");

      await vi.advanceTimersByTimeAsync(LICENSE_BOUNDARY_RETRY_MS);
      await flushPromises();
      expect(licenseServer.get_license).toHaveBeenCalledTimes(3);
      expect(search()).toContain("Paused");
      await vi.advanceTimersByTimeAsync(LICENSE_BOUNDARY_RETRY_MS * 3);
      expect(licenseServer.get_license).toHaveBeenCalledTimes(3);
    });

    it("drops a pending refetch on unmount", async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(response({}));
      wrapper = createWrapper();
      await flushPromises();
      await vi.advanceTimersByTimeAsync(1500);
      wrapper.unmount();
      await vi.advanceTimersByTimeAsync(LICENSE_BOUNDARY_RETRY_MS * 3);
      expect(licenseServer.get_license).toHaveBeenCalledTimes(1);
    });
  });

  describe("Component Cleanup", () => {
    it("should cleanup properly on unmount", async () => {
      vi.mocked(licenseServer.get_license).mockResolvedValue(createAxiosResponse(mockLicenseData));
      wrapper = createWrapper();
      await flushPromises();

      expect(() => wrapper.unmount()).not.toThrow();
    });
  });
});

describe("makeLicenseSchema", () => {
  const schema = makeLicenseSchema((k: string) => k);

  it("rejects a whitespace-only key (the .trim() rule is load-bearing)", () => {
    // Without .trim() a single space passes .min(1); this guards that.
    expect(schema.safeParse({ licenseKey: "   " }).success).toBe(false);
  });

  it("rejects an empty key", () => {
    expect(schema.safeParse({ licenseKey: "" }).success).toBe(false);
  });

  it("accepts a non-empty key and trims surrounding whitespace", () => {
    const res = schema.safeParse({ licenseKey: "  abc-123  " });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.licenseKey).toBe("abc-123");
  });
});
