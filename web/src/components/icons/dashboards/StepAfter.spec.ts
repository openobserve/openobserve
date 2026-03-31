import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import StepAfter from '@/components/icons/dashboards/StepAfter.vue';
import { Quasar } from 'quasar';

describe('StepAfter.vue', () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const createWrapper = () => mount(StepAfter, { global: { plugins: [Quasar] } });

  describe('Component Rendering', () => {
    it('renders the component correctly', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('has correct component name', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('StepAfter');
    });

    it('renders an SVG element', () => {
      wrapper = createWrapper();
      expect(wrapper.find('svg').exists()).toBe(true);
    });

    it('has correct SVG dimensions', () => {
      wrapper = createWrapper();
      const svg = wrapper.find('svg');
      expect(svg.attributes('width')).toBe('91');
      expect(svg.attributes('height')).toBe('83');
    });

    it('has correct viewBox', () => {
      wrapper = createWrapper();
      expect(wrapper.find('svg').attributes('viewBox')).toBe('0 0 91 83');
    });

    it('contains a path element for the step line', () => {
      wrapper = createWrapper();
      expect(wrapper.find('path').exists()).toBe(true);
    });

    it('path uses currentColor stroke', () => {
      wrapper = createWrapper();
      expect(wrapper.find('path').attributes('stroke')).toBe('currentColor');
    });

    it('path has vertical (V) steps', () => {
      wrapper = createWrapper();
      expect(wrapper.find('path').attributes('d')).toContain('V');
    });

    it('has 3 circle elements for data points', () => {
      wrapper = createWrapper();
      expect(wrapper.findAll('circle').length).toBe(3);
    });

    it('circles use currentColor fill', () => {
      wrapper = createWrapper();
      wrapper.findAll('circle').forEach((c) => {
        expect(c.attributes('fill')).toBe('currentColor');
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
});
