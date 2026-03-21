import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import SsoLogin from './SsoLogin.vue';

// Mock zincutils
vi.mock('@/utils/zincutils', () => ({
  getImageURL: vi.fn((path) => `mock-image-url-${path}`),
}));

const mockStore = createStore({
  state: {
    theme: 'light',
  },
});

const mockI18n = createI18n({
  locale: 'en',
  messages: {
    en: {
      login: {
        userEmail: 'Email',
        password: 'Password',
        signIn: 'Sign In',
      },
    },
  },
});

describe('SsoLogin.vue', () => {
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
    return mount(SsoLogin, {
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
    it('should initialize name as empty string', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.name).toBe('');
    });

    it('should initialize password as empty string', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.password).toBe('');
    });

    it('should initialize isSubmitting as false', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.isSubmitting).toBe(false);
    });

    it('should initialize showLoginInput as false', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.showLoginInput).toBe(false);
    });
  });

  describe('SSO Login Button', () => {
    it('should render SSO login button', () => {
      wrapper = createWrapper();
      const ssoBtn = wrapper.find('[data-test="sso-login-btn"]');
      expect(ssoBtn.exists()).toBe(true);
    });

    it('should show "Login with SSO" text in button', () => {
      wrapper = createWrapper();
      const ssoBtn = wrapper.find('[data-test="sso-login-btn"]');
      expect(ssoBtn.text()).toContain('Login with SSO');
    });
  });

  describe('showLoginInput Toggle', () => {
    it('should hide login form by default (showLoginInput=false)', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.showLoginInput).toBe(false);
    });

    it('should toggle showLoginInput to true when link is clicked', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      const link = wrapper.find('a.login-internal-link');
      await link.trigger('click');

      expect(vm.showLoginInput).toBe(true);
    });

    it('should toggle showLoginInput back to false on second click', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      const link = wrapper.find('a.login-internal-link');
      await link.trigger('click');
      expect(vm.showLoginInput).toBe(true);

      await link.trigger('click');
      expect(vm.showLoginInput).toBe(false);
    });

    it('should render "Sign in with an internal user" link', () => {
      wrapper = createWrapper();
      const link = wrapper.find('a.login-internal-link');
      expect(link.exists()).toBe(true);
      expect(link.text()).toContain('Sign in with an internal user');
    });
  });

  describe('Login Input Form', () => {
    it('should render login-user-id input', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.showLoginInput = true;
      await wrapper.vm.$nextTick();

      const userInput = wrapper.find('[data-test="login-user-id"]');
      expect(userInput.exists()).toBe(true);
    });

    it('should render login-password input', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.showLoginInput = true;
      await wrapper.vm.$nextTick();

      const passwordInput = wrapper.find('[data-test="login-password"]');
      expect(passwordInput.exists()).toBe(true);
    });

    it('should render sign-in button when showLoginInput is true', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.showLoginInput = true;
      await wrapper.vm.$nextTick();

      const signInBtn = wrapper.find('[data-cy="login-sign-in"]');
      expect(signInBtn.exists()).toBe(true);
    });
  });

  describe('onSignIn method', () => {
    it('should have onSignIn method defined', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.onSignIn).toBeDefined();
      expect(typeof vm.onSignIn).toBe('function');
    });

    it('should not throw when onSignIn is called', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(() => vm.onSignIn()).not.toThrow();
    });
  });

  describe('getImageURL', () => {
    it('should call getImageURL at least once during rendering', async () => {
      const zincutils = await import('@/utils/zincutils');
      wrapper = createWrapper();
      expect(zincutils.getImageURL).toHaveBeenCalled();
    });

    it('should call getImageURL with SSO icon path', async () => {
      const zincutils = await import('@/utils/zincutils');
      wrapper = createWrapper();
      const calls = (zincutils.getImageURL as any).mock.calls.map((c: any) => c[0]);
      expect(calls.some((p: string) => p.includes('sso'))).toBe(true);
    });
  });

  describe('Component Properties Exposed', () => {
    it('should expose name ref', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm).toHaveProperty('name');
    });

    it('should expose password ref', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm).toHaveProperty('password');
    });

    it('should expose isSubmitting ref', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm).toHaveProperty('isSubmitting');
    });

    it('should expose showLoginInput ref', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm).toHaveProperty('showLoginInput');
    });

    it('should expose getImageURL function', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(typeof vm.getImageURL).toBe('function');
    });

    it('should expose onSignIn function', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(typeof vm.onSignIn).toBe('function');
    });
  });

  describe('Reactive Updates', () => {
    it('should update name reactively', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.name = 'testuser';
      await wrapper.vm.$nextTick();
      expect(vm.name).toBe('testuser');
    });

    it('should update password reactively', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.password = 'testpassword';
      await wrapper.vm.$nextTick();
      expect(vm.password).toBe('testpassword');
    });

    it('should update isSubmitting reactively', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.isSubmitting = true;
      await wrapper.vm.$nextTick();
      expect(vm.isSubmitting).toBe(true);
    });

    it('should update showLoginInput reactively', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.showLoginInput = true;
      await wrapper.vm.$nextTick();
      expect(vm.showLoginInput).toBe(true);
    });
  });

  describe('Theme Support', () => {
    it('should render without errors in dark theme', () => {
      const darkStore = createStore({ state: { theme: 'dark' } });
      wrapper = createWrapper(darkStore);
      expect(wrapper.exists()).toBe(true);
    });

    it('should render without errors in light theme', () => {
      const lightStore = createStore({ state: { theme: 'light' } });
      wrapper = createWrapper(lightStore);
      expect(wrapper.exists()).toBe(true);
    });
  });
});
