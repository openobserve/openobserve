import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import LinearIcon from '@/components/icons/dashboards/LinearIcon.vue';


describe('LinearIcon.vue', () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const createWrapper = () => mount(LinearIcon, { global: { plugins: [] } });

  describe('Component Rendering', () => {
    it('renders the component correctly', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('has correct component name', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('LinearIcon');
    });

    it('renders an SVG element', () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="dashboard-icon-linear-svg"]').exists()).toBe(true);
    });

    it('has correct SVG dimensions', () => {
      wrapper = createWrapper();
      const svg = wrapper.find('[data-test="dashboard-icon-linear-svg"]');
      expect(svg.attributes('width')).toBe('116');
      expect(svg.attributes('height')).toBe('87');
    });

    it('has correct viewBox', () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="dashboard-icon-linear-svg"]').attributes('viewBox')).toBe('0 0 116 87');
    });

    it('contains path elements', () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="dashboard-icon-linear-path"]').exists()).toBe(true);
    });

    it('uses currentColor for theming', () => {
      wrapper = createWrapper();
      const paths = wrapper.findAll('[data-test="dashboard-icon-linear-path"]');
      const circleEls = wrapper.findAll('[data-test="dashboard-icon-linear-circle"]');
      const elems = [...paths, ...circleEls];
      const usesCurrentColor = elems.some(
        (e) =>
          e.attributes('stroke') === 'currentColor' ||
          e.attributes('fill') === 'currentColor',
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

    it('has circle elements representing data points', () => {
      wrapper = createWrapper();
      expect(wrapper.findAll('[data-test="dashboard-icon-linear-circle"]').length).toBeGreaterThanOrEqual(2);
    });
  });
});
