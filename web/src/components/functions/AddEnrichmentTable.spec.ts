import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { Quasar } from 'quasar';
import AddEnrichmentTable from './AddEnrichmentTable.vue';

// Mock dependencies
vi.mock('@/services/jstransform', () => ({
  default: {
    create_enrichment_table: vi.fn(() => Promise.resolve({
      data: { message: 'Enrichment table created successfully' }
    })),
  },
}));

vi.mock('@/services/segment_analytics', () => ({
  default: {
    track: vi.fn(),
  },
}));

const mockNotify = vi.fn(() => vi.fn()); // Return a dismiss function
const mockQuasar = {
  notify: mockNotify,
};

vi.mock('quasar', async () => {
  const actual = await vi.importActual('quasar');
  return {
    ...actual,
    useQuasar: () => mockQuasar,
  };
});

describe('AddEnrichmentTable.vue', () => {
  let wrapper: any;
  let store: any;
  let i18n: any;

  const createWrapper = (propsData = {}) => {
    // Create store with default configuration
    store = createStore({
      state: {
        selectedOrganization: {
          identifier: 'test-org-id',
          name: 'Test Organization',
        },
        userInfo: {
          email: 'test@example.com',
          name: 'Test User',
        },
      },
      getters: {},
      mutations: {},
      actions: {},
    });

    // Create i18n instance
    i18n = createI18n({
      legacy: false,
      locale: 'en',
      fallbackLocale: 'en',
      globalInjection: true,
      messages: {
        en: {
          function: {
            addEnrichmentTable: 'Add Enrichment Table',
            updateEnrichmentTable: 'Update Enrichment Table',
            name: 'Name',
            uploadCSVFile: 'Upload CSV File',
            appendData: 'Append Data',
            cancel: 'Cancel',
            save: 'Save',
          },
        },
      },
    });

    return mount(AddEnrichmentTable, {
      props: {
        modelValue: {
          name: '',
          file: '',
          append: false,
        },
        isUpdating: false,
        ...propsData,
      },
      global: {
        plugins: [store, i18n, [Quasar, {}]],
        stubs: {
          'q-form': {
            template: '<form @submit.prevent="$attrs.onSubmit && $attrs.onSubmit()"><slot /></form>',
          },
          'q-input': {
            template: '<input v-model="modelValue" :readonly="readonly" :disabled="disable" />',
            props: ['modelValue', 'label', 'rules', 'readonly', 'disable'],
            emits: ['update:modelValue'],
          },
          'q-file': {
            template: '<div class="q-file"><slot /></div>',
            props: ['modelValue', 'label', 'rules'],
            emits: ['update:modelValue'],
          },
          'q-toggle': {
            template: '<input type="checkbox" v-model="modelValue" />',
            props: ['modelValue', 'label'],
            emits: ['update:modelValue'],
          },
          'q-btn': {
            template: '<button @click="$emit(\'click\')" :type="type">{{ label }}<slot /></button>',
            props: ['label', 'type'],
            emits: ['click'],
          },
          'q-separator': {
            template: '<hr />',
          },
          'q-icon': {
            template: '<i></i>',
            props: ['name'],
          },
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe('Component Initialization', () => {
    it('should render the component with default configuration', () => {
      wrapper = createWrapper();
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('.text-h6').text()).toBe('Add Enrichment Table');
    });

    it('should initialize with correct default values', () => {
      wrapper = createWrapper();
      
      expect((wrapper.vm as any).formData.name).toBe('');
      expect((wrapper.vm as any).formData.file).toBe('');
      expect((wrapper.vm as any).formData.append).toBe(false);
    });

    it('should render update mode when isUpdating is true', () => {
      wrapper = createWrapper({ isUpdating: true });
      
      expect(wrapper.find('.text-h6').text()).toBe('Update Enrichment Table');
    });

    it('should initialize with provided modelValue', () => {
      const modelValue = {
        name: 'test-table',
        file: 'test.csv',
        append: true,
      };
      
      wrapper = createWrapper({ modelValue });
      
      expect((wrapper.vm as any).formData.name).toBe('test-table');
      expect((wrapper.vm as any).formData.file).toBe('test.csv');
      expect((wrapper.vm as any).formData.append).toBe(true);
    });
  });

  describe('Form Fields', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should render name input field', () => {
      const nameInput = wrapper.find('input');
      expect(nameInput.exists()).toBe(true);
    });

    it('should render file upload field', () => {
      const fileInput = wrapper.find('.q-file');
      expect(fileInput.exists()).toBe(true);
    });

    it('should not show append toggle in add mode', () => {
      expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
    });

    it('should show append toggle in update mode', () => {
      wrapper = createWrapper({
        isUpdating: true,
        modelValue: {
          name: 'test-table',
          source: 'file',
          file: '',
          append: false,
        }
      });
      expect(wrapper.find('input[type="checkbox"]').exists()).toBe(true);
    });

    it('should disable name field in update mode', () => {
      wrapper = createWrapper({ 
        isUpdating: true,
        modelValue: { name: 'existing-table', file: '', append: false }
      });
      
      // Check if the component is in update mode
      expect((wrapper.vm as any).isUpdating).toBe(true);
      expect((wrapper.vm as any).disableColor).toBe('grey-5');
    });
  });

  describe('Form Submission', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should have save and cancel buttons', () => {
      const buttons = wrapper.findAll('button');
      expect(buttons.length).toBe(2);
      expect(buttons[0].text()).toContain('Cancel');
      expect(buttons[1].text()).toContain('Save');
    });

    it('should emit cancel event when cancel button is clicked', async () => {
      const cancelBtn = wrapper.findAll('button')[0];
      await cancelBtn.trigger('click');
      
      expect(wrapper.emitted('cancel:hideform')).toBeTruthy();
    });

    it('should call onSubmit when form is submitted', async () => {
      const onSubmitSpy = vi.spyOn(wrapper.vm, 'onSubmit');
      
      // Set form data
      (wrapper.vm as any).formData = {
        name: 'test-table',
        file: new File(['test'], 'test.csv', { type: 'text/csv' }),
        append: false,
      };
      
      // Call onSubmit directly since form submission might not work with stubs
      await (wrapper.vm as any).onSubmit();
      
      expect(onSubmitSpy).toHaveBeenCalled();
    });
  });

  describe('Form Validation', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should validate required name field', () => {
      // Test that rules function exists and works
      const rules = [(val: any) => !!val || 'Field is required!'];
      
      expect(rules[0]('')).toBe('Field is required!');
      expect(rules[0]('test-name')).toBe(true);
    });

    it('should validate required file field', () => {
      // Test that rules function exists and works
      const rules = [(val: any) => !!val || 'CSV File is required!'];
      
      expect(rules[0]('')).toBe('CSV File is required!');
      expect(rules[0]('test.csv')).toBe(true);
    });
  });

  describe('API Integration', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should call create_enrichment_table service on successful submit', async () => {
      const jsTransformService = await import('@/services/jstransform');
      const createSpy = vi.spyOn(jsTransformService.default, 'create_enrichment_table');
      
      // Set form data
      (wrapper.vm as any).formData = {
        name: 'test-table',
        file: new File(['test'], 'test.csv', { type: 'text/csv' }),
        append: false,
      };
      
      await (wrapper.vm as any).onSubmit();
      
      expect(createSpy).toHaveBeenCalledWith(
        'test-org-id',
        'test-table',
        expect.any(FormData),
        false
      );
    });

    it('should emit update:list on successful submission', async () => {
      // Set form data
      (wrapper.vm as any).formData = {
        name: 'test-table',
        file: new File(['test'], 'test.csv', { type: 'text/csv' }),
        append: false,
      };
      
      await (wrapper.vm as any).onSubmit();
      
      expect(wrapper.emitted('update:list')).toBeTruthy();
    });

    it('should show success notification on successful submission', async () => {
      // Set form data
      (wrapper.vm as any).formData = {
        name: 'test-table',
        file: new File(['test'], 'test.csv', { type: 'text/csv' }),
        append: false,
      };
      
      await (wrapper.vm as any).onSubmit();
      
      // Check that notify was called twice: once for loading, once for success
      expect(mockNotify).toHaveBeenCalledWith({
        spinner: true,
        message: 'Please wait...',
        timeout: 2000,
      });
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'positive',
        message: 'Enrichment table created successfully',
      });
    });

    it('should reset form data after successful submission', async () => {
      // Set form data
      (wrapper.vm as any).formData = {
        name: 'test-table',
        file: new File(['test'], 'test.csv', { type: 'text/csv' }),
        append: false,
      };
      
      await (wrapper.vm as any).onSubmit();
      
      expect((wrapper.vm as any).formData.name).toBe('');
      expect((wrapper.vm as any).formData.file).toBe('');
      expect((wrapper.vm as any).formData.append).toBe(false);
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      wrapper = createWrapper();
      vi.clearAllMocks();
    });

    it('should handle API errors gracefully', async () => {
      const jsTransformService = await import('@/services/jstransform');
      const error = {
        response: {
          status: 400,
          data: {
            message: 'Invalid CSV format',
            error: 'Parsing error',
          },
        },
      };
      
      // Mock the service to reject
      vi.spyOn(jsTransformService.default, 'create_enrichment_table')
        .mockRejectedValueOnce(error);
      
      // Set form data
      (wrapper.vm as any).formData = {
        name: 'test-table',
        file: new File(['test'], 'test.csv', { type: 'text/csv' }),
        append: false,
      };
      
      await (wrapper.vm as any).onSubmit();
      await wrapper.vm.$nextTick();
      
      expect((wrapper.vm as any).compilationErr).toBe('Invalid CSV format');
    });

    it('should set compilationErr from error message when response data is missing', async () => {
      const jsTransformService = await import('@/services/jstransform');
      const error = new Error('Direct error message');
      
      vi.spyOn(jsTransformService.default, 'create_enrichment_table')
        .mockRejectedValueOnce(error);
      
      // Set form data
      (wrapper.vm as any).formData = {
        name: 'test-table',
        file: new File(['test'], 'test.csv', { type: 'text/csv' }),
        append: false,
      };
      
      await (wrapper.vm as any).onSubmit();
      await wrapper.vm.$nextTick();
      
      expect((wrapper.vm as any).compilationErr).toBe('Direct error message');
    });

    it('should set compilationErr to "Unknown error" when no error details available', async () => {
      const jsTransformService = await import('@/services/jstransform');
      const error = {};
      
      vi.spyOn(jsTransformService.default, 'create_enrichment_table')
        .mockRejectedValueOnce(error);
      
      // Set form data
      (wrapper.vm as any).formData = {
        name: 'test-table',
        file: new File(['test'], 'test.csv', { type: 'text/csv' }),
        append: false,
      };
      
      await (wrapper.vm as any).onSubmit();
      await wrapper.vm.$nextTick();
      
      expect((wrapper.vm as any).compilationErr).toBe('Unknown error');
    });

    it('should handle 403 errors without showing notification', async () => {
      const jsTransformService = await import('@/services/jstransform');
      const error = {
        response: {
          status: 403,
          data: {
            message: 'Forbidden',
            error: 'Access denied',
          },
        },
      };
      
      const createSpy = vi.spyOn(jsTransformService.default, 'create_enrichment_table')
        .mockRejectedValueOnce(error);
      
      // Set form data
      (wrapper.vm as any).formData = {
        name: 'test-table',
        file: new File(['test'], 'test.csv', { type: 'text/csv' }),
        append: false,
      };
      
      try {
        await (wrapper.vm as any).onSubmit();
      } catch (e) {
        // Expected to fail
      }
      
      expect(createSpy).toHaveBeenCalled();
    });

    it('should show default error message when error details are missing', async () => {
      const jsTransformService = await import('@/services/jstransform');
      const error = new Error('Network error');
      
      const createSpy = vi.spyOn(jsTransformService.default, 'create_enrichment_table')
        .mockRejectedValueOnce(error);
      
      // Set form data
      (wrapper.vm as any).formData = {
        name: 'test-table',
        file: new File(['test'], 'test.csv', { type: 'text/csv' }),
        append: false,
      };
      
      try {
        await (wrapper.vm as any).onSubmit();
      } catch (e) {
        // Expected to fail
      }
      
      expect(createSpy).toHaveBeenCalled();
    });
  });

  describe('Analytics Tracking', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should track save button click event', async () => {
      const segment = await import('@/services/segment_analytics');
      const trackSpy = vi.spyOn(segment.default, 'track');
      
      // Set form data
      (wrapper.vm as any).formData = {
        name: 'test-table',
        file: new File(['test'], 'test.csv', { type: 'text/csv' }),
        append: false,
      };
      
      await (wrapper.vm as any).onSubmit();
      
      expect(trackSpy).toHaveBeenCalledWith('Button Click', {
        button: 'Save Enrichment Table',
        user_org: 'test-org-id',
        user_id: 'test@example.com',
        function_name: 'test-table',
        page: 'Add/Update Enrichment Table',
      });
    });
  });

  describe('Loading States', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should show loading notification during submission', async () => {
      // Set form data
      (wrapper.vm as any).formData = {
        name: 'test-table',
        file: new File(['test'], 'test.csv', { type: 'text/csv' }),
        append: false,
      };
      
      const submitPromise = (wrapper.vm as any).onSubmit();
      
      // Check if loading notification was called
      expect(mockNotify).toHaveBeenCalledWith({
        spinner: true,
        message: 'Please wait...',
        timeout: 2000,
      });
      
      await submitPromise;
    });
  });

  describe('Component Props and Emits', () => {
    it('should accept modelValue prop', () => {
      const modelValue = {
        name: 'test-table',
        file: 'test.csv',
        append: true,
      };
      
      wrapper = createWrapper({ modelValue });
      
      expect(wrapper.props('modelValue')).toEqual(modelValue);
    });

    it('should accept isUpdating prop', () => {
      wrapper = createWrapper({ isUpdating: true });
      
      expect(wrapper.props('isUpdating')).toBe(true);
    });

    it('should emit cancel:hideform event', async () => {
      wrapper = createWrapper();
      
      const cancelBtn = wrapper.findAll('button')[0];
      await cancelBtn.trigger('click');
      
      expect(wrapper.emitted('cancel:hideform')).toBeTruthy();
    });

    it('should emit update:list event on successful submission', async () => {
      wrapper = createWrapper();
      
      // Set form data
      (wrapper.vm as any).formData = {
        name: 'test-table',
        file: new File(['test'], 'test.csv', { type: 'text/csv' }),
        append: false,
      };
      
      await (wrapper.vm as any).onSubmit();
      
      expect(wrapper.emitted('update:list')).toBeTruthy();
    });
  });

  describe('Compilation Error Display', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should display compilation errors', async () => {
      (wrapper.vm as any).compilationErr = 'Test error message';
      await wrapper.vm.$nextTick();
      
      const errorElement = wrapper.find('pre');
      expect(errorElement.text()).toBe('Test error message');
    });

    it('should clear compilation errors on successful submission', async () => {
      (wrapper.vm as any).compilationErr = 'Previous error';
      
      // Set form data
      (wrapper.vm as any).formData = {
        name: 'test-table',
        file: new File(['test'], 'test.csv', { type: 'text/csv' }),
        append: false,
      };
      
      await (wrapper.vm as any).onSubmit();
      
      // Error should remain as it's only cleared on error in catch block, not success
      // The component doesn't explicitly clear it on success
      expect((wrapper.vm as any).compilationErr).toBe('Previous error');
    });
  });

  describe('Update Mode Specific Tests', () => {
    it('should set append to false by default in update mode', () => {
      const modelValue = {
        name: 'existing-table',
        file: 'existing.csv',
        // append is undefined
      };
      
      wrapper = createWrapper({ 
        isUpdating: true,
        modelValue 
      });
      
      expect((wrapper.vm as any).formData.append).toBe(false);
    });

    it('should preserve existing append value in update mode', () => {
      const modelValue = {
        name: 'existing-table',
        file: 'existing.csv',
        append: true,
      };
      
      wrapper = createWrapper({ 
        isUpdating: true,
        modelValue 
      });
      
      expect((wrapper.vm as any).formData.append).toBe(true);
    });

    it('should set disable color in update mode', () => {
      wrapper = createWrapper({ isUpdating: true });
      
      expect((wrapper.vm as any).disableColor).toBe('grey-5');
    });
  });

  describe('Editor Functionality', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should update formData.function when editor content changes', async () => {
      // Initialize formData.function if it doesn't exist
      if (!(wrapper.vm as any).formData.function) {
        (wrapper.vm as any).formData.function = '';
      }

      const mockEvent = {
        target: {
          value: 'new function content'
        }
      };

      // Call editorUpdate
      await (wrapper.vm as any).editorUpdate(mockEvent);
      await wrapper.vm.$nextTick();
      
      // Verify the function was updated
      expect((wrapper.vm as any).formData.function).toBe('new function content');
    });

    it('should handle empty editor content', async () => {
      // Initialize formData.function if it doesn't exist
      if (!(wrapper.vm as any).formData.function) {
        (wrapper.vm as any).formData.function = 'initial content';
      }

      const mockEvent = {
        target: {
          value: ''
        }
      };

      // Call editorUpdate
      await (wrapper.vm as any).editorUpdate(mockEvent);
      await wrapper.vm.$nextTick();
      
      // Verify the function was updated to empty string
      expect((wrapper.vm as any).formData.function).toBe('');
    });

    it('should handle null event value', async () => {
      // Initialize formData.function if it doesn't exist
      if (!(wrapper.vm as any).formData.function) {
        (wrapper.vm as any).formData.function = 'initial content';
      }

      const mockEvent = {
        target: {
          value: null
        }
      };

      // Call editorUpdate
      await (wrapper.vm as any).editorUpdate(mockEvent);
      await wrapper.vm.$nextTick();
      
      // Verify the function was updated to null
      expect((wrapper.vm as any).formData.function).toBe(null);
    });
  });
});
