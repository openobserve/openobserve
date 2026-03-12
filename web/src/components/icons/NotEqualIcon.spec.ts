import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import NotEqualIcon from '@/components/icons/NotEqualIcon.vue';
import { Quasar } from 'quasar';

describe('NotEqualIcon.vue', () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const createWrapper = () => mount(NotEqualIcon, { global: { plugins: [Quasar] } });

  describe('Component Rendering', () => {
    it('renders the component correctly', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('has correct component name', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('NotEqualIcon');
    });

    it('renders an SVG element', () => {
      wrapper = createWrapper();
      expect(wrapper.find('svg').exists()).toBe(true);
    });

    it('has correct SVG dimensions', () => {
      wrapper = createWrapper();
      const svg = wrapper.find('svg');
      expect(svg.attributes('width')).toBe('32');
      expect(svg.attributes('height')).toBe('32');
    });

    it('has correct viewBox', () => {
      wrapper = createWrapper();
      expect(wrapper.find('svg').attributes('viewBox')).toBe('0 0 32 32');
    });

    it('contains path elements', () => {
      wrapper = createWrapper();
      expect(wrapper.find('path').exists()).toBe(true);
    });

    it('has two path elements for the not-equal symbol', () => {
      wrapper = createWrapper();
      expect(wrapper.findAll('path').length).toBe(2);
    });

    it('paths use currentColor fill', () => {
      wrapper = createWrapper();
      wrapper.findAll('path').forEach((path) => {
        expect(path.attributes('fill')).toBe('currentColor');
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
    it('is a square icon (32x32)', () => {
      wrapper = createWrapper();
      const svg = wrapper.find('svg');
      expect(svg.attributes('width')).toBe(svg.attributes('height'));
    });

    it('renders at the SVG root level', () => {
      wrapper = createWrapper();
      expect(wrapper.element.tagName).toBe('svg');
    });

    it('has a diagonal slash path indicating negation', () => {
      wrapper = createWrapper();
      const paths = wrapper.findAll('path');
      // One of the paths includes the diagonal slash unique to not-equal
      const hasSlash = paths.some((p) =>
        p.attributes('d')?.includes('21.3061'),
      );
      expect(hasSlash).toBe(true);
    });
  });
});
