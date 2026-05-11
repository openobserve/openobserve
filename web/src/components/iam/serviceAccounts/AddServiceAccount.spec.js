import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Dialog, Notify, Quasar } from "quasar";
import { installQuasar } from "@/test/unit/helpers";
import i18n from "@/locales";
import AddServiceAccount from "./AddServiceAccount.vue";
import * as service_accounts from "@/services/service_accounts";
import { createRouter, createWebHistory } from "vue-router";
import { nextTick } from "vue";

// Mock the service accounts service
vi.mock("@/services/service_accounts", () => ({
  default: {
    create: vi.fn(),
    update: vi.fn(),
  },
}));

// Mock vue-i18n so labels resolve to their keys (predictable assertions)
vi.mock("vue-i18n", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useI18n: () => ({
      t: (key: string) => key,
    }),
  };
});

// Mock reo analytics — component calls track() in submit handlers
vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({ track: vi.fn() }),
}));


// Platform mock for Quasar
const platform = {
  is: { desktop: true, mobile: false },
  has: { touch: false },
};

installQuasar({
  plugins: [Dialog, Notify],
  config: { platform },
});

// ODrawer stub: keeps slot content queryable, surfaces open state and
// proxies the migration emit so the parent's @update:open wiring is exercised.
const ODrawerStub = {
  name: "ODrawer",
  props: [
    "open",
    "width",
    "showClose",
    "persistent",
    "size",
    "title",
    "subTitle",
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
    <div data-test-stub="o-drawer" :data-open="open" :data-title="title" :data-size="size">
      <div data-test-stub="o-drawer-header"><slot name="header" /></div>
      <div data-test-stub="o-drawer-body"><slot /></div>
      <div data-test-stub="o-drawer-footer"><slot name="footer" /></div>
    </div>
  `,
};

// OButton stub: passes through data-test attr and forwards click for interaction.
const OButtonStub = {
  name: "OButton",
  props: ["variant", "size", "disabled", "loading", "type"],
  emits: ["click"],
  template: `<button
      data-test-stub="o-button"
      :data-test="$attrs['data-test']"
      :disabled="disabled"
      :type="type"
      @click="$emit('click', $event)"><slot /></button>`,
  inheritAttrs: false,
};

describe("AddServiceAccount Component", () => {
  let wrapper: VueWrapper<any>;
  let mockStore: any;
  let router: ReturnType<typeof createRouter>;

  const mountComp = (props: Record<string, any> = {}): VueWrapper<any> =>
    mount(AddServiceAccount, {
      props: {
        open: true,
        modelValue: {
          org_member_id: "",
          role: "admin",
          first_name: "",
          email: "",
          organization: "",
        },
        isUpdated: false,
        ...props,
      },
      global: {
        plugins: [[Quasar, { platform }], i18n, router],
        provide: { store: mockStore, platform },
        stubs: {
          ODrawer: ODrawerStub,
          OButton: OButtonStub,
          QInput: false,
          QForm: false,
        },
      },
      attachTo: document.body,
    });

  beforeEach(async () => {
    vi.mocked(service_accounts.default.create).mockReset();
    vi.mocked(service_accounts.default.update).mockReset();

    mockStore = {
      state: {
        selectedOrganization: {
          identifier: "test-org",
          name: "Test Org",
        },
      },
    };

    router = createRouter({
      history: createWebHistory(),
      routes: [
        {
          path: "/service-accounts",
          name: "serviceAccounts",
          component: { template: "<div>Service Accounts</div>" },
        },
      ],
    });

    wrapper = mountComp();
    await flushPromises();
  });

  afterEach(() => {
    if (wrapper && typeof wrapper.unmount === "function") {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("mounts successfully and renders ODrawer", () => {
      expect(wrapper.exists()).toBe(true);
      const drawer = wrapper.find('[data-test-stub="o-drawer"]');
      expect(drawer.exists()).toBe(true);
    });

    it("initializes with default values", () => {
      expect(wrapper.vm.formData).toEqual({
        org_member_id: "",
        role: "admin",
        first_name: "",
        email: "",
        organization: "",
      });
    });

    it("passes the add title to ODrawer when not updating", () => {
      const drawer = wrapper.find('[data-test-stub="o-drawer"]');
      expect(drawer.attributes("data-title")).toBe("serviceAccounts.add");
    });

    it("passes the update title to ODrawer when beingUpdated", async () => {
      const updateWrapper = mountComp({
        isUpdated: true,
        modelValue: {
          email: "existing@example.com",
          first_name: "Existing Description",
          organization: "test-org",
        },
      });
      await nextTick();
      const drawer = updateWrapper.find('[data-test-stub="o-drawer"]');
      expect(drawer.attributes("data-title")).toBe("serviceAccounts.update");
      expect(updateWrapper.vm.beingUpdated).toBe(true);
      updateWrapper.unmount();
    });

    it("forwards open prop to ODrawer", () => {
      const drawer = wrapper.find('[data-test-stub="o-drawer"]');
      expect(drawer.attributes("data-open")).toBe("true");
    });
  });

  describe("Form Fields", () => {
    it("shows email and description fields when adding new service account", () => {
      const inputs = wrapper.findAllComponents({ name: "QInput" });
      expect(inputs.length).toBe(2);
    });

    it("hides email field when updating service account", async () => {
      const updateWrapper = mountComp({
        isUpdated: true,
        modelValue: {
          email: "test@example.com",
          first_name: "Test Account",
          organization: "test-org",
        },
      });

      await nextTick();
      await flushPromises();

      const inputs = updateWrapper.findAllComponents({ name: "QInput" });
      expect(inputs.length).toBe(1); // Only description field visible
      updateWrapper.unmount();
    });
  });

  describe("Form Validation", () => {
    it("does not submit when email is empty", async () => {
      const form = wrapper.find("form");
      await form.trigger("submit.prevent");
      expect(service_accounts.default.create).not.toHaveBeenCalled();
    });

    it("does not submit when email format is invalid", async () => {
      wrapper.vm.formData.email = "invalid-email";
      await nextTick();
      const form = wrapper.find("form");
      await form.trigger("submit.prevent");
      expect(service_accounts.default.create).not.toHaveBeenCalled();
    });
  });

  describe("Service Account Creation", () => {
    it("creates service account successfully and emits update:open false", async () => {
      vi.mocked(service_accounts.default.create).mockResolvedValue({
        data: {},
      } as any);

      wrapper.vm.formData.email = "test@example.com";
      wrapper.vm.firstName = "Test Description";
      await nextTick();

      const form = wrapper.find("form");
      await form.trigger("submit.prevent");
      await flushPromises();

      expect(service_accounts.default.create).toHaveBeenCalledWith(
        {
          org_member_id: "",
          role: "admin",
          first_name: "Test Description",
          email: "test@example.com",
          organization: "test-org",
        },
        "test-org",
      );
      expect(wrapper.emitted()["updated"]).toBeTruthy();
      expect(wrapper.emitted()["update:open"]).toBeTruthy();
      expect(wrapper.emitted()["update:open"]![0]).toEqual([false]);
    });

    it("does not throw on 403 error during create", async () => {
      // 403 is intentionally swallowed (no error toast). We just assert the
      // promise resolves cleanly and the service was invoked.
      vi.mocked(service_accounts.default.create).mockRejectedValue({
        response: { status: 403 },
      });

      wrapper.vm.formData.email = "test@example.com";
      await nextTick();

      await expect(
        (async () => {
          wrapper.vm.onSubmit();
          await flushPromises();
        })(),
      ).resolves.not.toThrow();

      expect(service_accounts.default.create).toHaveBeenCalled();
    });

    it("does not emit update:open on create error", async () => {
      vi.mocked(service_accounts.default.create).mockRejectedValue({
        response: { status: 500, data: { message: "Server error" } },
      });

      wrapper.vm.formData.email = "test@example.com";
      await nextTick();

      wrapper.vm.onSubmit();
      await flushPromises();

      // On failure the drawer must stay open — no update:open emit
      expect(wrapper.emitted()["update:open"]).toBeFalsy();
      expect(wrapper.emitted()["updated"]).toBeFalsy();
    });
  });

  describe("Service Account Update", () => {
    let updateWrapper: VueWrapper<any>;

    beforeEach(async () => {
      updateWrapper = mountComp({
        isUpdated: true,
        modelValue: {
          email: "existing@example.com",
          first_name: "Existing Description",
          organization: "test-org",
        },
      });

      await nextTick();
    });

    afterEach(() => {
      updateWrapper.unmount();
    });

    it("updates service account successfully and emits update:open false", async () => {
      vi.mocked(service_accounts.default.update).mockResolvedValue({
        data: {},
      } as any);

      updateWrapper.vm.firstName = "Updated Description";
      await nextTick();

      const form = updateWrapper.find("form");
      await form.trigger("submit.prevent");
      await flushPromises();

      expect(service_accounts.default.update).toHaveBeenCalledWith(
        expect.objectContaining({
          first_name: "Updated Description",
          organization: "test-org",
        }),
        "test-org",
        "existing@example.com",
      );
      expect(updateWrapper.emitted()["updated"]).toBeTruthy();
      expect(updateWrapper.emitted()["update:open"]).toBeTruthy();
      expect(updateWrapper.emitted()["update:open"]![0]).toEqual([false]);
    });

    it("does not emit update:open on update error", async () => {
      vi.mocked(service_accounts.default.update).mockRejectedValue({
        response: { status: 500, data: { message: "Update failed" } },
      });

      updateWrapper.vm.onSubmit();
      await flushPromises();

      // On failure the drawer must stay open — no update:open emit
      expect(updateWrapper.emitted()["update:open"]).toBeFalsy();
      expect(updateWrapper.emitted()["updated"]).toBeFalsy();
    });

    it("does not throw on 403 error during update", async () => {
      vi.mocked(service_accounts.default.update).mockRejectedValue({
        response: { status: 403 },
      });

      await expect(
        (async () => {
          updateWrapper.vm.onSubmit();
          await flushPromises();
        })(),
      ).resolves.not.toThrow();

      expect(service_accounts.default.update).toHaveBeenCalled();
    });
  });

  describe("UI Interactions", () => {
    it("emits update:open false on cancel button click", async () => {
      const cancelButton = wrapper.find('[data-test="cancel-button"]');
      expect(cancelButton.exists()).toBe(true);
      await cancelButton.trigger("click");
      expect(wrapper.emitted()["update:open"]).toBeTruthy();
      expect(wrapper.emitted()["update:open"]![0]).toEqual([false]);
    });

    it("forwards ODrawer update:open to parent", async () => {
      await wrapper
        .findComponent({ name: "ODrawer" })
        .vm.$emit("update:open", false);
      expect(wrapper.emitted("update:open")).toBeTruthy();
      expect(wrapper.emitted("update:open")![0]).toEqual([false]);
    });
  });

  describe("Form State Management", () => {
    it("maintains form state after failed submission", async () => {
      vi.mocked(service_accounts.default.create).mockRejectedValue({
        response: { status: 400, data: { message: "Error" } },
      });

      const testEmail = "test@example.com";
      const testDescription = "Test Description";

      wrapper.vm.formData.email = testEmail;
      wrapper.vm.firstName = testDescription;
      await nextTick();

      const form = wrapper.find("form");
      await form.trigger("submit.prevent");
      await flushPromises();

      expect(wrapper.vm.formData.email).toBe(testEmail);
      expect(wrapper.vm.firstName).toBe(testDescription);
    });
  });
});
