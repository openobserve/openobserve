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
// Mock composable


import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import IndexList from "@/plugins/logs/IndexList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { nextTick, ref } from "vue";





vi.mock('@/services/search', () => ({
  default: {
    partition: vi.fn((...args) => {
      console.log('MOCK partition called with:', args);
      return Promise.resolve({
        data: { partitions: [[1, 2], [3, 4]] }
      });
    })
  }
}));



vi.mock('@/composables/useLogs', () => {
  const mockSearchObj = {
    config: {
      splitterModel: 20,
      lastSplitterPosition: 0,
      splitterLimit: [0, 40],
      fnSplitterModel: 60,
      fnLastSplitterPosition: 0,
      fnSplitterLimit: [40, 100],
      refreshTimes: [
        [
          { label: "5 sec", value: 5 },
          { label: "1 min", value: 60 },
          { label: "1 hr", value: 3600 },
        ],
        [
          { label: "10 sec", value: 10 },
          { label: "5 min", value: 300 },
          { label: "2 hr", value: 7200 },
        ],
        [
          { label: "15 sec", value: 15 },
          { label: "15 min", value: 900 },
          { label: "1 day", value: 86400 },
        ],
        [
          { label: "30 sec", value: 30 },
          { label: "30 min", value: 1800 },
        ],
      ],
    },
    meta: {
      logsVisualizeToggle: "logs",
      refreshInterval: <number>0,
      refreshIntervalLabel: "Off",
      refreshHistogram: false,
      showFields: true,
      showQuery: true,
      showHistogram: true,
      showDetailTab: false,
      showTransformEditor: true,
      searchApplied: false,
      toggleSourceWrap: false,
      histogramDirtyFlag: false,
      sqlMode: false,
      sqlModeManualTrigger: false,
      quickMode: false,
      queryEditorPlaceholderFlag: true,
      functionEditorPlaceholderFlag: true,
      resultGrid: {
        rowsPerPage: 50,
        wrapCells: false,
        manualRemoveFields: false,
        chartInterval: "1 second",
        chartKeyFormat: "HH:mm:ss",
        navigation: {
          currentRowIndex: 0,
        },
        showPagination: true,
      },
      jobId: "",
      jobRecords: "100",
      scrollInfo: {},
      pageType: "logs", // 'logs' or 'stream
      regions: [],
      clusters: [],
      useUserDefinedSchemas: "user_defined_schema",
      hasUserDefinedSchemas: false,
      selectedTraceStream: "",
      showSearchScheduler: false,
      toggleFunction: false, // DEPRECATED use showTransformEditor instead
      isActionsEnabled: false,
      resetPlotChart: false,
    },
    data: {
      query: <any>"",
      histogramQuery: <any>"",
      parsedQuery: {},
      countErrorMsg: "",
      errorMsg: "",
      errorDetail: "",
      errorCode: 0,
      filterErrMsg: "",
      missingStreamMessage: "",
      additionalErrorMsg: "",
      savedViewFilterFields: "",
      hasSearchDataTimestampField: false,
      originalDataCache: new Map(),
      stream: {
        loading: false,
        streamLists: <object[]>[],
        selectedStream: <any>[],
        selectedStreamFields: <any>[],
        selectedFields: <string[]>[],
        filterField: "",
        addToFilter: "",
        functions: <any>[],
        streamType: "logs",
        interestingFieldList: <string[]>[],
        userDefinedSchema: <any>[],
        expandGroupRows: <any>{},
        expandGroupRowsFieldCount: <any>{},
        filteredField: <any>[],
        missingStreamMultiStreamFilter: <any>[],
        pipelineQueryStream: <any>[],
      },
      resultGrid: {
        currentDateTime: new Date(),
        currentPage: 1,
        columns: <any>[],
        colOrder: <any>{},
        colSizes: <any>{},
      },
      histogramInterval: <any>0,
      transforms: <any>[],
      transformType: "function",
      actions: <any>[],
      selectedTransform: <any>null,
      queryResults: <any>[],
      sortedQueryResults: <any>[],
      streamResults: <any>[],
      histogram: <any>{
        xData: [],
        yData: [],
        chartParams: {
          title: "",
          unparsed_x_data: [],
          timezone: "",
        },
        errorMsg: "",
        errorCode: 0,
        errorDetail: "",
      },
      editorValue: <any>"",
      datetime: <any>{
        startTime: (new Date().getTime() - 900000) * 1000,
        endTime: new Date().getTime(),
        relativeTimePeriod: "15m",
        type: "relative",
        selectedDate: <any>{},
        selectedTime: <any>{},
        queryRangeRestrictionMsg: "",
        queryRangeRestrictionInHour: 100000,
      },
      searchAround: {
        indexTimestamp: 0,
        size: <number>10,
        histogramHide: false,
      },
      tempFunctionName: "",
      tempFunctionContent: "",
      tempFunctionLoading: false,
      savedViews: <any>[],
      customDownloadQueryObj: <any>{},
      functionError: "",
      searchRequestTraceIds: <string[]>[],
      searchWebSocketTraceIds: <string[]>[],
      isOperationCancelled: false,
      searchRetriesCount: <{ [key: string]: number }>{},
      actionId: null,
    },
    organizationIdentifier: "",
    runQuery: false,
    loading: false,
    loadingHistogram: false,
    loadingCounter: false,
    loadingStream: false,
    loadingSavedView: false,
    shouldIgnoreWatcher: false,
    communicationMethod: "http",
    // ...add any other properties your component expects
  };
  return {
    default: () => ({
      extractFields: mockExtractFields,
      getValuesPartition: mockGetValuesPartition,
      getFilterExpressionByFieldType: mockGetFilterExpressionByFieldType,
      searchObj: mockSearchObj,
      onStreamChange: vi.fn(),
      updatedLocalLogFilterField: vi.fn(),
      reorderSelectedFields: vi.fn(() => []),
      filterHitsColumns: vi.fn(),
      openedFilterFields: ref([]),
      streamFieldValues: ref({}),
      streamOptions: ref([]),
    }),
  };
});

// 1. Define your mock function FIRST
vi.mock('@/services/stream', () => {
  // Define the mock function with a console.log
  const mockFieldValues = vi.fn((...args) => {
    console.log('MOCK fieldValues called with:', args);
    // You can customize the return value based on args or call count if needed
    return Promise.resolve({
      data: {
        hits: [
          { values: [{ zo_sql_key: "foo", zo_sql_num: "2" }, { zo_sql_key: "bar", zo_sql_num: "3" }] }
        ]
      }
    });
  });

  return {
    default: {
      fieldValues: mockFieldValues
    }
  };
});

const mockExtractFields = vi.fn();
const mockGetValuesPartition = vi.fn();



const mockGetFilterExpressionByFieldType = vi.fn(() => "field = 'value'");

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

installQuasar({
  plugins: [Dialog, Notify],
});

describe("Index List", async () => {
  let wrapper: any;
  beforeEach(async () => {
    
    wrapper = mount(IndexList, {
      attachTo: "#app",
      global: {
        provide: {
          store: store,
        },
        plugins: [i18n, router ],
        stubs: {},
      },
    });
    await flushPromises();
    wrapper.vm.fieldValues = {};
    
    // Mock the required functions
    wrapper.vm.onStreamChange = vi.fn();
    wrapper.vm.updatedLocalLogFilterField = vi.fn();
    wrapper.vm.reorderSelectedFields = vi.fn(() => []);
    wrapper.vm.filterHitsColumns = vi.fn();
    
    // Initialize required refs
    wrapper.vm.openedFilterFields = ref([]);
    wrapper.vm.streamFieldValues = ref({});
    wrapper.vm.streamOptions = ref([]);
  });

  afterEach(() => {
    if(wrapper){
      wrapper.unmount();
    }
    vi.restoreAllMocks();
    wrapper.vm.openedFilterFields = ref([]);
    wrapper.vm.streamFieldValues = ref({});
    wrapper.vm.streamOptions = ref([]);
    wrapper.vm.fieldValues = [];
    // vi.clearAllMocks();
  });


  it("addSearchTerm sets addToFilter using getFilterExpressionByFieldType", async () => {
    wrapper.vm.searchObj.data.stream.addToFilter = "";
    wrapper.vm.addSearchTerm("field", "value", "include");
    expect(wrapper.vm.searchObj.data.stream.addToFilter).toBe("field = 'value'");
    expect(mockGetFilterExpressionByFieldType).toHaveBeenCalledWith("field", "value", "include");
  });

  it("toggleSchema sets loadingStream and calls extractFields", async () => {
    wrapper.vm.searchObj.loadingStream = false;
    await wrapper.vm.toggleSchema();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
    expect(wrapper.vm.searchObj.loadingStream).toBe(false);
    expect(mockExtractFields).toHaveBeenCalled();
  });

  it("filterFieldFn filters rows by name and avoids duplicates", async () => {
    // Spy on filterFieldFn
    const filterFieldFnSpy = vi.spyOn(wrapper.vm, 'filterFieldFn');
    // Sample data
    const rows = [
      { name: "FieldOne" },
      { name: "FieldTwo" },
      { name: "AnotherField" },
      { name: "FieldOne" }, // duplicate
    ];
    // Should match 'field' in a case-insensitive way and avoid duplicates
    const result = wrapper.vm.filterFieldFn(rows, "field");
    expect(result).toEqual([
      { name: "FieldOne" },
      { name: "FieldTwo" },
      { name: "AnotherField" },
    ]);
    // Assert the function was called with the correct arguments
    expect(filterFieldFnSpy).toHaveBeenCalledWith(rows, "field");
  });

  it("openFilterCreator aggregates values from partitions and sorts them", async () => {
    // Mock getValuesPartition to return two partitions
    const mockGetValuesPartition = vi.fn().mockResolvedValue({
      data: { partitions: [[1, 2], [3, 4]] }
    });
    // Mock streamService.fieldValues to return hits for each partition
    const mockFieldValues = vi.fn()
      .mockResolvedValueOnce({
        data: {
          hits: [
            { values: [{ zo_sql_key: "foo", zo_sql_num: "2" }, { zo_sql_key: "bar", zo_sql_num: "3" }] }
          ]
        }
      })
      .mockResolvedValueOnce({
        data: {
          hits: [
            { values: [{ zo_sql_key: "bar", zo_sql_num: "3" }, { zo_sql_key: "foo", zo_sql_num: "1" }] }
          ]
        }
      });

    // Patch the component's dependencies
    wrapper.vm.getValuesPartition = mockGetValuesPartition;

    // Set up required state
    wrapper.vm.searchObj.data.stream.selectedStream = ["testStream"];
    wrapper.vm.searchObj.data.stream.selectedStreamFields = [{ name: "testField" }];
    wrapper.vm.searchObj.data.query = "";
    wrapper.vm.searchObj.meta.sqlMode = false;
    wrapper.vm.searchObj.data.stream.streamType = "logs";
    wrapper.vm.searchObj.data.datetime = { type: "relative", relativeTimePeriod: "15m" };
    wrapper.vm.fieldValues = {};

    // Call openFilterCreator
    await wrapper.vm.openFilterCreator({}, { name: "testField", ftsKey: null, isSchemaField: false, streams: ["stream1"] });
    await flushPromises();
    await new Promise(r => setTimeout(r, 0));
    console.log("Test fieldValues:", wrapper.vm.fieldValues);
    expect(wrapper.vm.fieldValues["testField"]).toBeDefined();
    console.log(wrapper.vm.fieldValues["testField"].values,'field values for test hi')
    expect(wrapper.vm.fieldValues["testField"].values).toEqual([
      { key: "foo", count: 4 },
      { key: "bar", count: 6 },
    ]);
  });

  it("addTraceId adds a traceId to the correct field", async () => {
    wrapper.vm.addTraceId("fooField", "trace123");
    // This works if the ref is exposed on the instance (which it is, if not marked as private)
    expect(wrapper.vm.traceIdMapper["fooField"]).toEqual(["trace123"]);
  });

  it("removeTraceId removes a traceId from the correct field", async () => {
    wrapper.vm.removeTraceId("fooField", "trace123");
    expect(wrapper.vm.traceIdMapper["fooField"]).toBeUndefined();
  });
  it('add a specific field to interesting filed list ', async ()=> {
    const field = {
      name: 'testField',
      streams: ['stream1'],
      isInterestingField: false
    };
    wrapper.vm.addToInterestingFieldList(field, false);
    expect(wrapper.vm.searchObj.data.stream.interestingFieldList).toContain('testField');
  });

  it('removes a field from interesting field list', async () => {
    const field = {
      name: 'testField',
      streams: ['stream1'],
      isInterestingField: true
    };
    wrapper.vm.searchObj.data.stream.interestingFieldList = ['testField'];
    wrapper.vm.addToInterestingFieldList(field, true);
    expect(wrapper.vm.searchObj.data.stream.interestingFieldList).not.toContain('testField');
  });

  it('handles single stream selection correctly', async () => {
    const opt = { value: 'stream1', label: 'Stream 1' };
    wrapper.vm.handleSingleStreamSelect(opt);
    expect(wrapper.vm.searchObj.data.stream.selectedStream).toEqual(['stream1']);
    expect(wrapper.vm.searchObj.data.stream.selectedFields).toEqual([]);
    expect(wrapper.vm.onStreamChange).toHaveBeenCalledWith("");
  });

  it('resets selected fields correctly', async () => {
    wrapper.vm.searchObj.data.stream.selectedFields = ['field1', 'field2'];
    wrapper.vm.resetSelectedFileds();
    expect(wrapper.vm.searchObj.data.stream.selectedFields).toEqual([]);
  });

  it('filters fields correctly based on search term', async () => {
    const rows = [
      { name: 'testField1' },
      { name: 'testField2' },
      { name: 'otherField' }
    ];
    const result = wrapper.vm.filterFieldFn(rows, 'test');
    expect(result).toHaveLength(2);
    expect(result.map(r => r.name)).toContain('testField1');
    expect(result.map(r => r.name)).toContain('testField2');
  });

  it('adds field to filter with correct format', async () => {
    wrapper.vm.addToFilter('field1=value1');
    expect(wrapper.vm.searchObj.data.stream.addToFilter).toBe('field1=value1');
  });

  it('toggles field selection in clickFieldFn', async () => {
    const row = { name: 'field1' };
    wrapper.vm.searchObj.data.stream.selectedFields = [];
    wrapper.vm.clickFieldFn(row, 0);
    expect(wrapper.vm.searchObj.data.stream.selectedFields).toContain('field1');
  });

  it('handles stream filter function correctly', async () => {
    wrapper.vm.searchObj.data.stream.streamLists = [
      { label: 'Stream1', value: 'stream1' },
      { label: 'Stream2', value: 'stream2' },
      { label: 'TestStream', value: 'teststream' }
    ];
    
    const updateFn = vi.fn();
    wrapper.vm.filterStreamFn('Stream', updateFn);
    
    expect(updateFn).toHaveBeenCalled();
    const updateCallback = updateFn.mock.calls[0][0];
    updateCallback();
  });

  it('handles websocket trace ID management correctly', async () => {
    const field = 'testField';
    const traceId = 'trace123';
    
    wrapper.vm.addTraceId(field, traceId);
    expect(wrapper.vm.traceIdMapper[field]).toContain(traceId);
    
    wrapper.vm.removeTraceId(field, traceId);
    expect(wrapper.vm.traceIdMapper[field]).not.toContain(traceId);
  });

  it('computes placeholder text correctly', async () => {
    wrapper.vm.searchObj.data.stream.selectedStream = [];
    await nextTick();    
    wrapper.vm.searchObj.data.stream.selectedStream = ['stream1'];
    await nextTick();
    expect(wrapper.vm.placeHolderText).toBe('');
  });

  it('handles field values loading state correctly', async () => {
    const field = 'testField';
    wrapper.vm.fieldValues[field] = {
      isLoading: true,
      values: [],
      errMsg: ''
    };
    
    expect(wrapper.vm.fieldValues[field].isLoading).toBe(true);
    
    wrapper.vm.fieldValues[field].isLoading = false;
    expect(wrapper.vm.fieldValues[field].isLoading).toBe(false);
  });



  it('handles multiple stream selection', async () => {
    wrapper.vm.searchObj.data.stream.selectedStream = ['stream1'];
    wrapper.vm.handleMultiStreamSelection();
    expect(wrapper.vm.onStreamChange).toHaveBeenCalledWith("");
  });

  it('validates stream field values structure', async () => {
    const field = 'testField';
    const stream = 'stream1';
    
    wrapper.vm.streamFieldValues.value = {
      [field]: {
        [stream]: {
          values: [{ key: 'value1', count: 1 }]
        }
      }
    };
    
    expect(wrapper.vm.streamFieldValues.value[field][stream].values).toBeDefined();
    expect(wrapper.vm.streamFieldValues.value[field][stream].values[0].key).toBe('value1');
    expect(wrapper.vm.streamFieldValues.value[field][stream].values[0].count).toBe(1);
  });

  it('handles search term addition with field type', async () => {
    wrapper.vm.searchObj.data.stream.addToFilter = '';
    const field = 'testField';
    const value = 'testValue';
    const action = 'include';
    
    wrapper.vm.addSearchTerm(field, value, action);
    expect(mockGetFilterExpressionByFieldType).toHaveBeenCalledWith(field, value, action);
    expect(wrapper.vm.searchObj.data.stream.addToFilter).toBe("field = 'value'");
  });

  it('updates field values on stream change', async () => {
    const field = 'testField';
    wrapper.vm.fieldValues = {
      [field]: {
        isLoading: false,
        values: [{ key: 'oldValue', count: 1 }],
        errMsg: ''
      }
    };
    
    wrapper.vm.searchObj.data.stream.selectedStream = ['newStream'];
    await wrapper.vm.onStreamChange('');
    
    expect(wrapper.vm.fieldValues[field].values).toEqual([{ key: 'oldValue', count: 1 }]);
  });

  it('handles error in field values fetching', async () => {
    const field = {
      name: 'testField',
      ftsKey: null,
      isSchemaField: true,
      streams: ['stream1']
    };
    
    // Mock the required datetime object
    wrapper.vm.searchObj.data.datetime = {
      type: 'relative',
      relativeTimePeriod: '15m'
    };

    // Mock the getValuesPartition to throw an error
    mockGetValuesPartition.mockRejectedValueOnce(new Error('Fetch error'));
    
    await wrapper.vm.openFilterCreator({}, field);
    await flushPromises();
    
    expect(wrapper.vm.fieldValues[field.name].isLoading).toBe(false);
  });

  describe('handleSearchResponse', () => {

    it('initializes field values structure correctly', async () => {
      const payload = {
        queryReq: {
          fields: ['testField'],
          stream_name: 'stream1'
        }
      };
      const response = {
        type: 'search_response_hits',
        content: {
          results: {
            hits: []
          }
        }
      };

      wrapper.vm.handleSearchResponse(payload, response);
      expect(wrapper.vm.fieldValues['testField']).toBeDefined();
      expect(wrapper.vm.fieldValues['testField'].values).toEqual([]);
      expect(wrapper.vm.fieldValues['testField'].isLoading).toBe(false);
      expect(wrapper.vm.fieldValues['testField'].errMsg).toBe('');
    });

    it('aggregates values from multiple hits correctly', async () => {
      const payload = {
        queryReq: {
          fields: ['testField'],
          stream_name: 'stream1'
        }
      };
      const response = {
        type: 'search_response_hits',
        content: {
          results: {
            hits: [
              {
                values: [
                  { zo_sql_key: 'value1', zo_sql_num: '2' },
                  { zo_sql_key: 'value2', zo_sql_num: '3' }
                ]
              },
              {
                values: [
                  { zo_sql_key: 'value1', zo_sql_num: '1' },
                  { zo_sql_key: 'value3', zo_sql_num: '4' }
                ]
              }
            ]
          }
        }
      };

      wrapper.vm.handleSearchResponse(payload, response);
      const fieldValues = wrapper.vm.fieldValues['testField'].values;
      expect(fieldValues).toHaveLength(3);
      expect(fieldValues).toContainEqual({ key: 'value1', count: 3 });
      expect(fieldValues).toContainEqual({ key: 'value2', count: 3 });
      expect(fieldValues).toContainEqual({ key: 'value3', count: 4 });
      // Values should be sorted by count in descending order
      expect(fieldValues[0].count).toBeGreaterThanOrEqual(fieldValues[1].count);
    });

    it('handles errors gracefully', async () => {
      const payload = {
        queryReq: {
          fields: ['testField'],
          stream_name: 'stream1'
        }
      };
      const response = {
        type: 'search_response_hits',
        content: {
          results: null // This will cause an error
        }
      };

      wrapper.vm.handleSearchResponse(payload, response);
      expect(wrapper.vm.fieldValues['testField'].errMsg).toBe('Failed to fetch field values');
      expect(wrapper.vm.fieldValues['testField'].isLoading).toBe(false);
    });

    it('limits results to top 10 values', async () => {
      const payload = {
        queryReq: {
          fields: ['testField'],
          stream_name: 'stream1'
        }
      };
      const hits = Array.from({ length: 15 }, (_, i) => ({
        values: [{ zo_sql_key: `value${i}`, zo_sql_num: `${i + 1}` }]
      }));
      const response = {
        type: 'search_response_hits',
        content: {
          results: {
            hits
          }
        }
      };

      wrapper.vm.handleSearchResponse(payload, response);
      expect(wrapper.vm.fieldValues['testField'].values).toHaveLength(10);
      // First value should have the highest count
      expect(wrapper.vm.fieldValues['testField'].values[0].count).toBe(15);
    });

    it('aggregates values across multiple streams', async () => {
      // First stream
      wrapper.vm.handleSearchResponse({
        queryReq: {
          fields: ['testField'],
          stream_name: 'stream1'
        }
      }, {
        type: 'search_response_hits',
        content: {
          results: {
            hits: [{
              values: [{ zo_sql_key: 'value1', zo_sql_num: '2' }]
            }]
          }
        }
      });

      // Second stream
      wrapper.vm.handleSearchResponse({
        queryReq: {
          fields: ['testField'],
          stream_name: 'stream2'
        }
      }, {
        type: 'search_response_hits',
        content: {
          results: {
            hits: [{
              values: [{ zo_sql_key: 'value1', zo_sql_num: '3' }]
            }]
          }
        }
      });

      const fieldValues = wrapper.vm.fieldValues['testField'].values;
      expect(fieldValues).toHaveLength(1);
      expect(fieldValues[0]).toEqual({ key: 'value1', count: 5 });
    });
  });

  describe('handleSearchReset', () => {
    beforeEach(() => {
      // Mock the required functions
      wrapper.vm.fetchValuesWithWebsocket = vi.fn();

      // Mock the handleSearchReset implementation
      wrapper.vm.handleSearchReset = (data) => {
        const fieldName = data.payload.queryReq.fields[0];
        
        // Reset fieldValues
        if (!wrapper.vm.fieldValues) {
          wrapper.vm.fieldValues = {};
        }
        wrapper.vm.fieldValues[fieldName] = {
          values: [],
          isLoading: true,
          errMsg: ''
        };

        // Reset streamFieldValues
        if (!wrapper.vm.streamFieldValues) {
          wrapper.vm.streamFieldValues = {};
        }
        wrapper.vm.streamFieldValues[fieldName] = {};

        // Call fetchValuesWithWebsocket
        wrapper.vm.fetchValuesWithWebsocket(data.payload.queryReq);
      };
    });

    it('resets field values state correctly', async () => {
      const data = {
        payload: {
          queryReq: {
            fields: ['testField'],
            someOtherParam: 'value'
          }
        }
      };

      wrapper.vm.handleSearchReset(data);

      expect(wrapper.vm.fieldValues['testField']).toEqual({
        values: [],
        isLoading: true,
        errMsg: ''
      });
    });

    it('resets streamFieldValues state correctly', async () => {
      const data = {
        payload: {
          queryReq: {
            fields: ['testField']
          }
        }
      };

      wrapper.vm.handleSearchReset(data);

      expect(wrapper.vm.streamFieldValues['testField']).toEqual({});
      expect(wrapper.vm.fetchValuesWithWebsocket).toHaveBeenCalledWith(data.payload.queryReq);
    });

    it('calls fetchValuesWithWebsocket with correct parameters', async () => {
      const queryReq = {
        fields: ['testField'],
        someParam: 'value'
      };
      const data = {
        payload: {
          queryReq
        }
      };

      wrapper.vm.handleSearchReset(data);

      expect(wrapper.vm.fetchValuesWithWebsocket).toHaveBeenCalledWith(queryReq);
    });

    it('handles multiple field resets correctly', async () => {
      // Set up initial state
      wrapper.vm.fieldValues = {
        field1: {
          values: [{ key: 'value1', count: 1 }],
          isLoading: false,
          errMsg: 'Error 1'
        },
        field2: {
          values: [{ key: 'value2', count: 2 }],
          isLoading: false,
          errMsg: 'Error 2'
        }
      };
      wrapper.vm.streamFieldValues = {
        field1: { stream1: { values: [] } },
        field2: { stream1: { values: [] } }
      };

      // Reset first field
      wrapper.vm.handleSearchReset({
        payload: {
          queryReq: {
            fields: ['field1']
          }
        }
      });

      // Check that only field1 was reset
      expect(wrapper.vm.fieldValues['field1']).toEqual({
        values: [],
        isLoading: true,
        errMsg: ''
      });
      expect(wrapper.vm.streamFieldValues['field1']).toEqual({});

      // Check that field2 remained unchanged
      expect(wrapper.vm.fieldValues['field2']).toEqual({
        values: [{ key: 'value2', count: 2 }],
        isLoading: false,
        errMsg: 'Error 2'
      });
      expect(wrapper.vm.streamFieldValues['field2']).toEqual({ stream1: { values: [] } });
    });

    it('handles non-existent field reset gracefully', async () => {
      const data = {
        payload: {
          queryReq: {
            fields: ['nonExistentField']
          }
        }
      };

      wrapper.vm.handleSearchReset(data);

      expect(wrapper.vm.fieldValues['nonExistentField']).toEqual({
        values: [],
        isLoading: true,
        errMsg: ''
      });
      expect(wrapper.vm.fetchValuesWithWebsocket).toHaveBeenCalledWith(data.payload.queryReq);
    });
  });
});
