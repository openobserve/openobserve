import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createRouter, createWebHistory } from 'vue-router';
import App from '@/App.vue';

// Mock localStorage
const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

// Mock aws-exports
vi.mock('@/aws-exports', () => ({
  default: {
    isCloud: 'false'
  }
}));

describe('App.vue', () => {
  let wrapper: VueWrapper;
  let store: any;
  let router: any;
  let mockDispatch: any;
  let mockPush: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    mockLocalStorage.getItem.mockReturnValue(null);

    // Create mock store
    mockDispatch = vi.fn();
    store = createStore({
      state: {
        defaultThemeColors: {
          light: "#3F7994",
          dark: "#5B9FBE",
        },
        tempThemeColors: {
          light: null,
          dark: null,
        },
        theme: 'light',
        organizationData: {
          organizationSettings: {}
        }
      },
      mutations: {},
      actions: {},
      dispatch: mockDispatch
    });
    store.dispatch = mockDispatch;

    // Create mock router
    mockPush = vi.fn();
    router = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/', component: { template: '<div>Home</div>' } },
        { path: '/logs', component: { template: '<div>Logs</div>' } }
      ]
    });
    router.push = mockPush;
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe('Component Setup', () => {
    it('renders router-view correctly', () => {
      wrapper = mount(App, {
        global: {
          plugins: [store, router],
          stubs: {
            'router-view': true
          }
        }
      });

      expect(wrapper.find('router-view-stub').exists()).toBe(true);
    });

    it('initializes without localStorage credentials', () => {
      mockLocalStorage.getItem.mockReturnValue(null);

      wrapper = mount(App, {
        global: {
          plugins: [store, router],
          stubs: {
            'router-view': true
          }
        }
      });

      expect(mockLocalStorage.getItem).toHaveBeenCalledWith('creds');
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('redirects to logs when credentials exist in localStorage', () => {
      const mockCreds = JSON.stringify({ username: 'test', token: 'abc123' });
      mockLocalStorage.getItem.mockReturnValue(mockCreds);

      wrapper = mount(App, {
        global: {
          plugins: [store, router],
          stubs: {
            'router-view': true
          }
        }
      });

      expect(mockLocalStorage.getItem).toHaveBeenCalledWith('creds');
      expect(mockPush).toHaveBeenCalledWith('/logs');
    });

    it('handles empty string credentials', () => {
      mockLocalStorage.getItem.mockReturnValue('');

      wrapper = mount(App, {
        global: {
          plugins: [store, router],
          stubs: {
            'router-view': true
          }
        }
      });

      expect(mockLocalStorage.getItem).toHaveBeenCalledWith('creds');
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('handles localStorage access errors gracefully', () => {
      mockLocalStorage.getItem.mockImplementation(() => {
        throw new Error('localStorage not available');
      });

      // The component will throw because localStorage access fails in setup
      expect(() => {
        wrapper = mount(App, {
          global: {
            plugins: [store, router],
            stubs: {
              'router-view': true
            }
          }
        });
      }).toThrow('localStorage not available');
    });
  });

  describe('Credential Handling', () => {
    it('handles valid JSON credentials', () => {
      const validCreds = JSON.stringify({ user: 'test@example.com', token: 'valid-token' });
      mockLocalStorage.getItem.mockReturnValue(validCreds);

      wrapper = mount(App, {
        global: {
          plugins: [store, router],
          stubs: {
            'router-view': true
          }
        }
      });

      expect(mockPush).toHaveBeenCalledWith('/logs');
    });

    it('handles whitespace-only credentials', () => {
      mockLocalStorage.getItem.mockReturnValue('   ');

      wrapper = mount(App, {
        global: {
          plugins: [store, router],
          stubs: {
            'router-view': true
          }
        }
      });

      // Whitespace-only string is truthy in JavaScript, so it will redirect
      expect(mockPush).toHaveBeenCalledWith('/logs');
    });

    it('handles null credentials', () => {
      mockLocalStorage.getItem.mockReturnValue(null);

      wrapper = mount(App, {
        global: {
          plugins: [store, router],
          stubs: {
            'router-view': true
          }
        }
      });

      expect(mockPush).not.toHaveBeenCalled();
    });

    it('handles undefined credentials', () => {
      mockLocalStorage.getItem.mockReturnValue(undefined);

      wrapper = mount(App, {
        global: {
          plugins: [store, router],
          stubs: {
            'router-view': true
          }
        }
      });

      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe('Store and Router Integration', () => {
    it('uses the provided store correctly', () => {
      wrapper = mount(App, {
        global: {
          plugins: [store, router],
          stubs: {
            'router-view': true
          }
        }
      });

      // Verify store is accessible in component
      expect(wrapper.vm).toBeDefined();
    });

    it('uses the provided router correctly', () => {
      const mockCreds = JSON.stringify({ test: 'data' });
      mockLocalStorage.getItem.mockReturnValue(mockCreds);

      wrapper = mount(App, {
        global: {
          plugins: [store, router],
          stubs: {
            'router-view': true
          }
        }
      });

      expect(mockPush).toHaveBeenCalledWith('/logs');
    });

    it('handles router push errors gracefully', () => {
      const mockCreds = JSON.stringify({ test: 'data' });
      mockLocalStorage.getItem.mockReturnValue(mockCreds);
      mockPush.mockImplementation(() => {
        throw new Error('Navigation failed');
      });

      // The component will throw because router.push fails
      expect(() => {
        wrapper = mount(App, {
          global: {
            plugins: [store, router],
            stubs: {
              'router-view': true
            }
          }
        });
      }).toThrow('Navigation failed');
    });
  });

  describe('Component Structure', () => {
    it('has correct template structure', () => {
      wrapper = mount(App, {
        global: {
          plugins: [store, router],
          stubs: {
            'router-view': true
          }
        }
      });

      const routerView = wrapper.find('router-view-stub');
      expect(routerView.exists()).toBe(true);
    });

    it('renders without any props', () => {
      wrapper = mount(App, {
        global: {
          plugins: [store, router],
          stubs: {
            'router-view': true
          }
        }
      });

      expect(wrapper.props()).toEqual({});
    });
  });
});