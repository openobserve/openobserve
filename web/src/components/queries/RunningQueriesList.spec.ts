import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { Quasar, QTable } from 'quasar';
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
      'alerts.streamType': 'Stream Type',
      'common.actions': 'Actions',
      'queries.cancelQuery': 'Cancel Query',
      'queries.queryList': 'Query List'
    }
  }
});

const mockRows = [
  {
    id: 1,
    user_id: 'user1@example.com',
    org_id: 'org1',
    search_type: 'logs',
    duration: '5s',
    queryRange: '1h',
    work_group: 'default',
    status: 'running',
    stream_type: 'logs'
  },
  {
    id: 2,
    user_id: 'user2@example.com',
    org_id: 'org2',
    search_type: 'metrics',
    duration: '10s',
    queryRange: '2h',
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
        plugins: [i18n, Quasar, store],
        stubs: {
          QueryList: {
            template: '<div data-test="query-list"><slot /></div>'
          },
          QTablePagination: {
            template: '<div data-test="pagination"></div>'
          },
          NoData: {
            template: '<div data-test="no-data">No Data</div>'
          }
        }
      }
    });
  };

  const mockQTable = (wrapper: VueWrapper<any>) => {
    wrapper.vm.qTable = {
      setPagination: vi.fn()
    };
    return wrapper.vm.qTable;
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

    it('should initialize lastRefreshed as empty string', () => {
      expect(wrapper.vm.lastRefreshed).toBe('');
    });

    it('should initialize resultTotal as 0', () => {
      expect(wrapper.vm.resultTotal).toBe(0);
    });

    it('should initialize loadingState as false', () => {
      expect(wrapper.vm.loadingState).toBe(false);
    });

    it('should initialize showListSchemaDialog as false', () => {
      expect(wrapper.vm.showListSchemaDialog).toBe(false);
    });

    it('should initialize selectedPerPage as 20', () => {
      expect(wrapper.vm.selectedPerPage).toBe(20);
    });

    it('should initialize pagination with rowsPerPage 20', () => {
      expect(wrapper.vm.pagination.rowsPerPage).toBe(20);
    });

    it('should initialize qTable as ref', () => {
      // After mounting, qTable should be assigned the table component
      expect(wrapper.vm.qTable).toBeDefined();
      expect(typeof wrapper.vm.qTable).toBe('object');
    });
  });

  describe('DeleteDialog State', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should initialize deleteDialog with correct default values', () => {
      const deleteDialog = wrapper.vm.deleteDialog;
      expect(deleteDialog.show).toBe(false);
      expect(deleteDialog.title).toBe('Delete Running Query');
      expect(deleteDialog.message).toBe('Are you sure you want to delete this running query?');
      expect(deleteDialog.data).toBe(null);
    });

    it('should allow modification of deleteDialog show property', () => {
      wrapper.vm.deleteDialog.show = true;
      expect(wrapper.vm.deleteDialog.show).toBe(true);
    });

    it('should allow modification of deleteDialog data property', () => {
      const testData = { id: 1, name: 'test' };
      wrapper.vm.deleteDialog.data = testData;
      expect(wrapper.vm.deleteDialog.data).toEqual(testData);
    });
  });

  describe('PerPageOptions Configuration', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should have correct perPageOptions structure', () => {
      const expectedOptions = [
        { label: "5", value: 5 },
        { label: "10", value: 10 },
        { label: "20", value: 20 },
        { label: "50", value: 50 },
        { label: "100", value: 100 }
      ];
      expect(wrapper.vm.perPageOptions).toEqual(expectedOptions);
    });
  });

  describe('Table Columns Configuration', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should have correct number of columns', () => {
      expect(wrapper.vm.columns).toHaveLength(11);
    });

    it('should have correct column for row number', () => {
      const column = wrapper.vm.columns.find((col: any) => col.name === '#');
      expect(column).toBeDefined();
      expect(column.field).toBe('#');
      expect(column.label).toBe('#');
      expect(column.align).toBe('left');
    });

    it('should have correct column for user_id', () => {
      const column = wrapper.vm.columns.find((col: any) => col.name === 'user_id');
      expect(column).toBeDefined();
      expect(column.field).toBe('user_id');
      expect(column.sortable).toBe(true);
      expect(column.align).toBe('left');
    });

    it('should have correct column for org_id', () => {
      const column = wrapper.vm.columns.find((col: any) => col.name === 'org_id');
      expect(column).toBeDefined();
      expect(column.field).toBe('org_id');
      expect(column.sortable).toBe(true);
      expect(column.align).toBe('left');
    });

    it('should have correct column for search_type', () => {
      const column = wrapper.vm.columns.find((col: any) => col.name === 'search_type');
      expect(column).toBeDefined();
      expect(column.field).toBe('search_type');
      expect(column.sortable).toBe(true);
      expect(column.align).toBe('left');
    });

    it('should have correct column for duration', () => {
      const column = wrapper.vm.columns.find((col: any) => col.name === 'duration');
      expect(column).toBeDefined();
      expect(column.field).toBe('duration');
      expect(column.sortable).toBe(true);
      expect(column.align).toBe('left');
    });

    it('should have correct column for queryRange', () => {
      const column = wrapper.vm.columns.find((col: any) => col.name === 'queryRange');
      expect(column).toBeDefined();
      expect(column.field).toBe('queryRange');
      expect(column.sortable).toBe(true);
      expect(column.align).toBe('left');
    });

    it('should have correct column for work_group', () => {
      const column = wrapper.vm.columns.find((col: any) => col.name === 'work_group');
      expect(column).toBeDefined();
      expect(column.field).toBe('work_group');
      expect(column.sortable).toBe(true);
      expect(column.align).toBe('left');
    });

    it('should have correct column for status', () => {
      const column = wrapper.vm.columns.find((col: any) => col.name === 'status');
      expect(column).toBeDefined();
      expect(column.field).toBe('status');
      expect(column.sortable).toBe(true);
      expect(column.align).toBe('left');
    });

    it('should have correct column for stream_type', () => {
      const column = wrapper.vm.columns.find((col: any) => col.name === 'stream_type');
      expect(column).toBeDefined();
      expect(column.field).toBe('stream_type');
      expect(column.sortable).toBe(true);
      expect(column.align).toBe('left');
    });

    it('should have correct column for actions', () => {
      const column = wrapper.vm.columns.find((col: any) => col.name === 'actions');
      expect(column).toBeDefined();
      expect(column.field).toBe('actions');
      expect(column.align).toBe('center');
    });
  });

  describe('listSchema Function', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should emit show:schema event with correct data', () => {
      const mockRow = { id: 1, name: 'test query' };
      const mockProps = { row: mockRow };
      
      wrapper.vm.listSchema(mockProps);
      
      expect(wrapper.emitted('show:schema')).toBeTruthy();
      expect(wrapper.emitted('show:schema')[0]).toEqual([mockRow]);
    });

    it('should emit show:schema event multiple times with different data', () => {
      const mockRow1 = { id: 1, name: 'test query 1' };
      const mockRow2 = { id: 2, name: 'test query 2' };
      
      wrapper.vm.listSchema({ row: mockRow1 });
      wrapper.vm.listSchema({ row: mockRow2 });
      
      expect(wrapper.emitted('show:schema')).toHaveLength(2);
      expect(wrapper.emitted('show:schema')[0]).toEqual([mockRow1]);
      expect(wrapper.emitted('show:schema')[1]).toEqual([mockRow2]);
    });

    it('should handle empty row data', () => {
      const mockProps = { row: null };
      
      wrapper.vm.listSchema(mockProps);
      
      expect(wrapper.emitted('show:schema')).toBeTruthy();
      expect(wrapper.emitted('show:schema')[0]).toEqual([null]);
    });
  });

  describe('changePagination Function', () => {
    beforeEach(() => {
      wrapper = createWrapper();
      mockQTable(wrapper);
    });

    it('should update selectedPerPage when called', () => {
      const newVal = { label: "50", value: 50 };
      
      wrapper.vm.changePagination(newVal);
      
      expect(wrapper.vm.selectedPerPage).toBe(50);
    });

    it('should update pagination rowsPerPage when called', () => {
      const newVal = { label: "100", value: 100 };
      
      wrapper.vm.changePagination(newVal);
      
      expect(wrapper.vm.pagination.rowsPerPage).toBe(100);
    });

    it('should call qTable setPagination when qTable exists', () => {
      const newVal = { label: "10", value: 10 };
      
      wrapper.vm.changePagination(newVal);
      
      expect(wrapper.vm.qTable.setPagination).toHaveBeenCalledWith(wrapper.vm.pagination);
    });

    it('should not throw error when qTable is null', () => {
      wrapper.vm.qTable = null;
      const newVal = { label: "5", value: 5 };
      
      expect(() => wrapper.vm.changePagination(newVal)).not.toThrow();
      expect(wrapper.vm.selectedPerPage).toBe(5);
    });

    it('should handle different pagination values correctly', () => {
      const testValues = [5, 10, 20, 50, 100];
      
      testValues.forEach(value => {
        const newVal = { label: value.toString(), value };
        wrapper.vm.changePagination(newVal);
        
        expect(wrapper.vm.selectedPerPage).toBe(value);
        expect(wrapper.vm.pagination.rowsPerPage).toBe(value);
      });
    });
  });

  describe('selectedRowsModel Computed Property', () => {
    it('should return selectedRows prop value', () => {
      const selectedRows = [mockRows[0]];
      wrapper = createWrapper({ selectedRows });
      
      expect(wrapper.vm.selectedRowsModel).toEqual(selectedRows);
    });

    it('should emit update:selectedRows when set', () => {
      wrapper = createWrapper();
      const newSelectedRows = [mockRows[1]];
      
      wrapper.vm.selectedRowsModel = newSelectedRows;
      
      expect(wrapper.emitted('update:selectedRows')).toBeTruthy();
      expect(wrapper.emitted('update:selectedRows')[0]).toEqual([newSelectedRows]);
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

    it('should emit delete:query event with correct row data', () => {
      const mockRow = { id: 1, name: 'test query' };
      const mockProps = { row: mockRow };
      
      wrapper.vm.confirmDeleteAction(mockProps);
      
      expect(wrapper.emitted('delete:query')).toBeTruthy();
      expect(wrapper.emitted('delete:query')[0]).toEqual([mockRow]);
    });

    it('should emit delete:query event multiple times', () => {
      const mockRow1 = { id: 1, name: 'test query 1' };
      const mockRow2 = { id: 2, name: 'test query 2' };
      
      wrapper.vm.confirmDeleteAction({ row: mockRow1 });
      wrapper.vm.confirmDeleteAction({ row: mockRow2 });
      
      expect(wrapper.emitted('delete:query')).toHaveLength(2);
      expect(wrapper.emitted('delete:query')[0]).toEqual([mockRow1]);
      expect(wrapper.emitted('delete:query')[1]).toEqual([mockRow2]);
    });

    it('should handle null row data', () => {
      const mockProps = { row: null };
      
      wrapper.vm.confirmDeleteAction(mockProps);
      
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

  describe('Component Emits', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should emit update:selectedRows when selected rows change', async () => {
      const checkbox = wrapper.find('[data-test="running-queries-table"] .q-checkbox');
      await checkbox.trigger('click');
      
      expect(wrapper.emitted('update:selectedRows')).toBeTruthy();
    });

    it('should emit delete:query when cancel button is clicked', async () => {
      const cancelButton = wrapper.find('[data-test="cancelQuery-btn"]');
      await cancelButton.trigger('click');
      
      expect(wrapper.emitted('delete:query')).toBeTruthy();
      expect(wrapper.emitted('delete:query')[0]).toEqual([mockRows[0]]);
    });

    it('should emit delete:queries when multiple cancel button is clicked', async () => {
      // First select some rows to enable the button
      await wrapper.setProps({ selectedRows: [mockRows[0]] });
      wrapper.vm.selectedRowsModel = [mockRows[0]];
      
      await wrapper.vm.$nextTick();
      
      const multiCancelButton = wrapper.find('[data-test="qm-multiple-cancel-query-btn"]');
      expect(multiCancelButton.exists()).toBe(true);
      
      // Check if button is enabled
      expect(multiCancelButton.attributes('disabled')).toBeFalsy();
      
      await multiCancelButton.trigger('click');
      
      expect(wrapper.emitted('delete:queries')).toBeTruthy();
    });

    it('should emit show:schema when list icon is clicked', async () => {
      const listButton = wrapper.find('[data-test="queryList-btn"]');
      await listButton.trigger('click');
      
      expect(wrapper.emitted('show:schema')).toBeTruthy();
      expect(wrapper.emitted('show:schema')[0]).toEqual([mockRows[0]]);
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

  describe('Icons and External Dependencies', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should have access to outlinedCancel icon', () => {
      expect(wrapper.vm.outlinedCancel).toBeDefined();
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
      
      expect(() => wrapper.vm.listSchema({})).not.toThrow();
      expect(() => wrapper.vm.confirmDeleteAction({})).not.toThrow();
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

    it('should allow updating lastRefreshed', () => {
      const timestamp = '2023-01-01T00:00:00Z';
      wrapper.vm.lastRefreshed = timestamp;
      expect(wrapper.vm.lastRefreshed).toBe(timestamp);
    });

    it('should allow updating resultTotal', () => {
      wrapper.vm.resultTotal = 100;
      expect(wrapper.vm.resultTotal).toBe(100);
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

  describe('Complex Scenarios', () => {
    it('should handle rapid pagination changes', () => {
      wrapper = createWrapper();
      const qTable = mockQTable(wrapper);
      
      const values = [5, 10, 20, 50, 100];
      values.forEach(value => {
        wrapper.vm.changePagination({ label: value.toString(), value });
      });
      
      expect(wrapper.vm.selectedPerPage).toBe(100);
      expect(qTable.setPagination).toHaveBeenCalledTimes(5);
    });

    it('should handle multiple delete operations', () => {
      wrapper = createWrapper();
      
      mockRows.forEach((row, index) => {
        wrapper.vm.confirmDeleteAction({ row });
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
        wrapper.vm.listSchema({ row });
      });
      
      expect(wrapper.emitted('show:schema')).toHaveLength(3);
      testRows.forEach((row, index) => {
        expect(wrapper.emitted('show:schema')[index]).toEqual([row]);
      });
    });
  });
});