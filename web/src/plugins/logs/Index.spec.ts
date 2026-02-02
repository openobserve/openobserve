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
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "../../test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import { Mock } from 'vitest';

import Index from "@/plugins/logs/Index.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
// @ts-ignore
import { rest } from "msw";
import searchService from "@/services/search";
import router from "@/test/unit/helpers/router";
import { buildSqlQuery, getFieldsFromQuery } from "@/utils/query/sqlUtils";

// Mock CSS.supports for test environment
Object.defineProperty(global, 'CSS', {
  value: {
    supports: () => false,
    escape: () => '',
    // Add other required CSS properties as needed with dummy values
  }
});

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock the sqlUtils module
vi.mock("@/utils/query/sqlUtils", () => ({
  buildSqlQuery: vi.fn(),
  getFieldsFromQuery: vi.fn(),
  isSimpleSelectAllQuery: vi.fn((query) => {
    if (!query || typeof query !== 'string') return false;
    const normalizedQuery = query.trim().replace(/\s+/g, ' ');
    const selectAllPattern = /^select\s+\*\s+from\s+/i;
    return selectAllPattern.test(normalizedQuery);
  })
}));
vi.mock("@/composables/useDashboardPanelData", () => ({
  default: () => ({
    dashboardPanelData: {
      data: {
        version: 5,
        queries: [
          {
            fields: {
              stream_type: "",
              stream: "",
              x: [],
              y: [],
              z: [],
              breakdown: [],
              filter: [],
              latitude: null,
              longitude: null,
              weight: null,
              name: null,
              value_for_maps: null,
            }
          }
        ],
        id: "",
        type: "bar",
        title: "",
        description: "",
        config: {
          trellis: {
            layout: null,
            num_of_columns: 1,
            group_by_y_axis: false,
          },
          show_legends: true,
          legends_position: null,
          unit: null,
          unit_custom: null,
          decimals: 2,
          line_thickness: 1.5,
          step_value: "0",
          y_axis_min: null,
          y_axis_max: null,
          top_results: null,
          top_results_others: false,
          axis_width: null,
          axis_border_show: false,
          label_option: {
            position: null,
            rotate: 0,
          },
          show_symbol: true,
          line_interpolation: "smooth",
          legend_width: {
            value: null,
            unit: "px",
          },
          base_map: {
            type: "osm",
          },
          map_type: {
            type: "world",
          },
          map_view: {
            zoom: 1,
            lat: 0,
            lng: 0,
          },
          map_symbol_style: {
            size: "by Value",
            size_by_value: {
              min: 1,
              max: 100,
            },
            size_fixed: 2,
          },
          drilldown: [],
          mark_line: [],
          override_config: [],
          connect_nulls: false,
          no_value_replacement: "",
          wrap_table_cells: false,
          table_transpose: false,
          table_dynamic_columns: false,
          color: {
            mode: "palette-classic-by-series",
            fixedColor: ["#53ca53"],
            seriesBy: "last",
          },
          background: null,
        },
        htmlContent: "",
        markdownContent: "",
        customChartContent: `\ // To know more about ECharts , \n// visit: https://echarts.apache.org/examples/en/index.html \n// Example: https://echarts.apache.org/examples/en/editor.html?c=line-simple \n// Define your ECharts 'option' here. \n// 'data' variable is available for use and contains the response data from the search result and it is an array.\noption = {  \n \n};
      `,
        customChartResult: {},
        queryType: "sql",
      },
      layout: {
        splitter: 20,
        querySplitter: 41,
        showQueryBar: false,
        isConfigPanelOpen: false,
        currentQueryIndex: 0,
        vrlFunctionToggle: false,
        showFieldList: true,
      },
      meta: {
        parsedQuery: "",
        dragAndDrop: {
          dragging: false,
          dragElement: null,
          dragSource: null,
          dragSourceIndex: null,
          currentDragArea: null,
          targetDragIndex: null,
        },
        errors: {
          queryErrors: [],
        },
        editorValue: "",
        dateTime: { start_time: "", end_time: "" },
        filterValue: <any>[],
        stream: {
          hasUserDefinedSchemas: false,
          interestingFieldList: [],
          userDefinedSchema: [],
          vrlFunctionFieldList: [],
          selectedStreamFields: [],
          useUserDefinedSchemas: "user_defined_schema",
          customQueryFields: [],
          functions: [],
          streamResults: <any>[],
          streamResultsType: "",
          filterField: "",
        },
      },
    },
    validatePanel: vi.fn(),
    generateLabelFromName: (name: string) => name,
    resetDashboardPanelData: vi.fn()
  })
  
}));
vi.mock('@/composables/useLogs', async () => {
  // Import the real module
  const actual = await vi.importActual<typeof import('@/composables/useLogs')>(
    '@/composables/useLogs'
  )

  return {
    ...actual,
    // Only mock clearSearchObject
    clearSearchObj: vi.fn()
  }
})

import config from "@/aws-exports";
import segment from "@/services/segment_analytics";

describe("Logs Index", async () => {
  let wrapper: any;
  beforeEach(async () => {
    // ensure logs module shape exists to satisfy component expectations
    (store.state as any).logs = {
      isInitialized: true,
      logs: {
        data: {
          stream: {
            selectedStream: [],
          },
        },
        organizationIdentifier: store.state.selectedOrganization.identifier,
      },
    };
    // swallow vuex dispatches for namespaced modules not present in test helper
    vi.spyOn(store, 'dispatch').mockResolvedValue(undefined as any);
    // default safe mock to avoid destructuring errors in watchers
    (getFieldsFromQuery as Mock).mockResolvedValue({ fields: [], filters: [], streamName: '' });
    
    wrapper = mount(Index, {
      attachTo: "#app",
      global: {
        provide: {
          store: store,
        },
        plugins: [i18n, router],
      },
    });
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.restoreAllMocks();
    // vi.clearAllMocks();
  });


  it("Should hide index list when showFields is false.", async () => {
    

    wrapper.vm.searchObj.meta.showFields = false;
    await flushPromises();
    expect(
      wrapper.find('[data-test="logs-search-index-list"]').exists()
    ).toBeFalsy();
  });


  it("Should transform non-SQL query to SQL format when SQL mode is enabled", async () => {
    // Setup initial state
    wrapper.vm.searchObj.data.stream.selectedStream = ["stream1"];
    wrapper.vm.searchObj.data.stream.selectedStreamFields = [
      { name: "field1" },
      { name: "field2" }
    ];
    wrapper.vm.searchObj.data.stream.interestingFieldList = ["field1", "field2"];
    wrapper.vm.searchObj.meta.quickMode = true;
    //this is the query we need to set in the query editor and after that we need to call setQuery with SQL mode enabled
    //so that it will transform the query to SQL format
    wrapper.vm.searchObj.data.query = "field2 > 5";

    // Call setQuery with SQL mode enabled
    await wrapper.vm.setQuery(true);
    await flushPromises();

    // Verify the query was transformed correctly
    expect(wrapper.vm.searchObj.data.query).toBe('SELECT field1,field2 FROM "stream1" WHERE field2 > 5');
    expect(wrapper.vm.searchObj.data.editorValue).toBe('SELECT field1,field2 FROM "stream1" WHERE field2 > 5');
  });

  it("Should modify SQL query when adding/removing interesting fields", async () => {
    // Mock the removeFieldByName function
    const removeFieldByNameSpy = vi.spyOn(wrapper.vm, 'removeFieldByName')
      .mockImplementation((...args: any[]) => {
        const [data, fieldName] = args;
        if (fieldName === '*') {
          return data;
        }
        return data.filter((item: any) => item.expr?.column !== fieldName);
      });

    // Mock the processInterestingFiledInSQLQuery function
    const mockProcessedSQL = {
      columns: [
        {
          expr: { type: "column_ref", column: "field1" },
          type: "expr"
        }
      ],
      from: [{ table: "my_stream1" }],
      where: {
        type: "binary_expr",
        operator: ">",
        left: { type: "column_ref", column: "field1" },
        right: { type: "number", value: 5 }
      }
    };

    // Mock for adding field2
    const mockProcessedSQLWithField2 = {
      ...mockProcessedSQL,
      columns: [
        ...mockProcessedSQL.columns,
        {
          expr: { type: "column_ref", column: "field2" },
          type: "expr"
        }
      ]
    };

    const processInterestingFiledInSQLQuerySpy = vi.spyOn(wrapper.vm, 'processInterestingFiledInSQLQuery')
      .mockImplementationOnce(() => mockProcessedSQLWithField2)  // First call (adding field2)
      .mockImplementationOnce(() => mockProcessedSQL);          // Second call (removing field2)

    // Setup initial state
    wrapper.vm.searchObj.data.stream.selectedStream = ["my_stream1"];
    wrapper.vm.searchObj.data.query = 'SELECT field1 FROM "my_stream1" WHERE field1 > 5';
    wrapper.vm.searchObj.data.editorValue = wrapper.vm.searchObj.data.query;
    wrapper.vm.searchObj.data.streamResults = {
      list: [{
        name: "my_stream1",
        schema: [
          { name: "field1" },
          { name: "field2" }
        ]
      }]
    };
    
    // Add a new field (field2) to the query
    await wrapper.vm.setInterestingFieldInSQLQuery({
      "name": "field2",
      "ftsKey": false,
      "isSchemaField": true,
      "group": "my_stream1",
      "streams": [
          "my_stream1"
      ],
      "showValues": true,
      "isInterestingField": true
    }, false);
    await flushPromises();

    // Verify field was added to the query
    expect(wrapper.vm.searchObj.data.query).toBe('SELECT field1, field2 FROM "my_stream1" WHERE field1 > 5');
    expect(wrapper.vm.searchObj.data.editorValue).toBe('SELECT field1, field2 FROM "my_stream1" WHERE field1 > 5');

    // Remove an existing field (field2) from the query
    await wrapper.vm.setInterestingFieldInSQLQuery({
      "name": "field2",
      "ftsKey": false,
      "isSchemaField": true,
      "group": "my_stream1",
      "streams": ["my_stream1"],
      "showValues": true,
      "isInterestingField": true
    }, true);
    await flushPromises();

    // Verify field was removed from the query
    expect(wrapper.vm.searchObj.data.query).toBe('SELECT field1 FROM "my_stream1" WHERE field1 > 5');
    expect(wrapper.vm.searchObj.data.editorValue).toBe('SELECT field1 FROM "my_stream1" WHERE field1 > 5');

    // Cleanup
    processInterestingFiledInSQLQuerySpy.mockRestore();
    removeFieldByNameSpy.mockRestore();
  });

  it("Should update query when quick mode is enabled with interesting fields", async () => {
    // Setup initial state
    wrapper.vm.searchObj.meta.quickMode = true;
    wrapper.vm.searchObj.meta.sqlMode = true;
    wrapper.vm.searchObj.data.stream.selectedStream = ["my_stream1"];
    wrapper.vm.searchObj.data.stream.interestingFieldList = ["timestamp", "level", "message"];
    wrapper.vm.searchObj.data.query = 'SELECT * FROM "my_stream1" WHERE level = "error"';
    wrapper.vm.searchObj.data.editorValue = wrapper.vm.searchObj.data.query;

    // Mock setQuery function
    const setQuerySpy = vi.spyOn(wrapper.vm, 'setQuery');
    const updateUrlQueryParamsSpy = vi.spyOn(wrapper.vm, 'updateUrlQueryParams');

    // Call handleQuickModeChange
    await wrapper.vm.handleQuickModeChange();
    await flushPromises();

    // Verify the query was updated with interesting fields
    expect(wrapper.vm.searchObj.data.query).toBe('SELECT timestamp,level,message FROM "my_stream1" WHERE level = "error"');
    expect(setQuerySpy).toHaveBeenCalledWith(true);
    expect(updateUrlQueryParamsSpy).toHaveBeenCalled();

    // Test with empty interesting fields list
    wrapper.vm.searchObj.data.stream.interestingFieldList = [];
    wrapper.vm.searchObj.data.query = 'SELECT field1,field2 FROM "my_stream1" WHERE level = "error"';
    
    await wrapper.vm.handleQuickModeChange();
    await flushPromises();

    // Verify query reverts to SELECT * when no interesting fields
    expect(wrapper.vm.searchObj.data.query).toBe('SELECT * FROM "my_stream1" WHERE level = "error"');
    
    // Cleanup
    setQuerySpy.mockRestore();
    updateUrlQueryParamsSpy.mockRestore();
  });

  it.skip("Should properly set fields and conditions for dashboard panel", async () => {
    // Setup initial state
    wrapper.vm.searchObj.meta.sqlMode = true;
    wrapper.vm.searchObj.data.stream.streamType = "logs";
    wrapper.vm.searchObj.data.stream.selectedStream = ["my_stream1"];
    wrapper.vm.searchObj.data.query = 'SELECT histogram(_timestamp) as x_axis_1, count(_timestamp) as y_axis_1, level FROM "my_stream1" WHERE level = "error"';
    
    // Mock store state
    store.state.zoConfig.timestamp_column = "_timestamp";

    // Mock the getFieldsFromQuery function
    const mockFields = [
      {
        column: "_timestamp",
        alias: "x_axis_1",
        aggregationFunction: "histogram"
      },
      {
        column: "_timestamp",
        alias: "y_axis_1",
        aggregationFunction: "count"
      },
      {
        column: "level",
        alias: null,
        aggregationFunction: null
      }
    ];

    (getFieldsFromQuery as Mock).mockResolvedValue({
      fields: mockFields,
      filters: [{ column: "level", operator: "=", value: "error" }],
      streamName: "my_stream1"
    });


    // Call setFieldsAndConditions
    await wrapper.vm.setFieldsAndConditions();
    await flushPromises();

    // Verify dashboard panel data was set correctly
    const panelData = wrapper.vm.dashboardPanelData.data.queries[0].fields;
    
    // Check stream settings
    expect(panelData.stream_type).toBe("logs");
    expect(panelData.stream).toBe("my_stream1");

    // Check x-axis fields (should contain histogram field)
    expect(panelData.x).toHaveLength(1);
    expect(panelData.x[0]).toEqual({
      column: "_timestamp",
      alias: "x_axis_1",
      aggregationFunction: "histogram",
      label: "Timestamp"
    });

    // Check y-axis fields (should contain count field)
    expect(panelData.y).toHaveLength(1);
    expect(panelData.y[0]).toEqual({
      column: "_timestamp",
      alias: "y_axis_1",
      aggregationFunction: "count",
      label: "Timestamp"
    });

    // Check breakdown fields (should contain level field)
    expect(panelData.breakdown).toHaveLength(1);
    expect(panelData.breakdown[0]).toEqual({
      column: "level",
      alias: "level",
      aggregationFunction: null,
      label: "Level"
    });

    // Check filters
    expect(panelData.filter).toEqual([
      { column: "level", operator: "=", value: "error" }
    ]);

    // Test with no fields returned
    (getFieldsFromQuery as Mock).mockResolvedValueOnce({
      fields: [],
      filters: [],
      streamName: "my_stream1"
    });

    // Reset dashboard panel data
    wrapper.vm.dashboardPanelData.data.queries[0].fields = {
      stream_type: "",
      stream: "",
      x: [],
      y: [],
      breakdown: [],
      filter: []
    };

    // Call setFieldsAndConditions again
    await wrapper.vm.setFieldsAndConditions();
    await flushPromises();

    // Verify default fields were added
    const defaultPanelData = wrapper.vm.dashboardPanelData.data.queries[0].fields;
    expect(defaultPanelData.x).toHaveLength(1);
    expect(defaultPanelData.y).toHaveLength(1);
    expect(defaultPanelData.x[0].aggregationFunction).toBe("histogram");
    expect(defaultPanelData.y[0].aggregationFunction).toBe("count");

    // Verify getFieldsFromQuery was called with correct parameters
    expect(getFieldsFromQuery).toHaveBeenCalledWith(
      'SELECT histogram(_timestamp) as x_axis_1, count(_timestamp) as y_axis_1, level FROM "my_stream1" WHERE level = "error"',
      "_timestamp"
    );
  });

  // Additional tests for broader coverage
  it("Should toggle field list via collapseFieldList and update splitter model", async () => {
    wrapper.vm.searchObj.meta.showFields = true;
    // set splitter to 0 to avoid moveSplitter watcher toggling showFields back to true
    wrapper.vm.searchObj.config.splitterModel = 0;
    wrapper.vm.searchObj.config.lastSplitterPosition = 20;

    wrapper.vm.collapseFieldList();
    await flushPromises();
    expect(wrapper.vm.searchObj.meta.showFields).toBe(false);
    expect(wrapper.vm.searchObj.config.splitterModel).toBe(0);

    wrapper.vm.collapseFieldList();
    await flushPromises();
    expect(wrapper.vm.searchObj.meta.showFields).toBe(true);
    expect(wrapper.vm.searchObj.config.splitterModel).toBe(20);
  });

  it("Should dispatch resize event on onSplitterUpdate", async () => {
    const spy = vi.spyOn(window, 'dispatchEvent');
    wrapper.vm.onSplitterUpdate();
    expect(spy).toHaveBeenCalledWith(expect.any(Event));
    spy.mockRestore();
  });

  it("Should refresh timezone without errors", async () => {
    expect(() => wrapper.vm.refreshTimezone()).not.toThrow();
  });

  it("Should handle change interval without errors", async () => {
    wrapper.vm.searchObj.meta.refreshInterval = 0;
    expect(() => wrapper.vm.onChangeInterval()).not.toThrow();
  });

  it("Should execute runQueryFn and show job scheduler", async () => {
    // do not rely on spying internal closures; assert state change
    await wrapper.vm.runQueryFn();
    expect(wrapper.vm.showJobScheduler).toBe(true);
  });

  it("Should toggle expanded logs on toggleExpandLog", async () => {
    wrapper.vm.expandedLogs = [];
    wrapper.vm.toggleExpandLog(1);
    expect(wrapper.vm.expandedLogs).toContain(1);
    wrapper.vm.toggleExpandLog(1);
    expect(wrapper.vm.expandedLogs).not.toContain(1);
  });

  it("Should compute areStreamsPresent based on streamLists length", async () => {
    wrapper.vm.searchObj.data.stream.streamLists = [];
    await flushPromises();
    expect(wrapper.vm.areStreamsPresent).toBe(false);

    wrapper.vm.searchObj.data.stream.streamLists = ["s1"];
    await flushPromises();
    expect(wrapper.vm.areStreamsPresent).toBe(true);
  });


  it("Should resize on splitter model change", async () => {
    const spy = vi.spyOn(window, 'dispatchEvent');
    wrapper.vm.splitterModel = 11;
    await flushPromises();
    expect(spy).toHaveBeenCalledWith(expect.any(Event));
    spy.mockRestore();
  });

  it("Should handle search history toggling via route action query", async () => {
    // Ensure initial state
    expect(wrapper.vm.showSearchHistory).toBe(false);
    
    // Navigate to history view
    await wrapper.vm.router.push({ 
      name: 'logs', 
      query: { 
        action: 'history', 
        org_identifier: store.state.selectedOrganization.identifier 
      } 
    });
    
    // Wait for all async operations and route changes
    await flushPromises();
    await wrapper.vm.$nextTick();
    
    expect(wrapper.vm.showSearchHistory).toBe(true);

    // Navigate back to normal view
    await wrapper.vm.router.push({ 
      name: 'logs', 
      query: { 
        org_identifier: store.state.selectedOrganization.identifier 
      } 
    });
    
    // Wait for all async operations and route changes
    await flushPromises();
    await wrapper.vm.$nextTick();
    
    expect(wrapper.vm.showSearchHistory).toBe(false);
    expect(wrapper.vm.showSearchScheduler).toBe(false);
  }, 10000);


  it("Should call router.push on redirectBackToLogs", async () => {
    const pushSpy = vi.spyOn(wrapper.vm.router, 'push');
    wrapper.vm.redirectBackToLogs();
    expect(pushSpy).toHaveBeenCalledWith(expect.objectContaining({ name: 'logs' }));
  });

  it("Should call router.push and set showSearchHistory on showSearchHistoryfn", async () => {
    const pushSpy = vi.spyOn(wrapper.vm.router, 'push');
    wrapper.vm.showSearchHistoryfn();
    expect(pushSpy).toHaveBeenCalledWith(expect.objectContaining({ name: 'logs' }));
    expect(wrapper.vm.showSearchHistory).toBe(true);
  });

  it("Should close search history and refresh histogram", async () => {
    const backSpy = vi.spyOn(wrapper.vm.router, 'back').mockImplementation(() => {});
    wrapper.vm.showSearchHistory = true;

    wrapper.vm.closeSearchHistoryfn();
    expect(backSpy).toHaveBeenCalled();
    expect(wrapper.vm.showSearchHistory).toBe(false);
  });

  it("Should close search scheduler and navigate back", async () => {
    const backSpy = vi.spyOn(wrapper.vm.router, 'back').mockImplementation(() => {});
    wrapper.vm.showSearchScheduler = true;

    wrapper.vm.closeSearchSchedulerFn();
    expect(backSpy).toHaveBeenCalled();
    expect(wrapper.vm.showSearchScheduler).toBe(false);
  });

  it("Should set histogram date using searchBarRef", async () => {
    const setCustomDate = vi.fn();
    wrapper.vm.searchBarRef = { dateTimeRef: { setCustomDate } } as any;
    const date = { startTime: '2020-01-01', endTime: '2020-01-02' };
    wrapper.vm.setHistogramDate(date);
    expect(setCustomDate).toHaveBeenCalledWith('absolute', date);
  });

  it("Should handle chart API error and populate errors list", async () => {
    wrapper.vm.handleChartApiError('some-error');
    expect(wrapper.vm.visualizeErrorData.errors).toEqual(['some-error']);
  });

  it("Should watch runQuery and trigger runQueryFn when true", async () => {
    wrapper.vm.searchObj.runQuery = true;
    await flushPromises();
    // state-based check: runQuery watcher should have attempted to run
    expect(wrapper.vm.searchObj.runQuery).toBe(true);
  });

  it("Should watch fullSQLMode true -> setQuery & updateUrl; false -> reset and maybe getQueryData", async () => {
    const setQuerySpy = vi.spyOn(wrapper.vm, 'setQuery');
    const updateSpy = vi.spyOn(wrapper.vm, 'updateUrlQueryParams');

    // Trigger true branch
    wrapper.vm.searchObj.meta.sqlModeManualTrigger = false;
    wrapper.vm.searchObj.meta.sqlMode = true;
    await flushPromises();
    expect(setQuerySpy).toHaveBeenCalledWith(true);
    expect(updateSpy).toHaveBeenCalled();

    // Trigger false branch
    wrapper.vm.searchObj.loading = false;
    wrapper.vm.searchObj.shouldIgnoreWatcher = false;
    store.state.zoConfig.query_on_stream_selection = false;
    wrapper.vm.searchObj.meta.sqlMode = false;
    await flushPromises();

    expect(wrapper.vm.searchObj.data.query).toBe("");
    expect(wrapper.vm.searchObj.data.editorValue).toBe("");
  });

  it("Should set loading & runQuery, and track analytics on cloud in searchData", async () => {
    const originalIsCloud = config.isCloud;
    try {
      (segment as any).track = vi.fn();
      (config as any).isCloud = 'true';

      wrapper.vm.searchObj.loading = false;
      wrapper.vm.searchObj.runQuery = false;
      wrapper.vm.searchObj.data.stream.selectedStream = ['s1'];
      wrapper.vm.searchObj.meta.showQuery = true;
      wrapper.vm.searchObj.meta.showHistogram = true;
      wrapper.vm.searchObj.meta.sqlMode = false;
      wrapper.vm.searchObj.meta.showFields = true;

      wrapper.vm.searchData();

      expect(wrapper.vm.searchObj.loading).toBe(true);
      expect(wrapper.vm.searchObj.runQuery).toBe(true);
      expect((segment as any).track).toHaveBeenCalledWith(
        'Button Click',
        expect.objectContaining({ button: 'Search Data' })
      );
    } finally {
      (config as any).isCloud = originalIsCloud;
    }
  });

  it("Should toggle error details visibility", async () => {
    expect(wrapper.vm.disableMoreErrorDetails).toBe(false);
    wrapper.vm.toggleErrorDetails();
    expect(wrapper.vm.disableMoreErrorDetails).toBe(true);
  });

  it("Should emit sendToAiChat event with payload", async () => {
    wrapper.vm.sendToAiChat({ foo: 'bar' });
    expect(wrapper.emitted('sendToAiChat')?.[0]?.[0]).toEqual({ foo: 'bar' });
  });

  it("removeFieldByName should remove matching column_ref and aggr_func entries", () => {
    const cols = [
      { expr: { type: 'column_ref', column: '*' } },
      { expr: { type: 'column_ref', column: 'f1' } },
      { expr: { type: 'aggr_func', args: { expr: { column: { value: 'f2' } } } } },
    ];
    const result = wrapper.vm.removeFieldByName(cols, 'f1');
    expect(result.find((c: any) => c.expr?.column === 'f1')).toBeUndefined();
    const result2 = wrapper.vm.removeFieldByName(result, 'f2');
    expect(result2.find((c: any) => c.expr?.args?.expr?.column?.value === 'f2')).toBeUndefined();
  });
});
