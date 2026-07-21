import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import RunningQueriesList from '@/components/queries/RunningQueriesList.vue';
import store from '@/test/unit/helpers/store';

// Mock the composables
vi.mock('@/composables/useIsMetaOrg', () => ({
  default: () => ({
    isMetaOrg: vi.fn(() => false)
  })
}));

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      'user.email': 'Email',
      'organization.id': 'Organization ID',
      'queries.searchType': 'Search Type',
      'queries.duration': 'Duration',
      'queries.queryRange': 'Query Range',
      'queries.queryType': 'Query Type',
      'queries.status': 'Status',
      'queries.querySource': 'Query Source',
      'alerts.streamType': 'Stream Type',
      'common.actions': 'Actions',
      'queries.cancelQuery': 'Cancel Query',
      'queries.queryList': 'Query List'
    }
  }
});

const mockRows = [
  {
    trace_id: 'trace-1',
    user_id: 'user1@example.com',
    org_id: 'org1',
    search_type: 'logs',
    duration: 5,
    queryRange: 3600,
    work_group: 'default',
    status: 'running',
    stream_type: 'logs'
  },
  {
    trace_id: 'trace-2',
    user_id: 'user2@example.com',
    org_id: 'org2',
    search_type: 'metrics',
    duration: 10,
    queryRange: 7200,
    work_group: 'analytics',
    status: 'completed',
    stream_type: 'metrics'
  }
];


describe('RunningQueriesList.vue', () => {
  let wrapper: VueWrapper<any>;

  const createWrapper = (props = {}) => {
    return mount(RunningQueriesList, {
      props: {
        rows: mockRows,
        selectedRows: [],
        ...props
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          QueryList: {
            name: 'QueryList',
            props: ['schemaData'],
            emits: ['close'],
            template: '<div data-test="query-list"><slot /></div>'
          },
          NoData: {
            template: '<div data-test="no-data">No Data</div>'
          },
          ODrawer: {
            name: 'ODrawer',
            props: ['open', 'size', 'persistent', 'title', 'subTitle', 'showClose', 'width', 'primaryButtonLabel', 'secondaryButtonLabel', 'neutralButtonLabel'],
            emits: ['update:open', 'click:primary', 'click:secondary', 'click:neutral'],
            template: '<div data-test="o-drawer-stub" :data-open="open" :data-size="size"><slot /><slot name="header" /><slot name="footer" /></div>'
          },
          OTable: {
            name: 'OTable',
            props: ['data', 'columns', 'rowKey', 'selectedIds', 'selection', 'pagination', 'pageSize', 'pageSizeOptions', 'sorting', 'filterMode', 'defaultColumns', 'showGlobalFilter'],
            emits: ['update:selected-ids', 'row-click'],
            template: '<div data-test="o-table-stub"><slot name="cell-actions" :row="{}" /><slot name="cell-duration" :row="{}" /><slot name="cell-queryRange" :row="{}" /><slot name="empty" /><slot name="bottom" /></div>'
          }
        }
      }
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
    it('should render the component successfully', () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it('should have the correct component name', () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe('RunningQueriesList');
    });

    it('should initialize with default props', () => {
      wrapper = createWrapper();
      expect(wrapper.props('rows')).toEqual(mockRows);
      expect(wrapper.props('selectedRows')).toEqual([]);
    });

    it('should initialize with provided selectedRows prop', () => {
      const selectedRows = [mockRows[0]];
      wrapper = createWrapper({ selectedRows });
      expect(wrapper.props('selectedRows')).toEqual(selectedRows);
    });
  });

  describe('Reactive Data Properties', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should initialize schemaData as empty object', () => {
      expect(wrapper.vm.schemaData).toEqual({});
    });

    it('should initialize loadingState as false', () => {
      expect(wrapper.vm.loadingState).toBe(false);
    });

    it('should initialize showListSchemaDialog as false', () => {
      expect(wrapper.vm.showListSchemaDialog).toBe(false);
    });
  });

  describe('Table Columns Configuration', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should have correct number of columns', () => {
      expect(wrapper.vm.columns).toHaveLength(10);
    });

    // Row numbering moved to OTable's built-in show-index (no '#' column).

    it('should have correct column for user_id', () => {
      const column = wrapper.vm.columns.find((col: any) => col.id === 'user_id');
      expect(column).toBeDefined();
      expect(column.accessorKey).toBe('user_id');
      expect(column.sortable).toBe(true);
    });

    it('should have correct column for org_id', () => {
      const column = wrapper.vm.columns.find((col: any) => col.id === 'org_id');
      expect(column).toBeDefined();
      expect(column.accessorKey).toBe('org_id');
      expect(column.sortable).toBe(true);
    });

    it('should have correct column for search_type', () => {
      const column = wrapper.vm.columns.find((col: any) => col.id === 'search_type');
      expect(column).toBeDefined();
      expect(column.accessorKey).toBe('search_type');
      expect(column.sortable).toBe(true);
    });

    it('should have correct column for query_source', () => {
      const column = wrapper.vm.columns.find((col: any) => col.id === 'query_source');
      expect(column).toBeDefined();
      expect(column.accessorKey).toBe('query_source');
      expect(column.sortable).toBe(true);
    });

    it('should have correct column for duration', () => {
      const column = wrapper.vm.columns.find((col: any) => col.id === 'duration');
      expect(column).toBeDefined();
      expect(column.accessorKey).toBe('duration');
      expect(column.sortable).toBe(true);
    });

    it('should have correct column for queryRange', () => {
      const column = wrapper.vm.columns.find((col: any) => col.id === 'queryRange');
      expect(column).toBeDefined();
      expect(column.accessorKey).toBe('queryRange');
      expect(column.sortable).toBe(true);
    });

    it('should have correct column for work_group', () => {
      const column = wrapper.vm.columns.find((col: any) => col.id === 'work_group');
      expect(column).toBeDefined();
      expect(column.accessorKey).toBe('work_group');
      expect(column.sortable).toBe(true);
    });

    it('should have correct column for status', () => {
      const column = wrapper.vm.columns.find((col: any) => col.id === 'status');
      expect(column).toBeDefined();
      expect(column.accessorKey).toBe('status');
      expect(column.sortable).toBe(true);
    });

    it('should have correct column for stream_type', () => {
      const column = wrapper.vm.columns.find((col: any) => col.id === 'stream_type');
      expect(column).toBeDefined();
      expect(column.accessorKey).toBe('stream_type');
      expect(column.sortable).toBe(true);
    });

    it('should have correct column for actions', () => {
      const column = wrapper.vm.columns.find((col: any) => col.id === 'actions');
      expect(column).toBeDefined();
      expect(column.isAction).toBe(true);
      expect(column.pinned).toBe('right');
    });
  });

  describe('listSchema Function', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should emit show:schema event with row data directly', () => {
      const mockRow = { id: 1, name: 'test query' };

      wrapper.vm.listSchema(mockRow);

      expect(wrapper.emitted('show:schema')).toBeTruthy();
      expect(wrapper.emitted('show:schema')[0]).toEqual([mockRow]);
    });

    it('should emit show:schema event multiple times with different data', () => {
      const mockRow1 = { id: 1, name: 'test query 1' };
      const mockRow2 = { id: 2, name: 'test query 2' };

      wrapper.vm.listSchema(mockRow1);
      wrapper.vm.listSchema(mockRow2);

      expect(wrapper.emitted('show:schema')).toHaveLength(2);
      expect(wrapper.emitted('show:schema')[0]).toEqual([mockRow1]);
      expect(wrapper.emitted('show:schema')[1]).toEqual([mockRow2]);
    });

    it('should handle null row data', () => {
      wrapper.vm.listSchema(null);

      expect(wrapper.emitted('show:schema')).toBeTruthy();
      expect(wrapper.emitted('show:schema')[0]).toEqual([null]);
    });
  });

  describe('selectedRowsModel Computed Property', () => {
    it('should return selectedRows prop value', () => {
      const selectedRows = [mockRows[0]];
      wrapper = createWrapper({ selectedRows });

      expect(wrapper.vm.selectedRowsModel).toEqual(selectedRows);
    });

    it('should handle empty selectedRows', () => {
      wrapper = createWrapper({ selectedRows: [] });

      expect(wrapper.vm.selectedRowsModel).toEqual([]);
    });

    it('should handle multiple selectedRows', () => {
      const selectedRows = mockRows;
      wrapper = createWrapper({ selectedRows });

      expect(wrapper.vm.selectedRowsModel).toEqual(mockRows);
    });
  });

  describe('confirmDeleteAction Function', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should emit delete:query event with row data directly', () => {
      const mockRow = { id: 1, name: 'test query' };

      wrapper.vm.confirmDeleteAction(mockRow);

      expect(wrapper.emitted('delete:query')).toBeTruthy();
      expect(wrapper.emitted('delete:query')[0]).toEqual([mockRow]);
    });

    it('should emit delete:query event multiple times', () => {
      const mockRow1 = { id: 1, name: 'test query 1' };
      const mockRow2 = { id: 2, name: 'test query 2' };

      wrapper.vm.confirmDeleteAction(mockRow1);
      wrapper.vm.confirmDeleteAction(mockRow2);

      expect(wrapper.emitted('delete:query')).toHaveLength(2);
      expect(wrapper.emitted('delete:query')[0]).toEqual([mockRow1]);
      expect(wrapper.emitted('delete:query')[1]).toEqual([mockRow2]);
    });

    it('should handle null row data', () => {
      wrapper.vm.confirmDeleteAction(null);

      expect(wrapper.emitted('delete:query')).toBeTruthy();
      expect(wrapper.emitted('delete:query')[0]).toEqual([null]);
    });
  });

  describe('handleMultiQueryCancel Function', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should emit delete:queries event', () => {
      wrapper.vm.handleMultiQueryCancel();

      expect(wrapper.emitted('delete:queries')).toBeTruthy();
      expect(wrapper.emitted('delete:queries')).toHaveLength(1);
    });

    it('should emit delete:queries event multiple times when called multiple times', () => {
      wrapper.vm.handleMultiQueryCancel();
      wrapper.vm.handleMultiQueryCancel();
      wrapper.vm.handleMultiQueryCancel();

      expect(wrapper.emitted('delete:queries')).toHaveLength(3);
    });

    it('should emit delete:queries event without parameters', () => {
      wrapper.vm.handleMultiQueryCancel();

      expect(wrapper.emitted('delete:queries')[0]).toEqual([]);
    });
  });

  describe('Store Integration', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should have access to store', () => {
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state).toBeDefined();
    });

    it('should have access to store state properties', () => {
      expect(wrapper.vm.store.state.selectedOrganization).toBeDefined();
      expect(wrapper.vm.store.state.userInfo).toBeDefined();
    });
  });

  describe('Composables Integration', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should have access to isMetaOrg from useIsMetaOrg composable', () => {
      expect(wrapper.vm.isMetaOrg).toBeDefined();
    });

    it('should have access to t function from useI18n', () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(typeof wrapper.vm.t).toBe('function');
    });
  });

  describe('handleSelectedIdsUpdate Function', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should emit update:selectedRows with matched rows', () => {
      wrapper.vm.handleSelectedIdsUpdate(['trace-1']);

      expect(wrapper.emitted('update:selectedRows')).toBeTruthy();
      expect(wrapper.emitted('update:selectedRows')[0]).toEqual([[mockRows[0]]]);
    });

    it('should emit update:selectedRows with empty array when no IDs match', () => {
      wrapper.vm.handleSelectedIdsUpdate(['nonexistent']);

      expect(wrapper.emitted('update:selectedRows')).toBeTruthy();
      expect(wrapper.emitted('update:selectedRows')[0]).toEqual([[]]);
    });
  });

  describe('Props Validation', () => {
    it('should accept valid rows prop', () => {
      expect(() => createWrapper({ rows: mockRows })).not.toThrow();
    });

    it('should accept empty rows array', () => {
      expect(() => createWrapper({ rows: [] })).not.toThrow();
    });

    it('should accept valid selectedRows prop', () => {
      expect(() => createWrapper({ selectedRows: [mockRows[0]] })).not.toThrow();
    });

    it('should handle selectedRows prop as optional', () => {
      wrapper = createWrapper({ rows: mockRows });
      expect(wrapper.props('selectedRows')).toEqual([]);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle undefined props gracefully', () => {
      expect(() => createWrapper({
        rows: [],
        selectedRows: []
      })).not.toThrow();
    });

    it('should handle empty function calls gracefully', () => {
      wrapper = createWrapper();

      expect(() => wrapper.vm.listSchema(null)).not.toThrow();
      expect(() => wrapper.vm.confirmDeleteAction(null)).not.toThrow();
      expect(() => wrapper.vm.handleMultiQueryCancel()).not.toThrow();
    });
  });

  describe('Reactive Properties Updates', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should allow updating schemaData', () => {
      const newSchema = { field: 'value' };
      wrapper.vm.schemaData = newSchema;
      expect(wrapper.vm.schemaData).toEqual(newSchema);
    });

    it('should allow updating loadingState', () => {
      wrapper.vm.loadingState = true;
      expect(wrapper.vm.loadingState).toBe(true);
    });

    it('should allow updating showListSchemaDialog', () => {
      wrapper.vm.showListSchemaDialog = true;
      expect(wrapper.vm.showListSchemaDialog).toBe(true);
    });
  });

  describe('ODrawer Schema Dialog Migration', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should render ODrawer stub for schema dialog', () => {
      const drawer = wrapper.find('[data-test="list-schema-dialog"]');
      expect(drawer.exists()).toBe(true);
    });

    it('should pass size="lg" to ODrawer', () => {
      const drawer = wrapper.find('[data-test="list-schema-dialog"]');
      expect(drawer.attributes('data-size')).toBe('lg');
    });

    it('should pass showListSchemaDialog state as ODrawer open prop (false by default)', () => {
      const drawer = wrapper.find('[data-test="list-schema-dialog"]');
      expect(drawer.attributes('data-open')).toBe('false');
    });

    it('should sync ODrawer open prop when showListSchemaDialog becomes true', async () => {
      wrapper.vm.showListSchemaDialog = true;
      await wrapper.vm.$nextTick();

      const drawer = wrapper.find('[data-test="list-schema-dialog"]');
      expect(drawer.attributes('data-open')).toBe('true');
    });

    it('should update showListSchemaDialog when ODrawer emits update:open=false', async () => {
      wrapper.vm.showListSchemaDialog = true;
      await wrapper.vm.$nextTick();

      const drawer = wrapper.findComponent({ name: 'ODrawer' });
      expect(drawer.exists()).toBe(true);
      await drawer.vm.$emit('update:open', false);

      expect(wrapper.vm.showListSchemaDialog).toBe(false);
    });

    it('should set showListSchemaDialog to false when QueryList emits close', async () => {
      wrapper.vm.showListSchemaDialog = true;
      await wrapper.vm.$nextTick();

      const queryList = wrapper.findComponent({ name: 'QueryList' });
      expect(queryList.exists()).toBe(true);

      await queryList.vm.$emit('close');

      expect(wrapper.vm.showListSchemaDialog).toBe(false);
    });

    it('should pass schemaData prop to QueryList', () => {
      const queryList = wrapper.findComponent({ name: 'QueryList' });
      expect(queryList.exists()).toBe(true);
      expect(queryList.props('schemaData')).toEqual({});
    });

    it('should pass updated schemaData to QueryList after change', async () => {
      const newSchema = { stream: 'logs', field: 'msg' };
      wrapper.vm.schemaData = newSchema;
      await wrapper.vm.$nextTick();

      const queryList = wrapper.findComponent({ name: 'QueryList' });
      expect(queryList.props('schemaData')).toEqual(newSchema);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle multiple delete operations', () => {
      wrapper = createWrapper();

      mockRows.forEach((row) => {
        wrapper.vm.confirmDeleteAction(row);
      });

      expect(wrapper.emitted('delete:query')).toHaveLength(2);
    });

    it('should handle schema operations on different rows', () => {
      wrapper = createWrapper();

      const testRows = [
        { id: 1, schema: 'logs' },
        { id: 2, schema: 'metrics' },
        { id: 3, schema: 'traces' }
      ];

      testRows.forEach(row => {
        wrapper.vm.listSchema(row);
      });

      expect(wrapper.emitted('show:schema')).toHaveLength(3);
      testRows.forEach((row, index) => {
        expect(wrapper.emitted('show:schema')[index]).toEqual([row]);
      });
    });
  });
});
