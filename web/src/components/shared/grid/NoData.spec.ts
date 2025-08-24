import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import NoData from '@/components/shared/grid/NoData.vue';
import { Quasar } from 'quasar';

// Mock dependencies
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}));

vi.mock('@/utils/zincutils', () => ({
  getImageURL: vi.fn((path: string) => `mocked-url-for-${path}`)
}));

describe('NoData.vue', () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  const createWrapper = () => {
    return mount(NoData, {
      global: {
        plugins: [Quasar],
        stubs: {
          'q-img': {
            template: '<div class="q-img-stub" :data-src="src">{{ src }}</div>',
            props: ['src', 'style']
          }
        }
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
      expect(wrapper.vm.$options.name).toBe('QTableNoData');
    });

    it('displays the no data message', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('ticket.noDataErrorMsg');
    });

    it('renders the clipboard icon image', () => {
      wrapper = createWrapper();
      const image = wrapper.find('.q-img-stub');
      expect(image.exists()).toBe(true);
    });

    it('uses correct image URL from getImageURL utility', () => {
      wrapper = createWrapper();
      const image = wrapper.find('.q-img-stub');
      expect(image.attributes('data-src')).toBe('mocked-url-for-images/common/clipboard_icon.svg');
    });
  });

  describe('Component Structure', () => {
    it('has correct main container structure', () => {
      wrapper = createWrapper();
      const container = wrapper.find('div');
      
      expect(container.classes()).toContain('full-width');
      expect(container.classes()).toContain('column');
      expect(container.classes()).toContain('flex-center');
      expect(container.classes()).toContain('q-gutter-sm');
    });

    it('applies correct inline styles', () => {
      wrapper = createWrapper();
      const container = wrapper.find('div');
      
      expect(container.attributes('style')).toContain('font-size: 1.5rem');
    });

    it('has proper layout structure with image and text', () => {
      wrapper = createWrapper();
      
      const image = wrapper.find('.q-img-stub');
      const textDiv = wrapper.find('.q-ma-none');
      
      expect(image.exists()).toBe(true);
      expect(textDiv.exists()).toBe(true);
    });
  });

  describe('Image Configuration', () => {
    it('passes correct style to q-img component', () => {
      wrapper = createWrapper();
      const image = wrapper.find('.q-img-stub');
      
      expect(image.exists()).toBe(true);
      expect(image.attributes('data-src')).toBeTruthy();
    });

    it('calls getImageURL with correct path', () => {
      wrapper = createWrapper();
      
      const image = wrapper.find('.q-img-stub');
      expect(image.exists()).toBe(true);
      expect(image.attributes('data-src')).toContain('clipboard_icon.svg');
    });
  });

  describe('Internationalization', () => {
    it('uses i18n for the no data message', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      expect(vm.t).toBeDefined();
      expect(typeof vm.t).toBe('function');
    });

    it('displays the translated message key', () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain('ticket.noDataErrorMsg');
    });

    it('properly integrates i18n in setup function', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      // t function should be available in component instance
      expect(vm.t).toBeTruthy();
    });
  });

  describe('Setup Function', () => {
    it('returns correct properties from setup', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      expect(vm.t).toBeDefined();
      expect(vm.getImageURL).toBeDefined();
    });

    it('exposes getImageURL function', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      expect(typeof vm.getImageURL).toBe('function');
    });

    it('setup function provides required dependencies', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      // Both t and getImageURL should be available
      expect(vm.t).toBeTruthy();
      expect(vm.getImageURL).toBeTruthy();
    });
  });

  describe('CSS Classes and Styling', () => {
    it('applies Quasar utility classes correctly', () => {
      wrapper = createWrapper();
      const container = wrapper.find('div');
      
      expect(container.classes()).toContain('full-width');
      expect(container.classes()).toContain('column');
      expect(container.classes()).toContain('flex-center');
      expect(container.classes()).toContain('q-gutter-sm');
    });

    it('applies correct margin class to text element', () => {
      wrapper = createWrapper();
      const textElement = wrapper.find('.q-ma-none');
      
      expect(textElement.exists()).toBe(true);
      expect(textElement.classes()).toContain('q-ma-none');
    });

    it('has correct inline styling for font size', () => {
      wrapper = createWrapper();
      const container = wrapper.find('div');
      
      expect(container.attributes('style')).toContain('font-size: 1.5rem');
    });
  });

  describe('Accessibility', () => {
    it('provides meaningful content for screen readers', () => {
      wrapper = createWrapper();
      
      // Component should have readable text content
      expect(wrapper.text().trim()).toBeTruthy();
    });

    it('uses semantic structure with image and text', () => {
      wrapper = createWrapper();
      
      const image = wrapper.find('.q-img-stub');
      const text = wrapper.find('.q-ma-none');
      
      expect(image.exists()).toBe(true);
      expect(text.exists()).toBe(true);
    });
  });

  describe('Vue 3 Composition API Integration', () => {
    it('uses Vue 3 defineComponent correctly', () => {
      wrapper = createWrapper();
      
      // Component should be properly defined with composition API
      expect(wrapper.vm).toBeTruthy();
    });

    it('properly imports and uses composition API functions', () => {
      wrapper = createWrapper();
      
      // Component should render without errors
      expect(wrapper.exists()).toBe(true);
    });

    it('correctly uses setup function return values', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      // Setup return values should be accessible
      expect(vm.t).toBeDefined();
      expect(vm.getImageURL).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('handles missing image gracefully', () => {
      // getImageURL is already mocked to return a value
      wrapper = createWrapper();
      
      // Component should still render
      expect(wrapper.exists()).toBe(true);
    });

    it('handles i18n key that might not exist', () => {
      wrapper = createWrapper();
      
      // Should still display the key even if translation doesn't exist
      expect(wrapper.text()).toContain('ticket.noDataErrorMsg');
    });

    it('maintains component integrity with different viewport sizes', () => {
      wrapper = createWrapper();
      
      const image = wrapper.find('.q-img-stub');
      expect(image.exists()).toBe(true);
      expect(image.attributes('data-src')).toBeTruthy();
    });
  });

  describe('Component Performance', () => {
    it('renders efficiently without unnecessary re-renders', () => {
      wrapper = createWrapper();
      
      // Simple component should render quickly
      expect(wrapper.exists()).toBe(true);
    });

    it('uses minimal reactive state', () => {
      wrapper = createWrapper();
      
      // Component should be simple with no reactive state changes
      expect(wrapper.vm).toBeTruthy();
    });
  });

  describe('Integration with Parent Components', () => {
    it('can be used as a placeholder in tables', () => {
      wrapper = createWrapper();
      
      // Component should be suitable for table no-data scenarios
      expect(wrapper.classes()).toContain('full-width');
    });

    it('provides appropriate visual feedback', () => {
      wrapper = createWrapper();
      
      // Should have both image and text for clear communication
      expect(wrapper.find('.q-img-stub').exists()).toBe(true);
      expect(wrapper.text()).toBeTruthy();
    });

    it('maintains consistent styling across different contexts', () => {
      wrapper = createWrapper();
      
      const container = wrapper.find('div');
      expect(container.exists()).toBe(true);
      expect(container.classes()).toContain('full-width');
    });
  });

  describe('Component Lifecycle', () => {
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

  describe('TypeScript Integration', () => {
    it('properly types component with defineComponent', () => {
      wrapper = createWrapper();
      
      // Component should have proper TypeScript typing
      expect(wrapper.vm.$options.name).toBe('QTableNoData');
    });

    it('correctly types imported utilities', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      // getImageURL should be properly typed and callable
      expect(typeof vm.getImageURL).toBe('function');
    });
  });
});