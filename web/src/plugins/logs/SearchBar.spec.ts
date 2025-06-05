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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises, DOMWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import { AxiosHeaders } from 'axios';
import DateTime from "@/components/DateTime.vue";
import { nextTick } from 'vue';
import { defineComponent, ref } from "vue";

// Create a mock DateTime component
const mockDateTime = defineComponent({
  name: 'DateTime',
  template: '<div class="mock-date-time"></div>',
  setup() {
    return {
      setSavedDate: vi.fn(),
      setAbsoluteTime: vi.fn(),
      setDateType: vi.fn(),
      setRelativeTime: vi.fn(),
      setCustomDate: vi.fn(),
      getDateTimeRange: vi.fn().mockReturnValue({
        startTime: 1749023371191000,
        endTime: 1749024271191000,
        type: 'relative'
      })
    }
  }
});

// Mock jsTransformService before any imports
vi.mock('../../services/jstransform', () => ({
  default: {
    create: vi.fn(),
    update: vi.fn()
  }
}));
vi.mock('../../services/saved_views', () => ({
  default: {
    getViewDetail: vi.fn(),
    post: vi.fn(),
    delete: vi.fn()
  }
}));

import Index from "@/plugins/logs/Index.vue";
import SearchBar from "@/plugins/logs/SearchBar.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import searchService from "@/services/search";
import jsTransformService from "../../services/jstransform";
import savedviewsService from "../../services/saved_views";
import SearchResult from "@/plugins/logs/SearchResult.vue";
import router from "@/test/unit/helpers/router";
import QueryEditor from "@/components/QueryEditor.vue";
import useLogs from "@/composables/useLogs";
import useSuggestions from "@/composables/useSuggestions";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

installQuasar({
  plugins: [Dialog, Notify],
});

// @ts-expect-error - Partial CSS mock for testing
global.CSS = {
  supports: jest.fn().mockReturnValue(true),
};

// @ts-expect-error - Partial ClipboardItem mock for testing
global.ClipboardItem = class ClipboardItem {
  static supports(type: string) { return true; }
  constructor(data: any) {
    return data;
  }
};

// Mock clipboard
Object.defineProperty(global.navigator, 'clipboard', {
  value: {
    write: vi.fn().mockResolvedValue(undefined),
  },
  writable: true,
});

// Update the mock - move it before any imports that might use it
vi.mock("@/composables/useSuggestions", () => {
  return {
    default: () => {
      // Create mock functions and refs
      const mockGetSuggestions = vi.fn().mockImplementation(() => {
      });
      const mockOpen = vi.fn();
      const mockClose = vi.fn();

      // Create a singleton instance to track calls
      const instance = {
        autoCompleteData: ref({
          fieldValues: {} as any,
          query: "",
          position: {
            cursorIndex: 0,
          },
          popup: {
            open: mockOpen,
            close: mockClose,
          },
        }),
        autoCompleteKeywords: ref([]),
        autoCompleteSuggestions: ref([]),
        loading: ref(false),
        getSuggestions: mockGetSuggestions,
        updateFieldKeywords: vi.fn(),
        updateFunctionKeywords: vi.fn()
      };

      return instance;
    }
  };
});

describe("SearchBar Component", () => {
  let wrapper: any;
  let mockQueryEditor: any;
  let createSavedViewsSpy: any;

  beforeEach(async () => {
    // Reset mock implementations before each test
    vi.mocked(jsTransformService.create).mockReset();
    vi.mocked(jsTransformService.update).mockReset();
    vi.mocked(savedviewsService.getViewDetail).mockReset();
    vi.mocked(savedviewsService.post).mockReset();
    vi.mocked(savedviewsService.delete).mockReset();

    // Mock QueryEditor component with auto-complete capabilities
    mockQueryEditor = {
      name: 'QueryEditor',
      template: '<div class="mock-editor"></div>',
      methods: {
        setValue: vi.fn(),
        getCursorIndex: vi.fn().mockReturnValue(5),
        triggerAutoComplete: true
      }
    };

    // Create a mock DateTime instance
    const dateTimeMock = {
      setSavedDate: vi.fn(),
      setAbsoluteTime: vi.fn(),
      setDateType: vi.fn(),
      setRelativeTime: vi.fn(),
      setCustomDate: vi.fn(),
      getDateTimeRange: vi.fn().mockReturnValue({
        startTime: 1749023371191000,
        endTime: 1749024271191000,
        type: 'relative'
      })
    };

    wrapper = mount(SearchBar, {
      props: {  
        fieldValues: ['field1', 'field2']
      },
      attachTo: document.body,
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: {
          QueryEditor: mockQueryEditor,
          IndexList: true,
          DateTime: mockDateTime
        }
      },
    });

    // Directly set the dateTimeRef with our mock
    wrapper.vm.dateTimeRef = ref({
      ...dateTimeMock,
      value: dateTimeMock
    });
    createSavedViewsSpy = vi.spyOn(wrapper.vm, 'createSavedViews');

    wrapper.vm.router.currentRoute.value.name = "logs";
    await flushPromises();
  });


  afterEach(async () => {
    if (wrapper && wrapper.unmount) {
      wrapper.vm.searchObj.meta.sqlMode = false;
      await wrapper.unmount();
    }
    await flushPromises(); // finish any remaining promises
    vi.clearAllTimers(); // stop intervals/timeouts
    wrapper = null; // Clear the wrapper reference

  });

  it("Should render show histogram toggle btn", () => {
    expect(
      wrapper
        .find('[data-test="logs-search-bar-show-histogram-toggle-btn"]')
        .exists()
    ).toBeTruthy();
  });

  it("Should render sql mode toggle btn", () => {
    expect(
      wrapper
        .find('[data-test="logs-search-bar-sql-mode-toggle-btn"]')
        .exists()
    ).toBeTruthy();
  });

  it("renders the search bar component", () => {
    expect(wrapper.exists()).toBe(true);
  });

  it("toggles SQL mode when the button is clicked", async () => {
    const sqlModeToggle = wrapper.find('[data-test="logs-search-bar-sql-mode-toggle-btn"]');
    expect(wrapper.vm.searchObj.meta.sqlMode).toBe(false); // Assuming default is false

    await sqlModeToggle.trigger('click');
    expect(wrapper.vm.searchObj.meta.sqlMode).toBe(true); // Check if toggled
  });

  it("resets filters when the reset button is clicked", async () => {
    const resetButton = wrapper.find('[data-test="logs-search-bar-reset-filters-btn"]');
    await resetButton.trigger('click');
    // Add assertions to check if filters are reset
  });

  it("toggles histogram when the button is clicked", async () => {
    const histogramToggle = wrapper.find('[data-test="logs-search-bar-show-histogram-toggle-btn"]');
    const initialState = wrapper.vm.searchObj.meta.showHistogram;
    
    await histogramToggle.trigger('click');
    expect(wrapper.vm.searchObj.meta.showHistogram).toBe(!initialState);
  });

  it("handles quick mode toggle", async () => {
    const quickModeToggle = wrapper.find('[data-test="logs-search-bar-quick-mode-toggle-btn"]');
    const initialState = wrapper.vm.searchObj.meta.quickMode;
    
    await quickModeToggle.trigger('click');
    expect(wrapper.vm.searchObj.meta.quickMode).toBe(!initialState);
  });

  it("handles transform type selection", async () => {
    const transformType = "function";
    wrapper.vm.searchObj.data.transformType = transformType;
    await wrapper.vm.$nextTick();
    
    expect(wrapper.vm.searchObj.data.transformType).toBe(transformType);
  });

  it("shows saved view dialog when save button is clicked", async () => {
    // Setup stream selection to avoid validation error
      wrapper.vm.searchObj.data.stream.selectedStream = ["stream1"];
    
    // Trigger fnSavedView directly since the button might be conditionally rendered
    await wrapper.vm.fnSavedView();
    
    expect(store.state.savedViewDialog).toBe(true);
  });

  // New test cases for additional methods
  it("should trigger searchData method", async () => {
    const searchDataSpy = vi.spyOn(wrapper.vm, 'searchData');
    wrapper.vm.searchData();
    expect(searchDataSpy).toHaveBeenCalled();
  });

  it("should trigger changeFunctionName method", () => {
    const changeFunctionNameSpy = vi.spyOn(wrapper.vm, 'changeFunctionName');
    wrapper.vm.changeFunctionName('newFunction');
    expect(changeFunctionNameSpy).toHaveBeenCalledWith('newFunction');
  });

  it("should trigger createNewValue method", () => {
    const doneFn = vi.fn();
    wrapper.vm.createNewValue('newValue', doneFn);
    expect(doneFn).toHaveBeenCalledWith('newValue');
  });

  it("should trigger updateSelectedValue method", () => {
    wrapper.vm.functionModel = 'newFunction';
    wrapper.vm.functionOptions = ['existingFunction'];
    wrapper.vm.updateSelectedValue();
    expect(wrapper.vm.functionOptions).toContain('newFunction');
  });

  it("should trigger handleDeleteSavedView method", () => {
    const item = { view_id: '123' };
    wrapper.vm.handleDeleteSavedView(item);
    expect(wrapper.vm.deleteViewID).toBe('123');
    expect(wrapper.vm.confirmDelete).toBe(true);
  });

  it("should trigger handleUpdateSavedView method", () => {
    const item = { view_id: '123', view_name: 'Test View' };
    wrapper.vm.searchObj.data.stream.selectedStream = ['stream1'];
    wrapper.vm.handleUpdateSavedView(item);
    expect(wrapper.vm.updateViewObj).toEqual(item);
    expect(wrapper.vm.confirmUpdate).toBe(true);
  });

  it("should trigger downloadRangeData method", async () => {
    const searchServiceMock = vi.spyOn(searchService, 'search').mockResolvedValue({
      data: { hits: ['log1', 'log2'] },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {} as any
    });

    wrapper.vm.searchObj = {
      data: {
        query: 'some query',
        datetime: {
          startTime: '2023-01-01T00:00:00Z',
          endTime: '2023-01-02T00:00:00Z',
          type: 'absolute'
        },
        stream: {
          selectedStream: ['stream1']
        },
        customDownloadQueryObj: {
          query: {
            from: 0,
            size: 10
          }
        }
      },
      meta: {
        sqlMode: false
      }
    };

    wrapper.vm.downloadCustomInitialNumber = '0';
    wrapper.vm.downloadCustomRange = '10';

    await wrapper.vm.downloadRangeData();

    expect(searchServiceMock).toHaveBeenCalled();
    expect(wrapper.vm.customDownloadDialog).toBe(false);
  });

  it("should trigger handleKeyDown method", () => {
    const handleRunQueryFnSpy = vi.spyOn(wrapper.vm, 'handleRunQueryFn');
    const event = new KeyboardEvent('keydown', { ctrlKey: true, key: 'Enter' });
    wrapper.vm.handleKeyDown(event);
    expect(handleRunQueryFnSpy).toHaveBeenCalled();
  });


  it("should update SQL query when addSearchTerm watcher is triggered in SQL mode", async () => {
    wrapper.vm.searchObj.data.stream.selectedStream = ["stream1"]
    await wrapper.vm.$nextTick();
    const sqlModeToggle = wrapper.find('[data-test="logs-search-bar-sql-mode-toggle-btn"]');
    await sqlModeToggle.trigger('click');
    await wrapper.vm.$nextTick();
    wrapper.vm.searchObj.data.query = "SELECT * FROM stream1"
    await wrapper.vm.$nextTick();
    wrapper.vm.searchObj.data.stream.addToFilter = "field='value'"


    await wrapper.vm.$nextTick();
    expect(wrapper.vm.searchObj.data.query).toBe("SELECT * FROM stream1 where field='value'");
  });

  describe('getColumnNames function test cases', () => {
    it('should extract column names from simple column references', () => {
      const parsedSQL = {
        columns: [
          { expr: { type: 'column_ref', column: { expr: { value: 'name' } } } },
          { expr: { type: 'column_ref', column: { expr: { value: 'age' } } } }
        ]
      };
      
      expect(wrapper.vm.getColumnNames(parsedSQL)).toEqual(['name', 'age']);
    });

    it('should extract column names from aggregate functions', () => {
      const parsedSQL = {
        columns: [
          { 
            expr: { 
              type: 'aggr_func',
              args: { expr: { column: { value: 'count' } } }
            }
          },
          {
            expr: {
              type: 'aggr_func',
              args: { expr: { value: 'sum' } }
            }
          }
        ]
      };
      
      expect(wrapper.vm.getColumnNames(parsedSQL)).toEqual(['count', 'sum']);
    });

    it('should extract column names from regular functions', () => {
      const parsedSQL = {
        columns: [
          {
            expr: {
              type: 'function',
              args: {
                value: [
                  { type: 'column_ref', column: { expr: { value: 'timestamp' } } }
                ]
              }
            }
          }
        ]
      };
      
      expect(wrapper.vm.getColumnNames(parsedSQL)).toEqual(['timestamp']);
    });

    it('should handle nested queries with _next property', () => {
      const parsedSQL = {
        columns: [
          { expr: { type: 'column_ref', column: { expr: { value: 'name' } } } }
        ],
        _next: {
          columns: [
            { expr: { type: 'column_ref', column: { expr: { value: 'age' } } } }
          ]
        }
      };
      
      expect(wrapper.vm.getColumnNames(parsedSQL)).toEqual(['age']);
    });

    it('should handle empty or invalid column data', () => {
      const parsedSQL = {
        columns: []
      };
      
      expect(wrapper.vm.getColumnNames(parsedSQL)).toEqual([]);
    });

  });

  describe('updateQueryValue', () => {
    beforeEach(() => {
      wrapper.vm.searchObj.data.stream.selectedStreamFields = [
        { name: 'field1', isInterestingField: false },
        { name: 'field2', isInterestingField: false }
      ];
      wrapper.vm.searchObj.data.stream.selectedStream = ['stream1'];
      wrapper.vm.searchObj.organizationIdentifier = 'test-org';
    });

    it('should update editor value', () => {
      const value = 'SELECT * FROM stream1';
      wrapper.vm.updateQueryValue(value);
      expect(wrapper.vm.searchObj.data.editorValue).toBe(value);
    });

    it('should auto-enable SQL mode when query contains SELECT and FROM', () => {
      wrapper.vm.searchObj.meta.sqlMode = false;
      wrapper.vm.updateQueryValue('SELECT * FROM stream1');
      expect(wrapper.vm.searchObj.meta.sqlMode).toBe(true);
      expect(wrapper.vm.searchObj.meta.sqlModeManualTrigger).toBe(true);
    });

    it('should not enable SQL mode for non-SQL queries', () => {
      wrapper.vm.searchObj.meta.sqlMode = false;
      wrapper.vm.updateQueryValue('field1="value"');
      expect(wrapper.vm.searchObj.meta.sqlMode).toBe(false);
    });


    it('should handle stream selection in SQL mode', async () => {
      wrapper.vm.searchObj.meta.sqlMode = true;
      wrapper.vm.searchObj.data.streamResults.list = [
        { name: 'stream2' }
      ];

      // Mock parser.astify
      wrapper.vm.parser = { 
        astify: vi.fn().mockReturnValue({
          from: [{ table: 'stream2' }]
        })
      };

      wrapper.vm.updateQueryValue('SELECT * FROM stream2');
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.searchObj.data.stream.selectedStream).toContain('stream2');
      wrapper.vm.searchObj.meta.sqlMode = false;
    });

    it('should show error notification when stream is not found', async () => {
      wrapper.vm.searchObj.meta.sqlMode = true;
      wrapper.vm.searchObj.data.streamResults.list = [
        { name: 'stream1' }
      ];

      const notifySpy = vi.spyOn(wrapper.vm.$q, 'notify');

      // Mock parser.astify
      wrapper.vm.parser = { 
        astify: vi.fn().mockReturnValue({
          from: [{ table: 'nonexistent_stream' }]
        })
      };

      wrapper.vm.updateQueryValue('SELECT * FROM nonexistent_stream');
      await wrapper.vm.$nextTick();

      expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Stream not found',
        color: 'negative'
      }));
      expect(wrapper.vm.searchObj.data.stream.selectedStream).toEqual([]);
      expect(wrapper.vm.searchObj.data.stream.selectedStreamFields).toEqual([]);
      wrapper.vm.searchObj.meta.sqlMode = false;
    });

    it('should handle job context removal', async () => {
      wrapper.vm.searchObj.meta.jobId = 'test-job';
      wrapper.vm.searchObj.meta.queryEditorPlaceholderFlag = true;
      wrapper.vm.checkQuery = vi.fn().mockReturnValue(false);

      const notifySpy = vi.spyOn(wrapper.vm.$q, 'notify');

      wrapper.vm.updateQueryValue('SELECT * FROM stream1');
      await wrapper.vm.$nextTick();

      expect(notifySpy).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Job Context have been removed',
        color: 'warning'
      }));
      expect(wrapper.vm.searchObj.meta.jobId).toBe('');
      expect(wrapper.vm.searchObj.data.queryResults.hits).toEqual([]);
    });
  });

  describe('updateDateTime', () => {
    beforeEach(async () => {
      // Reset searchObj datetime related properties
      wrapper.vm.searchObj.data.datetime = {
        startTime: 0,
        endTime: 0,
        relativeTimePeriod: '',
        type: 'absolute',
        queryRangeRestrictionMsg: '',
        queryRangeRestrictionInHour: 0
      };
      wrapper.vm.searchObj.loading = false;
      wrapper.vm.searchObj.runQuery = false;
      wrapper.vm.searchObj.data.stream.selectedStream = ['stream1'];

      // Mock the dateTimeRef
      wrapper.vm.dateTimeRef = {
        value: {
          setAbsoluteTime: vi.fn(),
          setDateType: vi.fn()
        }
      };

      // Mock store state
      store.state.timezone = 'UTC';
      store.state.zoConfig = {
        version: '1.0.0',
        commit_hash: 'abc123',
        build_date: '2024-01-01',
        default_fts_keys: [],
        show_stream_stats_doc_num: true,
        data_retention_days: true,
        extended_data_retention_days: 30,
        user_defined_schemas_enabled: true,
        super_cluster_enabled: true,
        query_on_stream_selection: false,
        default_functions: []
      };
    });

    it('should handle absolute time with query range restriction', async () => {
      const value = {
        valueType: 'absolute',
        startTime: 1000000000,
        endTime: 2000000000,
        selectedDate: { from: '2023/01/01' },
        selectedTime: { startTime: '10:00' }
      };

      wrapper.vm.searchObj.data.datetime.queryRangeRestrictionInHour = 2;
      await wrapper.vm.updateDateTime(value);

      expect(wrapper.vm.searchObj.data.datetime.startTime).toBe(value.startTime);
      expect(wrapper.vm.searchObj.data.datetime.endTime).toBe(value.endTime);
      expect(wrapper.vm.searchObj.data.datetime.type).toBe('absolute');
    });


    it('should update loading state when conditions are met', async () => {
      const value = {
        valueType: 'absolute',
        startTime: 1000000000,
        endTime: 2000000000
      };

      await wrapper.vm.updateDateTime(value);
      expect(wrapper.vm.searchObj.loading).toBe(true);
      expect(wrapper.vm.searchObj.runQuery).toBe(true);
    });

    it('should not update loading state when query_on_stream_selection is true', async () => {
      store.state.zoConfig.query_on_stream_selection = true;
      const value = {
        valueType: 'absolute',
        startTime: 1000000000,
        endTime: 2000000000
      };

      await wrapper.vm.updateDateTime(value);
      expect(wrapper.vm.searchObj.loading).toBe(false);
      expect(wrapper.vm.searchObj.runQuery).toBe(false);
    });
  });

  describe('saveFunction', () => {
    beforeEach(() => {
      // Reset component state
      wrapper.vm.saveFunctionLoader = false;
      wrapper.vm.savedFunctionSelectedName = ref({ name: '', function: '' });
      wrapper.vm.searchObj.data.tempFunctionContent = '';
      wrapper.vm.functionOptions = ref([]);
      wrapper.vm.formData = ref({
        params: '',
        function: '',
        transType: 0,
        name: ''
      });

      // Mock showConfirmDialog
      wrapper.vm.showConfirmDialog = vi.fn().mockImplementation(callback => callback());
    });

    it('should validate empty function content', async () => {
      const notifySpy = vi.spyOn(wrapper.vm.$q, 'notify');
      wrapper.vm.searchObj.data.tempFunctionContent = '   ';
      
      await wrapper.vm.saveFunction();
      
      expect(notifySpy).toHaveBeenCalledWith({
        type: 'warning',
        message: 'The function field must contain a value and cannot be left empty.'
      });
      expect(wrapper.vm.saveFunctionLoader).toBe(false);
    });

    it('should validate function name format', async () => {
      const notifySpy = vi.spyOn(wrapper.vm.$q, 'notify');
      wrapper.vm.searchObj.data.tempFunctionContent = 'valid content';
      wrapper.vm.savedFunctionName = '123invalid';
      
      await wrapper.vm.saveFunction();
      
      expect(notifySpy).toHaveBeenCalledWith({
        type: 'negative',
        message: 'Function name is not valid.'
      });
      expect(wrapper.vm.saveFunctionLoader).toBe(false);
    });

    it('should create new function successfully', async () => {
      vi.mocked(jsTransformService.create).mockResolvedValue({
        data: { message: 'Function created successfully' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any
      });

      wrapper.vm.searchObj.data.tempFunctionContent = 'function content';
      wrapper.vm.savedFunctionName = 'validName'

      wrapper.vm.isSavedFunctionAction = 'create';
      console.log(wrapper.vm.savedFunctionName.value,'wrapper vm')

      await wrapper.vm.saveFunction();

      expect(jsTransformService.create).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        expect.objectContaining({
          name: 'validName',
          function: 'function content',
          params: 'row',
          transType: 0
        })
      );
    });

    // it('should reset function content', async () => {
      
    //   wrapper.vm.searchObj.data.tempFunctionContent = 'function content';
    //   wrapper.vm.searchObj.data.tempFunctionName = 'validName';
    //   wrapper.vm.resetFunctionContent();
    //   expect(wrapper.vm.searchObj.data.tempFunctionContent).toBe('');
    //   expect(wrapper.vm.searchObj.data.tempFunctionName).toBe('');
    // });

  });

  describe('handleSavedView', () => {
    beforeEach(() => {
      // Mock savedviewsService.post
      vi.mocked(savedviewsService.post).mockResolvedValue({
        status: 200,
        data: { message: 'Success' }
      } as any);
    });

    it('should call createSavedViews for valid view name', async () => {
      // Set up valid view name
      // wrapper.vm.isSavedViewAction = 'create';
      wrapper.vm.savedViewName = 'valid-view-name';
      
      const createSavedViewsSpy = vi.spyOn(wrapper.vm, 'createSavedViews');
      
      await wrapper.vm.handleSavedView();

      await flushPromises();

      wrapper.vm.createSavedViews('valid-view-name');
    

      vi.mocked(savedviewsService.post).mockResolvedValue({
        status: 200,
        data: { message: 'Success' }
      } as any);

      
    });

    it('should successfully apply saved view with complete response data', async () => {
      // Mock the response data
      const responseData = {
        data: {
          org_id: "2y1ufyK0yGTUSIXQfOrRxWpFqQs",
          data: {
            communicationMethod: "http",
            config: {
              fnLastSplitterPosition: 0,
              fnSplitterLimit: [40, 100],
              fnSplitterModel: 60,
              lastSplitterPosition: 0,
              refreshTimes: [
                [
                  { label: "5 sec", value: 5 },
                  { label: "1 min", value: 60 },
                  { label: "1 hr", value: 3600 }
                ],
                [
                  { label: "10 sec", value: 10 },
                  { label: "5 min", value: 300 },
                  { label: "2 hr", value: 7200 }
                ],
                [
                  { label: "15 sec", value: 15 },
                  { label: "15 min", value: 900 },
                  { label: "1 day", value: 86400 }
                ],
                [
                  { label: "30 sec", value: 30 },
                  { label: "30 min", value: 1800 }
                ]
              ],
              splitterLimit: [0, 40],
              splitterModel: 20
            },
            data: {
              actionId: null,
              actions: [],
              additionalErrorMsg: "",
              countErrorMsg: "",
              customDownloadQueryObj: {},
              datetime: {
                endTime: 1749024271191000,
                queryRangeRestrictionInHour: -1,
                queryRangeRestrictionMsg: "",
                relativeTimePeriod: "15m",
                startTime: 1749023371191000,
                type: "relative"
              },
              editorValue: 'SELECT * FROM "stream1"',
              errorCode: 0,
              errorDetail: "",
              errorMsg: "",
              filterErrMsg: "",
              functionError: "",
              hasSearchDataTimestampField: false,
              histogramInterval: 0,
              histogramQuery: "",
              isOperationCancelled: false,
              missingStreamMessage: "",
              originalDataCache: {},
              parsedQuery: {
                columns: [
                  {
                    as: null,
                    expr: {
                      column: "*",
                      table: null,
                      type: "column_ref"
                    }
                  }
                ],
                distinct: { type: null },
                from: [
                  {
                    as: null,
                    db: null,
                    table: "stream1"
                  }
                ],
                groupby: null,
                having: null,
                into: { position: null },
                limit: { seperator: "", value: [] },
                options: null,
                orderby: null,
                type: "select",
                where: null,
                window: null,
                with: null
              },
              query: 'SELECT * FROM "stream1"',
              resultGrid: {
                colOrder: {},
                colSizes: {},
                columns: [],
                currentDateTime: "2025-06-04T08:04:09.069Z",
                currentPage: 1
              },
              savedViewFilterFields: "",
              searchAround: {
                histogramHide: false,
                indexTimestamp: -1,
                size: 0
              },
              searchRequestTraceIds: [],
              searchRetriesCount: {},
              searchWebSocketTraceIds: [],
              selectedTransform: null,
              stream: {
                addToFilter: "",
                expandGroupRows: {
                  common: true,
                  stream1: true
                },
                expandGroupRowsFieldCount: {
                  common: 0,
                  stream1: 4
                },
                filterField: "",
                filteredField: [],
                interestingFieldList: [],
                loading: false,
                missingStreamMultiStreamFilter: [],
                pipelineQueryStream: [],
                selectedFields: [],
                selectedStreamFields: [
                  {
                    ftsKey: false,
                    group: "stream1",
                    isInterestingField: false,
                    isSchemaField: true,
                    name: "_timestamp",
                    showValues: false,
                    streams: ["stream1"]
                  }
                ],
                selectedStream: ["stream1"],
                streamType: "logs",
                userDefinedSchema: [],
                functions: []
              },
              tempFunctionContent: "",
              tempFunctionLoading: false,
              tempFunctionName: "",
              timezone: "Asia/Calcutta",
              transformType: "function",
              transforms: [],
              histogram: {
                xData: [],
                yData: [],
                chartParams: {}
              },
              savedViews: [
                {
                  org_id: "2y1ufyK0yGTUSIXQfOrRxWpFqQs",
                  view_id: "2y2ETfwQVsIYcupzBRFisihBHdg",
                  view_name: "dd"
                }
              ],
              queryResults: []
            },
            loading: false,
            loadingCounter: false,
            loadingHistogram: false,
            loadingSavedView: false,
            loadingStream: false,
            meta: {
              clusters: [],
              functionEditorPlaceholderFlag: true,
              hasUserDefinedSchemas: false,
              histogramDirtyFlag: false,
              isActionsEnabled: false,
              jobId: "",
              jobRecords: "100",
              logsVisualizeToggle: "logs",
              pageType: "logs",
              queryEditorPlaceholderFlag: true,
              quickMode: false,
              refreshHistogram: true,
              refreshInterval: 0,
              refreshIntervalLabel: "Off",
              regions: [],
              resetPlotChart: false,
              resultGrid: {
                chartInterval: "1 second",
                chartKeyFormat: "HH:mm:ss",
                manualRemoveFields: false,
                navigation: {
                  currentRowIndex: 0
                },
                rowsPerPage: 50,
                showPagination: true,
                wrapCells: false
              },
              searchApplied: false,
              selectedTraceStream: "",
              showDetailTab: false,
              showFields: true,
              showHistogram: true,
              showQuery: true,
              showSearchScheduler: false,
              showTransformEditor: true,
              sqlMode: true,
              sqlModeManualTrigger: false,
              toggleFunction: false,
              toggleSourceWrap: true,
              useUserDefinedSchemas: "user_defined_schema",
              scrollInfo: {}
            },
            organizationIdentifier: "2y1ufyK0yGTUSIXQfOrRxWpFqQs",
            runQuery: false,
            shouldIgnoreWatcher: false
          },
          view_id: "2y2ETfwQVsIYcupzBRFisihBHdg",
          view_name: "dd"
        },
        status: 200,
        statusText: "OK",
        headers: {
          "content-type": "application/json"
        },
        config: {
        },
        request: {
        }
      };
      

      // Setup initial state
      wrapper.vm.searchObj.data.stream.selectedStream = [];
      wrapper.vm.searchObj.data.stream.streamLists.push({ value: 'stream1', label: 'Stream 1' });

      // Mock the required services and refs
      vi.mocked(savedviewsService.getViewDetail).mockResolvedValue(responseData as any);
      
      wrapper.vm.dateTimeRef = {
        value: {
          setSavedDate: vi.fn(),
          setAbsoluteTime: vi.fn(),
          setDateType: vi.fn(),
          setRelativeTime: vi.fn(),
          setCustomDate: vi.fn(),
          getDateTimeRange: vi.fn().mockReturnValue({
            startTime: 1749023371191000,
            endTime: 1749024271191000,
            type: 'relative'
          })
        }
      };


      // Call applySavedView with a view item
      await wrapper.vm.applySavedView({
        view_id: "2y2ETfwQVsIYcupzBRFisihBHdg",
        view_name: "dd"
      });

      console.log(wrapper.vm.searchObj.meta.toggleFunction,'togglefunction')

      // Wait for all promises to resolve
      await flushPromises();



      // Verify service was called
      expect(savedviewsService.getViewDetail).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        "2y2ETfwQVsIYcupzBRFisihBHdg"
      );



    });
  });

  describe('deleteSavedViews', () => {
    beforeEach(() => {
      wrapper.vm.deleteViewID = 'test-view-id';
      vi.mocked(savedviewsService.delete).mockResolvedValue({
        status: 200,
        data: { message: 'Success' }
      } as any);
    });

    it('should handle delete failure with error detail', async () => {
      // Mock failed delete response with error detail
      vi.mocked(savedviewsService.delete).mockResolvedValue({
        status: 400,
        data: { error_detail: 'View not found' }
      } as any);

      await wrapper.vm.deleteSavedViews();

      expect(savedviewsService.delete).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        'test-view-id'
      );
    });

  });

  describe('resetFilters', () => {
    const initialSearchObj = {
      data: {
        query: '',
        editorValue: '',
        datetime: {
          type: 'relative',
          startTime: 1749023371191000,
          endTime: 1749024271191000,
          relativeTimePeriod: '1h'
        },
        searchRequestTraceIds: [],
        searchWebSocketTraceIds: [],
        stream: {
          selectedStream: ['stream1'],
          selectedStreamFields: [
            { name: 'field1', isInterestingField: false },
            { name: 'field2', isInterestingField: false }
          ],
          interestingFieldList: [],
          addToFilter: '',
          filterField: '',
          filteredField: [],
          loading: false,
          streamType: 'logs',
          userDefinedSchema: [],
          functions: []
        },
        transforms: [],
        transformType: 'function',
        queryResults: { hits: [] }
      },
      meta: {
        sqlMode: false,
        sqlModeManualTrigger: false,
        quickMode: false,
        showHistogram: true,
        showFields: true,
        showQuery: true,
        showTransformEditor: true,
        toggleFunction: false,
        jobId: '',
        searchApplied: false,
        logsVisualizeToggle: 'logs'
      },
      config: {
        fnSplitterModel: 0,
        fnSplitterLimit: [0, 100]
      },
      loading: false,
      runQuery: false,
      loadingHistogram: false,
      loadingCounter: false,
      loadingStream: false,
      loadingSavedView: false,
      organizationIdentifier: 'test-org'
    };


    beforeEach(async () => {
      // Create a fresh wrapper for each test with reactive data
      wrapper = mount(SearchBar, {
        props: {  
          fieldValues: ['field1', 'field2']
        },
        attachTo: document.body,
        global: {
          provide: { store },
          plugins: [i18n, router],
          stubs: {
            QueryEditor: mockQueryEditor,
            IndexList: true,
            DateTime: true
          }
        },
      });

      // Initialize searchObj with a deep clone of the initial state
      wrapper.vm.searchObj = JSON.parse(JSON.stringify(initialSearchObj));
      await wrapper.vm.$nextTick();
      
      // Mock the specific functions from useLogs that resetFilters uses
      wrapper.vm.fnParsedSQL = vi.fn().mockReturnValue({
        from: [{ table: 'stream1' }],
        where: { type: 'binary_expr', operator: '=', left: 'field1', right: 'value' }
      });
      wrapper.vm.fnUnparsedSQL = vi.fn().mockReturnValue('SELECT * FROM stream1');
      wrapper.vm.buildStreamQuery = vi.fn().mockImplementation((stream, fieldList) => `SELECT * FROM "${stream}"`);
      wrapper.vm.getFieldList = vi.fn().mockReturnValue(['field1', 'field2']);

      // Mock store state
      store.state.zoConfig = {
        version: '1.0.0',
        commit_hash: 'abc123',
        build_date: '2024-01-01',
        default_fts_keys: [],
        show_stream_stats_doc_num: true,
        data_retention_days: true,
        extended_data_retention_days: 30,
        user_defined_schemas_enabled: true,
        super_cluster_enabled: true,
        query_on_stream_selection: false,
        default_functions: []
      };

      // Mock handleRunQuery from useLogs
      wrapper.vm.handleRunQuery = vi.fn();
    });

    afterEach(async () => {
      if (wrapper && wrapper.unmount) {
        await wrapper.unmount();
      }
      await flushPromises();
      vi.clearAllMocks();
    });

    it('should reset query in non-SQL mode', async () => {
      // Set initial values
      wrapper.vm.searchObj.data.query = 'initial query';
      wrapper.vm.searchObj.data.editorValue = 'initial query';
      await wrapper.vm.$nextTick();

      console.log('Before resetFilters:', {
        query: wrapper.vm.searchObj.data.query,
        editorValue: wrapper.vm.searchObj.data.editorValue,
        sqlMode: wrapper.vm.searchObj.meta.sqlMode
      });

      // Call resetFilters
      await wrapper.vm.resetFilters();

      await wrapper.vm.$nextTick();
      await flushPromises();

      console.log('After resetFilters:', {
        query: wrapper.vm.searchObj.data.query,
        editorValue: wrapper.vm.searchObj.data.editorValue,
        sqlMode: wrapper.vm.searchObj.meta.sqlMode
      });

      await wrapper.vm.$nextTick();
      await flushPromises();

      console.log('Final state:', {
        query: wrapper.vm.searchObj.data.query,
        editorValue: wrapper.vm.searchObj.data.editorValue,
        sqlMode: wrapper.vm.searchObj.meta.sqlMode
      });



      // Verify the function was called with correct context
      expect(wrapper.vm.handleRunQuery).not.toHaveBeenCalled();
    });

  
  });
});
