import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import RightJoinTypeSvg from '@/components/icons/RightJoinTypeSvg.vue';
import { Quasar } from 'quasar';

describe('RightJoinTypeSvg.vue', () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const createWrapper = (props = {}) =>
    mount(RightJoinTypeSvg, { global: { plugins: [Quasar] }, props });

  describe('Component Rendering', () => {
    it('renders the component correctly', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('has correct component name', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('RightJoinTypeSvg');
    });

    it('renders an SVG element', () => {
      wrapper = createWrapper();
      expect(wrapper.find('svg').exists()).toBe(true);
    });

    it('has correct SVG dimensions', () => {
      wrapper = createWrapper();
      const svg = wrapper.find('svg');
      expect(svg.attributes('width')).toBe('25');
      expect(svg.attributes('height')).toBe('24');
    });

    it('has correct viewBox', () => {
      wrapper = createWrapper();
      expect(wrapper.find('svg').attributes('viewBox')).toBe('0 0 25 24');
    });

    it('contains the join path element', () => {
      wrapper = createWrapper();
      expect(wrapper.find('path').exists()).toBe(true);
    });

    it('path uses currentColor', () => {
      wrapper = createWrapper();
      expect(wrapper.find('path').attributes('fill')).toBe('currentColor');
    });
  });

  describe('shouldFill prop', () => {
    it('defaults shouldFill to false', () => {
      wrapper = createWrapper();
      expect(wrapper.props('shouldFill')).toBe(false);
    });

    it('does NOT render background rect when shouldFill is false', () => {
      wrapper = createWrapper({ shouldFill: false });
      expect(wrapper.find('rect').exists()).toBe(false);
    });

    it('renders background rect when shouldFill is true', () => {
      wrapper = createWrapper({ shouldFill: true });
      expect(wrapper.find('rect').exists()).toBe(true);
    });

    it('rect has correct fill color when shouldFill is true', () => {
      wrapper = createWrapper({ shouldFill: true });
      expect(wrapper.find('rect').attributes('fill')).toBe('#6571BD');
    });

    it('rect has correct fill-opacity', () => {
      wrapper = createWrapper({ shouldFill: true });
      expect(wrapper.find('rect').attributes('fill-opacity')).toBe('0.12');
    });

    it('rect has correct dimensions', () => {
      wrapper = createWrapper({ shouldFill: true });
      const rect = wrapper.find('rect');
      expect(rect.attributes('width')).toBe('24');
      expect(rect.attributes('height')).toBe('24');
    });

    it('rect has rx=2 for rounded corners', () => {
      wrapper = createWrapper({ shouldFill: true });
      expect(wrapper.find('rect').attributes('rx')).toBe('2');
    });
  });

  describe('Vue 3 Integration', () => {
    it('uses defineComponent correctly', () => {
      wrapper = createWrapper();
      expect(wrapper.vm).toBeTruthy();
    });

    it('mounts without errors', () => {
      expect(() => { wrapper = createWrapper(); }).not.toThrow();
    });

    it('unmounts cleanly', () => {
      wrapper = createWrapper();
      expect(() => { wrapper.unmount(); }).not.toThrow();
    });

    it('has no side effects on mount', () => {
      const spy = vi.spyOn(console, 'warn');
      wrapper = createWrapper();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });
});
