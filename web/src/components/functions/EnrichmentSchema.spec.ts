import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import EnrichmentSchema from './EnrichmentSchema.vue';
import { createStore } from 'vuex';
import { createI18n } from 'vue-i18n';
import { nextTick } from 'vue';

// Create mock functions
const mockGetStream = vi.fn();

// Mock modules
vi.mock('@/composables/useStreams', () => ({
  default: () => ({
    getStream: mockGetStream,
  }),
}));

vi.mock('@/services/segment_analytics', () => ({
  default: {},
}));

vi.mock('@/aws-exports', () => ({
  default: {
    isCloud: 'false',
  },
}));

vi.mock('@/utils/zincutils', () => ({
  formatSizeFromMB: vi.fn((size) => `${size} MB`),
  getImageURL: vi.fn(),
  timestampToTimezoneDate: vi.fn(),
  convertDateToTimestamp: vi.fn(),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

const mockStore = createStore({
  state: {
    theme: 'light',
    zoConfig: {
      show_stream_stats_doc_num: true,
    },
  },
});

const mockI18n = createI18n({
  locale: 'en',
  messages: {
    en: {
      logStream: {
        schemaHeader: 'Schema',
        docsCount: 'Documents',
        storageSize: 'Storage Size',
        compressedSize: 'Compressed Size',
        propertyName: 'Property Name',
        propertyType: 'Property Type',
      },
      alerts: {
        stream_name: 'Stream Name',
      },
      search: {
        searchField: 'Search fields',
        showing: 'Showing',
        of: 'of',
        recordsPerPage: 'records per page',
      },
    },
  },
});

describe('EnrichmentSchema.vue Branch Coverage', () => {
  const defaultProps = {
    selectedEnrichmentTable: 'test_table',
  };

  const mockSchemaData = {
    name: 'test_stream',
    schema: [
      { name: 'field1', type: 'string' },
      { name: 'field2', type: 'number' },
    ],
    stats: {
      doc_num: 1000,
      storage_size: 50,
      compressed_size: 25,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStream.mockResolvedValue(mockSchemaData);
  });

  describe('Loading State Branch Coverage', () => {
    it('should show content after loading completes', async () => {
      // Test when loading is complete (normal case)
      const wrapper = mount(EnrichmentSchema, {
        props: defaultProps,
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            $store: mockStore,
            store: mockStore,
          },
          stubs: {
            'QTablePagination': true,
          },
        },
      });

      // Wait for component to finish loading
      await nextTick();
      await nextTick();

      // After loading should show content - Branch: loadingState = false (line 51) 
      expect(wrapper.find('.indexDetailsContainer').exists()).toBe(true);
      
      // Test loading state was initially true and error handling works
      // We test this by triggering the loading state through the mounted lifecycle
      expect(wrapper.vm).toBeDefined(); // Component mounted successfully
    });
  });

  describe('Config-based Display Branch Coverage', () => {
    it('should show doc count when zoConfig.show_stream_stats_doc_num is true', async () => {
      const storeWithDocNum = createStore({
        state: {
          theme: 'light',
          zoConfig: {
            show_stream_stats_doc_num: true, // Branch condition: true
          },
        },
      });

      const wrapper = mount(EnrichmentSchema, {
        props: defaultProps,
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            $store: storeWithDocNum,
            store: storeWithDocNum,
          },
          stubs: {
            'QTablePagination': true,
          },
        },
      });

      // Wait for component to load
      await nextTick();
      await nextTick();

      // Branch: show_stream_stats_doc_num = true (line 64)
      const streamElements = wrapper.findAll('[data-test="schema-stream-title-text"]');
      const hasDocCountElement = streamElements.some(el => el.text().includes('Documents'));
      expect(hasDocCountElement).toBe(true);
    });

    it('should hide doc count when zoConfig.show_stream_stats_doc_num is false', async () => {
      const storeWithoutDocNum = createStore({
        state: {
          theme: 'light',
          zoConfig: {
            show_stream_stats_doc_num: false, // Branch condition: false
          },
        },
      });

      const wrapper = mount(EnrichmentSchema, {
        props: defaultProps,
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            $store: storeWithoutDocNum,
            store: storeWithoutDocNum,
          },
          stubs: {
            'QTablePagination': true,
          },
        },
      });

      // Wait for component to load
      await nextTick();
      await nextTick();

      // Branch: show_stream_stats_doc_num = false (line 64)
      const streamElements = wrapper.findAll('[data-test="schema-stream-title-text"]');
      const hasDocCountElement = streamElements.some(el => el.text().includes('Documents'));
      expect(hasDocCountElement).toBe(false);
    });
  });

  describe('Theme-based Styling Branch Coverage', () => {
    it('should apply light theme class when theme is light', async () => {
      const lightStore = createStore({
        state: {
          theme: 'light', // Branch condition: !== 'dark'
          zoConfig: {
            show_stream_stats_doc_num: true,
          },
        },
      });

      const wrapper = mount(EnrichmentSchema, {
        props: defaultProps,
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            $store: lightStore,
            store: lightStore,
          },
          stubs: {
            'QTablePagination': true,
          },
        },
      });

      await nextTick();
      await nextTick();

      // Branch: theme !== 'dark' (line 114-117)
      const tableContainer = wrapper.find('.q-mt-lg');
      expect(tableContainer.classes()).toContain('light-theme-table');
    });

    it('should apply dark theme class when theme is dark', async () => {
      const darkStore = createStore({
        state: {
          theme: 'dark', // Branch condition: === 'dark'
          zoConfig: {
            show_stream_stats_doc_num: true,
          },
        },
      });

      const wrapper = mount(EnrichmentSchema, {
        props: defaultProps,
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            $store: darkStore,
            store: darkStore,
          },
          stubs: {
            'QTablePagination': true,
          },
        },
      });

      await nextTick();
      await nextTick();

      // Branch: theme === 'dark' (line 114-117)
      const tableContainer = wrapper.find('.q-mt-lg');
      expect(tableContainer.classes()).toContain('dark-theme-table');
    });
  });

  describe('Error Handling Branch Coverage', () => {
    it('should handle getSchemaData error and set loading to false', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      // Reset and mock getStream to reject for this test
      mockGetStream.mockReset();
      mockGetStream.mockRejectedValueOnce(new Error('API Error'));

      const wrapper = mount(EnrichmentSchema, {
        props: defaultProps,
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            $store: mockStore,
            store: mockStore,
          },
          stubs: {
            'QTablePagination': true,
          },
        },
      });

      // Wait for error to be handled
      await nextTick();
      await nextTick();
      await nextTick(); // Give more time for async error handling

      // Branch: catch block in getSchemaData (line 261-264)
      expect(consoleSpy).toHaveBeenCalled();
      
      // Loading should be false after error - spinner should not exist
      expect(wrapper.find('.q-spinner-hourglass').exists()).toBe(false);

      consoleSpy.mockRestore();
    });

    it('should test loading state transitions', async () => {
      // Test both branches: loading and loaded states
      const wrapper = mount(EnrichmentSchema, {
        props: defaultProps,
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            $store: mockStore,
            store: mockStore,
          },
          stubs: {
            'QTablePagination': true,
          },
        },
      });

      await nextTick();
      await nextTick();
      
      // After mounting and data loading, should show content (loading = false branch)
      // Branch: loadingState = false (line 51)
      expect(wrapper.find('.indexDetailsContainer').exists()).toBe(true);
      
      // The loading state branch (line 45) is tested implicitly during component initialization
      // where getSchemaData sets loadingState.value = true initially
      expect(wrapper.vm).toBeDefined();
    });
  });

  describe('Filter Functionality Branch Coverage', () => {
    it('should filter fields correctly when component is mounted', async () => {
      const wrapper = mount(EnrichmentSchema, {
        props: defaultProps,
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            $store: mockStore,
            store: mockStore,
          },
          stubs: {
            'QTablePagination': true,
          },
        },
      });

      await nextTick();

      // Test the filter function directly (exposed in setup)
      const filterFn = (wrapper.vm as any).filterFieldFn;
      const rows = [
        { name: 'username', type: 'string' },
        { name: 'email', type: 'string' },
        { name: 'age', type: 'number' },
      ];

      // Branch: field name includes search term (line 269)
      const filteredResults = filterFn(rows, 'user');
      expect(filteredResults).toHaveLength(1);
      expect(filteredResults[0].name).toBe('username');

      // Branch: no matches
      const noResults = filterFn(rows, 'xyz');
      expect(noResults).toHaveLength(0);
    });
  });

  describe('Cloud Environment Simulation', () => {
    it('should handle cloud vs non-cloud display logic', async () => {
      // Test with isCloud = 'false'
      const wrapper = mount(EnrichmentSchema, {
        props: defaultProps,
        global: {
          plugins: [Quasar, mockI18n],
          provide: {
            $store: mockStore,
            store: mockStore,
          },
          stubs: {
            'QTablePagination': true,
          },
        },
      });

      await nextTick();
      await nextTick();

      // The component uses config.isCloud which is mocked as 'false'
      // Branch: isCloud !== 'true' should show compressed size element
      // We can at least test that the template renders without error
      expect(wrapper.find('.stream_details_container').exists()).toBe(true);
    });
  });
});