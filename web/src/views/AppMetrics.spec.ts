import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import AppMetrics from './AppMetrics.vue';

// Mock zinc-metrics component
const ZincMetricsMock = {
  name: 'ZincMetrics',
  template: '<div class="zinc-metrics-mock" data-test="zinc-metrics"></div>',
  props: ['pageType'],
};

describe('AppMetrics.vue', () => {
  it('should render zinc-metrics component', () => {
    const wrapper = mount(AppMetrics, {
      global: {
        stubs: {
          'zinc-metrics': ZincMetricsMock,
        },
      },
    });

    expect(wrapper.find('[data-test="zinc-metrics"]').exists()).toBe(true);
  });

  it('should pass pageType prop as "metrics"', () => {
    const wrapper = mount(AppMetrics, {
      global: {
        stubs: {
          'zinc-metrics': ZincMetricsMock,
        },
      },
    });

    const zincMetrics = wrapper.findComponent(ZincMetricsMock);
    expect(zincMetrics.props('pageType')).toBe('metrics');
  });

  it('should mount without errors', () => {
    expect(() => {
      mount(AppMetrics, {
        global: {
          stubs: {
            'zinc-metrics': ZincMetricsMock,
          },
        },
      });
    }).not.toThrow();
  });

  it('should have correct component structure', () => {
    const wrapper = mount(AppMetrics, {
      global: {
        stubs: {
          'zinc-metrics': ZincMetricsMock,
        },
      },
    });

    expect(wrapper.html()).toContain('data-test="zinc-metrics"');
  });
});
