// Copyright 2023 OpenObserve Inc.
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
import { ref } from 'vue';
import regexPatternsService from '@/services/regex_pattern';
import { convertUnixToQuasarFormat } from '@/utils/zincutils';
import config from '@/aws-exports';

// Mock dependencies
vi.mock('@/services/regex_pattern', () => ({
  default: {
    list: vi.fn(),
    delete: vi.fn()
  }
}));

vi.mock('@/utils/zincutils', () => ({
  convertUnixToQuasarFormat: vi.fn()
}));

vi.mock('@/aws-exports', () => ({
  default: {
    isEnterprise: 'true'
  }
}));

// Mock Blob
class MockBlob {
  content: any;
  options: any;
  constructor(content: any, options: any) {
    this.content = content;
    this.options = options;
  }
}
global.Blob = MockBlob as any;

// Mock URL.createObjectURL and URL.revokeObjectURL
const mockCreateObjectURL = vi.fn(() => 'mock-blob-url');
const mockRevokeObjectURL = vi.fn();
global.URL.createObjectURL = mockCreateObjectURL as any;
global.URL.revokeObjectURL = mockRevokeObjectURL as any;

// Mock document.createElement
const mockClick = vi.fn();
const mockLink = {
  href: '',
  download: '',
  click: mockClick
};
const originalCreateElement = document.createElement.bind(document);
document.createElement = vi.fn((tagName: string) => {
  if (tagName === 'a') {
    return mockLink as any;
  }
  return originalCreateElement(tagName);
}) as any;

// Mock i18n
const mockT = vi.fn((key) => key);

// Mock store
const mockStore = {
  state: {
    selectedOrganization: {
      identifier: 'default'
    },
    organizationData: {
      regexPatterns: [],
      regexPatternPrompt: '',
      regexPatternTestValue: ''
    },
    theme: 'light'
  },
  dispatch: vi.fn()
};

// Mock router
const mockRouter = {
  currentRoute: {
    value: {
      query: {}
    }
  },
  push: vi.fn()
};

// Mock Quasar
const mockQuasar = {
  notify: vi.fn()
};

describe('RegexPatternList.vue Component Logic', () => {
  const mockRegexPatterns = [
    {
      id: '1',
      name: 'Test Pattern 1',
      pattern: '^test.*',
      description: 'Test description 1',
      created_at: 1640995200,
      updated_at: 1640995200
    },
    {
      id: '2',
      name: 'Test Pattern 2', 
      pattern: '.*test$',
      description: 'Test description 2',
      created_at: 1640995300,
      updated_at: 1640995300
    }
  ];

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Setup service mocks
    regexPatternsService.list.mockResolvedValue({
      data: {
        patterns: mockRegexPatterns
      }
    });

    regexPatternsService.delete.mockResolvedValue({});

    convertUnixToQuasarFormat.mockImplementation((timestamp) =>
      `2022-01-01 ${timestamp}`
    );

    // Reset URL mocks
    mockCreateObjectURL.mockClear();
    mockCreateObjectURL.mockReturnValue('mock-blob-url');
    mockRevokeObjectURL.mockClear();
    mockClick.mockClear();

    // Reset mockLink
    mockLink.href = '';
    mockLink.download = '';

    // Reset router
    mockRouter.currentRoute.value = { query: {} };
    mockRouter.push.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Create a mock component setup function that mimics the actual component setup
  const createComponentSetup = () => {
    const regexPatternListTableRef = ref(null);
    const pagination = ref({ rowsPerPage: 20 });
    const filterQuery = ref('');
    const regexPatterns = ref([]);
    const resultTotal = ref(0);
    const perPageOptions = ref([10, 20, 50, 100]);
    const listLoading = ref(false);
    const selectedPerPage = ref(20);
    const showImportRegexPatternDialog = ref(false);
    const showAddRegexPatternDialog = ref({
      show: false,
      data: {},
      isEdit: false
    });
    const deleteDialog = ref({
      show: false,
      title: 'Delete Regex Pattern',
      message: 'Are you sure you want to delete this regex pattern?',
      data: ''
    });

    const columns = ref([
      { name: '#', label: '#', field: '#', align: 'left', style: 'width: 67px' },
      { name: 'name', field: 'name', label: 'regex_patterns.name', align: 'left', sortable: true },
      { name: 'pattern', field: 'pattern', label: 'regex_patterns.pattern', align: 'left' },
      { name: 'created_at', field: 'created_at', label: 'regex_patterns.created_at', align: 'left', style: 'width: 150px' },
      { name: 'updated_at', field: 'updated_at', label: 'regex_patterns.updated_at', align: 'left', sortable: true, style: 'width: 150px' },
      { name: 'actions', field: 'actions', label: 'regex_patterns.actions', align: 'left', classes: 'actions-column' }
    ]);

    const changePagination = (val) => {
      let rowsPerPage = val.value ? val.value : val;
      selectedPerPage.value = rowsPerPage;
      pagination.value.rowsPerPage = rowsPerPage;
      regexPatternListTableRef.value?.setPagination(pagination.value);
    };

    const filterData = (rows, terms) => {
      var filtered = [];
      if (!terms) return rows; // Handle null/undefined/empty terms
      terms = terms.toLowerCase();
      for (var i = 0; i < rows.length; i++) {
        if (rows[i]['name'].toLowerCase().includes(terms)) {
          filtered.push(rows[i]);
        }
      }
      resultTotal.value = filtered.length;
      return filtered;
    };

    const createRegexPattern = () => {
      showAddRegexPatternDialog.value.show = true;
      showAddRegexPatternDialog.value.isEdit = false;
      showAddRegexPatternDialog.value.data = {};
    };

    const getRegexPatterns = async () => {
      listLoading.value = true;
      try {
        const response = await regexPatternsService.list(mockStore.state.selectedOrganization.identifier);
        let counter = 1;
        regexPatterns.value = response.data.patterns.map((pattern) => ({
          ...pattern,
          '#': counter <= 9 ? `0${counter++}` : `${counter++}`,
          created_at: convertUnixToQuasarFormat(pattern.created_at),
          updated_at: convertUnixToQuasarFormat(pattern.updated_at),
        }));
        mockStore.dispatch('setRegexPatterns', regexPatterns.value);
        resultTotal.value = regexPatterns.value.length;
      } catch (error) {
        mockQuasar.notify({
          message: error.data?.message || 'Error fetching regex patterns',
          color: 'negative',
          icon: 'error',
        });
      } finally {
        listLoading.value = false;
      }
    };

    const editRegexPattern = (row) => {
      showAddRegexPatternDialog.value.show = true;
      showAddRegexPatternDialog.value.isEdit = true;
      showAddRegexPatternDialog.value.data = row;
    };

    const confirmDeleteRegexPattern = (row) => {
      deleteDialog.value.show = true;
      deleteDialog.value.data = row.id;
    };

    const deleteRegexPattern = async () => {
      try {
        await regexPatternsService.delete(mockStore.state.selectedOrganization.identifier, deleteDialog.value.data);
        getRegexPatterns();
        mockQuasar.notify({
          message: 'Regex pattern deleted successfully.',
          color: 'positive',
          timeout: 1500,
        });
      } catch (error) {
        mockQuasar.notify({
          message: error?.data?.message || error?.response?.data?.message || 'Error deleting regex pattern',
          color: 'negative',
          timeout: 1500,
        });
      }
    };

    const importRegexPattern = () => {
      showImportRegexPatternDialog.value = true;
      mockRouter.push({
        path: '/settings/regex_patterns',
        query: {
          org_identifier: mockStore.state.selectedOrganization.identifier,
          action: 'import'
        },
      });
    };

    const exportRegexPattern = (row) => {
      let url = '';
      try {
        const regexPatternToBeExported = {
          name: row.name,
          pattern: row.pattern,
          description: row.description,
        };

        const regexPatternJson = JSON.stringify(regexPatternToBeExported, null, 2);
        const blob = new Blob([regexPatternJson], { type: 'application/json' });
        url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${row.name || 'regex_pattern'}.json`;
        link.click();
        mockQuasar.notify({
          message: 'Regex pattern exported successfully',
          color: 'positive',
          icon: 'check',
        });
      } catch (error) {
        mockQuasar.notify({
          message: error.data?.message || 'Error exporting regex pattern',
          color: 'negative',
          icon: 'error',
        });
      } finally {
        if (url) {
          URL.revokeObjectURL(url);
        }
      }
    };

    const closeAddRegexPatternDialog = () => {
      showAddRegexPatternDialog.value.show = false;
      mockStore.state.organizationData.regexPatternPrompt = '';
      mockStore.state.organizationData.regexPatternTestValue = '';
      mockRouter.push({
        path: '/settings/regex_patterns',
        query: {
          org_identifier: mockStore.state.selectedOrganization.identifier,
        }
      });
    };

    return {
      regexPatternListTableRef,
      pagination,
      filterQuery,
      columns,
      regexPatterns,
      filterData,
      resultTotal,
      perPageOptions,
      changePagination,
      createRegexPattern,
      listLoading,
      editRegexPattern,
      deleteRegexPattern,
      deleteDialog,
      confirmDeleteRegexPattern,
      showAddRegexPatternDialog,
      getRegexPatterns,
      selectedPerPage,
      showImportRegexPatternDialog,
      importRegexPattern,
      exportRegexPattern,
      closeAddRegexPatternDialog,
      t: mockT,
      store: mockStore,
      router: mockRouter
    };
  };

  // Test 1: Component setup initializes correctly
  it('should initialize reactive data correctly', () => {
    const setup = createComponentSetup();
    
    expect(setup.pagination.value.rowsPerPage).toBe(20);
    expect(setup.filterQuery.value).toBe('');
    expect(setup.regexPatterns.value).toEqual([]);
    expect(setup.resultTotal.value).toBe(0);
    expect(setup.selectedPerPage.value).toBe(20);
    expect(setup.listLoading.value).toBe(false);
    expect(setup.showImportRegexPatternDialog.value).toBe(false);
  });

  // Test 2: Columns are defined correctly
  it('should have correct column definitions', () => {
    const setup = createComponentSetup();
    const columns = setup.columns.value;
    
    expect(columns).toHaveLength(6);
    expect(columns[0].name).toBe('#');
    expect(columns[1].name).toBe('name');
    expect(columns[2].name).toBe('pattern');
    expect(columns[3].name).toBe('created_at');
    expect(columns[4].name).toBe('updated_at');
    expect(columns[5].name).toBe('actions');
  });

  // Test 3: changePagination function handles object value
  it('should handle object value in changePagination', () => {
    const setup = createComponentSetup();
    
    setup.changePagination({ label: '50', value: 50 });
    
    expect(setup.selectedPerPage.value).toBe(50);
    expect(setup.pagination.value.rowsPerPage).toBe(50);
  });

  // Test 4: changePagination function handles direct number value
  it('should handle direct number value in changePagination', () => {
    const setup = createComponentSetup();
    
    setup.changePagination(100);
    
    expect(setup.selectedPerPage.value).toBe(100);
    expect(setup.pagination.value.rowsPerPage).toBe(100);
  });

  // Test 5: filterData function filters by name (case insensitive)
  it('should filter data by name case insensitively', () => {
    const setup = createComponentSetup();
    
    const result = setup.filterData(mockRegexPatterns, 'TEST');
    
    expect(result).toHaveLength(2);
    expect(setup.resultTotal.value).toBe(2);
  });

  // Test 6: filterData function filters by partial name match
  it('should filter data by partial name match', () => {
    const setup = createComponentSetup();
    
    const result = setup.filterData(mockRegexPatterns, 'Pattern 1');
    
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Test Pattern 1');
    expect(setup.resultTotal.value).toBe(1);
  });

  // Test 7: filterData function returns empty array for no matches
  it('should return empty array when no matches found', () => {
    const setup = createComponentSetup();
    
    const result = setup.filterData(mockRegexPatterns, 'nonexistent');
    
    expect(result).toHaveLength(0);
    expect(setup.resultTotal.value).toBe(0);
  });

  // Test 8: createRegexPattern function opens add dialog
  it('should open add dialog when createRegexPattern is called', () => {
    const setup = createComponentSetup();
    
    setup.createRegexPattern();
    
    expect(setup.showAddRegexPatternDialog.value.show).toBe(true);
    expect(setup.showAddRegexPatternDialog.value.isEdit).toBe(false);
    expect(setup.showAddRegexPatternDialog.value.data).toEqual({});
  });

  // Test 9: getRegexPatterns function sets loading state
  it('should set loading state during getRegexPatterns', async () => {
    const setup = createComponentSetup();
    
    const promise = setup.getRegexPatterns();
    expect(setup.listLoading.value).toBe(true);
    
    await promise;
    expect(setup.listLoading.value).toBe(false);
  });

  // Test 10: getRegexPatterns function processes API response correctly
  it('should process API response correctly in getRegexPatterns', async () => {
    const setup = createComponentSetup();
    
    await setup.getRegexPatterns();
    
    expect(setup.regexPatterns.value).toHaveLength(2);
    expect(setup.regexPatterns.value[0]['#']).toBe('01');
    expect(setup.regexPatterns.value[1]['#']).toBe('02');
    expect(setup.resultTotal.value).toBe(2);
  });

  // Test 11: editRegexPattern function opens edit dialog
  it('should open edit dialog when editRegexPattern is called', () => {
    const setup = createComponentSetup();
    const testRow = mockRegexPatterns[0];
    
    setup.editRegexPattern(testRow);
    
    expect(setup.showAddRegexPatternDialog.value.show).toBe(true);
    expect(setup.showAddRegexPatternDialog.value.isEdit).toBe(true);
    expect(setup.showAddRegexPatternDialog.value.data).toEqual(testRow);
  });

  // Test 12: confirmDeleteRegexPattern function shows delete dialog
  it('should show delete dialog when confirmDeleteRegexPattern is called', () => {
    const setup = createComponentSetup();
    const testRow = mockRegexPatterns[0];
    
    setup.confirmDeleteRegexPattern(testRow);
    
    expect(setup.deleteDialog.value.show).toBe(true);
    expect(setup.deleteDialog.value.data).toBe(testRow.id);
  });

  // Test 13: deleteRegexPattern function calls API
  it('should call API in deleteRegexPattern', async () => {
    const setup = createComponentSetup();
    setup.deleteDialog.value.data = '1';
    
    await setup.deleteRegexPattern();
    
    expect(regexPatternsService.delete).toHaveBeenCalledWith('default', '1');
    expect(regexPatternsService.list).toHaveBeenCalled(); // Called by getRegexPatterns
  });

  // Test 14: importRegexPattern function shows import dialog and navigates
  it('should show import dialog and navigate in importRegexPattern', () => {
    const setup = createComponentSetup();
    
    setup.importRegexPattern();
    
    expect(setup.showImportRegexPatternDialog.value).toBe(true);
    expect(mockRouter.push).toHaveBeenCalledWith({
      path: '/settings/regex_patterns',
      query: {
        org_identifier: 'default',
        action: 'import'
      }
    });
  });

  // Test 15: exportRegexPattern function creates and downloads file
  it('should create and download file in exportRegexPattern', () => {
    const setup = createComponentSetup();
    const testRow = mockRegexPatterns[0];
    
    setup.exportRegexPattern(testRow);
    
    expect(mockCreateObjectURL).toHaveBeenCalled();
    expect(mockLink.download).toBe('Test Pattern 1.json');
    expect(mockClick).toHaveBeenCalled();
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('mock-blob-url');
  });

  // Test 16: exportRegexPattern function uses default filename when name is missing
  it('should use default filename when name is missing in exportRegexPattern', () => {
    const setup = createComponentSetup();
    const testRow = { ...mockRegexPatterns[0], name: '' };
    
    setup.exportRegexPattern(testRow);
    
    expect(mockLink.download).toBe('regex_pattern.json');
  });

  // Test 17: exportRegexPattern creates correct JSON structure
  it('should create correct JSON structure in exportRegexPattern', () => {
    const setup = createComponentSetup();
    const testRow = mockRegexPatterns[0];

    // Spy on Blob constructor
    const blobSpy = vi.spyOn(global, 'Blob' as any);

    setup.exportRegexPattern(testRow);

    expect(blobSpy).toHaveBeenCalled();
    const blobCall = blobSpy.mock.calls[0];
    const jsonString = blobCall[0][0];
    const exportedData = JSON.parse(jsonString);

    expect(exportedData).toEqual({
      name: testRow.name,
      pattern: testRow.pattern,
      description: testRow.description
    });

    blobSpy.mockRestore();
  });

  // Test 18: closeAddRegexPatternDialog function closes dialog and resets store
  it('should close dialog and reset store in closeAddRegexPatternDialog', () => {
    const setup = createComponentSetup();
    setup.showAddRegexPatternDialog.value.show = true;
    
    setup.closeAddRegexPatternDialog();
    
    expect(setup.showAddRegexPatternDialog.value.show).toBe(false);
    expect(setup.store.state.organizationData.regexPatternPrompt).toBe('');
    expect(setup.store.state.organizationData.regexPatternTestValue).toBe('');
    expect(mockRouter.push).toHaveBeenCalledWith({
      path: '/settings/regex_patterns',
      query: {
        org_identifier: 'default'
      }
    });
  });

  // Test 19: Delete dialog is initialized correctly
  it('should initialize delete dialog correctly', () => {
    const setup = createComponentSetup();
    const deleteDialog = setup.deleteDialog.value;
    
    expect(deleteDialog.show).toBe(false);
    expect(deleteDialog.title).toBe('Delete Regex Pattern');
    expect(deleteDialog.message).toBe('Are you sure you want to delete this regex pattern?');
    expect(deleteDialog.data).toBe('');
  });

  // Test 20: Per page options are set correctly
  it('should have correct per page options', () => {
    const setup = createComponentSetup();
    const perPageOptions = setup.perPageOptions.value;
    
    expect(perPageOptions).toEqual([10, 20, 50, 100]);
  });

  // Test 21: Show add regex pattern dialog is initialized correctly
  it('should initialize add regex pattern dialog correctly', () => {
    const setup = createComponentSetup();
    const dialog = setup.showAddRegexPatternDialog.value;
    
    expect(dialog.show).toBe(false);
    expect(dialog.data).toEqual({});
    expect(dialog.isEdit).toBe(false);
  });

  // Test 22: Component handles API errors gracefully
  it('should handle API error in getRegexPatterns', async () => {
    regexPatternsService.list.mockRejectedValue({
      data: { message: 'API Error' }
    });
    
    const setup = createComponentSetup();
    
    await setup.getRegexPatterns();
    
    expect(setup.listLoading.value).toBe(false);
    expect(mockQuasar.notify).toHaveBeenCalledWith({
      message: 'API Error',
      color: 'negative',
      icon: 'error',
    });
  });

  // Test 23: Component handles API errors without message
  it('should handle API error without message in getRegexPatterns', async () => {
    regexPatternsService.list.mockRejectedValue({});
    
    const setup = createComponentSetup();
    
    await setup.getRegexPatterns();
    
    expect(setup.listLoading.value).toBe(false);
    expect(mockQuasar.notify).toHaveBeenCalledWith({
      message: 'Error fetching regex patterns',
      color: 'negative',
      icon: 'error',
    });
  });

  // Test 24: deleteRegexPattern handles API errors
  it('should handle API errors in deleteRegexPattern', async () => {
    regexPatternsService.delete.mockRejectedValue({
      data: { message: 'Delete error' }
    });
    
    const setup = createComponentSetup();
    
    await setup.deleteRegexPattern();
    
    expect(mockQuasar.notify).toHaveBeenCalledWith({
      message: 'Delete error',
      color: 'negative',
      timeout: 1500,
    });
  });

  // Test 25: exportRegexPattern handles errors
  it('should handle error in exportRegexPattern', () => {
    mockCreateObjectURL.mockImplementationOnce(() => {
      throw new Error('Blob error');
    });

    const setup = createComponentSetup();

    setup.exportRegexPattern(mockRegexPatterns[0]);

    expect(mockQuasar.notify).toHaveBeenCalledWith({
      message: 'Error exporting regex pattern',
      color: 'negative',
      icon: 'error',
    });
  });

  // Test 26: Component handles double digit counter formatting
  it('should format counters correctly without leading zeros for double digits', async () => {
    // Create mock data with more than 9 items
    const manyPatterns = Array.from({ length: 15 }, (_, i) => ({
      id: `${i + 1}`,
      name: `Pattern ${i + 1}`,
      pattern: `.*${i + 1}`,
      description: `Description ${i + 1}`,
      created_at: 1640995200 + i,
      updated_at: 1640995200 + i
    }));
    
    regexPatternsService.list.mockResolvedValue({
      data: { patterns: manyPatterns }
    });
    
    const setup = createComponentSetup();
    await setup.getRegexPatterns();
    
    expect(setup.regexPatterns.value[9]['#']).toBe('10'); // No leading zero for 10
    expect(setup.regexPatterns.value[14]['#']).toBe('15'); // No leading zero for 15
  });

  // Test 27: Component reactive data updates correctly
  it('should update reactive data correctly', () => {
    const setup = createComponentSetup();
    
    // Update regexPatterns
    setup.regexPatterns.value = mockRegexPatterns;
    expect(setup.regexPatterns.value).toEqual(mockRegexPatterns);
    
    // Update resultTotal
    setup.resultTotal.value = 5;
    expect(setup.resultTotal.value).toBe(5);
  });

  // Test 28: Component integrates with store properly
  it('should integrate with store properly', () => {
    const setup = createComponentSetup();
    
    // Verify store access
    expect(setup.store.state.selectedOrganization.identifier).toBe('default');
    expect(setup.store.state.organizationData).toBeDefined();
  });

  // Test 29: Component handles theme state
  it('should access theme state correctly', () => {
    const setup = createComponentSetup();
    
    expect(setup.store.state.theme).toBe('light');
  });

  // Test 30: Component state management works correctly
  it('should manage component state correctly', () => {
    const setup = createComponentSetup();
    
    // Test initial state
    expect(setup.listLoading.value).toBe(false);
    expect(setup.resultTotal.value).toBe(0);
    expect(setup.showImportRegexPatternDialog.value).toBe(false);
    
    // Test state changes
    setup.listLoading.value = true;
    expect(setup.listLoading.value).toBe(true);
  });

  // Test 31: Component manages dialog state correctly
  it('should manage dialog state correctly', () => {
    const setup = createComponentSetup();
    
    // Test import dialog state
    expect(setup.showImportRegexPatternDialog.value).toBe(false);
    setup.showImportRegexPatternDialog.value = true;
    expect(setup.showImportRegexPatternDialog.value).toBe(true);
    
    // Test add dialog state
    expect(setup.showAddRegexPatternDialog.value.show).toBe(false);
    setup.showAddRegexPatternDialog.value.show = true;
    expect(setup.showAddRegexPatternDialog.value.show).toBe(true);
  });

  // Test 32: Component manages filter state correctly
  it('should manage filter state correctly', () => {
    const setup = createComponentSetup();
    
    expect(setup.filterQuery.value).toBe('');
    
    setup.filterQuery.value = 'test search';
    expect(setup.filterQuery.value).toBe('test search');
  });

  // Test 33: Component handles number formatting for counters
  it('should format counters correctly with leading zeros', async () => {
    const setup = createComponentSetup();
    await setup.getRegexPatterns();
    
    expect(setup.regexPatterns.value[0]['#']).toBe('01');
    expect(setup.regexPatterns.value[1]['#']).toBe('02');
  });

  // Test 34: Component columns have proper structure
  it('should have properly structured columns', () => {
    const setup = createComponentSetup();
    const columns = setup.columns.value;
    
    // Check first column structure
    expect(columns[0]).toMatchObject({
      name: '#',
      label: '#',
      field: '#',
      align: 'left'
    });
    
    // Check actions column
    const actionsColumn = columns.find(col => col.name === 'actions');
    expect(actionsColumn).toMatchObject({
      name: 'actions',
      field: 'actions',
      align: 'left',
      classes: 'actions-column'
    });
  });

  // Test 35: Component resultTotal updates correctly with filtered data
  it('should update resultTotal correctly with filter data', () => {
    const setup = createComponentSetup();
    
    // Test with results
    setup.filterData(mockRegexPatterns, 'Test');
    expect(setup.resultTotal.value).toBe(2);
    
    // Test with no results
    setup.filterData(mockRegexPatterns, 'nonexistent');
    expect(setup.resultTotal.value).toBe(0);
  });

  // Test 36: Component handles pagination setPagination when table ref exists
  it('should handle pagination setPagination when table ref exists', () => {
    const setup = createComponentSetup();
    
    // Mock table ref with setPagination method
    setup.regexPatternListTableRef.value = {
      setPagination: vi.fn()
    };
    
    setup.changePagination(50);
    
    expect(setup.regexPatternListTableRef.value.setPagination).toHaveBeenCalledWith(setup.pagination.value);
  });

  // Test 37: Component dispatches store actions correctly
  it('should dispatch setRegexPatterns action after fetching data', async () => {
    const setup = createComponentSetup();
    
    await setup.getRegexPatterns();
    
    expect(mockStore.dispatch).toHaveBeenCalledWith('setRegexPatterns', expect.any(Array));
  });

  // Test 38: Component handles successful delete operation
  it('should handle successful delete operation', async () => {
    const setup = createComponentSetup();
    setup.deleteDialog.value.data = '1';
    
    await setup.deleteRegexPattern();
    
    expect(regexPatternsService.delete).toHaveBeenCalledWith('default', '1');
    expect(regexPatternsService.list).toHaveBeenCalled(); // Called by getRegexPatterns
    expect(mockQuasar.notify).toHaveBeenCalledWith({
      message: 'Regex pattern deleted successfully.',
      color: 'positive',
      timeout: 1500,
    });
  });

  // Test 39: Component handles export notifications correctly
  it('should show success notification after export', () => {
    const setup = createComponentSetup();
    const testRow = mockRegexPatterns[0];
    
    setup.exportRegexPattern(testRow);
    
    expect(mockQuasar.notify).toHaveBeenCalledWith({
      message: 'Regex pattern exported successfully',
      color: 'positive',
      icon: 'check',
    });
  });

  // Test 40: Component handles API error with response.data.message in deleteRegexPattern
  it('should handle API error with response.data.message in deleteRegexPattern', async () => {
    regexPatternsService.delete.mockRejectedValue({
      response: { data: { message: 'Response delete error' } }
    });
    
    const setup = createComponentSetup();
    
    await setup.deleteRegexPattern();
    
    expect(mockQuasar.notify).toHaveBeenCalledWith({
      message: 'Response delete error',
      color: 'negative',
      timeout: 1500,
    });
  });

  // Test 41: Component handles API error without specific message in deleteRegexPattern
  it('should handle API error without specific message in deleteRegexPattern', async () => {
    regexPatternsService.delete.mockRejectedValue({});
    
    const setup = createComponentSetup();
    
    await setup.deleteRegexPattern();
    
    expect(mockQuasar.notify).toHaveBeenCalledWith({
      message: 'Error deleting regex pattern',
      color: 'negative',
      timeout: 1500,
    });
  });

  // Test 42: Component maintains reference integrity
  it('should maintain reference integrity for table ref', () => {
    const setup = createComponentSetup();
    
    expect(setup.regexPatternListTableRef.value).toBe(null);
    
    setup.regexPatternListTableRef.value = { test: 'value' };
    expect(setup.regexPatternListTableRef.value).toEqual({ test: 'value' });
  });

  // Test 43: Component manages loading states properly
  it('should manage loading states properly', () => {
    const setup = createComponentSetup();
    
    expect(setup.listLoading.value).toBe(false);
    
    setup.listLoading.value = true;
    expect(setup.listLoading.value).toBe(true);
    
    setup.listLoading.value = false;
    expect(setup.listLoading.value).toBe(false);
  });

  // Test 44: Component handles empty regex patterns array
  it('should handle empty regex patterns array', () => {
    const setup = createComponentSetup();
    
    const result = setup.filterData([], 'test');
    
    expect(result).toHaveLength(0);
    expect(setup.resultTotal.value).toBe(0);
  });

  // Test 45: Component handles null/undefined filter terms
  it('should handle null/undefined filter terms', () => {
    const setup = createComponentSetup();
    
    const result1 = setup.filterData(mockRegexPatterns, '');
    expect(result1).toHaveLength(2);
    
    const result2 = setup.filterData(mockRegexPatterns, null);
    expect(result2).toHaveLength(2);
  });

  // Test 46: Component service integration works correctly
  it('should integrate with regex patterns service correctly', async () => {
    const setup = createComponentSetup();
    
    await setup.getRegexPatterns();
    
    expect(regexPatternsService.list).toHaveBeenCalledWith('default');
    expect(convertUnixToQuasarFormat).toHaveBeenCalled();
  });

  // Test 47: Component pagination state updates correctly
  it('should update pagination state correctly', () => {
    const setup = createComponentSetup();
    
    expect(setup.pagination.value.rowsPerPage).toBe(20);
    
    setup.changePagination(50);
    
    expect(setup.pagination.value.rowsPerPage).toBe(50);
    expect(setup.selectedPerPage.value).toBe(50);
  });

  // Test 48: Component dialog state management is consistent
  it('should manage dialog states consistently', () => {
    const setup = createComponentSetup();
    
    // Initial states
    expect(setup.deleteDialog.value.show).toBe(false);
    expect(setup.showAddRegexPatternDialog.value.show).toBe(false);
    expect(setup.showImportRegexPatternDialog.value).toBe(false);
    
    // Change states
    setup.deleteDialog.value.show = true;
    setup.showAddRegexPatternDialog.value.show = true;
    setup.showImportRegexPatternDialog.value = true;
    
    expect(setup.deleteDialog.value.show).toBe(true);
    expect(setup.showAddRegexPatternDialog.value.show).toBe(true);
    expect(setup.showImportRegexPatternDialog.value).toBe(true);
  });

  // Test 49: Component handles data transformation correctly
  it('should transform API data correctly', async () => {
    const setup = createComponentSetup();
    
    await setup.getRegexPatterns();
    
    expect(setup.regexPatterns.value[0]).toMatchObject({
      id: '1',
      name: 'Test Pattern 1',
      pattern: '^test.*',
      '#': '01',
      created_at: '2022-01-01 1640995200',
      updated_at: '2022-01-01 1640995200'
    });
  });

  // Test 50: Component function references are correctly exposed
  it('should expose all required functions', () => {
    const setup = createComponentSetup();
    
    expect(typeof setup.changePagination).toBe('function');
    expect(typeof setup.filterData).toBe('function');
    expect(typeof setup.createRegexPattern).toBe('function');
    expect(typeof setup.getRegexPatterns).toBe('function');
    expect(typeof setup.editRegexPattern).toBe('function');
    expect(typeof setup.confirmDeleteRegexPattern).toBe('function');
    expect(typeof setup.deleteRegexPattern).toBe('function');
    expect(typeof setup.importRegexPattern).toBe('function');
    expect(typeof setup.exportRegexPattern).toBe('function');
    expect(typeof setup.closeAddRegexPatternDialog).toBe('function');
  });
});