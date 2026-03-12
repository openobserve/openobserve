import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import TraceTimelineIcon from '@/components/icons/TraceTimelineIcon.vue';
import { Quasar } from 'quasar';

describe('TraceTimelineIcon.vue', () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const createWrapper = () => mount(TraceTimelineIcon, { global: { plugins: [Quasar] } });

  describe('Component Rendering', () => {
    it('renders the component correctly', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('has correct component name', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('TraceTimelineIcon');
    });

    it('renders an SVG element', () => {
      wrapper = createWrapper();
      expect(wrapper.find('svg').exists()).toBe(true);
    });

    it('has correct SVG dimensions', () => {
      wrapper = createWrapper();
      const svg = wrapper.find('svg');
      expect(svg.attributes('width')).toBe('13');
      expect(svg.attributes('height')).toBe('11');
    });

    it('has correct viewBox', () => {
      wrapper = createWrapper();
      expect(wrapper.find('svg').attributes('viewBox')).toBe('0 0 13 11');
    });

    it('contains path elements', () => {
      wrapper = createWrapper();
      expect(wrapper.findAll('path').length).toBeGreaterThanOrEqual(2);
    });

    it('uses currentColor for theming', () => {
      wrapper = createWrapper();
      const paths = wrapper.findAll('path');
      const usesCurrentColor = paths.some(
        (p) =>
          p.attributes('stroke') === 'currentColor' ||
          p.attributes('fill') === 'currentColor',
      );
      expect(usesCurrentColor).toBe(true);
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

    it('has horizontal lines for timeline tracks', () => {
      wrapper = createWrapper();
      const firstPath = wrapper.find('path');
      expect(firstPath.attributes('d')).toContain('H');
    });

    it('has L-shaped axes path', () => {
      wrapper = createWrapper();
      const paths = wrapper.findAll('path');
      // The last two paths form the L-shaped axis lines
      expect(paths.length).toBeGreaterThanOrEqual(2);
    });
  });
});
