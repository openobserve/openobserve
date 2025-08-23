import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import DescSort from '@/components/icons/DescSort.vue';
import { Quasar } from 'quasar';

describe('DescSort.vue', () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = () => {
    return mount(DescSort, {
      global: {
        plugins: [Quasar]
      }
    });
  };

  describe('Component Rendering', () => {
    it('renders the component correctly', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('has correct component name', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('DescSort');
    });

    it('renders SVG element', () => {
      wrapper = createWrapper();
      const svg = wrapper.find('svg');
      expect(svg.exists()).toBe(true);
    });

    it('has correct SVG attributes', () => {
      wrapper = createWrapper();
      const svg = wrapper.find('svg');
      
      expect(svg.attributes('xmlns')).toBe('http://www.w3.org/2000/svg');
      expect(svg.attributes('width')).toBe('20');
      expect(svg.attributes('height')).toBe('20');
      expect(svg.attributes('viewBox')).toBe('0 0 24 24');
    });

    it('contains path element with fill attribute', () => {
      wrapper = createWrapper();
      const path = wrapper.find('path');
      
      expect(path.exists()).toBe(true);
      expect(path.attributes('fill')).toBe('currentColor');
    });

    it('has correct path data for descending sort icon', () => {
      wrapper = createWrapper();
      const path = wrapper.find('path');
      
      expect(path.attributes('d')).toBe('M19 7h3l-4-4l-4 4h3v14h2m-8-8v2l-3.33 4H11v2H5v-2l3.33-4H5v-2M9 3H7c-1.1 0-2 .9-2 2v6h2V9h2v2h2V5a2 2 0 0 0-2-2m0 4H7V5h2Z');
    });
  });

  describe('Component Structure', () => {
    it('is a simple SVG icon component', () => {
      wrapper = createWrapper();
      
      expect(wrapper.element.tagName).toBe('svg');
      expect(wrapper.find('path').exists()).toBe(true);
    });

    it('uses currentColor for dynamic styling', () => {
      wrapper = createWrapper();
      const path = wrapper.find('path');
      
      expect(path.attributes('fill')).toBe('currentColor');
    });

    it('has proper icon dimensions', () => {
      wrapper = createWrapper();
      const svg = wrapper.find('svg');
      
      expect(svg.attributes('width')).toBe('20');
      expect(svg.attributes('height')).toBe('20');
    });
  });

  describe('Vue 3 Integration', () => {
    it('uses defineComponent correctly', () => {
      wrapper = createWrapper();
      expect(wrapper.vm).toBeTruthy();
    });

    it('has no reactive state', () => {
      wrapper = createWrapper();
      
      // Simple icon component should have no reactive data
      expect(wrapper.vm.$data).toEqual({});
    });

    it('mounts without errors', () => {
      expect(() => {
        wrapper = createWrapper();
      }).not.toThrow();
    });

    it('unmounts cleanly', () => {
      wrapper = createWrapper();
      
      expect(() => {
        wrapper.unmount();
      }).not.toThrow();
    });
  });

  describe('Accessibility', () => {
    it('uses semantic SVG structure', () => {
      wrapper = createWrapper();
      
      expect(wrapper.element.tagName).toBe('svg');
      expect(wrapper.element.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
    });

    it('has proper viewBox for scalability', () => {
      wrapper = createWrapper();
      const svg = wrapper.find('svg');
      
      expect(svg.attributes('viewBox')).toBe('0 0 24 24');
    });

    it('supports color inheritance for theming', () => {
      wrapper = createWrapper();
      const path = wrapper.find('path');
      
      expect(path.attributes('fill')).toBe('currentColor');
    });
  });

  describe('Icon Specifics', () => {
    it('represents descending sort functionality', () => {
      wrapper = createWrapper();
      
      // Component name indicates purpose
      expect(wrapper.vm.$options.name).toBe('DescSort');
    });

    it('contains vector path data', () => {
      wrapper = createWrapper();
      const path = wrapper.find('path');
      
      expect(path.attributes('d')).toBeTruthy();
      expect(path.attributes('d')?.length).toBeGreaterThan(0);
    });

    it('is ready for CSS styling', () => {
      wrapper = createWrapper();
      const svg = wrapper.find('svg');
      
      // SVG should accept external styling
      expect(svg.exists()).toBe(true);
      expect(svg.attributes('fill')).toBeUndefined(); // fill is on path, not svg
    });

    it('differs from AscSort in path data', () => {
      wrapper = createWrapper();
      const path = wrapper.find('path');
      
      // Should have different path than ascending sort
      expect(path.attributes('d')).not.toBe('M19 17h3l-4 4l-4-4h3V3h2m-8 10v2l-3.33 4H11v2H5v-2l3.33-4H5v-2M9 3H7c-1.1 0-2 .9-2 2v6h2V9h2v2h2V5a2 2 0 0 0-2-2m0 4H7V5h2Z');
    });
  });

  describe('Component Lifecycle', () => {
    it('renders immediately on mount', () => {
      wrapper = createWrapper();
      
      expect(wrapper.find('svg').exists()).toBe(true);
      expect(wrapper.find('path').exists()).toBe(true);
    });

    it('has no side effects', () => {
      const consoleSpy = vi.spyOn(console, 'warn');
      wrapper = createWrapper();
      
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('Performance', () => {
    it('is a lightweight component', () => {
      wrapper = createWrapper();
      
      // Should only contain SVG and path elements
      expect(wrapper.element.children.length).toBe(1);
      expect(wrapper.element.children[0].tagName).toBe('path');
    });

    it('requires no external dependencies beyond Vue', () => {
      wrapper = createWrapper();
      
      // Simple icon component should work without external libs
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('Comparison with AscSort', () => {
    it('has same structure but different content', () => {
      wrapper = createWrapper();
      
      // Same SVG structure
      expect(wrapper.find('svg').exists()).toBe(true);
      expect(wrapper.find('path').exists()).toBe(true);
      
      // Different component name
      expect(wrapper.vm.$options.name).toBe('DescSort');
    });

    it('maintains consistent icon dimensions', () => {
      wrapper = createWrapper();
      const svg = wrapper.find('svg');
      
      // Same dimensions as AscSort
      expect(svg.attributes('width')).toBe('20');
      expect(svg.attributes('height')).toBe('20');
      expect(svg.attributes('viewBox')).toBe('0 0 24 24');
    });
  });
});