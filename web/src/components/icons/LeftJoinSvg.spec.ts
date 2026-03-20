import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import LeftJoinSvg from '@/components/icons/LeftJoinSvg.vue';
import { Quasar } from 'quasar';

describe('LeftJoinSvg.vue', () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const createWrapper = () => mount(LeftJoinSvg, { global: { plugins: [Quasar] } });

  describe('Component Rendering', () => {
    it('renders the component correctly', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('has correct component name', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('LeftJoinSvg');
    });

    it('renders an SVG element', () => {
      wrapper = createWrapper();
      expect(wrapper.find('svg').exists()).toBe(true);
    });

    it('has correct SVG dimensions', () => {
      wrapper = createWrapper();
      const svg = wrapper.find('svg');
      expect(svg.attributes('width')).toBe('20');
      expect(svg.attributes('height')).toBe('12');
    });

    it('has correct viewBox', () => {
      wrapper = createWrapper();
      expect(wrapper.find('svg').attributes('viewBox')).toBe('0 0 20 12');
    });

    it('contains two circle elements', () => {
      wrapper = createWrapper();
      expect(wrapper.findAll('circle').length).toBe(2);
    });

    it('first circle (left/solid) has full opacity', () => {
      wrapper = createWrapper();
      const circles = wrapper.findAll('circle');
      expect(circles[0].attributes('opacity')).toBeFalsy();
    });

    it('second circle (right/faded) has reduced opacity', () => {
      wrapper = createWrapper();
      const circles = wrapper.findAll('circle');
      expect(circles[1].attributes('opacity')).toBe('0.3');
    });

    it('circles use currentColor stroke', () => {
      wrapper = createWrapper();
      wrapper.findAll('circle').forEach((c) => {
        expect(c.attributes('stroke')).toBe('currentColor');
      });
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

    it('left circle (cx=6) is the solid primary circle', () => {
      wrapper = createWrapper();
      const circles = wrapper.findAll('circle');
      expect(circles[0].attributes('cx')).toBe('6');
    });

    it('right circle (cx=14) is the faded secondary circle', () => {
      wrapper = createWrapper();
      const circles = wrapper.findAll('circle');
      expect(circles[1].attributes('cx')).toBe('14');
    });
  });
});
