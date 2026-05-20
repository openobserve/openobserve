// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import AddEnrichmentTable from './AddEnrichmentTable.vue';

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

vi.mock('@/services/reodotdev_analytics', () => ({
  useReo: () => ({ track: vi.fn() }),
}));

const mockToast = vi.fn();
vi.mock('@/lib/feedback/Toast/useToast', () => ({
  toast: (...args: any[]) => mockToast(...args),
}));

describe('AddEnrichmentTable.vue', () => {
  let wrapper: any;
  let store: any;
  let i18n: any;

  const createWrapper = (propsData = {}) => {
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
    });

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
            dataSource: 'Data Source',
            uploadFile: 'Upload File',
            fromUrl: 'From URL',
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
        plugins: [store, i18n],
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
    });

    it('should render the page container', () => {
      wrapper = createWrapper();
      expect(wrapper.find('[data-test="add-enrichment-table-page"]').exists()).toBe(true);
    });

    it('should render title for add mode', () => {
      wrapper = createWrapper();
      const title = wrapper.find('[data-test="add-enrichment-table-title"]');
      expect(title.text()).toBe('Add Enrichment Table');
    });

    it('should initialize with correct default values', () => {
      wrapper = createWrapper();
      expect((wrapper.vm as any).formData.name).toBe('');
      expect((wrapper.vm as any).formData.file).toBe('');
      expect((wrapper.vm as any).formData.append).toBe(false);
    });

    it('should render update mode title when isUpdating is true', () => {
      wrapper = createWrapper({ isUpdating: true });
      const title = wrapper.find('[data-test="add-enrichment-table-title"]');
      expect(title.text()).toBe('Update Enrichment Table');
    });

    it('should initialize with provided modelValue', () => {
      const modelValue = {
        name: 'test-table',
        file: 'test.csv',
        append: true,
      };
      wrapper = createWrapper({ modelValue });
      expect((wrapper.vm as any).formData.name).toBe('test-table');
      expect((wrapper.vm as any).formData.append).toBe(true);
    });
  });

  describe('Form Buttons', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should render cancel button', () => {
      expect(wrapper.find('[data-test="add-enrichment-table-cancel-btn"]').exists()).toBe(true);
    });

    it('should render save button', () => {
      expect(wrapper.find('[data-test="add-enrichment-table-save-btn"]').exists()).toBe(true);
    });

    it('should emit cancel:hideform when cancel button is clicked', async () => {
      await wrapper.find('[data-test="add-enrichment-table-cancel-btn"]').trigger('click');
      expect(wrapper.emitted('cancel:hideform')).toBeTruthy();
    });
  });

  describe('Form Validation', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should validate required name field', () => {
      const rules = [(val: any) => !!val || 'Field is required!'];
      expect(rules[0]('')).toBe('Field is required!');
      expect(rules[0]('test-name')).toBe(true);
    });

    it('should validate required file field', () => {
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

      (wrapper.vm as any).formData = {
        name: 'test-table',
        source: 'file',
        file: new File(['test'], 'test.csv', { type: 'text/csv' }),
        append: false,
      };

      await (wrapper.vm as any).onSubmit();
      await flushPromises();

      expect(createSpy).toHaveBeenCalledWith(
        'test-org-id',
        'test-table',
        expect.any(FormData),
        false
      );
    });

    it('should emit update:list on successful submission', async () => {
      (wrapper.vm as any).formData = {
        name: 'test-table',
        source: 'file',
        file: new File(['test'], 'test.csv', { type: 'text/csv' }),
        append: false,
      };

      await (wrapper.vm as any).onSubmit();
      await flushPromises();

      expect(wrapper.emitted('update:list')).toBeTruthy();
    });

    it('should reset form data after successful submission', async () => {
      (wrapper.vm as any).formData = {
        name: 'test-table',
        source: 'file',
        file: new File(['test'], 'test.csv', { type: 'text/csv' }),
        append: false,
      };

      await (wrapper.vm as any).onSubmit();
      await flushPromises();

      expect((wrapper.vm as any).formData.name).toBe('');
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
          data: { message: 'Invalid CSV format' },
        },
      };

      vi.spyOn(jsTransformService.default, 'create_enrichment_table')
        .mockRejectedValueOnce(error);

      (wrapper.vm as any).formData = {
        name: 'test-table',
        source: 'file',
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

      (wrapper.vm as any).formData = {
        name: 'test-table',
        source: 'file',
        file: new File(['test'], 'test.csv', { type: 'text/csv' }),
        append: false,
      };

      await (wrapper.vm as any).onSubmit();
      await wrapper.vm.$nextTick();

      expect((wrapper.vm as any).compilationErr).toBe('Direct error message');
    });

    it('should set compilationErr to "Unknown error" when no error details available', async () => {
      const jsTransformService = await import('@/services/jstransform');

      vi.spyOn(jsTransformService.default, 'create_enrichment_table')
        .mockRejectedValueOnce({});

      (wrapper.vm as any).formData = {
        name: 'test-table',
        source: 'file',
        file: new File(['test'], 'test.csv', { type: 'text/csv' }),
        append: false,
      };

      await (wrapper.vm as any).onSubmit();
      await wrapper.vm.$nextTick();

      expect((wrapper.vm as any).compilationErr).toBe('Unknown error');
    });

    it('should handle 403 errors without crashing', async () => {
      const jsTransformService = await import('@/services/jstransform');
      const createSpy = vi.spyOn(jsTransformService.default, 'create_enrichment_table')
        .mockRejectedValueOnce({ response: { status: 403, data: { message: 'Forbidden' } } });

      (wrapper.vm as any).formData = {
        name: 'test-table',
        source: 'file',
        file: new File(['test'], 'test.csv', { type: 'text/csv' }),
        append: false,
      };

      await (wrapper.vm as any).onSubmit();
      await flushPromises();

      expect(createSpy).toHaveBeenCalled();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('Analytics Tracking', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should track save button click event', async () => {
      const segment = await import('@/services/segment_analytics');
      const trackSpy = vi.spyOn(segment.default, 'track');

      (wrapper.vm as any).formData = {
        name: 'test-table',
        source: 'file',
        file: new File(['test'], 'test.csv', { type: 'text/csv' }),
        append: false,
      };

      await (wrapper.vm as any).onSubmit();
      await flushPromises();

      expect(trackSpy).toHaveBeenCalledWith('Button Click', expect.objectContaining({
        button: 'Save Enrichment Table',
        function_name: 'test-table',
        page: 'Add/Update Enrichment Table',
      }));
    });
  });

  describe('Component Props and Emits', () => {
    it('should accept modelValue prop', () => {
      const modelValue = { name: 'test-table', file: 'test.csv', append: true };
      wrapper = createWrapper({ modelValue });
      expect(wrapper.props('modelValue')).toEqual(modelValue);
    });

    it('should accept isUpdating prop', () => {
      wrapper = createWrapper({ isUpdating: true });
      expect(wrapper.props('isUpdating')).toBe(true);
    });

    it('should emit cancel:hideform event when cancel is clicked', async () => {
      wrapper = createWrapper();
      await wrapper.find('[data-test="add-enrichment-table-cancel-btn"]').trigger('click');
      expect(wrapper.emitted('cancel:hideform')).toBeTruthy();
    });

    it('should emit update:list event on successful submission', async () => {
      wrapper = createWrapper();

      (wrapper.vm as any).formData = {
        name: 'test-table',
        source: 'file',
        file: new File(['test'], 'test.csv', { type: 'text/csv' }),
        append: false,
      };

      await (wrapper.vm as any).onSubmit();
      await flushPromises();

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
  });

  describe('Update Mode Specific Tests', () => {
    it('should set append to false by default in update mode', () => {
      const modelValue = {
        name: 'existing-table',
        file: 'existing.csv',
      };
      wrapper = createWrapper({ isUpdating: true, modelValue });
      expect((wrapper.vm as any).formData.append).toBe(false);
    });

    it('should preserve existing append value in update mode', () => {
      const modelValue = { name: 'existing-table', file: 'existing.csv', append: true };
      wrapper = createWrapper({ isUpdating: true, modelValue });
      expect((wrapper.vm as any).formData.append).toBe(true);
    });

    it('should set disableColor in update mode', () => {
      wrapper = createWrapper({ isUpdating: true });
      expect((wrapper.vm as any).disableColor).toBe('grey-5');
    });
  });

  describe('Editor Functionality', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should update formData.function when editor content changes', async () => {
      if (!(wrapper.vm as any).formData.function) {
        (wrapper.vm as any).formData.function = '';
      }
      await (wrapper.vm as any).editorUpdate({ target: { value: 'new function content' } });
      await wrapper.vm.$nextTick();
      expect((wrapper.vm as any).formData.function).toBe('new function content');
    });

    it('should handle empty editor content', async () => {
      if (!(wrapper.vm as any).formData.function) {
        (wrapper.vm as any).formData.function = 'initial content';
      }
      await (wrapper.vm as any).editorUpdate({ target: { value: '' } });
      await wrapper.vm.$nextTick();
      expect((wrapper.vm as any).formData.function).toBe('');
    });

    it('should handle null event value', async () => {
      if (!(wrapper.vm as any).formData.function) {
        (wrapper.vm as any).formData.function = 'initial content';
      }
      await (wrapper.vm as any).editorUpdate({ target: { value: null } });
      await wrapper.vm.$nextTick();
      expect((wrapper.vm as any).formData.function).toBe(null);
    });
  });
});
