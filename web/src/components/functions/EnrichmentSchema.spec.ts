import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
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

// Stub for ODrawer: exposes slots and re-emits update:open so tests can drive
// drawer open/close interactions without rendering the real overlay.
const ODrawerStub = {
  name: 'ODrawer',
  props: ['open', 'width', 'showClose', 'persistent', 'size', 'title', 'subTitle'],
  emits: ['update:open', 'click:primary', 'click:secondary', 'click:neutral'],
  template: `
    <div data-test-stub="o-drawer" :data-open="open" :data-title="title" :data-size="size">
      <div data-test-stub="o-drawer-header"><slot name="header" /></div>
      <div data-test-stub="o-drawer-body"><slot /></div>
      <div data-test-stub="o-drawer-footer"><slot name="footer" /></div>
    </div>
  `,
};

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

function buildMountOptions(store: any = mockStore, props: Record<string, unknown> = {}) {
  return {
    props: {
      selectedEnrichmentTable: 'test_table',
      open: true,
      ...props,
    },
    global: {
      plugins: [Quasar, mockI18n],
      provide: {
        $store: store,
        store,
      },
      stubs: {
        ODrawer: ODrawerStub,
        QTablePagination: true,
      },
    },
  };
}

describe('EnrichmentSchema.vue Branch Coverage', () => {
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

  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStream.mockResolvedValue(mockSchemaData);
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe('ODrawer Integration', () => {
    it('should render the ODrawer wrapper', async () => {
      wrapper = mount(EnrichmentSchema, buildMountOptions());
      await flushPromises();
      expect(wrapper.find('[data-test-stub="o-drawer"]').exists()).toBe(true);
    });

    it('should pass open prop through to ODrawer', async () => {
      wrapper = mount(EnrichmentSchema, buildMountOptions());
      await flushPromises();
      const drawer = wrapper.find('[data-test-stub="o-drawer"]');
      expect(drawer.attributes('data-open')).toBe('true');
    });

    it('should set the drawer title from the i18n schemaHeader key', async () => {
      wrapper = mount(EnrichmentSchema, buildMountOptions());
      await flushPromises();
      expect(
        wrapper.find('[data-test-stub="o-drawer"]').attributes('data-title'),
      ).toBe('Schema');
    });

    it('should pass size "lg" to ODrawer', async () => {
      wrapper = mount(EnrichmentSchema, buildMountOptions());
      await flushPromises();
      expect(
        wrapper.find('[data-test-stub="o-drawer"]').attributes('data-size'),
      ).toBe('lg');
    });

    it('should propagate ODrawer update:open event to parent', async () => {
      wrapper = mount(EnrichmentSchema, buildMountOptions());
      await flushPromises();

      const drawer = wrapper.findComponent({ name: 'ODrawer' });
      drawer.vm.$emit('update:open', false);
      await flushPromises();

      const events = wrapper.emitted('update:open');
      expect(events).toBeTruthy();
      expect(events![events!.length - 1]).toEqual([false]);
    });

    it('should reflect open=false when the prop is set to false', async () => {
      wrapper = mount(EnrichmentSchema, buildMountOptions(mockStore, { open: false }));
      await flushPromises();
      expect(
        wrapper.find('[data-test-stub="o-drawer"]').attributes('data-open'),
      ).toBe('false');
    });
  });

  describe('Loading State Branch Coverage', () => {
    it('should show content after loading completes', async () => {
      wrapper = mount(EnrichmentSchema, buildMountOptions());

      await nextTick();
      await nextTick();

      expect(wrapper.find('.indexDetailsContainer').exists()).toBe(true);
      expect(wrapper.vm).toBeDefined();
    });
  });

  describe('Config-based Display Branch Coverage', () => {
    it('should show doc count when zoConfig.show_stream_stats_doc_num is true', async () => {
      const storeWithDocNum = createStore({
        state: {
          theme: 'light',
          zoConfig: {
            show_stream_stats_doc_num: true,
          },
        },
      });

      wrapper = mount(EnrichmentSchema, buildMountOptions(storeWithDocNum));

      await nextTick();
      await nextTick();

      const streamElements = wrapper.findAll('[data-test="schema-stream-title-text"]');
      const hasDocCountElement = streamElements.some((el) =>
        el.text().includes('Documents'),
      );
      expect(hasDocCountElement).toBe(true);
    });

    it('should hide doc count when zoConfig.show_stream_stats_doc_num is false', async () => {
      const storeWithoutDocNum = createStore({
        state: {
          theme: 'light',
          zoConfig: {
            show_stream_stats_doc_num: false,
          },
        },
      });

      wrapper = mount(EnrichmentSchema, buildMountOptions(storeWithoutDocNum));

      await nextTick();
      await nextTick();

      const streamElements = wrapper.findAll('[data-test="schema-stream-title-text"]');
      const hasDocCountElement = streamElements.some((el) =>
        el.text().includes('Documents'),
      );
      expect(hasDocCountElement).toBe(false);
    });
  });

  describe('Theme-based Styling Branch Coverage', () => {
    it('should apply light theme class when theme is light', async () => {
      const lightStore = createStore({
        state: {
          theme: 'light',
          zoConfig: {
            show_stream_stats_doc_num: true,
          },
        },
      });

      wrapper = mount(EnrichmentSchema, buildMountOptions(lightStore));

      await nextTick();
      await nextTick();

      const tableContainer = wrapper.find('.q-mt-lg');
      expect(tableContainer.classes()).toContain('light-theme-table');
    });

    it('should apply dark theme class when theme is dark', async () => {
      const darkStore = createStore({
        state: {
          theme: 'dark',
          zoConfig: {
            show_stream_stats_doc_num: true,
          },
        },
      });

      wrapper = mount(EnrichmentSchema, buildMountOptions(darkStore));

      await nextTick();
      await nextTick();

      const tableContainer = wrapper.find('.q-mt-lg');
      expect(tableContainer.classes()).toContain('dark-theme-table');
    });
  });

  describe('Error Handling Branch Coverage', () => {
    it('should handle getSchemaData error and set loading to false', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockGetStream.mockReset();
      mockGetStream.mockRejectedValueOnce(new Error('API Error'));

      wrapper = mount(EnrichmentSchema, buildMountOptions());

      await nextTick();
      await nextTick();
      await nextTick();

      expect(consoleSpy).toHaveBeenCalled();
      expect(wrapper.find('.q-spinner-hourglass').exists()).toBe(false);

      consoleSpy.mockRestore();
    });

    it('should test loading state transitions', async () => {
      wrapper = mount(EnrichmentSchema, buildMountOptions());

      await nextTick();
      await nextTick();

      expect(wrapper.find('.indexDetailsContainer').exists()).toBe(true);
      expect(wrapper.vm).toBeDefined();
    });
  });

  describe('Filter Functionality Branch Coverage', () => {
    it('should filter fields correctly when component is mounted', async () => {
      wrapper = mount(EnrichmentSchema, buildMountOptions());

      await nextTick();

      const filterFn = (wrapper.vm as any).filterFieldFn;
      const rows = [
        { name: 'username', type: 'string' },
        { name: 'email', type: 'string' },
        { name: 'age', type: 'number' },
      ];

      const filteredResults = filterFn(rows, 'user');
      expect(filteredResults).toHaveLength(1);
      expect(filteredResults[0].name).toBe('username');

      const noResults = filterFn(rows, 'xyz');
      expect(noResults).toHaveLength(0);
    });
  });

  describe('Cloud Environment Simulation', () => {
    it('should handle cloud vs non-cloud display logic', async () => {
      wrapper = mount(EnrichmentSchema, buildMountOptions());

      await nextTick();
      await nextTick();

      expect(wrapper.find('.stream_details_container').exists()).toBe(true);
    });
  });

  describe('Search Field Input Coverage', () => {
    it('should render schema field search input', async () => {
      wrapper = mount(EnrichmentSchema, buildMountOptions());

      await nextTick();
      await nextTick();

      const searchInput = wrapper.find('[data-test="schema-field-search-input"]');
      expect(searchInput.exists()).toBe(true);
    });

    it('should update filterField when search input changes', async () => {
      wrapper = mount(EnrichmentSchema, buildMountOptions());

      await nextTick();
      await nextTick();

      const vm = wrapper.vm as any;
      expect(vm.filterField).toBe('');

      vm.filterField = 'test_field';
      expect(vm.filterField).toBe('test_field');
    });
  });

  describe('Result Total and Field Count Coverage', () => {
    it('should set resultTotal from schema length after data load', async () => {
      wrapper = mount(EnrichmentSchema, buildMountOptions());

      await nextTick();
      await nextTick();

      const vm = wrapper.vm as any;
      expect(vm.resultTotal).toBe(2);
    });

    it('should display all-fields count in the display-total-fields element', async () => {
      wrapper = mount(EnrichmentSchema, buildMountOptions());

      await nextTick();
      await nextTick();

      const totalFields = wrapper.find('.display-total-fields');
      expect(totalFields.exists()).toBe(true);
      expect(totalFields.text()).toContain('2');
    });
  });

  describe('Pagination Coverage', () => {
    it('should update pagination values in changePagination', async () => {
      wrapper = mount(EnrichmentSchema, buildMountOptions());

      await nextTick();
      await nextTick();

      const vm = wrapper.vm as any;
      vm.changePagination({ label: '10', value: 10 });

      expect(vm.selectedPerPage).toBe(10);
      expect(vm.pagination.rowsPerPage).toBe(10);
    });

    it('should handle changePagination when qTable ref is null (optional chaining)', async () => {
      wrapper = mount(EnrichmentSchema, buildMountOptions());

      await nextTick();
      await nextTick();

      const vm = wrapper.vm as any;
      vm.qTable = null;

      expect(() => {
        vm.changePagination({ label: '20', value: 20 });
      }).not.toThrow();

      expect(vm.selectedPerPage).toBe(20);
    });

    it('should have correct perPageOptions', async () => {
      wrapper = mount(EnrichmentSchema, buildMountOptions());

      await nextTick();

      const vm = wrapper.vm as any;
      const values = vm.perPageOptions.map((o: any) => o.value);
      expect(values).toContain(5);
      expect(values).toContain(10);
      expect(values).toContain(20);
      expect(values).toContain(50);
    });
  });

  describe('filterFieldFn Comprehensive Coverage', () => {
    it('should return all rows when terms is empty string', async () => {
      wrapper = mount(EnrichmentSchema, buildMountOptions());

      await nextTick();

      const vm = wrapper.vm as any;
      const rows = [
        { name: 'field_a', type: 'string' },
        { name: 'field_b', type: 'number' },
      ];

      const result = vm.filterFieldFn(rows, '');
      expect(result).toHaveLength(2);
    });

    it('should filter case-insensitively', async () => {
      wrapper = mount(EnrichmentSchema, buildMountOptions());

      await nextTick();

      const vm = wrapper.vm as any;
      const rows = [
        { name: 'USERNAME', type: 'string' },
        { name: 'email_address', type: 'string' },
      ];

      const result = vm.filterFieldFn(rows, 'username');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('USERNAME');
    });

    it('should return empty array when no rows match', async () => {
      wrapper = mount(EnrichmentSchema, buildMountOptions());

      await nextTick();

      const vm = wrapper.vm as any;
      const rows = [{ name: 'field1', type: 'string' }];

      const result = vm.filterFieldFn(rows, 'xyz_not_found');
      expect(result).toHaveLength(0);
    });
  });

  describe('Schema Data Loading Coverage', () => {
    it('should set schemaData correctly after successful load', async () => {
      wrapper = mount(EnrichmentSchema, buildMountOptions());

      await nextTick();
      await nextTick();

      const vm = wrapper.vm as any;
      expect(vm.schemaData.name).toBe('test_stream');
      expect(vm.schemaData.schema).toHaveLength(2);
    });

    it('should reset loadingState to false after successful load', async () => {
      wrapper = mount(EnrichmentSchema, buildMountOptions());

      await nextTick();
      await nextTick();

      const vm = wrapper.vm as any;
      expect(vm.loadingState).toBe(false);
    });

    it('should call getStream with enrichment_tables type', async () => {
      wrapper = mount(
        EnrichmentSchema,
        buildMountOptions(mockStore, { selectedEnrichmentTable: 'my_table' }),
      );

      await nextTick();
      await nextTick();

      expect(mockGetStream).toHaveBeenCalledWith('my_table', 'enrichment_tables', true);
    });
  });
});
