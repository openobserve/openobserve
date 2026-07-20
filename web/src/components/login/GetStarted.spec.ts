import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import GetStarted from './GetStarted.vue';
import { getStartedSchema } from './GetStarted.schema';

// Mock billings service
vi.mock('@/services/billings', () => ({
  default: {
    submit_new_user_info: vi.fn(),
  },
}));

// Mock toast function
vi.mock('@/lib/feedback/Toast/useToast', () => {
  return {
    toast: vi.fn(),
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
  let mockToast: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const toastModule = await import('@/lib/feedback/Toast/useToast');
    mockToast = vi.mocked(toastModule.toast);
    mockToast.mockClear();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (storeOverride?: any) => {
    return mount(GetStarted, {
      global: {
        plugins: [mockI18n, storeOverride || mockStore],
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

  // Validation lives in the Zod schema (GetStarted.schema.ts), not in local refs.
  // Assert the schema directly so the source of truth is what's tested.
  describe('schema validation', () => {
    it('should fail when hearAboutUs is empty', () => {
      expect(
        getStartedSchema.safeParse({ hearAboutUs: '', whereDoYouWork: 'Company', isAgree: true }).success,
      ).toBe(false);
    });

    it('should fail when whereDoYouWork is empty', () => {
      expect(
        getStartedSchema.safeParse({ hearAboutUs: 'From a friend', whereDoYouWork: '', isAgree: true }).success,
      ).toBe(false);
    });

    it('should fail when both fields are empty', () => {
      expect(
        getStartedSchema.safeParse({ hearAboutUs: '', whereDoYouWork: '', isAgree: true }).success,
      ).toBe(false);
    });

    it('should pass when both fields are filled and terms accepted', () => {
      expect(
        getStartedSchema.safeParse({ hearAboutUs: 'From a friend', whereDoYouWork: 'Company Inc', isAgree: true }).success,
      ).toBe(true);
    });

    it('should fail when hearAboutUs is only whitespace', () => {
      expect(
        getStartedSchema.safeParse({ hearAboutUs: '   ', whereDoYouWork: 'Company', isAgree: true }).success,
      ).toBe(false);
    });

    it('should fail when whereDoYouWork is only whitespace', () => {
      expect(
        getStartedSchema.safeParse({ hearAboutUs: 'From a friend', whereDoYouWork: '   ', isAgree: true }).success,
      ).toBe(false);
    });

    it('should handle fields with special characters', () => {
      expect(
        getStartedSchema.safeParse({ hearAboutUs: 'LinkedIn & Twitter', whereDoYouWork: 'Acme Corp (2024)', isAgree: true }).success,
      ).toBe(true);
    });

    it('should fail when isAgree is false (terms not accepted)', () => {
      const result = getStartedSchema.safeParse({
        hearAboutUs: 'From a friend',
        whereDoYouWork: 'Company Inc',
        isAgree: false,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const agreeIssue = result.error.issues.find((i) => i.path[0] === 'isAgree');
        expect(agreeIssue?.message).toBe('You must accept the terms to continue');
      }
    });

    it('should fail when isAgree is missing', () => {
      expect(
        getStartedSchema.safeParse({ hearAboutUs: 'From a friend', whereDoYouWork: 'Company Inc' }).success,
      ).toBe(false);
    });
  });

  describe('onSubmit - submit payload', () => {
    it('should map the submit payload to the billings service args', async () => {
      const billings = await import('@/services/billings');
      vi.mocked(billings.default.submit_new_user_info).mockResolvedValue({ status: 200 });

      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      await vm.doSubmit({ hearAboutUs: 'Search', company: undefined, whereDoYouWork: 'Company', isAgree: true });

      expect(billings.default.submit_new_user_info).toHaveBeenCalledWith('test-org', {
        from: 'Search',
        company: 'Company',
      });
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

      await vm.doSubmit({ hearAboutUs: 'From a friend', whereDoYouWork: 'Company Inc', isAgree: true });

      expect(billings.default.submit_new_user_info).toHaveBeenCalledWith('test-org', {
        from: 'From a friend',
        company: 'Company Inc',
      });
    });

    it('should emit removeFirstTimeLogin event on success', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      await vm.doSubmit({ hearAboutUs: 'From a friend', whereDoYouWork: 'Company Inc', isAgree: true });

      const emittedEvents = wrapper.emitted();
      expect(emittedEvents['removeFirstTimeLogin']).toBeTruthy();
      expect(emittedEvents['removeFirstTimeLogin'][0]).toEqual([false]);
    });

    it('should show success notification on success', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      await vm.doSubmit({ hearAboutUs: 'From a friend', whereDoYouWork: 'Company Inc', isAgree: true });

      expect(mockToast).toHaveBeenCalledWith({
        message: 'Thank you for your feedback',
        variant: 'success',
      });
    });

    it('should remove isFirstTimeLogin from localStorage on success', async () => {
      // vi.spyOn cannot intercept jsdom Storage prototype methods reliably;
      // verify the effect instead: set the item first, then confirm it is gone after submit.
      localStorage.setItem('isFirstTimeLogin', 'true');

      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      await vm.doSubmit({ hearAboutUs: 'From a friend', whereDoYouWork: 'Company Inc', isAgree: true });
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

      await vm.doSubmit({ hearAboutUs: 'From a friend', whereDoYouWork: 'Company Inc', isAgree: true });

      expect(mockToast).toHaveBeenCalledWith({
        message: 'Something went wrong',
        variant: 'error',
      });
    });

    it('should not emit removeFirstTimeLogin on failure', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      await vm.doSubmit({ hearAboutUs: 'From a friend', whereDoYouWork: 'Company Inc', isAgree: true });

      const emittedEvents = wrapper.emitted();
      expect(emittedEvents['removeFirstTimeLogin']).toBeFalsy();
    });
  });

  describe('Template Tests', () => {
    it('should render a form with inputs', () => {
      wrapper = createWrapper();
      expect(wrapper.find('.flex').exists()).toBe(true);
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

      await vm.doSubmit({ hearAboutUs: 'Search', whereDoYouWork: 'My Company', isAgree: true });

      expect(billings.default.submit_new_user_info).toHaveBeenCalledWith('custom-org', expect.any(Object));
    });
  });

  // End-to-end gating through the real OForm/TanStack pipeline: the Save button
  // is always enabled (R3), so submit is gated by the schema. An unchecked
  // terms box must block submission; checking it must let it through.
  // Pattern: set values via each field component's `update:modelValue`, then
  // AWAIT the form's own handleSubmit (runs schema → @submit) — deterministic.
  describe('terms gate (real OForm submit)', () => {
    const fillInputs = async () => {
      const inputs = wrapper.findAllComponents({ name: 'OInput' });
      // Two OFormInputs: hearAboutUs, whereDoYouWork (in template order).
      await inputs[0].vm.$emit('update:modelValue', 'From a friend');
      await inputs[1].vm.$emit('update:modelValue', 'Company Inc');
    };

    const submitForm = async () => {
      await flushPromises();
      await (wrapper.findComponent({ name: 'OForm' }).vm as any).form.handleSubmit();
      await flushPromises();
    };

    it('should NOT call billings when terms checkbox is unchecked', async () => {
      const billings = await import('@/services/billings');
      (billings.default.submit_new_user_info as any).mockResolvedValue({ status: 200 });

      wrapper = createWrapper();
      await fillInputs();

      // Box left unchecked (default false) → schema gate fails on submit.
      await submitForm();

      expect(billings.default.submit_new_user_info).not.toHaveBeenCalled();
    });

    it('should call billings when terms checkbox is checked and fields are filled', async () => {
      const billings = await import('@/services/billings');
      (billings.default.submit_new_user_info as any).mockResolvedValue({ status: 200 });

      wrapper = createWrapper();
      await fillInputs();

      // Check the terms box → isAgree=true satisfies the schema gate.
      const checkbox = wrapper.findComponent({ name: 'OCheckbox' });
      await checkbox.vm.$emit('update:modelValue', true);

      await submitForm();

      expect(billings.default.submit_new_user_info).toHaveBeenCalledWith('test-org', {
        from: 'From a friend',
        company: 'Company Inc',
      });
    });
  });
});
