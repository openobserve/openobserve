import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import ActionScript from './ActionScript.vue';

describe('ActionScript.vue', () => {
  let store: any;
  let i18n: any;

  beforeEach(() => {
    store = createStore({
      state: {
        selectedOrganization: {
          identifier: 'test-org',
        },
      },
    });

    i18n = createI18n({
      legacy: false,
      locale: 'en',
      messages: {
        en: {},
      },
    });
  });

  it('should render RouterView', () => {
    const wrapper = mount(ActionScript, {
      global: {
        plugins: [store, i18n],
        stubs: {
          RouterView: {
            name: 'RouterView',
            template: '<div class="router-view-stub"></div>',
          },
          OPage: {
            name: 'OPage',
            template: '<div data-o2-page data-test="alerts-page"><slot /></div>',
          },
        },
      },
    });

    expect(wrapper.find('.router-view-stub').exists()).toBe(true);
  });

  it('should have correct data-test attribute', () => {
    const wrapper = mount(ActionScript, {
      global: {
        plugins: [store, i18n],
        stubs: {
          RouterView: true,
          OPage: {
            name: 'OPage',
            template: '<div data-o2-page data-test="alerts-page"><slot /></div>',
          },
        },
      },
    });

    expect(wrapper.find('[data-test="alerts-page"]').exists()).toBe(true);
  });

  it('should have q-page wrapper', () => {
    const wrapper = mount(ActionScript, {
      global: {
        plugins: [store, i18n],
        stubs: {
          RouterView: true,
          OPage: {
            name: 'OPage',
            template: '<div data-o2-page><slot /></div>',
          },
        },
      },
    });

    expect(wrapper.find('[data-o2-page]').exists()).toBe(true);
  });

  it('should mount without errors', () => {
    expect(() => {
      mount(ActionScript, {
        global: {
          plugins: [store, i18n],
          stubs: {
            RouterView: true,
            OPage: true,
          },
        },
      });
    }).not.toThrow();
  });

  it('should have access to store', () => {
    const wrapper = mount(ActionScript, {
      global: {
        plugins: [store, i18n],
        stubs: {
          RouterView: true,
          OPage: true,
        },
      },
    });

    expect(wrapper.vm.store).toBeDefined();
    expect(wrapper.vm.store.state.selectedOrganization.identifier).toBe('test-org');
  });

  it('should have access to i18n t function', () => {
    const wrapper = mount(ActionScript, {
      global: {
        plugins: [store, i18n],
        stubs: {
          RouterView: true,
          OPage: true,
        },
      },
    });

    expect(wrapper.vm.t).toBeDefined();
    expect(typeof wrapper.vm.t).toBe('function');
  });
});
