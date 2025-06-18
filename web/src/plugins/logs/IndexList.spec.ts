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
vi.mock("@/utils/zincutils", () => ({
  
  useLocalInterestingFields: vi.fn(() => ref({})),
  useLocalOrganization: vi.fn(() => ref({}))
}));

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
  });

  afterEach(() => {
    if(wrapper){
      wrapper.unmount();
    }
    vi.restoreAllMocks();
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
    
  })
  

});
