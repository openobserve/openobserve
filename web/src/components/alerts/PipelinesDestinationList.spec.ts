import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import PipelinesDestinationList from './PipelinesDestinationList.vue';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { nextTick } from 'vue';

// Mock external dependencies
vi.mock('@/services/alert_destination', () => ({
  default: {
    list: vi.fn(() => Promise.resolve({ data: [] })),
    delete: vi.fn(() => Promise.resolve({})),
  },
}));

vi.mock('@/services/alert_templates', () => ({
  default: {
    list: vi.fn(() => Promise.resolve({ data: [{ name: "test", body: "", type: "http" }] })),
  },
}));

vi.mock('@/utils/zincutils', () => ({
  getImageURL: vi.fn(() => 'mocked-image-url'),
}));

// Mock Quasar
vi.mock('quasar', async () => {
  const actual = await vi.importActual('quasar');
  return {
    ...actual,
    useQuasar: vi.fn(() => ({
      notify: vi.fn(() => vi.fn()), // Return a dismiss function
    })),
  };
});

// Mock Vue Router
vi.mock('vue-router', async () => {
  const actual = await vi.importActual('vue-router');
  return {
    ...actual,
    useRouter: vi.fn(() => ({
      push: vi.fn(),
      currentRoute: {
        value: {
          query: {},
        },
      },
    })),
  };
});

const mockStore = createStore({
  state: {
    selectedOrganization: {
      identifier: 'test-org',
    },
  },
});

const mockI18n = createI18n({
  locale: 'en',
  messages: {
    en: {
      alert_destinations: {
        name: 'Name',
        url: 'URL',
        method: 'Method',
        actions: 'Actions',
      },
    },
  },
});

describe('PipelinesDestinationList Component - Comprehensive Function Tests', () => {
  let wrapper: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    wrapper = shallowMount(PipelinesDestinationList, {
      global: {
        plugins: [Quasar, mockI18n],
        provide: {
          store: mockStore,
        },
        mocks: {
          $store: mockStore,
        },
      },
    });

    // Wait for component to initialize
    await nextTick();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe('1. Component Initialization', () => {
    it('should initialize with default data properties', () => {
      expect(wrapper.vm.destinations).toEqual([]);
      expect(wrapper.vm.showDestinationEditor).toBe(false);
      expect(wrapper.vm.filterQuery).toBe('');
      expect(wrapper.vm.resultTotal).toBe(0);
      expect(wrapper.vm.selectedPerPage).toBe(20);
    });

    it('should initialize pagination correctly', () => {
      expect(wrapper.vm.pagination.rowsPerPage).toBe(20);
    });

    it('should initialize confirm delete dialog as closed', () => {
      expect(wrapper.vm.confirmDelete.visible).toBe(false);
      expect(wrapper.vm.confirmDelete.data).toBe(null);
    });

    it('should initialize columns correctly', () => {
      expect(wrapper.vm.columns).toHaveLength(7);
      expect(wrapper.vm.columns[0].name).toBe('#');
      expect(wrapper.vm.columns[1].name).toBe('name');
      expect(wrapper.vm.columns[2].name).toBe('destination_type');
      expect(wrapper.vm.columns[3].name).toBe('url');
      expect(wrapper.vm.columns[4].name).toBe('method');
      expect(wrapper.vm.columns[5].name).toBe('output_format');
      expect(wrapper.vm.columns[6].name).toBe('actions');
    });

    it('should format output_format column correctly for string values', () => {
      const outputFormatColumn = wrapper.vm.columns.find((col: any) => col.name === 'output_format');
      expect(outputFormatColumn).toBeDefined();
      expect(outputFormatColumn?.format?.('json')).toBe('JSON');
      expect(outputFormatColumn?.format?.('ndjson')).toBe('NDJSON');
      expect(outputFormatColumn?.format?.('nestedevent')).toBe('NESTEDEVENT');
      expect(outputFormatColumn?.format?.(null)).toBe('N/A');
      expect(outputFormatColumn?.format?.(undefined)).toBe('N/A');
    });

    it('should format output_format column correctly for esbulk object', () => {
      const outputFormatColumn = wrapper.vm.columns.find((col: any) => col.name === 'output_format');
      expect(outputFormatColumn).toBeDefined();
      expect(outputFormatColumn?.format?.({ esbulk: { index: 'test' } })).toBe('ESBULK');
    });

    it('should initialize per page options correctly', () => {
      expect(wrapper.vm.perPageOptions).toHaveLength(6);
      expect(wrapper.vm.perPageOptions[0]).toEqual({ label: "5", value: 5 });
      expect(wrapper.vm.perPageOptions[5]).toEqual({ label: "All", value: 0 });
    });
  });

  describe('2. Data Fetching Functions', () => {
    describe('getDestinations', () => {
      it('should fetch destinations successfully', async () => {
        const mockDestinations = [
          { name: 'dest1', url: 'http://example1.com', method: 'POST' },
          { name: 'dest2', url: 'http://example2.com', method: 'GET' },
        ];

        const destinationService = await import('@/services/alert_destination');
        vi.mocked(destinationService.default.list).mockResolvedValueOnce({
          data: mockDestinations,
        });

        await wrapper.vm.getDestinations();

        expect(destinationService.default.list).toHaveBeenCalledWith({
          page_num: 1,
          page_size: 100000,
          sort_by: "name",
          desc: false,
          org_identifier: 'test-org',
          module: "pipeline",
        });

        expect(wrapper.vm.destinations).toHaveLength(2);
        expect(wrapper.vm.destinations[0]['#']).toBe('01');
        expect(wrapper.vm.destinations[1]['#']).toBe('02');
        expect(wrapper.vm.resultTotal).toBe(2);
      });

      it('should format index numbers correctly for numbers >= 10', async () => {
        const mockDestinations = Array.from({ length: 12 }, (_, i) => ({
          name: `dest${i + 1}`,
          url: `http://example${i + 1}.com`,
          method: 'POST',
        }));

        const destinationService = await import('@/services/alert_destination');
        vi.mocked(destinationService.default.list).mockResolvedValueOnce({
          data: mockDestinations,
        });

        await wrapper.vm.getDestinations();

        expect(wrapper.vm.destinations[9]['#']).toBe(10); // 10th item should be 10
        expect(wrapper.vm.destinations[10]['#']).toBe(11);
        expect(wrapper.vm.destinations[11]['#']).toBe(12);
      });
    });

    describe('getTemplates', () => {
      it('should fetch templates successfully', async () => {
        const mockTemplates = [
          { name: 'template1', body: 'body1', type: 'http' },
          { name: 'template2', body: 'body2', type: 'email' },
        ];

        const templateService = await import('@/services/alert_templates');
        vi.mocked(templateService.default.list).mockResolvedValueOnce({
          data: mockTemplates,
        });

        await wrapper.vm.getTemplates();

        expect(templateService.default.list).toHaveBeenCalledWith({
          org_identifier: 'test-org',
        });

        expect(wrapper.vm.templates).toEqual(mockTemplates);
      });
    });
  });

  describe('3. Helper Functions', () => {
    describe('getDestinationByName', () => {
      beforeEach(() => {
        wrapper.vm.destinations = [
          { name: 'dest1', url: 'http://example1.com' },
          { name: 'dest2', url: 'http://example2.com' },
        ];
      });

      it('should find destination by name', () => {
        const result = wrapper.vm.getDestinationByName('dest1');
        expect(result).toEqual({ name: 'dest1', url: 'http://example1.com' });
      });

      it('should return undefined for non-existent destination', () => {
        const result = wrapper.vm.getDestinationByName('nonexistent');
        expect(result).toBeUndefined();
      });

      it('should be case sensitive', () => {
        const result = wrapper.vm.getDestinationByName('DEST1');
        expect(result).toBeUndefined();
      });

      it('should handle empty destinations array', () => {
        wrapper.vm.destinations = [];
        const result = wrapper.vm.getDestinationByName('dest1');
        expect(result).toBeUndefined();
      });
    });

    describe('resetEditingDestination', () => {
      it('should reset editing destination to null', () => {
        wrapper.vm.editingDestination = { name: 'test', url: 'http://test.com' };
        wrapper.vm.resetEditingDestination();
        expect(wrapper.vm.editingDestination).toBe(null);
      });
    });

    describe('filterData', () => {
      const mockRows = [
        { name: 'webhook-destination', url: 'http://example.com', method: 'post', destination_type_name: 'openobserve', output_format: 'json' },
        { name: 'email-destination', url: 'smtp://mail.com', method: 'post', destination_type_name: 'custom', output_format: 'json' },
        { name: 'slack-webhook', url: 'http://slack.com', method: 'post', destination_type_name: 'custom', output_format: 'ndjson' },
      ];

      it('should filter data by name (case insensitive)', () => {
        const result = wrapper.vm.filterData(mockRows, 'webhook');
        expect(result).toHaveLength(2);
        expect(result[0].name).toBe('webhook-destination');
        expect(result[1].name).toBe('slack-webhook');
      });

      it('should handle empty search term', () => {
        const result = wrapper.vm.filterData(mockRows, '');
        expect(result).toEqual(mockRows);
      });

      it('should handle case insensitive search', () => {
        const result = wrapper.vm.filterData(mockRows, 'EMAIL');
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('email-destination');
      });

      it('should return empty array for no matches', () => {
        const result = wrapper.vm.filterData(mockRows, 'nonexistent');
        expect(result).toHaveLength(0);
      });

      it('should handle empty rows array', () => {
        const result = wrapper.vm.filterData([], 'test');
        expect(result).toHaveLength(0);
      });
    });
  });

  describe('4. Route Management Functions', () => {
    describe('routeTo', () => {
      it('should navigate to specified route with add action', () => {
        // Test that the function exists and can be called
        expect(typeof wrapper.vm.routeTo).toBe('function');
        
        // Call the function to ensure it doesn't throw
        expect(() => wrapper.vm.routeTo('testRoute')).not.toThrow();
      });
    });
  });

  describe('5. Edit Functions', () => {
    describe('editDestination', () => {
      it('should edit new destination (add mode)', () => {
        wrapper.vm.editDestination(null);

        expect(wrapper.vm.showDestinationEditor).toBe(true);
        expect(wrapper.vm.editingDestination).toBe(null);
      });

      it('should edit existing destination (update mode)', () => {
        const mockDestination = { name: 'test-dest', url: 'http://test.com' };

        wrapper.vm.editDestination(mockDestination);

        expect(wrapper.vm.showDestinationEditor).toBe(true);
        expect(wrapper.vm.editingDestination).toEqual(mockDestination);
      });

      it('should clone destination object to avoid mutations', () => {
        const originalDestination = { name: 'test-dest', url: 'http://test.com' };
        wrapper.vm.editDestination(originalDestination);

        // Modify the editing destination
        wrapper.vm.editingDestination.name = 'modified-name';

        // Original should remain unchanged
        expect(originalDestination.name).toBe('test-dest');
      });
    });

    describe('toggleDestinationEditor', () => {
      it('should toggle editor visibility', () => {
        expect(wrapper.vm.showDestinationEditor).toBe(false);
        
        wrapper.vm.toggleDestinationEditor();
        expect(wrapper.vm.showDestinationEditor).toBe(true);
        
        wrapper.vm.toggleDestinationEditor();
        expect(wrapper.vm.showDestinationEditor).toBe(false);
      });
    });
  });

  describe('6. Delete Functions', () => {
    describe('conformDeleteDestination', () => {
      it('should show delete confirmation dialog', () => {
        const mockDestination = { name: 'test-dest', url: 'http://test.com' };

        wrapper.vm.conformDeleteDestination(mockDestination);

        expect(wrapper.vm.confirmDelete.visible).toBe(true);
        expect(wrapper.vm.confirmDelete.data).toEqual(mockDestination);
      });

      it('should handle null destination', () => {
        wrapper.vm.conformDeleteDestination(null);

        expect(wrapper.vm.confirmDelete.visible).toBe(true);
        expect(wrapper.vm.confirmDelete.data).toBe(null);
      });
    });

    describe('cancelDeleteDestination', () => {
      it('should cancel delete operation', () => {
        wrapper.vm.confirmDelete.visible = true;
        wrapper.vm.confirmDelete.data = { name: 'test' };

        wrapper.vm.cancelDeleteDestination();

        expect(wrapper.vm.confirmDelete.visible).toBe(false);
        expect(wrapper.vm.confirmDelete.data).toBe(null);
      });
    });

    describe('deleteDestination', () => {
      it('should delete destination successfully', async () => {
        const mockDestination = { name: 'test-dest' };
        wrapper.vm.confirmDelete.data = mockDestination;

        const destinationService = await import('@/services/alert_destination');
        vi.mocked(destinationService.default.delete).mockResolvedValueOnce({});
        vi.spyOn(wrapper.vm, 'getDestinations').mockImplementation(() => Promise.resolve());

        await wrapper.vm.deleteDestination();

        expect(destinationService.default.delete).toHaveBeenCalledWith({
          org_identifier: 'test-org',
          destination_name: 'test-dest',
        });
      });

      it('should do nothing when no destination data', async () => {
        wrapper.vm.confirmDelete.data = null;

        const destinationService = await import('@/services/alert_destination');
        const deleteSpy = vi.spyOn(destinationService.default, 'delete');

        await wrapper.vm.deleteDestination();

        expect(deleteSpy).not.toHaveBeenCalled();
      });

      it('should do nothing when destination has no name', async () => {
        wrapper.vm.confirmDelete.data = { url: 'http://test.com' };

        const destinationService = await import('@/services/alert_destination');
        const deleteSpy = vi.spyOn(destinationService.default, 'delete');

        await wrapper.vm.deleteDestination();

        expect(deleteSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe('7. Pagination Functions', () => {
    describe('changePagination', () => {
      it('should change pagination settings', async () => {
        const newPaginationValue = { label: '50', value: 50 };
        
        // Mock qTable reference
        const mockSetPagination = vi.fn();
        wrapper.vm.qTable = { setPagination: mockSetPagination };

        wrapper.vm.changePagination(newPaginationValue);
        await nextTick();

        expect(wrapper.vm.selectedPerPage).toBe(50);
        expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
        expect(mockSetPagination).toHaveBeenCalledWith(wrapper.vm.pagination);
      });

      it('should handle "All" option', async () => {
        const allOption = { label: 'All', value: 0 };
        const mockSetPagination = vi.fn();
        wrapper.vm.qTable = { setPagination: mockSetPagination };

        wrapper.vm.changePagination(allOption);
        await nextTick();

        expect(wrapper.vm.selectedPerPage).toBe(0);
        expect(wrapper.vm.pagination.rowsPerPage).toBe(0);
      });

      it('should handle different page sizes', async () => {
        const testCases = [
          { label: '5', value: 5 },
          { label: '10', value: 10 },
          { label: '100', value: 100 },
        ];

        const mockSetPagination = vi.fn();
        wrapper.vm.qTable = { setPagination: mockSetPagination };

        for (const testCase of testCases) {
          wrapper.vm.changePagination(testCase);
          await nextTick();
          expect(wrapper.vm.selectedPerPage).toBe(testCase.value);
          expect(wrapper.vm.pagination.rowsPerPage).toBe(testCase.value);
        }
      });
    });
  });

  describe('8. Component Props and Computed Properties', () => {
    it('should have correct component name', () => {
      expect(wrapper.vm.$options.name).toBe('PageAlerts');
    });

    it('should have getImageURL utility', () => {
      expect(wrapper.vm.getImageURL).toBeDefined();
      expect(typeof wrapper.vm.getImageURL).toBe('function');
    });

    it('should have outlinedDelete icon', () => {
      expect(wrapper.vm.outlinedDelete).toBeDefined();
    });

    it('should have store and translation functions', () => {
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.t).toBeDefined();
    });
  });

  describe('9. Integration Tests', () => {
    it('should handle complete edit workflow', async () => {
      const mockDestination = { name: 'test-dest', url: 'http://test.com' };
      
      // Setup destinations
      wrapper.vm.destinations = [mockDestination];
      
      // Start edit
      wrapper.vm.editDestination(mockDestination);
      
      expect(wrapper.vm.editingDestination).toEqual(mockDestination);
      expect(wrapper.vm.showDestinationEditor).toBe(true);
      
      // Toggle to close
      wrapper.vm.toggleDestinationEditor();
      
      expect(wrapper.vm.showDestinationEditor).toBe(false);
    });

    it('should handle complete delete workflow', async () => {
      const mockDestination = { name: 'test-dest' };
      
      // Start delete
      wrapper.vm.conformDeleteDestination(mockDestination);
      expect(wrapper.vm.confirmDelete.visible).toBe(true);
      expect(wrapper.vm.confirmDelete.data).toEqual(mockDestination);
      
      // Cancel delete
      wrapper.vm.cancelDeleteDestination();
      expect(wrapper.vm.confirmDelete.visible).toBe(false);
      expect(wrapper.vm.confirmDelete.data).toBe(null);
    });

    it('should handle pagination workflow', async () => {
      const mockSetPagination = vi.fn();
      wrapper.vm.qTable = { setPagination: mockSetPagination };
      
      // Change pagination
      wrapper.vm.changePagination({ label: '50', value: 50 });
      await nextTick();
      
      expect(wrapper.vm.selectedPerPage).toBe(50);
      expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
      expect(mockSetPagination).toHaveBeenCalledWith(wrapper.vm.pagination);
    });
  });
});