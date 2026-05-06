import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper, flushPromises } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import GetStarted from './GetStarted.vue';

// Mock billings service
vi.mock('@/services/billings', () => ({
  default: {
    submit_new_user_info: vi.fn(),
  },
}));

// Mock useQuasar
const mockNotify = vi.fn();
vi.mock('quasar', async () => {
  const actual = await vi.importActual('quasar');
  return {
    ...actual,
    useQuasar: () => ({
      notify: mockNotify,
    }),
  };
});

const mockStore = createStore({
  state: {
    selectedOrganization: {
      identifier: 'test-org',
      name: 'Test Organization',
    },
    theme: 'light',
    userInfo: {
      email: 'test@example.com',
    },
  },
});

const mockI18n = createI18n({
  locale: 'en',
  messages: { en: {} },
});

describe('GetStarted.vue', () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (storeOverride?: any) => {
    return mount(GetStarted, {
      global: {
        plugins: [Quasar, mockI18n, storeOverride || mockStore],
      },
    });
  };

  describe('Component Mounting', () => {
    it('should mount without errors', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('should unmount without errors', () => {
      wrapper = createWrapper();
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it('should be a Vue component', () => {
      wrapper = createWrapper();
      expect(wrapper.vm).toBeDefined();
      expect(typeof wrapper.vm).toBe('object');
    });
  });

  describe('Initial State', () => {
    it('should initialize hearAboutUs as empty string', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.hearAboutUs).toBe('');
    });

    it('should initialize whereDoYouWork as empty string', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.whereDoYouWork).toBe('');
    });

    it('should initialize isAgree as false', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.isAgree).toBe(false);
    });

    it('should initialize isSubmitting as false', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.isSubmitting).toBe(false);
    });
  });

  describe('validateForm', () => {
    it('should return false when hearAboutUs is empty', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.hearAboutUs = '';
      vm.whereDoYouWork = 'Company';
      expect(vm.validateForm()).toBe(false);
    });

    it('should return false when whereDoYouWork is empty', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.hearAboutUs = 'From a friend';
      vm.whereDoYouWork = '';
      expect(vm.validateForm()).toBe(false);
    });

    it('should return false when both fields are empty', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.hearAboutUs = '';
      vm.whereDoYouWork = '';
      expect(vm.validateForm()).toBe(false);
    });

    it('should return true when both fields are filled', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.hearAboutUs = 'From a friend';
      vm.whereDoYouWork = 'Company Inc';
      expect(vm.validateForm()).toBe(true);
    });

    it('should return false when hearAboutUs is only whitespace', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.hearAboutUs = '   ';
      vm.whereDoYouWork = 'Company';
      expect(vm.validateForm()).toBe(false);
    });

    it('should return false when whereDoYouWork is only whitespace', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.hearAboutUs = 'From a friend';
      vm.whereDoYouWork = '   ';
      expect(vm.validateForm()).toBe(false);
    });

    it('should handle fields with special characters', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.hearAboutUs = 'LinkedIn & Twitter';
      vm.whereDoYouWork = 'Acme Corp (2024)';
      expect(vm.validateForm()).toBe(true);
    });
  });

  describe('onSubmit - Invalid Form', () => {
    it('should set isSubmitting to true when called', async () => {
      // isSubmitting=true is observable only while the async API call is in-flight;
      // for invalid forms it resets synchronously, so we use a valid form + pending promise.
      const billings = await import('@/services/billings');
      let resolveSubmit!: (val: any) => void;
      vi.mocked(billings.default.submit_new_user_info).mockReturnValueOnce(
        new Promise<any>((resolve) => { resolveSubmit = resolve; }),
      );

      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.hearAboutUs = 'From a friend';
      vm.whereDoYouWork = 'Company Inc';

      const submitPromise = vm.onSubmit();
      expect(vm.isSubmitting).toBe(true);
      resolveSubmit({ status: 200 });
      await submitPromise;
    });

    it('should show notification when form is invalid (empty fields)', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.hearAboutUs = '';
      vm.whereDoYouWork = '';

      await vm.onSubmit();

      expect(mockNotify).toHaveBeenCalledWith({
        message: 'Please fill all the fields',
        color: 'negative',
      });
    });

    it('should set isSubmitting to false after invalid form submission', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.hearAboutUs = '';
      vm.whereDoYouWork = '';

      await vm.onSubmit();

      expect(vm.isSubmitting).toBe(false);
    });

    it('should not call billings service when form is invalid', async () => {
      const billings = await import('@/services/billings');
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.hearAboutUs = '';
      vm.whereDoYouWork = 'Company';

      await vm.onSubmit();

      expect(billings.default.submit_new_user_info).not.toHaveBeenCalled();
    });
  });

  describe('onSubmit - Valid Form (Success)', () => {
    beforeEach(async () => {
      const billings = await import('@/services/billings');
      (billings.default.submit_new_user_info as any).mockResolvedValue({ status: 200 });
    });

    it('should call billings.submit_new_user_info with correct args', async () => {
      const billings = await import('@/services/billings');
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.hearAboutUs = 'From a friend';
      vm.whereDoYouWork = 'Company Inc';

      await vm.onSubmit();

      expect(billings.default.submit_new_user_info).toHaveBeenCalledWith('test-org', {
        from: 'From a friend',
        company: 'Company Inc',
      });
    });

    it('should emit removeFirstTimeLogin event on success', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.hearAboutUs = 'From a friend';
      vm.whereDoYouWork = 'Company Inc';

      await vm.onSubmit();

      const emittedEvents = wrapper.emitted();
      expect(emittedEvents['removeFirstTimeLogin']).toBeTruthy();
      expect(emittedEvents['removeFirstTimeLogin'][0]).toEqual([false]);
    });

    it('should show success notification on success', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.hearAboutUs = 'From a friend';
      vm.whereDoYouWork = 'Company Inc';

      await vm.onSubmit();

      expect(mockNotify).toHaveBeenCalledWith({
        message: 'Thank you for your feedback',
        color: 'positive',
      });
    });

    it('should set isSubmitting to false after successful submission', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.hearAboutUs = 'From a friend';
      vm.whereDoYouWork = 'Company Inc';

      await vm.onSubmit();

      expect(vm.isSubmitting).toBe(false);
    });

    it('should remove isFirstTimeLogin from localStorage on success', async () => {
      // vi.spyOn cannot intercept jsdom Storage prototype methods reliably;
      // verify the effect instead: set the item first, then confirm it is gone after submit.
      localStorage.setItem('isFirstTimeLogin', 'true');

      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.hearAboutUs = 'From a friend';
      vm.whereDoYouWork = 'Company Inc';

      await vm.onSubmit();
      await flushPromises();

      expect(localStorage.getItem('isFirstTimeLogin')).toBeNull();
    });
  });

  describe('onSubmit - Valid Form (Failure)', () => {
    beforeEach(async () => {
      const billings = await import('@/services/billings');
      (billings.default.submit_new_user_info as any).mockResolvedValue({ status: 500 });
    });

    it('should show error notification on non-200 response', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.hearAboutUs = 'From a friend';
      vm.whereDoYouWork = 'Company Inc';

      await vm.onSubmit();

      expect(mockNotify).toHaveBeenCalledWith({
        message: 'Something went wrong',
        color: 'negative',
      });
    });

    it('should set isSubmitting to false after failed submission', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.hearAboutUs = 'From a friend';
      vm.whereDoYouWork = 'Company Inc';

      await vm.onSubmit();

      expect(vm.isSubmitting).toBe(false);
    });

    it('should not emit removeFirstTimeLogin on failure', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.hearAboutUs = 'From a friend';
      vm.whereDoYouWork = 'Company Inc';

      await vm.onSubmit();

      const emittedEvents = wrapper.emitted();
      expect(emittedEvents['removeFirstTimeLogin']).toBeFalsy();
    });
  });

  describe('Template Tests', () => {
    it('should render a form with inputs', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.tw\\:flex').exists()).toBe(true);
    });

    it('should show copyright year', () => {
      wrapper = createWrapper();
      const yearEl = wrapper.find('#year');
      expect(yearEl.exists()).toBe(true);
      expect(yearEl.text()).toBe(new Date().getFullYear().toString());
    });

    it('should render at least one button', () => {
      wrapper = createWrapper();
      const buttons = wrapper.findAll('button');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  describe('Theme Tests', () => {
    it('should render without errors in dark theme', () => {
      const darkStore = createStore({
        state: {
          selectedOrganization: { identifier: 'test-org' },
          theme: 'dark',
          userInfo: { email: 'test@example.com' },
        },
      });
      wrapper = createWrapper(darkStore);
      expect(wrapper.exists()).toBe(true);
    });

    it('should render without errors in light theme', () => {
      const lightStore = createStore({
        state: {
          selectedOrganization: { identifier: 'test-org' },
          theme: 'light',
          userInfo: { email: 'test@example.com' },
        },
      });
      wrapper = createWrapper(lightStore);
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('Reactive Updates', () => {
    it('should update hearAboutUs reactively', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.hearAboutUs = 'LinkedIn';
      await wrapper.vm.$nextTick();
      expect(vm.hearAboutUs).toBe('LinkedIn');
    });

    it('should update whereDoYouWork reactively', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.whereDoYouWork = 'OpenObserve';
      await wrapper.vm.$nextTick();
      expect(vm.whereDoYouWork).toBe('OpenObserve');
    });

    it('should update isAgree reactively', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.isAgree = true;
      await wrapper.vm.$nextTick();
      expect(vm.isAgree).toBe(true);
    });
  });

  describe('Store Integration', () => {
    it('should use organization identifier from store', async () => {
      const billings = await import('@/services/billings');
      (billings.default.submit_new_user_info as any).mockResolvedValue({ status: 200 });

      const customStore = createStore({
        state: {
          selectedOrganization: { identifier: 'custom-org' },
          theme: 'light',
          userInfo: { email: 'test@example.com' },
        },
      });

      wrapper = createWrapper(customStore);
      const vm = wrapper.vm as any;
      vm.hearAboutUs = 'Search';
      vm.whereDoYouWork = 'My Company';

      await vm.onSubmit();

      expect(billings.default.submit_new_user_info).toHaveBeenCalledWith('custom-org', expect.any(Object));
    });
  });
});
