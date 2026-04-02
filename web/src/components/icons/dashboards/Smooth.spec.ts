import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import Smooth from '@/components/icons/dashboards/Smooth.vue';
import { Quasar } from 'quasar';

describe('Smooth.vue', () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const createWrapper = () => mount(Smooth, { global: { plugins: [Quasar] } });

  describe('Component Rendering', () => {
    it('renders the component correctly', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('has correct component name', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('Smooth');
    });

    it('renders an SVG element', () => {
      wrapper = createWrapper();
      expect(wrapper.find('svg').exists()).toBe(true);
    });

    it('has correct SVG dimensions', () => {
      wrapper = createWrapper();
      const svg = wrapper.find('svg');
      expect(svg.attributes('width')).toBe('132');
      expect(svg.attributes('height')).toBe('84');
    });

    it('has correct viewBox', () => {
      wrapper = createWrapper();
      expect(wrapper.find('svg').attributes('viewBox')).toBe('0 0 132 84');
    });

    it('contains a path element for the curve', () => {
      wrapper = createWrapper();
      expect(wrapper.find('path').exists()).toBe(true);
    });

    it('path uses currentColor stroke', () => {
      wrapper = createWrapper();
      expect(wrapper.find('path').attributes('stroke')).toBe('currentColor');
    });

    it('path has curved data (C command)', () => {
      wrapper = createWrapper();
      expect(wrapper.find('path').attributes('d')).toContain('C');
    });

    it('contains circle elements for data points', () => {
      wrapper = createWrapper();
      expect(wrapper.findAll('circle').length).toBeGreaterThanOrEqual(2);
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

    it('has xmlns attribute', () => {
      wrapper = createWrapper();
      expect(wrapper.find('svg').attributes('xmlns')).toBe('http://www.w3.org/2000/svg');
    });
  });
});
