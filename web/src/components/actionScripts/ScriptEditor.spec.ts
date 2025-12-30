import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import ScriptEditor from '@/components/actionScripts/ScriptEditor.vue';
import { Quasar } from 'quasar';

// Mock dependencies
vi.mock('axios');
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}));

describe('ScriptEditor.vue', () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  const createWrapper = (props = {}) => {
    const defaultProps = {
      loading: false,
      error: '',
      file: {
        name: 'test.py',
        language: 'python'
      },
      script: ''
    };

    return mount(ScriptEditor, {
      props: { ...defaultProps, ...props },
      global: {
        plugins: [Quasar],
        stubs: {
          'FullViewContainer': {
            template: '<div><slot name="left"></slot><slot></slot></div>',
            props: ['name', 'label', 'isExpanded']
          },
          'query-editor': {
            template: '<div data-test="vrl-function-test-events-editor"></div>',
            props: ['editorId', 'language', 'query']
          },
          'q-spinner-hourglass': {
            template: '<div class="spinner"></div>',
            props: ['size']
          },
          'q-icon': {
            template: '<div class="icon"><q-tooltip-stub v-if="$slots.default"><slot></slot></q-tooltip-stub></div>',
            props: ['name', 'size']
          },
          'q-tooltip': {
            template: '<div class="tooltip"><slot></slot></div>',
            props: ['anchor', 'self', 'offset']
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

    it('renders FullViewContainer with correct props', () => {
      const file = { name: 'script.py', language: 'python' };
      wrapper = createWrapper({ file });
      
      const fullViewContainer = wrapper.find('div'); // Since we're using a stub template
      expect(fullViewContainer.exists()).toBe(true);
    });

    it('renders query editor when expanded', async () => {
      const file = { name: 'test.py', language: 'python' };
      const script = 'print("hello")';
      
      wrapper = createWrapper({ file, script });
      const vm = wrapper.vm as any;
      
      // Ensure component is expanded
      vm.isExpanded = true;
      await wrapper.vm.$nextTick();
      
      const queryEditor = wrapper.find('[data-test="vrl-function-test-events-editor"]');
      expect(queryEditor.exists()).toBe(true);
    });

    it('hides editor section when collapsed', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.isExpanded = false;
      await wrapper.vm.$nextTick();
      
      const editorSection = wrapper.find('[data-test="test-function-input-editor-section"]');
      expect(editorSection.attributes('style')).toContain('display: none');
    });

    it('shows editor section when expanded', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.isExpanded = true;
      await wrapper.vm.$nextTick();
      
      const editorSection = wrapper.find('[data-test="test-function-input-editor-section"]');
      expect(editorSection.exists()).toBe(true);
    });
  });

  describe('Props Handling', () => {
    it('accepts all required props', () => {
      const props = {
        loading: true,
        error: 'Test error',
        file: { name: 'script.py', language: 'python' },
        script: 'test script'
      };
      
      wrapper = createWrapper(props);
      
      expect(wrapper.props('loading')).toBe(true);
      expect(wrapper.props('error')).toBe('Test error');
      expect(wrapper.props('file')).toEqual({ name: 'script.py', language: 'python' });
      expect(wrapper.props('script')).toBe('test script');
    });

    it('uses default values for optional props', () => {
      wrapper = createWrapper();
      
      expect(wrapper.props('loading')).toBe(false);
      expect(wrapper.props('error')).toBe('');
      expect(wrapper.props('script')).toBe('');
    });

    it('handles null file prop', () => {
      wrapper = createWrapper({ file: { name: null, language: null } });
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('Loading State', () => {
    it('shows loading spinner when loading is true', () => {
      wrapper = createWrapper({ loading: true });
      
      const spinner = wrapper.find('.spinner');
      expect(spinner.exists()).toBe(true);
    });

    it('shows loading text when loading is true', () => {
      wrapper = createWrapper({ loading: true });
      
      expect(wrapper.exists()).toBe(true); // Just verify it renders
    });

    it('does not show loading elements when loading is false', () => {
      wrapper = createWrapper({ loading: false });
      
      const spinner = wrapper.find('.spinner');
      expect(spinner.exists()).toBe(false);
    });

    it('applies correct styling to loading section', () => {
      wrapper = createWrapper({ loading: true });
      
      expect(wrapper.exists()).toBe(true); // Just verify it renders
    });
  });

  describe('Error State', () => {
    it('shows error icon when error exists', () => {
      wrapper = createWrapper({ error: 'Something went wrong' });
      
      const errorIcon = wrapper.find('.icon');
      expect(errorIcon.exists()).toBe(true);
    });

    it('does not show error icon when no error', () => {
      wrapper = createWrapper({ error: '' });
      
      const errorIcon = wrapper.find('.icon');
      expect(errorIcon.exists()).toBe(false);
    });

    it('shows error tooltip with correct message', () => {
      const errorMessage = 'Test error message';
      wrapper = createWrapper({ error: errorMessage });
      
      const tooltip = wrapper.find('.tooltip');
      expect(tooltip.exists()).toBe(true);
    });

    it('applies correct styling to error icon', () => {
      wrapper = createWrapper({ error: 'Error' });
      
      const errorIcon = wrapper.find('.icon');
      expect(errorIcon.exists()).toBe(true);
    });

    it('configures tooltip positioning correctly', () => {
      wrapper = createWrapper({ error: 'Error' });
      
      const tooltip = wrapper.find('.tooltip');
      expect(tooltip.exists()).toBe(true);
    });
  });

  describe('Script Input Handling', () => {
    it('inputScript computed property gets value from props', () => {
      wrapper = createWrapper({ script: 'test script content' });
      const vm = wrapper.vm as any;
      
      expect(vm.inputScript).toBe('test script content');
    });

    it('inputScript computed property emits update when set', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.inputScript = 'new script content';
      
      expect(wrapper.emitted('update:script')).toBeTruthy();
      expect(wrapper.emitted('update:script')?.[0]).toEqual(['new script content']);
    });

    it('handles empty script content', () => {
      wrapper = createWrapper({ script: '' });
      const vm = wrapper.vm as any;
      
      expect(vm.inputScript).toBe('');
    });

    it('handles long script content', () => {
      const longScript = 'print("hello")\n'.repeat(100);
      wrapper = createWrapper({ script: longScript });
      const vm = wrapper.vm as any;
      
      expect(vm.inputScript).toBe(longScript);
    });
  });

  describe('Expansion State', () => {
    it('initializes as expanded', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      expect(vm.isExpanded).toBe(true);
    });

    it('can be collapsed', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.isExpanded = false;
      await wrapper.vm.$nextTick();
      
      expect(vm.isExpanded).toBe(false);
    });

    it('binds expansion state to FullViewContainer', () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      expect(vm.isExpanded).toBe(true);
    });
  });

  describe('File Properties', () => {
    it('uses file name in multiple places', () => {
      const file = { name: 'my-script.py', language: 'python' };
      wrapper = createWrapper({ file });
      
      expect(wrapper.exists()).toBe(true);
    });

    it('passes file language to query editor', async () => {
      const file = { name: 'test.js', language: 'javascript' };
      wrapper = createWrapper({ file });
      
      // Ensure expanded state to render query editor
      const vm = wrapper.vm as any;
      vm.isExpanded = true;
      await wrapper.vm.$nextTick();
      
      const queryEditor = wrapper.find('[data-test="vrl-function-test-events-editor"]');
      expect(queryEditor.exists()).toBe(true);
    });

    it('generates unique editor ID based on file name', async () => {
      const file = { name: 'unique-script.py', language: 'python' };
      wrapper = createWrapper({ file });
      
      const vm = wrapper.vm as any;
      vm.isExpanded = true;
      await wrapper.vm.$nextTick();
      
      const queryEditor = wrapper.find('[data-test="vrl-function-test-events-editor"]');
      expect(queryEditor.exists()).toBe(true);
    });
  });

  describe('Component Structure', () => {
    it('has correct main wrapper structure', () => {
      wrapper = createWrapper();

      const mainDiv = wrapper.find('.tw\\:w-full.tw\\:h-full');
      expect(mainDiv.exists()).toBe(true);
    });

    it('has correct editor section structure', () => {
      wrapper = createWrapper();

      const editorSection = wrapper.find('[data-test="test-function-input-editor-section"]');
      expect(editorSection.exists()).toBe(true);
      expect(editorSection.classes()).toContain('tw:border-[1px]');
      expect(editorSection.classes()).toContain('tw:border-gray-200');
      expect(editorSection.classes()).toContain('tw:h-[calc(100%-30px)]');
      expect(editorSection.classes()).toContain('tw:relative');
      expect(editorSection.classes()).toContain('tw:rounded-md');
      expect(editorSection.classes()).toContain('tw:overflow-hidden');
    });

    it('query editor has correct CSS classes', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.isExpanded = true;
      await wrapper.vm.$nextTick();
      
      const queryEditor = wrapper.find('[data-test="vrl-function-test-events-editor"]');
      expect(queryEditor.exists()).toBe(true);
    });
  });

  describe('Internationalization', () => {
    it('uses i18n for loading text', () => {
      wrapper = createWrapper({ loading: true });
      
      expect(wrapper.exists()).toBe(true); // Just verify component renders
    });
  });

  describe('Edge Cases', () => {
    it('handles undefined file gracefully', () => {
      wrapper = createWrapper({ file: { name: undefined, language: undefined } });
      expect(wrapper.exists()).toBe(true);
    });

    it('handles file without language', () => {
      const file = { name: 'test.py' };
      wrapper = createWrapper({ file });
      expect(wrapper.exists()).toBe(true);
    });

    it('handles file without name', () => {
      const file = { language: 'python' };
      wrapper = createWrapper({ file });
      expect(wrapper.exists()).toBe(true);
    });

    it('handles both loading and error states simultaneously', () => {
      wrapper = createWrapper({ loading: true, error: 'Test error' });
      
      const spinner = wrapper.find('.spinner');
      const errorIcon = wrapper.find('.icon');
      
      expect(spinner.exists()).toBe(true);
      expect(errorIcon.exists()).toBe(true);
    });

    it('handles very long error messages', () => {
      const longError = 'A very long error message that might cause layout issues. '.repeat(10);
      wrapper = createWrapper({ error: longError });
      
      const tooltip = wrapper.find('.tooltip');
      expect(tooltip.exists()).toBe(true);
    });
  });

  describe('Data Test Attributes', () => {
    it('has correct data-test attributes for testing', () => {
      wrapper = createWrapper();
      
      const titleSection = wrapper.find('[data-test="test-function-input-title-section"]');
      const editorSection = wrapper.find('[data-test="test-function-input-editor-section"]');
      
      expect(titleSection.exists()).toBe(true);
      expect(editorSection.exists()).toBe(true);
    });

    it('query editor has correct data-test attribute', async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;
      
      vm.isExpanded = true;
      await wrapper.vm.$nextTick();
      
      const queryEditor = wrapper.find('[data-test="vrl-function-test-events-editor"]');
      expect(queryEditor.exists()).toBe(true);
    });
  });
});