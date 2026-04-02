import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import LeftJoinLineSvg from '@/components/icons/LeftJoinLineSvg.vue';
import { Quasar } from 'quasar';

describe('LeftJoinLineSvg.vue', () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const createWrapper = () => mount(LeftJoinLineSvg, { global: { plugins: [Quasar] } });

  describe('Component Rendering', () => {
    it('renders the component correctly', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('has correct component name', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('LeftJoinLineSvg');
    });

    it('renders an SVG element', () => {
      wrapper = createWrapper();
      expect(wrapper.find('svg').exists()).toBe(true);
    });

    it('has correct SVG dimensions', () => {
      wrapper = createWrapper();
      const svg = wrapper.find('svg');
      expect(svg.attributes('width')).toBe('53');
      expect(svg.attributes('height')).toBe('4');
    });

    it('has correct viewBox', () => {
      wrapper = createWrapper();
      expect(wrapper.find('svg').attributes('viewBox')).toBe('0 0 53 4');
    });

    it('contains a dashed path line', () => {
      wrapper = createWrapper();
      expect(wrapper.find('path').exists()).toBe(true);
    });

    it('path has stroke-dasharray for dashed effect', () => {
      wrapper = createWrapper();
      expect(wrapper.find('path').attributes('stroke-dasharray')).toBe('2 2');
    });

    it('contains an ellipse for the dot', () => {
      wrapper = createWrapper();
      expect(wrapper.find('ellipse').exists()).toBe(true);
    });

    it('ellipse uses currentColor fill', () => {
      wrapper = createWrapper();
      expect(wrapper.find('ellipse').attributes('fill')).toBe('currentColor');
    });
  });

  describe('Vue 3 Integration', () => {
    it('uses defineComponent correctly', () => {
      wrapper = createWrapper();
      expect(wrapper.vm).toBeTruthy();
    });

    it('has no reactive state', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$data).toEqual({});
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

  describe('Icon Specifics', () => {
    it('renders at the SVG root level', () => {
      wrapper = createWrapper();
      expect(wrapper.element.tagName).toBe('svg');
    });

    it('ellipse is at the left side (left join dot)', () => {
      wrapper = createWrapper();
      const ellipse = wrapper.find('ellipse');
      // cx is around 2.68 for left join
      const cx = parseFloat(ellipse.attributes('cx') || '0');
      expect(cx).toBeLessThan(10);
    });
  });
});
