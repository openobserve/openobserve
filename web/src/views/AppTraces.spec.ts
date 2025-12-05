import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import AppTraces from './AppTraces.vue';

// Mock zinc-traces component
const ZincTracesMock = {
  name: 'ZincTraces',
  template: '<div class="zinc-traces-mock"></div>',
};

describe('AppTraces.vue', () => {
  it('should render zinc-traces component', () => {
    const wrapper = mount(AppTraces, {
      global: {
        stubs: {
          'zinc-traces': ZincTracesMock,
        },
      },
    });

    expect(wrapper.find('.zinc-traces-mock').exists()).toBe(true);
  });

  it('should mount without errors', () => {
    expect(() => {
      mount(AppTraces, {
        global: {
          stubs: {
            'zinc-traces': ZincTracesMock,
          },
        },
      });
    }).not.toThrow();
  });

  it('should have correct component structure', () => {
    const wrapper = mount(AppTraces, {
      global: {
        stubs: {
          'zinc-traces': ZincTracesMock,
        },
      },
    });

    expect(wrapper.html()).toContain('zinc-traces-mock');
  });
});
