import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import SubTaskArrow from '@/components/icons/SubTaskArrow.vue';
import { Quasar } from 'quasar';

describe('SubTaskArrow.vue', () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const createWrapper = () => mount(SubTaskArrow, { global: { plugins: [Quasar] } });

  describe('Component Rendering', () => {
    it('renders the component correctly', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('has correct component name', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('SubTaskArrow');
    });

    it('renders an SVG element', () => {
      wrapper = createWrapper();
      expect(wrapper.find('svg').exists()).toBe(true);
    });

    it('has correct SVG display dimensions (12x12)', () => {
      wrapper = createWrapper();
      const svg = wrapper.find('svg');
      expect(svg.attributes('width')).toBe('12');
      expect(svg.attributes('height')).toBe('12');
    });

    it('has correct viewBox (0 0 24 24)', () => {
      wrapper = createWrapper();
      expect(wrapper.find('svg').attributes('viewBox')).toBe('0 0 24 24');
    });

    it('has stroke set for drawing lines', () => {
      wrapper = createWrapper();
      const svg = wrapper.find('svg');
      expect(svg.attributes('stroke')).toBeTruthy();
    });

    it('contains path elements for the arrow', () => {
      wrapper = createWrapper();
      expect(wrapper.findAll('path').length).toBeGreaterThanOrEqual(2);
    });

    it('has stroke-linecap set to round', () => {
      wrapper = createWrapper();
      expect(wrapper.find('svg').attributes('stroke-linecap')).toBe('round');
    });

    it('has stroke-linejoin set to round', () => {
      wrapper = createWrapper();
      expect(wrapper.find('svg').attributes('stroke-linejoin')).toBe('round');
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

    it('has curved path for the arrow line', () => {
      wrapper = createWrapper();
      const paths = wrapper.findAll('path');
      const curvedPath = paths.find((p) => p.attributes('d')?.includes('C'));
      expect(curvedPath).toBeTruthy();
    });

    it('has an arrowhead path', () => {
      wrapper = createWrapper();
      const paths = wrapper.findAll('path');
      const arrowheadPath = paths.find((p) => p.attributes('d')?.includes('L20 15'));
      expect(arrowheadPath).toBeTruthy();
    });
  });
});
