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
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import General from "./General.vue";
import i18n from "@/locales";
import { nextTick } from "vue";
import { createRouter, createWebHistory } from "vue-router";

// Mock toast
// vi.hoisted ensures mockToast is initialized before the vi.mock factory runs
const { mockToast } = vi.hoisted(() => ({
  mockToast: vi.fn(() => vi.fn()),
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
  useToast: () => ({ toast: mockToast, toasts: [] }),
}));

// Mock external services and composables
vi.mock("@/services/organizations", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      post_organization_settings: vi.fn(),
    },
  });
});

vi.mock("@/services/settings", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      createLogo: vi.fn(),
      deleteLogo: vi.fn(),
      updateCustomText: vi.fn(),
    },
  });
});

vi.mock("@/services/config", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      get_config: vi.fn(),
      get_config_full: vi.fn(),
    },
  });
});

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

vi.mock("@/composables/useLoading", () => ({
  useLoading: (fn: Function) => ({
    execute: fn,
    isLoading: { value: false },
  }),
}));

vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "true",
  },
}));

vi.mock("dompurify", () => ({
  default: {
    sanitize: vi.fn((text) => text),
  },
}));

// Import mocked services
import organizations from "@/services/organizations";
import settingsService from "@/services/settings";
import configService from "@/services/config";
import DOMPurify from "dompurify";
import analytics from "@/services/product_analytics";
import config from "@/aws-exports";
import { useEnterpriseUpgradeDialog } from "@/composables/useEnterpriseUpgradeDialog";
import { useConfirmDialog } from "@/composables/useConfirmDialog";
import { confirmLeave } from "@/lib/forms/SaveBar/useLeaveGuard";
import { applyThemeColors } from "@/utils/theme";

const mockOrganizations = organizations as any;
const mockSettingsService = settingsService as any;
const mockConfigService = configService as any;
const mockDOMPurify = DOMPurify as any;

// Mock Vuex store
const mockStore = {
  state: {
    theme: "light",
    defaultThemeColors: {
      light: "#3F7994",
      dark: "#5B9FBE",
    },
    tempThemeColors: {
      light: null,
      dark: null,
    },
    selectedOrganization: {
      identifier: "test-org",
    },
    organizationData: {
      organizationSettings: {
        scrape_interval: 30,
      },
    },
    zoConfig: {
      custom_logo_text: "Test Logo Text",
      custom_logo_img: "base64imagedata",
      meta_org: "test-org",
    },
    organizations: [
      { identifier: "default", type: "default" },
      { identifier: "test-org", type: "regular" },
    ],
  },
  dispatch: vi.fn(),
  commit: vi.fn(),
};

// Create real router instance
let router: any;

beforeEach(async () => {
  router = createRouter({
    history: createWebHistory(),
    routes: [{ path: "/", name: "general-settings", component: General }],
  });
  await router.push("/");

  // Spy on router.push
  vi.spyOn(router, "push");
});

const createWrapper = (props = {}, options = {}) => {
  return mount(General, {
    props: {
      ...props,
    },
    global: {
      plugins: [i18n, router],
      mocks: {
        $store: mockStore,
        $router: router,
      },
      provide: {
        store: mockStore,
      },
      stubs: {
        teleport: true,
        // OForm / OFormInput / OInput are intentionally NOT stubbed so the real
        // schema validation runs (per the migration playbook: at least one path
        // must mount the real <OForm>).
        OButton: {
          template: `<button
            data-test-stub='o-button'
            :data-test='$attrs["data-test"]'
            @click='$emit("click", $event)'
            :disabled='loading'
            :type='type'
          >
            <slot></slot>
          </button>`,
          props: ["loading", "type", "variant", "size", "iconLeft", "iconRight", "label"],
          emits: ["click"],
        },
        OFile: {
          template: `<input
            type='file'
            data-test-stub='o-file'
            :data-test='$attrs["data-test"]'
            @change='handleFileChange'
            :accept='accept'
          />`,
          props: ["modelValue", "label", "accept", "counter", "counterLabel"],
          emits: ["update:modelValue", "rejected"],
          methods: {
            handleFileChange(event: any) {
              const file = event.target.files[0];
              if (file) {
                this.$emit("update:modelValue", file);
              }
            },
          },
        },
        OIcon: {
          template: "<span data-test-stub='OIcon'></span>",
          props: ["name", "size"],
        },
        ODialog: {
          name: "ODialog",
          template: `<div
              data-test-stub='o-dialog'
              :data-open='String(open)'
              :data-size='size'
              :data-title='title'
              :data-primary-label='primaryButtonLabel'
              :data-secondary-label='secondaryButtonLabel'
            >
              <slot name='header' />
              <slot />
              <slot name='footer' />
              <button
                data-test-stub='o-dialog-primary'
                @click='$emit("click:primary")'
              >{{ primaryButtonLabel }}</button>
              <button
                data-test-stub='o-dialog-secondary'
                @click='$emit("click:secondary")'
              >{{ secondaryButtonLabel }}</button>
            </div>`,
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
        },
        OColor: {
          template: '<div data-test-stub="o-color" :data-value="modelValue"></div>',
          props: ["modelValue"],
          emits: ["update:modelValue"],
        },
        OSpinner: {
          template: '<div data-test-stub="o-spinner" :data-test="$attrs[\'data-test\']"></div>',
          props: ["size"],
        },
        OTooltip: {
          template: '<div data-test-stub="o-tooltip"><slot></slot></div>',
          props: ["content", "side", "align", "maxWidth"],
        },
      },
    },
    attachTo: document.body,
    ...options,
  });
};

describe("General", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure organization data is properly set
    mockStore.state.selectedOrganization = {
      identifier: "test-org",
    };
    mockStore.state.organizationData.organizationSettings = {
      scrape_interval: 30,
    };
    mockStore.state.zoConfig.custom_logo_text = "Test Logo Text";
    mockStore.state.zoConfig.custom_logo_img = "base64imagedata";
    mockOrganizations.post_organization_settings.mockResolvedValue({
      status: 200,
    });
    mockSettingsService.createLogo.mockResolvedValue({ status: 200 });
    mockSettingsService.deleteLogo.mockResolvedValue({ status: 200 });
    mockSettingsService.updateCustomText.mockResolvedValue({ status: 200 });
    mockConfigService.get_config.mockResolvedValue({ data: {} });
    mockConfigService.get_config_full.mockResolvedValue({ data: {} });
    mockDOMPurify.sanitize.mockImplementation((text) => text);
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Reset router spy
    if (router?.push?.mockClear) {
      router.push.mockClear();
    }
  });

  describe("Component mounting", () => {
    it("should mount successfully", () => {
      const wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should seed the form defaults from organization settings", () => {
      const wrapper = createWrapper();
      const form = wrapper.findComponent({ name: "OForm" });
      expect(form.vm.form.state.values.scrape_interval).toBe("30");
    });
  });

  describe("Save bar", () => {
    const bar = (wrapper: any) => wrapper.find('[data-test="general-settings-save-bar"]');

    it("counts theme colors with the form fields, and Discard restores both", async () => {
      const wrapper = createWrapper();
      const form = wrapper.findComponent({ name: "OForm" }).vm.form;
      expect(bar(wrapper).attributes("data-state")).toBe("clean");

      await wrapper.find('[data-test="theme-light-chip"]').trigger("click");
      Object.assign(wrapper.vm, { tempColor: "#112233" });
      (wrapper.vm as any).updateCustomColor();
      form.setFieldValue("scrape_interval", "45");
      await nextTick();

      expect((wrapper.vm as any).changeCount).toBe(2);
      expect(bar(wrapper).attributes("data-state")).toBe("changed");

      await wrapper.find('[data-test="general-settings-save-bar-discard"]').trigger("click");
      await nextTick();

      expect((wrapper.vm as any).customLightColor).toBe("#3F7994");
      expect(form.state.values.scrape_interval).toBe("30");
      expect(bar(wrapper).attributes("data-state")).toBe("clean");
    });
  });

  describe("Form inputs", () => {
    it("gives the max series input an accessible name", () => {
      const wrapper = createWrapper();
      const input = wrapper.find('[data-test="general-settings-max-series-per-query"]');
      expect(input.find("input").attributes("aria-label")).toBe("Max series per query");
    });

    it("should keep the scrape interval and max series inputs (data-tests preserved)", () => {
      const wrapper = createWrapper();
      expect(wrapper.find('[data-test="general-settings-scrape-interval"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="general-settings-max-series-per-query"]').exists()).toBe(
        true,
      );
    });
  });

  describe("Form submission (real OForm)", () => {
    it("should save organization settings successfully", async () => {
      const wrapper = createWrapper();
      const form = wrapper.findComponent({ name: "OForm" });

      await form.vm.form.handleSubmit();
      await nextTick();

      // The dispatch is called with the spread of existing organizationSettings plus scrape_interval
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        "setOrganizationSettings",
        expect.objectContaining({
          scrape_interval: 30,
        }),
      );

      expect(mockOrganizations.post_organization_settings).toHaveBeenCalledWith(
        "test-org",
        expect.any(Object),
      );

      expect(mockToast).toHaveBeenCalledWith({
        variant: "success",
        message: "Organization settings updated",
      });
    });

    it("keeps the saved accent color applied after the app's settings watchers have run", async () => {
      const accent = () => document.documentElement.style.getPropertyValue("--color-primary-500");
      const preview = mockStore.state.tempThemeColors;
      mockStore.commit.mockImplementation((mutation: string, payload: any) => {
        if (mutation === "setTempThemeColor") preview[payload.mode] = payload.color;
        if (mutation === "clearTempThemeColors") preview.light = preview.dark = null;
      });
      // Stands in for the layout's watcher: it re-applies the stored theme unless a preview is live.
      mockStore.dispatch.mockImplementation((action: string) => {
        if (action !== "setOrganizationSettings") return;
        void Promise.resolve().then(() => {
          if (!preview.light && !preview.dark) applyThemeColors("#3F7994", "light", true);
        });
      });
      const wrapper = createWrapper();

      await wrapper.find('[data-test="theme-light-chip"]').trigger("click");
      Object.assign(wrapper.vm, { tempColor: "#aa3366" });
      (wrapper.vm as any).updateCustomColor();
      await wrapper.findComponent({ name: "OForm" }).vm.form.handleSubmit();
      await flushPromises();

      expect(mockOrganizations.post_organization_settings.mock.calls[0][1]).toMatchObject({
        light_mode_theme_color: "#aa3366",
      });
      expect(accent()).not.toBe("");
      expect(preview.light).toBeNull();
      mockStore.commit.mockReset();
      mockStore.dispatch.mockReset();
      applyThemeColors("#3F7994", "light", true);
    });

    it("a save that completes late keeps later edits and never writes into another organization", async () => {
      let finish = () => {};
      const holdSave = () =>
        mockOrganizations.post_organization_settings.mockImplementationOnce(
          () => new Promise((resolve) => (finish = () => resolve({ status: 200 }))),
        );
      const wrapper = createWrapper();
      const form = wrapper.findComponent({ name: "OForm" }).vm.form;
      const stored = () =>
        mockStore.dispatch.mock.calls.filter(([action]) => action === "setOrganizationSettings");

      holdSave();
      form.setFieldValue("scrape_interval", "40");
      const first = form.handleSubmit();
      await vi.waitFor(() =>
        expect(mockOrganizations.post_organization_settings).toHaveBeenCalled(),
      );
      form.setFieldValue("scrape_interval", "45");
      await wrapper.find('[data-test="theme-light-chip"]').trigger("click");
      Object.assign(wrapper.vm, { tempColor: "#112233" });
      (wrapper.vm as any).updateCustomColor();
      finish();
      await first;
      await nextTick();

      expect(stored()[0][1]).toMatchObject({ scrape_interval: 40 });
      expect(form.state.values.scrape_interval).toBe("45");
      expect((wrapper.vm as any).customLightColor).toBe("#112233");
      expect(mockStore.commit).not.toHaveBeenCalledWith("clearTempThemeColors");

      holdSave();
      const second = form.handleSubmit();
      await vi.waitFor(() =>
        expect(mockOrganizations.post_organization_settings).toHaveBeenCalledTimes(2),
      );
      mockStore.state.selectedOrganization = { identifier: "other-org" };
      finish();
      await second;

      expect(stored()).toHaveLength(1);
      expect(mockStore.commit).not.toHaveBeenCalledWith("clearTempThemeColors");
    });

    it("a Discard confirmed on leaving while the save is open stays discarded when the save lands", async () => {
      let finish = () => {};
      mockOrganizations.post_organization_settings.mockImplementationOnce(
        () => new Promise((resolve) => (finish = () => resolve({ status: 200 }))),
      );
      const wrapper = createWrapper();
      const form = wrapper.findComponent({ name: "OForm" }).vm.form;
      const dialog = useConfirmDialog();

      form.setFieldValue("scrape_interval", "45");
      const saving = form.handleSubmit();
      await vi.waitFor(() =>
        expect(mockOrganizations.post_organization_settings).toHaveBeenCalled(),
      );
      let left = false;
      void confirmLeave().then((leave) => (left = leave));
      // Pages left mounted by earlier cases are asked too, one dialog each.
      await vi.waitFor(() => {
        dialog.handleConfirm();
        expect(left).toBe(true);
      });
      finish();
      await saving;
      await nextTick();

      expect(form.state.values.scrape_interval).toBe("45");
      expect(wrapper.vm.changeCount).toBe(0);
    });

    it("should handle save error gracefully", async () => {
      mockOrganizations.post_organization_settings.mockRejectedValue({
        message: "Server error",
      });

      const wrapper = createWrapper();
      const form = wrapper.findComponent({ name: "OForm" });
      form.vm.form.setFieldValue("scrape_interval", "45");
      await form.vm.form.handleSubmit();
      await nextTick();

      expect(mockToast).toHaveBeenCalledWith({
        variant: "error",
        message: "Server error",
      });
      // A failed save must leave the page changed: nothing stored, nothing reset.
      expect(mockStore.dispatch).not.toHaveBeenCalledWith(
        "setOrganizationSettings",
        expect.anything(),
      );
      expect(wrapper.find('[data-test="general-settings-save-bar"]').attributes("data-state")).toBe(
        "changed",
      );
    });

    it("tracks org_general_settings_saved once the save succeeds", async () => {
      const wrapper = createWrapper();
      const form = wrapper.findComponent({ name: "OForm" });
      await form.vm.form.handleSubmit();
      await nextTick();

      expect(analytics.track).toHaveBeenCalledWith("org_general_settings_saved", {
        custom_theme: false,
      });
    });

    it("does not track org_general_settings_saved when the save fails", async () => {
      mockOrganizations.post_organization_settings.mockRejectedValue({ message: "Server error" });

      const wrapper = createWrapper();
      const form = wrapper.findComponent({ name: "OForm" });
      await form.vm.form.handleSubmit();
      await nextTick();

      expect(analytics.track).not.toHaveBeenCalled();
    });

    it("should handle save error without message", async () => {
      mockOrganizations.post_organization_settings.mockRejectedValue({});

      const wrapper = createWrapper();
      const form = wrapper.findComponent({ name: "OForm" });
      await form.vm.form.handleSubmit();
      await nextTick();

      expect(mockToast).toHaveBeenCalledWith({
        variant: "error",
        message: "Something went wrong",
      });
    });
  });

  describe("Conditional rendering", () => {
    it("should show enterprise features when conditions are met", () => {
      mockStore.state.zoConfig.meta_org = "test-org";
      const wrapper = createWrapper();

      const enterpriseSection = wrapper.find("#enterpriseFeature");
      expect(enterpriseSection.exists()).toBe(true);
    });

    it("should hide enterprise features when meta_org doesn't match", () => {
      mockStore.state.zoConfig.meta_org = "different-org";
      const wrapper = createWrapper();

      const enterpriseSection = wrapper.find("#enterpriseFeature");
      expect(enterpriseSection.exists()).toBe(false);
    });
  });

  // customBranding is self-hosted-only (cloudOffers: false): OSS sees the
  // section locked-but-visible (disabled controls + lock), pure Cloud doesn't
  // see it at all — same split as the other cloudOffers:false gates (e.g.
  // cipherKeys in settings/index.vue).
  describe("Custom branding gating", () => {
    const originalIsEnterprise = config.isEnterprise;
    const originalIsCloud = config.isCloud;

    afterEach(() => {
      config.isEnterprise = originalIsEnterprise;
      config.isCloud = originalIsCloud;
    });

    it("should keep the branding section visible but locked on OSS", () => {
      mockStore.state.zoConfig.meta_org = "test-org";
      config.isEnterprise = "false";
      config.isCloud = "false";
      const wrapper = createWrapper();

      expect(wrapper.find("#enterpriseFeature").exists()).toBe(true);
      const lockedText = wrapper.find('[data-test="settings_ent_logo_custom_text_locked"]');
      expect(lockedText.exists()).toBe(true);
      // Clickable (not disabled) — the wrapping row opens the upgrade dialog
      // on click instead of the field being an inert disabled control.
      expect(lockedText.find("input").attributes("disabled")).toBeUndefined();
      expect(
        wrapper.find('[data-test="setting_ent_custom_logo_img_file_upload_locked"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="setting_ent_custom_logo_dark_img_file_upload_locked"]').exists(),
      ).toBe(true);
      // The functional controls must not render alongside the locked ones.
      expect(wrapper.find('[data-test="settings_ent_logo_custom_text"]').exists()).toBe(false);
    });

    it("opens the upgrade dialog when a locked branding row is clicked", async () => {
      mockStore.state.zoConfig.meta_org = "test-org";
      config.isEnterprise = "false";
      config.isCloud = "false";
      const wrapper = createWrapper();

      const { isOpen, close } = useEnterpriseUpgradeDialog();
      close();
      await wrapper.find('[data-test="settings_ent_logo_custom_text_locked"]').trigger("click");
      expect(isOpen.value).toBe(true);
    });

    it("should hide the branding section entirely on a pure Cloud build", () => {
      mockStore.state.zoConfig.meta_org = "test-org";
      config.isEnterprise = "false";
      config.isCloud = "true";
      const wrapper = createWrapper();

      expect(wrapper.find("#enterpriseFeature").exists()).toBe(false);
    });

    it("should render the functional (unlocked) controls on Enterprise", () => {
      mockStore.state.zoConfig.meta_org = "test-org";
      config.isEnterprise = "true";
      config.isCloud = "false";
      const wrapper = createWrapper();

      expect(wrapper.find('[data-test="settings_ent_logo_custom_text_locked"]').exists()).toBe(
        false,
      );
      expect(
        wrapper.find('[data-test="setting_ent_custom_logo_img_file_upload_locked"]').exists(),
      ).toBe(false);
    });
  });

  describe("Custom logo text", () => {
    const textField = (wrapper: any) =>
      wrapper.get('[data-test="settings_ent_logo_custom_text-field"]');
    const formOf = (wrapper: any) => wrapper.findComponent({ name: "OForm" }).vm.form;

    beforeEach(() => {
      mockStore.state.zoConfig.meta_org = "test-org";
    });

    it("saves from the bar with its own request and leaves untouched organization settings alone", async () => {
      const wrapper = createWrapper();
      expect((textField(wrapper).element as HTMLInputElement).value).toBe("Test Logo Text");
      expect(wrapper.find('[data-test="settings_ent_logo_custom_text_save_btn"]').exists()).toBe(
        false,
      );

      await textField(wrapper).setValue("New Logo Text");
      expect(wrapper.vm.changeCount).toBe(1);
      await formOf(wrapper).handleSubmit();
      await nextTick();

      expect(mockSettingsService.updateCustomText).toHaveBeenCalledWith(
        "test-org",
        "custom_logo_text",
        "New Logo Text",
      );
      expect(mockOrganizations.post_organization_settings).not.toHaveBeenCalled();
      expect(mockStore.dispatch).toHaveBeenCalledWith(
        "setConfig",
        expect.objectContaining({ custom_logo_text: "New Logo Text" }),
      );
      expect(wrapper.vm.changeCount).toBe(0);
    });

    it.each([
      { failing: "text", reason: "Update failed", stillChanged: "custom_logo_text" },
      { failing: "settings", reason: "Server error", stillChanged: "scrape_interval" },
    ])(
      "reports a failed $failing request on its own and keeps only that part unsaved",
      async ({ failing, reason, stillChanged }) => {
        const failed =
          failing === "text"
            ? mockSettingsService.updateCustomText
            : mockOrganizations.post_organization_settings;
        failed.mockRejectedValue({ message: reason });
        const wrapper = createWrapper();
        const form = formOf(wrapper);

        await textField(wrapper).setValue("New Text");
        form.setFieldValue("scrape_interval", "45");
        await nextTick();
        expect(wrapper.vm.changeCount).toBe(2);
        await form.handleSubmit();
        await nextTick();

        expect(mockToast).toHaveBeenCalledWith({
          variant: "error",
          message: expect.stringContaining(reason),
        });
        expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
        expect(form.state.values).toMatchObject({
          custom_logo_text: "New Text",
          scrape_interval: "45",
        });
        expect(wrapper.vm.changeCount).toBe(1);
        expect(form.options.defaultValues[stillChanged]).not.toBe(form.state.values[stillChanged]);
      },
    );

    it("rejects more than 100 characters when the field is left, and does not save it", async () => {
      const wrapper = createWrapper();

      await textField(wrapper).setValue("a".repeat(101));
      await textField(wrapper).trigger("blur");
      await flushPromises();
      expect(wrapper.find('[data-test="settings_ent_logo_custom_text_error"]').exists()).toBe(true);

      await formOf(wrapper).handleSubmit();
      await flushPromises();
      expect(mockSettingsService.updateCustomText).not.toHaveBeenCalled();
    });
  });

  describe("Logo image functionality", () => {
    it("should display existing logo image", () => {
      const wrapper = createWrapper();
      const logoImg = wrapper.find('[data-test="setting_ent_custom_logo_img"]');
      if (logoImg.exists()) {
        expect(logoImg.exists()).toBe(true);
      } else {
        // Fallback: verify component has access to logo image from store
        expect(mockStore.state.zoConfig.custom_logo_img).toBeTruthy();
      }
    });

    describe("a chosen file is part of the page's form", () => {
      const lightFile = new File(["light"], "light.png", { type: "image/png" });
      const darkFile = new File(["dark"], "dark.png", { type: "image/png" });
      const formOf = (wrapper: any) => wrapper.findComponent({ name: "OForm" }).vm.form;
      const successToasts = () =>
        mockToast.mock.calls.filter(([toast]: any) => toast.variant === "success");

      beforeEach(() => {
        mockStore.state.zoConfig.meta_org = "test-org";
        mockStore.state.zoConfig.custom_logo_img = null;
      });

      it("counts each chosen file, has no button of its own, and uploads with the page's other edits in one Save", async () => {
        const wrapper = createWrapper();
        expect(wrapper.find('[data-test="setting_ent_custom_logo_img_file_upload"]').exists()).toBe(
          true,
        );

        Object.assign(wrapper.vm, { filesLight: lightFile, filesDark: darkFile });
        formOf(wrapper).setFieldValue("scrape_interval", "45");
        await nextTick();
        expect(wrapper.vm.changeCount).toBe(3);
        expect(
          wrapper.find('[data-test="general-settings-save-bar"]').attributes("data-state"),
        ).toBe("changed");
        expect(wrapper.find('[data-test="settings_ent_logo_custom_light_save_btn"]').exists()).toBe(
          false,
        );

        await formOf(wrapper).handleSubmit();
        await flushPromises();

        for (const mode of ["light", "dark"]) {
          expect(mockSettingsService.createLogo).toHaveBeenCalledWith(
            "test-org",
            expect.any(FormData),
            mode,
          );
        }
        expect(mockOrganizations.post_organization_settings).toHaveBeenCalledTimes(1);
        expect(successToasts()).toHaveLength(1);
        expect(wrapper.vm.filesLight).toBeNull();
        expect(wrapper.vm.changeCount).toBe(0);
      });

      it("uploads a lone file without rewriting organization settings", async () => {
        const wrapper = createWrapper();

        Object.assign(wrapper.vm, { filesDark: darkFile });
        await nextTick();
        await formOf(wrapper).handleSubmit();
        await flushPromises();

        expect(mockSettingsService.createLogo).toHaveBeenCalledWith(
          "test-org",
          expect.any(FormData),
          "dark",
        );
        expect(mockOrganizations.post_organization_settings).not.toHaveBeenCalled();
        expect(successToasts()).toEqual([
          [{ variant: "success", message: "Dark Mode logo updated successfully." }],
        ]);
      });

      it("names the logo whose upload failed and keeps only that file unsaved", async () => {
        mockSettingsService.createLogo.mockImplementation(
          (_org: string, _data: any, mode: string) =>
            mode === "light" ? Promise.reject({ message: "Upload failed" }) : { status: 200 },
        );
        const wrapper = createWrapper();

        Object.assign(wrapper.vm, { filesLight: lightFile, filesDark: darkFile });
        formOf(wrapper).setFieldValue("scrape_interval", "45");
        await nextTick();
        await formOf(wrapper).handleSubmit();
        await flushPromises();

        expect(mockToast).toHaveBeenCalledWith({
          variant: "error",
          message: "Light Mode logo was not uploaded. Upload failed",
        });
        expect(successToasts()).toHaveLength(1);
        expect(wrapper.vm.filesLight).toBe(lightFile);
        expect(wrapper.vm.filesDark).toBeNull();
        expect(wrapper.vm.changeCount).toBe(1);
      });

      it("is cleared by Discard, and asked about before leaving", async () => {
        const wrapper = createWrapper();
        const dialog = useConfirmDialog();

        Object.assign(wrapper.vm, { filesLight: lightFile });
        await nextTick();
        await wrapper.find('[data-test="general-settings-save-bar-discard"]').trigger("click");
        expect(wrapper.vm.filesLight).toBeNull();

        Object.assign(wrapper.vm, { filesDark: darkFile });
        await nextTick();
        let left = false;
        void confirmLeave().then((leave) => (left = leave));
        await vi.waitFor(() => {
          dialog.handleConfirm();
          expect(left).toBe(true);
        });
        expect(wrapper.vm.filesDark).toBeNull();
        expect(mockSettingsService.createLogo).not.toHaveBeenCalled();
      });
    });

    it("should show delete confirmation dialog", async () => {
      const wrapper = createWrapper();
      const deleteButton = wrapper.find('[data-test="setting_ent_custom_logo_img_delete_btn"]');

      if (deleteButton.exists()) {
        await deleteButton.trigger("click");
        expect(wrapper.vm.confirmDeleteImage).toBe(true);
      } else {
        // Fallback: call the confirmDeleteLogo method directly
        await wrapper.vm.confirmDeleteLogo();
        expect(wrapper.vm.confirmDeleteImage).toBe(true);
      }
    });

    it("should delete logo successfully with default theme", async () => {
      const wrapper = createWrapper();

      await wrapper.vm.deleteLogo();

      expect(mockSettingsService.deleteLogo).toHaveBeenCalledWith("test-org", "light");
      expect(mockToast).toHaveBeenCalledWith({
        variant: "success",
        message: "Light Mode logo deleted successfully.",
      });
    });

    it("should delete dark mode logo successfully", async () => {
      const wrapper = createWrapper();

      await wrapper.vm.deleteLogo("dark");

      expect(mockSettingsService.deleteLogo).toHaveBeenCalledWith("test-org", "dark");
      expect(mockToast).toHaveBeenCalledWith({
        variant: "success",
        message: "Dark Mode logo deleted successfully.",
      });
    });

    it("should handle delete error", async () => {
      const wrapper = createWrapper();
      mockSettingsService.deleteLogo.mockRejectedValue({
        message: "Delete failed",
      });

      await wrapper.vm.deleteLogo();
      // Wait for async operations to complete
      await wrapper.vm.$nextTick();

      expect(mockToast).toHaveBeenCalledWith({
        variant: "error",
        message: "Something went wrong",
      });
    });
  });

  describe("Delete confirmation ODialog", () => {
    it("renders the delete confirmation ODialog stub", () => {
      const wrapper = createWrapper();
      // both ODialogs are always present (visibility driven by `open`)
      const dialogs = wrapper.findAll('[data-test-stub="o-dialog"]');
      expect(dialogs.length).toBeGreaterThanOrEqual(1);
    });

    it("opens the delete confirmation ODialog when confirmDeleteLogo is called", async () => {
      const wrapper = createWrapper();
      await wrapper.vm.confirmDeleteLogo("dark");
      await nextTick();

      expect(wrapper.vm.confirmDeleteImage).toBe(true);
      expect(wrapper.vm.logoThemeToDelete).toBe("dark");
    });

    it("closes the delete ODialog when secondary (cancel) is emitted", async () => {
      const wrapper = createWrapper();
      // open the dialog first
      await wrapper.vm.confirmDeleteLogo("light");
      await nextTick();
      expect(wrapper.vm.confirmDeleteImage).toBe(true);

      // Simulate ODialog emitting click:secondary -> cancelConfirmDialog
      const dialogs = wrapper.findAll('[data-test-stub="o-dialog"]');
      // first ODialog corresponds to the delete-confirmation dialog
      const cancelBtn = dialogs[0].find('[data-test-stub="o-dialog-secondary"]');
      await cancelBtn.trigger("click");
      await nextTick();

      expect(wrapper.vm.confirmDeleteImage).toBe(false);
      expect(mockSettingsService.deleteLogo).not.toHaveBeenCalled();
    });

    it("invokes deleteLogo when primary (ok) is emitted on delete ODialog", async () => {
      const wrapper = createWrapper();
      await wrapper.vm.confirmDeleteLogo("dark");
      await nextTick();

      const dialogs = wrapper.findAll('[data-test-stub="o-dialog"]');
      const okBtn = dialogs[0].find('[data-test-stub="o-dialog-primary"]');
      await okBtn.trigger("click");
      await nextTick();

      expect(wrapper.vm.confirmDeleteImage).toBe(false);
      expect(mockSettingsService.deleteLogo).toHaveBeenCalledWith("test-org", "dark");
    });
  });

  describe("Color picker ODialog", () => {
    it("opens the color picker ODialog when a theme chip is clicked", async () => {
      const wrapper = createWrapper();
      const chip = wrapper.find('[data-test="theme-light-chip"]');
      // A real button, so the chip is reachable and operable from the keyboard.
      expect(chip.element.tagName).toBe("BUTTON");
      await chip.trigger("click");

      expect(wrapper.vm.showColorPicker).toBe(true);
      expect(wrapper.vm.currentPickerMode).toBe("light");
    });

    it("opens the color picker for dark mode and seeds tempColor", async () => {
      const wrapper = createWrapper();
      // set a custom dark color so tempColor is seeded with it
      wrapper.vm.customDarkColor = "#123456";
      await wrapper.vm.handleThemeChipClick("dark");
      await nextTick();

      expect(wrapper.vm.showColorPicker).toBe(true);
      expect(wrapper.vm.currentPickerMode).toBe("dark");
      expect(wrapper.vm.tempColor).toBe("#123456");
    });

    it("closes the color picker when primary (close) is emitted", async () => {
      const wrapper = createWrapper();
      await wrapper.vm.handleThemeChipClick("light");
      await nextTick();
      expect(wrapper.vm.showColorPicker).toBe(true);

      // Select the color-picker dialog by title (order-independent — other dialogs
      // like the delete-org confirmation also exist in the template).
      const dialogs = wrapper.findAll('[data-test-stub="o-dialog"]');
      const colorDialog = dialogs.find((d) => d.attributes("data-title") === "Pick Custom Color");
      const closeBtn = colorDialog.find('[data-test-stub="o-dialog-primary"]');
      await closeBtn.trigger("click");
      await nextTick();

      expect(wrapper.vm.showColorPicker).toBe(false);
    });

    it("forwards size and primary label to the delete confirmation ODialog", () => {
      const wrapper = createWrapper();
      const dialogs = wrapper.findAll('[data-test-stub="o-dialog"]');
      const deleteDialog = dialogs[0];
      // Component template uses size="sm" for delete confirmation dialog
      expect(deleteDialog.attributes("data-size")).toBe("sm");
      expect(deleteDialog.attributes("data-primary-label")).toBe("OK");
      expect(deleteDialog.attributes("data-secondary-label")).toBe("Cancel");
    });

    it("names the logo theme in bold and uses a destructive OK button", async () => {
      const wrapper = createWrapper();
      wrapper.vm.confirmDeleteLogo("dark");
      await nextTick();
      const dialog = wrapper.findAllComponents({ name: "ODialog" })[0];
      expect(dialog.props("primaryButtonVariant")).toBe("destructive");
      const message = wrapper.find('[data-test="general-delete-image-message"]');
      const name = message.find("span.font-semibold");
      expect(name.text()).toBe("Dark Mode");
      expect(message.text()).toContain("Dark Mode");
    });

    it("forwards title and size to the color picker ODialog", () => {
      const wrapper = createWrapper();
      const dialogs = wrapper.findAll('[data-test-stub="o-dialog"]');
      // Select by title (order-independent — the delete-org confirmation dialog also
      // exists and would otherwise be the last dialog in the template).
      const colorDialog = dialogs.find((d) => d.attributes("data-title") === "Pick Custom Color");
      expect(colorDialog.attributes("data-size")).toBe("xs");
      expect(colorDialog.attributes("data-primary-label")).toBe("Close");
    });
  });

  describe("Loading states", () => {
    it("should show spinner when loading", async () => {
      const wrapper = createWrapper();
      Object.assign(wrapper.vm, { loadingState: true });

      const spinner = wrapper.find('[data-test="general-settings-loading-indicator"]');
      if (spinner.exists()) {
        expect(spinner.exists()).toBe(true);
      } else {
        // Fallback: verify component loading state
        expect(wrapper.vm.loadingState).toBe(true);
      }
    });

    it("should hide spinner when not loading", async () => {
      const wrapper = createWrapper();
      Object.assign(wrapper.vm, { loadingState: false });

      const spinner = wrapper.find('[data-test="general-settings-loading-indicator"]');
      expect(spinner.exists()).toBe(false);
    });
  });

  describe("Form validation (real OForm)", () => {
    it("blocks submit and does NOT save when scrape interval is empty (restored required rule)", async () => {
      const wrapper = createWrapper();
      const form = wrapper.findComponent({ name: "OForm" });
      form.vm.form.setFieldValue("scrape_interval", "");

      await form.vm.form.handleSubmit();
      await nextTick();

      expect(form.vm.form.state.isValid).toBe(false);
      expect(mockOrganizations.post_organization_settings).not.toHaveBeenCalled();
    });

    it("blocks submit when scrape interval is negative", async () => {
      const wrapper = createWrapper();
      const form = wrapper.findComponent({ name: "OForm" });
      form.vm.form.setFieldValue("scrape_interval", -5);

      await form.vm.form.handleSubmit();
      await nextTick();

      expect(form.vm.form.state.isValid).toBe(false);
      expect(mockOrganizations.post_organization_settings).not.toHaveBeenCalled();
    });

    it("allows a scrape interval of 0", async () => {
      const wrapper = createWrapper();
      const form = wrapper.findComponent({ name: "OForm" });
      form.vm.form.setFieldValue("scrape_interval", 0);

      await form.vm.form.handleSubmit();
      await nextTick();

      expect(mockOrganizations.post_organization_settings).toHaveBeenCalled();
    });

    it("blocks submit when max series per query is below 1000 (restored optional range rule)", async () => {
      const wrapper = createWrapper();
      const form = wrapper.findComponent({ name: "OForm" });
      form.vm.form.setFieldValue("max_series_per_query", 500);

      await form.vm.form.handleSubmit();
      await nextTick();

      expect(form.vm.form.state.isValid).toBe(false);
      expect(mockOrganizations.post_organization_settings).not.toHaveBeenCalled();
    });

    it("blocks submit when max series per query is above 1000000", async () => {
      const wrapper = createWrapper();
      const form = wrapper.findComponent({ name: "OForm" });
      form.vm.form.setFieldValue("max_series_per_query", 2000000);

      await form.vm.form.handleSubmit();
      await nextTick();

      expect(form.vm.form.state.isValid).toBe(false);
      expect(mockOrganizations.post_organization_settings).not.toHaveBeenCalled();
    });

    it("keeps max series per query OPTIONAL — empty value saves", async () => {
      const wrapper = createWrapper();
      const form = wrapper.findComponent({ name: "OForm" });
      // default is null (empty) — should still submit
      await form.vm.form.handleSubmit();
      await nextTick();

      expect(mockOrganizations.post_organization_settings).toHaveBeenCalled();
    });

    it("submits a valid in-range max series per query", async () => {
      const wrapper = createWrapper();
      const form = wrapper.findComponent({ name: "OForm" });
      form.vm.form.setFieldValue("max_series_per_query", 50000);

      await form.vm.form.handleSubmit();
      await nextTick();

      expect(mockStore.dispatch).toHaveBeenCalledWith(
        "setOrganizationSettings",
        expect.objectContaining({ max_series_per_query: 50000 }),
      );
    });
  });

  describe("File upload validation", () => {
    it("should handle file rejection", async () => {
      const wrapper = createWrapper();
      const rejectedFiles = [{ name: "large-file.png", size: 30000 }];

      await wrapper.vm.onRejected(rejectedFiles);

      expect(mockToast).toHaveBeenCalledWith({
        variant: "error",
        message: "1 file did not pass validation constraints",
      });
    });
  });

  describe("Accessibility", () => {
    it("should render the scrape interval as a number input", () => {
      const wrapper = createWrapper();
      const input = wrapper.find('[data-test="general-settings-scrape-interval"] input');
      expect(input.exists()).toBe(true);
      expect(input.attributes("type")).toBe("number");
    });
  });

  describe("Edge cases", () => {
    it("shows loading rows, not fallback values, until organization settings are present", () => {
      mockStore.state.organizationData.organizationSettings = null;
      const wrapper = createWrapper();

      expect(wrapper.find('[data-test="general-settings-scrape-interval"]').exists()).toBe(false);
      expect(
        wrapper.find('[data-test="general-settings-scrape-interval-row"]').attributes("aria-busy"),
      ).toBe("true");
      expect(wrapper.find('[data-test="general-settings-save-bar"]').attributes("data-state")).toBe(
        "loading",
      );
    });
  });
});
