import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { installQuasar } from '@/test/unit/helpers/install-quasar-plugin';
import ThemeSwitcher from './ThemeSwitcher.vue';
import { createStore } from 'vuex';
import { Dialog, Notify } from 'quasar';
import { createI18n } from 'vue-i18n';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

// Mock store
const mockStore = createStore({
  state: {
    theme: 'light',
  },
  actions: {
    appTheme: vi.fn(),
  },
});

// Install Quasar with proper plugins
installQuasar({
  plugins: [Dialog, Notify],
});

// Create i18n instance
const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      common: {
        lightMode: 'Light Mode',
        darkMode: 'Dark Mode',
        switchTo: 'Switch to'
      }
    }
  }
});

describe('ThemeSwitcher', () => {
  let wrapper: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });

    // Mock console.warn to avoid noise in tests
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.restoreAllMocks();
  });

  const mountComponent = () => {
    return mount(ThemeSwitcher, {
      global: {
        plugins: [mockStore, i18n],
      },
    });
  };

  describe('localStorage edge cases', () => {
    it('should handle localStorage.getItem throwing an error', () => {
      localStorageMock.getItem.mockImplementation(() => {
        throw new Error('localStorage not available');
      });

      expect(() => {
        const wrapper = mountComponent();
      }).not.toThrow();
    });

    it('should handle localStorage.setItem throwing an error', () => {
      localStorageMock.getItem.mockReturnValue('light');
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('localStorage not available');
      });

      expect(() => {
        const wrapper = mountComponent();
        wrapper.vm.toggleDarkMode();
      }).not.toThrow();
    });

    it('should default to light theme when localStorage throws error', () => {
      localStorageMock.getItem.mockImplementation(() => {
        throw new Error('localStorage not available');
      });

      const wrapper = mountComponent();
      expect(wrapper.vm.darkMode).toBe(false);
    });

    it('should continue to work when localStorage.setItem fails', () => {
      localStorageMock.getItem.mockReturnValue('light');
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('localStorage not available');
      });

      const wrapper = mountComponent();
      wrapper.vm.toggleDarkMode();
      
      // Should still update the theme even if localStorage fails
      expect(wrapper.vm.darkMode).toBe(true);
    });
  });

  describe('normal operation', () => {
    it('should load saved theme from localStorage', () => {
      localStorageMock.getItem.mockReturnValue('dark');
      
      const wrapper = mountComponent();
      expect(wrapper.vm.darkMode).toBe(true);
    });

    it('should default to light theme when no saved theme', () => {
      localStorageMock.getItem.mockReturnValue(null);
      
      const wrapper = mountComponent();
      expect(wrapper.vm.darkMode).toBe(false);
    });

    it('should toggle theme correctly', () => {
      localStorageMock.getItem.mockReturnValue('light');
      
      const wrapper = mountComponent();
      const initialMode = wrapper.vm.darkMode;
      
      wrapper.vm.toggleDarkMode();
      expect(wrapper.vm.darkMode).toBe(!initialMode);
    });

    it('should save theme to localStorage when changed', async () => {
      localStorageMock.getItem.mockReturnValue('light');
      
      const wrapper = mountComponent();
      // Clear the initial setItem call from onMounted
      localStorageMock.setItem.mockClear();
      
      wrapper.vm.toggleDarkMode();
      
      // Wait for Vue's reactivity to process
      await wrapper.vm.$nextTick();
      
      expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'dark');
    });
  });
});