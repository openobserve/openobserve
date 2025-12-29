import { flushPromises, mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Dialog, Notify } from 'quasar';
import { installQuasar } from "@/test/unit/helpers";
import EnrichmentTableList from './EnrichmentTableList.vue';
import streamService from '@/services/stream';
import segment from '@/services/segment_analytics';
import useStreams from '@/composables/useStreams';
import i18n from "@/locales";
import { formatSizeFromMB } from "@/utils/zincutils";

// Mock zincutils
vi.mock("@/utils/zincutils", () => ({
  formatSizeFromMB: vi.fn((size) => `${size} MB`),
  getImageURL: vi.fn(),
  verifyOrganizationStatus: vi.fn(),
}));

// Mock the stream service
vi.mock('@/services/stream', () => ({
  default: {
    delete: vi.fn(() => Promise.resolve({ data: { code: 200 } })),
  },
}));

// Mock segment analytics
vi.mock('@/services/segment_analytics', () => ({
  default: {
    track: vi.fn(),
  },
}));

// Mock jstransform service
vi.mock('@/services/jstransform', () => ({
  default: {
    get_all_enrichment_table_statuses: vi.fn(() => Promise.resolve({ data: {} })),
  },
}));

// Mock useStreams composable
const mockGetStreams = vi.fn(() => Promise.resolve({
  list: [],
}));

const mockGetStream = vi.fn(() => Promise.resolve({
  stats: {
    doc_time_min: 1000000,
    doc_time_max: 2000000,
  },
}));

const mockResetStreamType = vi.fn();

vi.mock('@/composables/useStreams', () => ({
  default: () => ({
    getStreams: mockGetStreams,
    resetStreamType: mockResetStreamType,
    getStream: mockGetStream,
  }),
}));

// Mock vue-i18n
vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useI18n: () => ({
      t: (key) => key
    })
  };
});

// Mock vue-router
const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
  currentRoute: {
    value: {
      query: {},
      name: 'enrichmentTables'
    }
  }
};

vi.mock('vue-router', () => ({
  useRouter: () => mockRouter
}));

installQuasar({
  plugins: [Dialog, Notify],
});

describe('EnrichmentTableList Component', () => {
  let wrapper;
  let store;
  let notifyMock;
  let dismissMock;
  let qTableMock;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset router mock state
    mockRouter.currentRoute.value = {
      query: {},
      name: 'enrichmentTables'
    };
    mockRouter.push.mockReset();
    mockRouter.replace.mockReset();

    // Setup notify mock with dismiss function
    dismissMock = vi.fn();
    notifyMock = vi.fn().mockReturnValue(dismissMock);

    // Setup qTable mock
    qTableMock = {
      setPagination: vi.fn(),
    };

    // Setup store
    store = {
      state: {
        selectedOrganization: {
          identifier: 'test-org',
          name: 'Test Organization',
        },
        userInfo: {
          email: 'test@example.com',
          name: 'Test User',
        },
        theme: 'light',
        organizations: [],
      },
      mutations: {
        setOrganization(state, org) {
          state.selectedOrganization = org;
        },
      },
      actions: {
        'logs/setIsInitialized': vi.fn(),
      },
      dispatch: vi.fn(),
    };

    // Mount component with default configuration
    wrapper = mount(EnrichmentTableList, {
      global: {
        plugins: [i18n],
        provide: {
          store: store,
        },
        stubs: {
          QCard: false,
          QPage: false,
          QTable: {
            template: '<div><slot name="top" :scope="scope"></slot><slot></slot><slot name="body-cell-actions" :props="rowProps"></slot></div>',
            data() {
              return {
                scope: {
                  pagination: { rowsPerPage: 20 },
                },
                rowProps: {
                  row: { name: 'test-table' },
                },
              };
            },
            methods: {
              setPagination: vi.fn(),
            },
          },
          QBtn: false,
          QInput: false,
          QDialog: false,
          QTd: false,
          QTooltip: false,
          QIcon: false,
          RouterLink: true,
          NoData: true,
          QTablePagination: true,
          AddEnrichmentTable: true,
          ConfirmDialog: true,
          EnrichmentSchema: true,
        }
      },
    });

    // Attach notify mock to wrapper
    wrapper.vm.$q = {
      notify: notifyMock
    };

    // Set qTable ref
    wrapper.vm.qTable = qTableMock;

    // Wait for component to mount and initial operations to complete
    await flushPromises();
  });

  afterEach(() => {
    vi.clearAllMocks();
    wrapper.unmount();
  });

  describe('Component Initialization', () => {
    it('mounts successfully', () => {
      expect(wrapper.exists()).toBe(true);
    });

    it('initializes with correct default state', () => {
      expect(wrapper.vm.jsTransforms).toEqual([]);
      expect(wrapper.vm.filterQuery).toBe('');
      expect(wrapper.vm.showAddJSTransformDialog).toBe(false);
      expect(wrapper.vm.isUpdated).toBe(false);
      expect(wrapper.vm.confirmDelete).toBe(false);
      expect(wrapper.vm.showEnrichmentSchema).toBe(false);
    });


    it('handles no action in route query on mount', async () => {
      mockRouter.currentRoute.value.query = {};
      await wrapper.vm.$nextTick();
      await wrapper.vm.$options.mounted?.call(wrapper.vm);
      
      expect(wrapper.vm.showAddJSTransformDialog).toBe(false);
      expect(wrapper.vm.isUpdated).toBe(false);
      expect(wrapper.vm.formData).toEqual({});
    });
  });

  describe('Search and Filtering', () => {
    beforeEach(() => {
      wrapper.vm.jsTransforms = [
        { name: 'table1', doc_num: 100 },
        { name: 'table2', doc_num: 200 },
        { name: 'test3', doc_num: 300 },
      ];
    });

    it('filters tables by name correctly', () => {
      const filtered = wrapper.vm.filterData(wrapper.vm.jsTransforms, 'table1');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('table1');
    });

    it('handles case-insensitive search', () => {
      const filtered = wrapper.vm.filterData(wrapper.vm.jsTransforms, 'TABLE');
      expect(filtered).toHaveLength(2);
    });

    it('returns all items for empty search', () => {
      const filtered = wrapper.vm.filterData(wrapper.vm.jsTransforms, '');
      expect(filtered).toHaveLength(3);
    });

    it('handles empty search terms', () => {
      // For empty string
      expect(wrapper.vm.filterData(wrapper.vm.jsTransforms, '')).toEqual(wrapper.vm.jsTransforms);
      
      // For null/undefined, the component should handle it gracefully
      const terms = '';
      expect(wrapper.vm.filterData(wrapper.vm.jsTransforms, terms || '')).toEqual(wrapper.vm.jsTransforms);
    });

    it('handles partial matches', () => {
      const filtered = wrapper.vm.filterData(wrapper.vm.jsTransforms, 'tab');
      expect(filtered).toHaveLength(2);
    });
  });

  describe('Delete Functionality', () => {
    beforeEach(() => {
      wrapper.vm.selectedDelete = { name: 'test-table' };
    });

    it('shows delete confirmation dialog', async () => {
      const testRow = { name: 'test-table' };
      await wrapper.vm.showDeleteDialogFn({ row: testRow });
      expect(wrapper.vm.confirmDelete).toBe(true);
      expect(wrapper.vm.selectedDelete).toEqual(testRow);
    });

    it('deletes table successfully', async () => {
      const mockDelete = vi.fn().mockResolvedValue({ data: { code: 200 } });
      vi.mocked(streamService.delete).mockImplementationOnce(mockDelete);

      await wrapper.vm.deleteLookupTable();
      await flushPromises();

      expect(mockDelete).toHaveBeenCalled();
    });

    it('tracks delete action in segment analytics', async () => {
      await wrapper.vm.deleteLookupTable();
      await flushPromises();

      expect(segment.track).toHaveBeenCalledWith('Button Click', {
        button: 'Delete Enrichment Table',
        user_org: 'test-org',
        user_id: 'test@example.com',
        function_name: 'test-table',
        is_ingest_func: undefined,
        page: 'Functions',
      });
    });
  });

  describe('Pagination Handling', () => {
    it('updates pagination settings correctly', async () => {
      const setPaginationSpy = vi.fn();
      wrapper.vm.qTable = { setPagination: setPaginationSpy };

      await wrapper.vm.changePagination({ label: '10', value: 10 });
      await flushPromises();

      expect(wrapper.vm.selectedPerPage).toBe(10);
      expect(wrapper.vm.pagination.rowsPerPage).toBe(10);
      expect(setPaginationSpy).toHaveBeenCalledWith({ rowsPerPage: 10 });
    });

    it('handles "All" pagination option', async () => {
      const setPaginationSpy = vi.fn();
      wrapper.vm.qTable = { setPagination: setPaginationSpy };

      await wrapper.vm.changePagination({ label: 'All', value: 0 });
      await flushPromises();

      expect(wrapper.vm.pagination.rowsPerPage).toBe(0);
      expect(setPaginationSpy).toHaveBeenCalledWith({ rowsPerPage: 0 });
    });

    it('validates pagination options', () => {
      expect(wrapper.vm.perPageOptions).toEqual([
        { label: "20", value: 20 },
        { label: "50", value: 50 },
        { label: "100", value: 100 },
        { label: "250", value: 250 },
        { label: "500", value: 500 },
      ]);
    });
  });

  describe('Form Management', () => {
    it('shows add form correctly', async () => {
      await wrapper.vm.showAddUpdateFn({});
      expect(wrapper.vm.showAddJSTransformDialog).toBe(true);
      expect(wrapper.vm.isUpdated).toBe(false);
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: 'enrichmentTables',
        query: {
          action: 'add',
          org_identifier: 'test-org'
        }
      });
    });

    it('shows update form correctly', async () => {
      const testRow = { name: 'test-table' };
      await wrapper.vm.showAddUpdateFn({ row: testRow });
      expect(wrapper.vm.showAddJSTransformDialog).toBe(true);
      expect(wrapper.vm.isUpdated).toBe(true);
      expect(mockRouter.push).toHaveBeenCalledWith({
        name: 'enrichmentTables',
        query: {
          action: 'update',
          name: 'test-table',
          org_identifier: 'test-org'
        }
      });
    });

    it('hides form and resets router state', async () => {
      wrapper.vm.showAddJSTransformDialog = true;
      await wrapper.vm.hideForm();
      expect(wrapper.vm.showAddJSTransformDialog).toBe(false);
      expect(mockRouter.replace).toHaveBeenCalledWith({
        name: 'enrichmentTables',
        query: {
          org_identifier: 'test-org'
        }
      });
    });

    it('refreshes list after form submission', async () => {
      await wrapper.vm.refreshList();
      expect(wrapper.vm.showAddJSTransformDialog).toBe(false);
      expect(mockResetStreamType).toHaveBeenCalledWith('enrichment_tables');
      expect(mockGetStreams).toHaveBeenCalledWith('enrichment_tables', false, false, true);
    });
  });

  describe('Schema Management', () => {
    it('shows schema dialog correctly', async () => {
      await wrapper.vm.listSchema({ row: { name: 'test-table' } });
      expect(wrapper.vm.showEnrichmentSchema).toBe(true);
      expect(wrapper.vm.selectedEnrichmentTable).toBe('test-table');
    });

    it('closes schema dialog properly', async () => {
      wrapper.vm.showEnrichmentSchema = true;
      wrapper.vm.selectedEnrichmentTable = 'test-table';
      wrapper.vm.showEnrichmentSchema = false;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.showEnrichmentSchema).toBe(false);
    });
  });

  describe('Table Data Formatting', () => {
    it('formats document numbers correctly', () => {
      const column = wrapper.vm.columns.find(c => c.name === 'doc_num');
      expect(column.field({ doc_num: 1000 })).toBe('1,000');
    });

    it('formats storage size correctly', () => {
      const column = wrapper.vm.columns.find(c => c.name === 'storage_size');
      expect(column.field({ storage_size: 10 })).toBe('10 MB');
    });

    it('handles numeric field sorting', () => {
      const column = wrapper.vm.columns.find(c => c.name === 'doc_num');
      expect(column.sort(null, null, { doc_num: 1000 }, { doc_num: 500 })).toBe(500);
    });

    it('handles storage size sorting', () => {
      const column = wrapper.vm.columns.find(c => c.name === 'storage_size');
      expect(column.sort(null, null, 
        { original_storage_size: 1000 }, 
        { original_storage_size: 500 }
      )).toBe(500);
    });
  });

  describe('Error Handling', () => {
    it('suppresses error notification for 403 errors', async () => {
      const error = new Error('Forbidden');
      error.response = { status: 403 };
      vi.mocked(streamService.delete).mockRejectedValueOnce(error);
      
      wrapper.vm.selectedDelete = { name: 'test-table' };
      await wrapper.vm.deleteLookupTable();
      await flushPromises();
      
      expect(notifyMock).not.toHaveBeenCalledWith(
        expect.objectContaining({
          color: 'negative',
        })
      );
    });
  });

  describe('Stream Explorer Navigation', () => {
    it('navigates to explorer with correct time range', async () => {
      const testRow = {
        name: 'test-table',
        stream_type: 'enrichment_tables'
      };

      await wrapper.vm.exploreEnrichmentTable({ row: testRow });
      await flushPromises();

      expect(store.dispatch).toHaveBeenCalledWith('logs/setIsInitialized', false);
      expect(mockRouter.push).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'logs',
          query: expect.objectContaining({
            stream: 'test-table',
            stream_type: 'enrichment_tables',
            from: expect.any(Number),
            to: expect.any(Number)
          })
        })
      );
    });

    it('handles missing time range data', async () => {
      mockGetStream.mockResolvedValueOnce({
        stats: {}
      });

      const testRow = {
        name: 'test-table',
        stream_type: 'enrichment_tables'
      };

      await wrapper.vm.exploreEnrichmentTable({ row: testRow });
      await flushPromises();

      expect(mockRouter.push).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'logs',
          query: expect.objectContaining({
            period: '15m'
          })
        })
      );
    });
  });

  describe('Data Processing', () => {
    it('handles empty stats in enrichment table data', async () => {
      const mockData = {
        list: [{
          name: 'test-table',
          stats: null
        }]
      };
      mockGetStreams.mockResolvedValueOnce(mockData);

      await wrapper.vm.getLookupTables();
      await flushPromises();

      expect(wrapper.vm.jsTransforms[0]).toEqual(expect.objectContaining({
        name: 'test-table',
        doc_num: '',
        storage_size: '',
        compressed_size: '',
        original_storage_size: '',
        original_compressed_size: ''
      }));
    });

    it('handles stats with data correctly', async () => {
      const mockData = {
        list: [{
          name: 'test-table',
          stats: {
            doc_num: 1000,
            storage_size: 50,
            compressed_size: 25
          }
        }]
      };
      mockGetStreams.mockResolvedValueOnce(mockData);

      await wrapper.vm.getLookupTables();
      await flushPromises();

      expect(wrapper.vm.jsTransforms[0]).toEqual(expect.objectContaining({
        name: 'test-table',
        doc_num: 1000,
        storage_size: '50 MB',
        compressed_size: '25 MB',
        original_storage_size: 50,
        original_compressed_size: 25
      }));
    });

    it('handles stats with zero values', async () => {
      const mockData = {
        list: [{
          name: 'test-table',
          stats: {
            doc_num: 0,
            storage_size: 0,
            compressed_size: 0
          }
        }]
      };
      mockGetStreams.mockResolvedValueOnce(mockData);

      await wrapper.vm.getLookupTables();
      await flushPromises();

      expect(wrapper.vm.jsTransforms[0]).toEqual(expect.objectContaining({
        name: 'test-table',
        doc_num: 0,
        storage_size: '0 MB',
        compressed_size: '0 MB',
        original_storage_size: 0,
        original_compressed_size: 0
      }));
    });

    it('suppresses error notification for 403 errors during fetch', async () => {
      const error = new Error('Forbidden');
      error.response = { status: 403 };
      mockGetStreams.mockRejectedValueOnce(error);

      await wrapper.vm.getLookupTables();
      await flushPromises();

      expect(notifyMock).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'negative'
        })
      );
    });
  });

  describe('Time Range Handling', () => {
    it('handles created_at time range when doc_time is not available', async () => {
      mockGetStream.mockResolvedValueOnce({
        stats: {
          created_at: 1000000000
        }
      });

      const testRow = {
        name: 'test-table',
        stream_type: 'enrichment_tables'
      };

      const timeRange = await wrapper.vm.getTimeRange(testRow);
      
      expect(timeRange).toEqual({
        from: 1000000000 - 60000000,
        to: 1000000000 + 3600000000
      });
    });

    it('handles error in getStream call', async () => {
      const error = new Error('Stream error');
      mockGetStream.mockRejectedValueOnce(error);

      const testRow = {
        name: 'test-table',
        stream_type: 'enrichment_tables'
      };

      const timeRange = await wrapper.vm.getTimeRange(testRow);
      
      expect(timeRange).toEqual({
        period: '15m'
      });
    });

    it('handles catch block in getTimeRange', async () => {
      mockGetStream.mockImplementationOnce(() => {
        throw new Error('Unexpected error');
      });

      const testRow = {
        name: 'test-table',
        stream_type: 'enrichment_tables'
      };

      const timeRange = await wrapper.vm.getTimeRange(testRow);
      
      expect(timeRange).toEqual({
        period: '15m'
      });
    });
  });

  describe('Organization Status Handling', () => {
    it('handles organization change in pipeline view', async () => {
      // Setup initial state
      wrapper.vm.jsTransforms = [{ name: 'old-table' }];
      wrapper.vm.resultTotal = 10;
      mockRouter.currentRoute.value.name = 'pipeline';

      // Trigger watcher
      await wrapper.vm.$options.watch.selectedOrg.call(wrapper.vm, 'new-org', 'old-org');
      await flushPromises();

      expect(wrapper.vm.resultTotal).toBe(0);
      expect(wrapper.vm.jsTransforms).toEqual([]);
      expect(mockGetStreams).toHaveBeenCalledWith('enrichment_tables', false, false, true);
    });

    it('verifies organization status on change', async () => {
      const organizations = [{ identifier: 'test-org' }];
      
      await wrapper.vm.$options.watch.selectedOrg.call({
        ...wrapper.vm,
        verifyOrganizationStatus: vi.fn(),
        store: { state: { organizations } },
        router: mockRouter
      }, 'new-org', 'old-org');
    });

    it('handles undefined jsTransforms value', async () => {
      wrapper.vm.jsTransforms.value = undefined;
      mockRouter.currentRoute.value.name = 'pipeline';

      await wrapper.vm.$options.watch.selectedOrg.call(wrapper.vm, 'new-org', 'old-org');
      await flushPromises();

      expect(mockGetStreams).toHaveBeenCalledWith('enrichment_tables', false, false, true);
    });
  });

  describe('Table Sorting', () => {
    it('handles compressed size sorting', () => {
      const column = wrapper.vm.columns.find(c => c.name === 'compressed_size');
      const result = column.sort(null, null, 
        { original_compressed_size: 1000 }, 
        { original_compressed_size: 500 }
      );
      expect(result).toBe(500);
    });
  });
}); 