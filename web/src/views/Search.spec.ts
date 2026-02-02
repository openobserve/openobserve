import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import Search from './Search.vue';

// Mock zinc-logs component
const ZincLogsMock = {
  name: 'ZincLogs',
  template: '<div class="zinc-logs-mock"></div>',
};

describe('Search.vue', () => {
  it('should render zinc-logs component', () => {
    const wrapper = mount(Search, {
      global: {
        stubs: {
          'zinc-logs': ZincLogsMock,
        },
      },
    });

    expect(wrapper.find('.zinc-logs-mock').exists()).toBe(true);
  });

  it('should mount without errors', () => {
    expect(() => {
      mount(Search, {
        global: {
          stubs: {
            'zinc-logs': ZincLogsMock,
          },
        },
      });
    }).not.toThrow();
  });

  it('should have correct component structure', () => {
    const wrapper = mount(Search, {
      global: {
        stubs: {
          'zinc-logs': ZincLogsMock,
        },
      },
    });

    expect(wrapper.html()).toContain('zinc-logs-mock');
  });
});
