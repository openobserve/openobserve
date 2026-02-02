import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Dialog, Notify, Quasar } from "quasar";
import { installQuasar } from "@/test/unit/helpers";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import AddServiceAccount from "./AddServiceAccount.vue";
import * as service_accounts from "@/services/service_accounts";
import { createRouter, createWebHistory } from 'vue-router';
import { nextTick } from "vue";

// Mock the service accounts service
vi.mock("@/services/service_accounts", () => ({
  default: {
    create: vi.fn(),
    update: vi.fn()
  }
}));

// Mock vue-i18n
vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useI18n: () => ({
      t: (key) => key
    })
  };
});

// Create platform mock
const platform = {
  is: {
    desktop: true,
    mobile: false,
  },
  has: {
    touch: false,
  },
};

installQuasar({
  plugins: [Dialog, Notify],
  config: {
    platform
  }
});

describe("AddServiceAccount Component", () => {
  let wrapper;
  let mockStore;
  let notifyMock;
  let router;
  let routerPushSpy;

  beforeEach(async () => {
    // Reset mock implementations
    vi.mocked(service_accounts.default.create).mockReset();
    vi.mocked(service_accounts.default.update).mockReset();

    // Setup store state
    mockStore = {
      state: {
        selectedOrganization: {
          identifier: "test-org",
          name: "Test Org"
        }
      }
    };

    // Setup router
    router = createRouter({
      history: createWebHistory(),
      routes: [
        {
          path: '/service-accounts',
          name: 'serviceAccounts',
          component: { template: '<div>Service Accounts</div>' }
        }
      ]
    });

    // Setup router push spy
    routerPushSpy = vi.spyOn(router, 'push');

    // Setup notify mock
    notifyMock = vi.fn().mockReturnValue(vi.fn()); // Return a dismiss function

    // Mount component
    wrapper = mount(AddServiceAccount, {
      props: {
        modelValue: {
          org_member_id: "",
          role: "admin",
          first_name: "",
          email: "",
          organization: ""
        },
        isUpdated: false
      },
      global: {
        plugins: [
          [Quasar, { platform }],
          i18n,
          router
        ],
        provide: {
          store: mockStore,
          platform
        },
        mocks: {
          $q: {
            platform,
            notify: notifyMock
          }
        },
        stubs: {
          QCard: false,
          QCardSection: false,
          QIcon: true,
          QInput: false,
          QBtn: false,
          QForm: false,
          QSeparator: false
        }
      },
      attachTo: document.body
    });

    await flushPromises();
  });

  afterEach(() => {
    if (wrapper && typeof wrapper.unmount === 'function') {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("mounts successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("initializes with default values", () => {
      expect(wrapper.vm.formData).toEqual({
        org_member_id: "",
        role: "admin",
        first_name: "",
        email: "",
        organization: ""
      });
    });
  });

  describe("Form Fields", () => {
    it("shows email field when adding new service account", () => {
      const emailInput = wrapper.findComponent({ name: 'QInput' });
      expect(emailInput.exists()).toBe(true);
    });

    it("hides email field when updating service account", async () => {
      // Create a new wrapper specifically for this test
      const updateWrapper = mount(AddServiceAccount, {
        props: {
          isUpdated: true,
          modelValue: {
            email: "test@example.com",
            first_name: "Test Account",
            organization: "test-org"
          }
        },
        global: {
          plugins: [[Quasar, { platform }], i18n, router],
          provide: { store: mockStore, platform },
          mocks: { $q: { platform, notify: notifyMock } },
          stubs: {
            QCard: false,
            QCardSection: false,
            QIcon: true,
            QInput: false,
            QBtn: false,
            QForm: false,
            QSeparator: false
          }
        }
      });

      await updateWrapper.vm.$nextTick();
      await flushPromises();

      const emailInputs = updateWrapper.findAllComponents({ name: 'QInput' });
      expect(emailInputs.length).toBe(1); // Only description field should be visible

      updateWrapper.unmount();
    });
  });

  describe("Form Validation", () => {
    it("validates required email field", async () => {
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      expect(service_accounts.default.create).not.toHaveBeenCalled();
    });

    it("validates email format", async () => {
      wrapper.vm.formData.email = "invalid-email";
      await wrapper.vm.$nextTick();
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      expect(service_accounts.default.create).not.toHaveBeenCalled();
    });
  });

  describe("Service Account Creation", () => {
    it("creates service account successfully", async () => {
      service_accounts.default.create.mockResolvedValue({ data: {} });
      
      wrapper.vm.formData.email = "test@example.com";
      wrapper.vm.firstName = "Test Description";
      await wrapper.vm.$nextTick();
      
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(service_accounts.default.create).toHaveBeenCalledWith(
        {
          org_member_id: "",
          role: "admin",
          first_name: "Test Description",
          email: "test@example.com",
          organization: "test-org"
        },
        "test-org"
      );
      expect(wrapper.emitted()["updated"]).toBeTruthy();
    });

    it("ignores 403 error notifications", async () => {
      service_accounts.default.create.mockRejectedValue({
        response: {
          status: 403
        }
      });

      wrapper.vm.formData.email = "test@example.com";
      await wrapper.vm.$nextTick();
      
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(notifyMock).not.toHaveBeenCalledWith(
        expect.objectContaining({
          color: "negative"
        })
      );
    });
  });

  describe("Service Account Update", () => {
    let updateWrapper;
    let updateNotifyMock;
    let dismissMock;

    beforeEach(async () => {
      dismissMock = vi.fn();
      updateNotifyMock = vi.fn().mockReturnValue(dismissMock);

      // Create a new wrapper for update tests
      updateWrapper = mount(AddServiceAccount, {
        props: {
          isUpdated: true,
          modelValue: {
            email: "existing@example.com",
            first_name: "Existing Description",
            organization: "test-org"
          }
        },
        global: {
          plugins: [[Quasar, { platform }], i18n, router],
          provide: { store: mockStore, platform },
          mocks: { 
            $q: { 
              platform, 
              notify: updateNotifyMock 
            } 
          }
        }
      });

      await nextTick();
    });

    afterEach(() => {
      updateWrapper.unmount();
    });

    it("updates service account successfully", async () => {
      service_accounts.default.update.mockResolvedValue({ data: {} });
      
      updateWrapper.vm.firstName = "Updated Description";
      await updateWrapper.vm.$nextTick();
      
      const form = updateWrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(service_accounts.default.update).toHaveBeenCalledWith(
        expect.objectContaining({
          first_name: "Updated Description",
          organization: "test-org"
        }),
        "test-org",
        "existing@example.com"
      );
      expect(updateWrapper.emitted()["updated"]).toBeTruthy();
    });

  });

  describe("UI Interactions", () => {
    it("emits cancel event on cancel button click", async () => {
      const cancelButton = wrapper.find('[data-test="cancel-button"]');
      await cancelButton.trigger('click');
      expect(wrapper.emitted()["cancel:hideform"]).toBeTruthy();
    });

  });

  describe("Form State Management", () => {
    it("maintains form state after failed submission", async () => {
      service_accounts.default.create.mockRejectedValue({
        response: {
          status: 400,
          data: { message: "Error" }
        }
      });

      const testEmail = "test@example.com";
      const testDescription = "Test Description";
      
      wrapper.vm.formData.email = testEmail;
      wrapper.vm.firstName = testDescription;
      await wrapper.vm.$nextTick();
      
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(wrapper.vm.formData.email).toBe(testEmail);
      expect(wrapper.vm.firstName).toBe(testDescription);
    });
  });
});

