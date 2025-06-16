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

import { describe, expect, it, beforeEach, vi, afterEach, Mock } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { Dialog, Notify } from "quasar";
import { createStore } from "vuex";
import { useRouter } from "vue-router";
import { createI18n } from "vue-i18n";
import type { AxiosResponse } from "axios";
import { defineComponent, nextTick } from "vue";
import useLogs from "../../composables/useLogs";
import searchService from "../../services/search";
import savedviewsService from "../../services/saved_views";
import * as zincutils from "../../utils/zincutils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";

import store from "../../test/unit/helpers/store";

installQuasar({
  plugins: [Dialog, Notify],
});

// Create i18n instance
const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      // Add any required translations here
      search: {
        queryRangeRestrictionMsg: 'Query range restricted to {range}'
      }
    }
  }
});

// Mock services
vi.mock("../../services/search", () => {
  return {
    default: {
      get_regions: vi.fn().mockImplementation(() => Promise.resolve()),
      search: vi.fn().mockImplementation(() => Promise.resolve()),
      partition: vi.fn().mockImplementation(() => Promise.resolve({
        data: {
          partitions: [[1000, 2000]],
          streaming_aggs: false,
          streaming_id: null,
          records: 100
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {}
      } as AxiosResponse)),
    },
  };
});

vi.mock("../../services/saved_views", () => ({
  default: {
    get: vi.fn().mockImplementation(() => Promise.resolve()),
  },
}));




// Mock getStreams and getStream functions
const mockGetStreams = vi.fn();
const mockGetStream = vi.fn();
vi.mock("../../composables/useStreams", () => ({
  default: () => ({
    getStreams: mockGetStreams,
    getStream: mockGetStream,
  }),
}));

// Mock router
const router = useRouter();
vi.mock("vue-router", () => ({
  useRouter: () => ({
    currentRoute: {
      value: {
        name: "logs",
        query: {},
      },
    },
    push: vi.fn(),
  }),
}));

// Create a test component that uses the composable
const TestComponent = defineComponent({
  template: '<div></div>',
  setup() {
    return useLogs();
  },
});

describe("Use Logs Composable", () => {
  let wrapper: any;

  beforeEach(async () => {
    // Create a div for mounting
    const app = document.createElement("div");
    app.setAttribute("id", "app");
    document.body.appendChild(app);

    // Mount test component with plugins
    wrapper = mount(TestComponent, {
      global: {
        plugins: [store, i18n],
        provide: {
          router
        }
      }
    });


    // Reset mocks
    vi.clearAllMocks();

    // Setup default mock responses
    mockGetStream.mockResolvedValue({
      schema: [
        { name: "timestamp", type: "timestamp" },
        { name: "message", type: "string" }
      ],
      settings: {
        defined_schema_fields: ["timestamp", "message"],
        full_text_search_keys: ["message"]
      }
    });
  });

  afterEach(() => {
    // Cleanup
    wrapper.vm.searchObj = undefined
    wrapper.unmount();
    document.body.innerHTML = "";
  });


  describe("Query Partitions", () => {

    afterEach(() => {
      wrapper.vm.searchObj = undefined
    });

    it("should get query partitions successfully", async () => {
      // Mock partition response
      vi.mocked(searchService.partition).mockImplementationOnce(() => 
        Promise.resolve({
          data: {
            "trace_id": "d975d36100dd4b5d8422a9b53454e64c",
            "file_num": 0,
            "records": 0,
            "original_size": 0,
            "compressed_size": 0,
            "max_query_range": 0,
            "partitions": [
                [
                    1749627138202000,
                    1749627198202000
                ],
                [
                    1749624498202000,
                    1749627138202000
                ]
            ],
            "order_by": "desc",
            "limit": 0,
            "streaming_output": true,
            "streaming_aggs": false,
            "streaming_id": null
        },
          status: 200,
          statusText: "OK",
          headers: {},
          config: {}
        } as AxiosResponse)
      );

      // Setup test data
      const queryReq = {
        query: {
          sql: "test query",
          start_time: 1000,
          end_time: 2000,
          sql_mode: "context"
        }
      };

      // Call getQueryPartitions
      const { getQueryPartitions } = wrapper.vm;
      await getQueryPartitions(queryReq);

      // Verify partition service was called with correct parameters
      expect(searchService.partition).toHaveBeenCalledWith({
        org_identifier: wrapper.vm.searchObj.organizationIdentifier,
        query: {
          sql: "test query",
          start_time: 1000,
          end_time: 2000,
          sql_mode: "context",
          streaming_output: true
        },
        page_type: wrapper.vm.searchObj.data.stream.streamType,
        traceparent: expect.any(String)
      });

      // Verify partition data is set correctly
      expect(wrapper.vm.searchObj.data.queryResults.partitionDetail).toEqual({
        partitions: [[1749627138202000, 1749627198202000], [1749624498202000, 1749627138202000]],
        partitionTotal: [-1,-1],
        paginations: [
            [
              {
                startTime: 1749627138202000,
                endTime: 1749627198202000,
                from: 0,
                size: 50,
                streaming_output: false,
                streaming_id: null
              }
            ],
            [
              {
                startTime: 1749624498202000,
                endTime: 1749627138202000,
                from: 0,
                size: 50,
                streaming_output: false,
                streaming_id: null
              }
            ]
          ]
      });

      // Verify total records are updated
    });
  });

  describe("Paginated Data", () => {
    beforeEach(() => {
      // Mock processPostPaginationData and its sub-functions
      vi.spyOn(wrapper.vm, 'processPostPaginationData').mockImplementation(() => {});
    });

    afterEach(() => {
      wrapper.vm.searchObj = undefined
      vi.clearAllMocks();
    });

    it("should get paginated data successfully", async () => {
      // Mock search response
      vi.mocked(searchService.search).mockImplementationOnce(() => 
        Promise.resolve({
          data: {
            hits: [
              { 
                timestamp: "1749627138202000", 
                message: "Log message 1",
                level: "info"
              },
              { 
                timestamp: "1749627138202001", 
                message: "Log message 2",
                level: "error"
              }
            ],
            total: 2,
            from: 0,
            scan_size: 1000,
            took: 50
          },
          status: 200,
          statusText: "OK",
          headers: {},
          config: {}
        } as AxiosResponse)
      );

      // Setup initial state for streams
      wrapper.vm.searchObj.data.streamResults = {
        list: [
          {
            name: "default_1",
            stats: { doc_time_max: 1749627138202000 },
            schema: [
              { name: "timestamp", type: "timestamp" },
              { name: "message", type: "string" },
              { name: "level", type: "string" }
            ],
            settings: {
              defined_schema_fields: ["timestamp", "message", "level"],
              full_text_search_keys: ["message"],
              max_query_range: 0
            }
          }
        ]
      };

      wrapper.vm.searchObj.data.stream = {
        selectedStream: ["default_1"],
        streamType: "logs",
        selectedStreamFields: [],
        selectedFields: ["message", "level"],
        interestingFieldList: [],
        expandGroupRows: { common: true, default_1: true },
        expandGroupRowsFieldCount: { common: 0, default_1: 0 },
        userDefinedSchema: ["timestamp", "message", "level"]
      };

      // Mock store state
      wrapper.vm.store = {
        state: {
          zoConfig: {
            timestamp_column: "timestamp",
            all_fields_name: "_all",
            user_defined_schemas_enabled: true,
            max_query_range: 0
          }
        }
      };

      // Setup partition details
      wrapper.vm.searchObj.data.queryResults = {
        partitionDetail: {
          partitions: [[1749627138202000, 1749627198202000]],
          partitionTotal: [-1],
          paginations: [[{
            startTime: 1749627138202000,
            endTime: 1749627198202000,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: null
          }]]
        },
        hits: [],
        total: 0,
        filteredHit: []
      };

      wrapper.vm.searchObj.data.resultGrid.currentPage = 1;
      wrapper.vm.searchObj.meta.resultGrid.rowsPerPage = 50;
      wrapper.vm.searchObj.organizationIdentifier = "test-org";

      // Setup query request
      const queryReq = {
        query: {
          "sql": "SELECT * FROM \"default_1\"",
          "start_time": 1749627138202000,
          "end_time": 1749627198202000,
          "from": 0,
          "size": 50,
          "quick_mode": false,
          "sql_mode": "full",
          "streaming_output": false,
          "streaming_id": null
        }
      };

      // Call getPaginatedData
      const { getPaginatedData } = wrapper.vm;
      await getPaginatedData(queryReq);

      // Verify search service was called with correct parameters
      expect(searchService.search).toHaveBeenCalledWith({
        org_identifier: "test-org",
        query: queryReq,
        jobId: "",
        page_type: "logs",
        traceparent: expect.any(String)
      }, "ui");

      // Verify search results are set correctly
      expect(wrapper.vm.searchObj.data.queryResults.hits).toEqual([
        { timestamp: "1749627138202000", message: "Log message 1", level: "info" },
        { timestamp: "1749627138202001", message: "Log message 2", level: "error" }
      ]);

      expect(wrapper.vm.searchObj.data.queryResults.hits.length).toBe(2);
      expect(wrapper.vm.searchObj.data.queryResults.scan_size).toBe(1000);
      expect(wrapper.vm.searchObj.data.queryResults.took).toBe(50);
      expect(wrapper.vm.searchObj.loading).toBe(false);

    });
  });

  describe("Generate Histogram Data", () => {
    beforeEach(() => {
      // Reset all mocks and state
      vi.clearAllMocks();
      
      // Mock fnParsedSQL
      vi.spyOn(wrapper.vm, 'fnParsedSQL').mockImplementation(() => ({
        columns: [],
        hasOwnProperty: () => true
      }));

      vi.spyOn(wrapper.vm, 'fnUnparsedSQL').mockImplementation(() => ({
        columns: [],
        hasOwnProperty: () => true
      }));


      // Mock histogramDateTimezone from zincutils
      vi.spyOn(zincutils, 'histogramDateTimezone').mockImplementation(function(this: unknown, ...args: unknown[]) {
        const date = args[0] as string | number | Date;
        return new Date(date).getTime();
      });

      vi.spyOn(wrapper.vm, 'importSqlParser').mockImplementation(function(this: unknown, ...args: unknown[]) {
        return {
            type: 'select',
            from: [{ table: '"default_2"' }]
        };
      });

      // Setup basic searchObj structure
    //   wrapper.vm.searchObj = {
    //     data: {
    //       queryResults: {
    //         aggs: [],
    //         total: 0
    //       },
    //       histogram: {
    //         xData: [],
    //         yData: [],
    //         chartParams: {
    //           title: "",
    //           unparsed_x_data: [],
    //           timezone: ""
    //         },
    //         errorCode: 0,
    //         errorMsg: "",
    //         errorDetail: ""
    //       }
    //     },
    //     meta: {
    //       sqlMode: false
    //     }
    //   };

    wrapper.vm.searchObj.data = {
        query: 'select * from "default_2" ',
        stream: {
            selectedStream: ['default_2'],
            selectedStreamFields: [],
            selectedFields: ['message'],
            interestingFieldList: [],
            expandGroupRows: { common: true, default_2: true },
            expandGroupRowsFieldCount: { common: 0, default_2: 0 },
            userDefinedSchema: ['timestamp', 'message']
        },
        datetime: { 
            startTime: 1714732800000,
            endTime: 1714736400000
        },
        resultGrid: {   
            rowsPerPage: 50,
            currentPage: 1
        },
        queryResults: {
          aggs: [],
          total: 0
        },
        histogram: {
          xData: [],
          yData: [],
          chartParams: {
            title: "",
            unparsed_x_data: [],
            timezone: ""
          },
          errorCode: 0,
          errorMsg: "",
          errorDetail: ""
        }
      };

      wrapper.vm.searchObj.meta.sqlMode = true;

      // Mock store state
      wrapper.vm.store = {
        state: {
          timezone: "UTC"
        }
      };

      // Reset histogramResults and histogramMappedData
      wrapper.vm.histogramResults = [];
      wrapper.vm.histogramMappedData = new Map();
    });
    afterEach(() => {
      vi.clearAllMocks();
      wrapper.vm.searchObj = undefined
    });

    it("should generate histogram data from aggregations", () => {
      // Setup test data
      const testAggs = [
        { zo_sql_key: "2024-01-01T00:00:00Z", zo_sql_num: "10" },
        { zo_sql_key: "2024-01-01T01:00:00Z", zo_sql_num: "20" },
        { zo_sql_key: "2024-01-01T02:00:00Z", zo_sql_num: "15" }
      ];

      wrapper.vm.searchObj.data.queryResults.aggs = testAggs;

      // Call generateHistogramData
      const { generateHistogramData } = wrapper.vm;
      generateHistogramData();


      // Verify histogram data
      expect(wrapper.vm.searchObj.data.histogram.xData).toEqual([
        new Date("2024-01-01T00:00:00Z").getTime(),
        new Date("2024-01-01T01:00:00Z").getTime(),
        new Date("2024-01-01T02:00:00Z").getTime()
      ]);
      expect(wrapper.vm.searchObj.data.histogram.yData).toEqual([10, 20, 15]);
      expect(wrapper.vm.searchObj.data.histogram.chartParams.unparsed_x_data).toEqual([
        "2024-01-01T00:00:00Z",
        "2024-01-01T01:00:00Z",
        "2024-01-01T02:00:00Z"
      ]);
      expect(wrapper.vm.searchObj.data.queryResults.total).toBe(45);
    });

  });


  describe('build search request', () => {

    beforeEach(async () => {
      vi.clearAllMocks();
      wrapper.vm.searchObj = {
        data: {
            query:' ',
            stream: {
                selectedStream: ['default_2'],
                selectedStreamFields: [],
                selectedFields: ['message'],
            },
            datetime: {
                startTime: 1714732800000,
                endTime: 1714736400000
            },
            resultGrid: {
                rowsPerPage: 50,
                currentPage: 1
            }
            
        },
        meta: {
            sqlMode: true,

        },

      }
      vi.mock('@/composables/useParser', () => {
        return {
          default: () => ({
            sqlParser: async () => ({
              astify: vi.fn((query) => {
                // Simple logic to return different mock structures
                if (query.includes("select * from INDEX_NAME")) {
                  return {
                    from: [{ table: "mock_table" }],
                    where: { mock: "where" },
                    _next: null
                  };
                }
      
                // Simulate parsed original query
                return {
                  from: [{ table: "mock_table" }],
                  where: { mock: "where" },
                  _next: null
                };
              }),
              sqlify: vi.fn((ast) => `SELECT * FROM \`${ast.from?.[0]?.table || 'UNKNOWN'}\``),
              columnList: vi.fn(),
              tableList: vi.fn(),
              whiteListCheck: vi.fn(),
              exprToSQL: vi.fn(),
              parse: vi.fn(),
            })
          })
        }
      })
    await flushPromises();
    });

    afterEach(() => {
      wrapper.vm.searchObj = undefined
    });

    it('should build search request with SQL mode', async () => {
        await flushPromises();
      wrapper.vm.searchObj.data.stream.selectedStream = ['default_2'];
      wrapper.vm.searchObj.data.datetime.startTime = 1714732800000;
      wrapper.vm.searchObj.data.datetime.endTime = 1714736400000;
      wrapper.vm.searchObj.data.resultGrid.currentPage = 1;
      wrapper.vm.searchObj.data.resultGrid.rowsPerPage = 50;
      wrapper.vm.searchObj.meta.sqlMode = true;
      wrapper.vm.searchObj.organizationIdentifier = "test-org";
      wrapper.vm.searchObj.data.stream.streamType = "logs";
      wrapper.vm.searchObj.data.stream.selectedStreamFields = [];
      wrapper.vm.searchObj.data.stream.interestingFieldList = [];
      const mockParser = {
        parse: vi.fn().mockReturnValue({ success: true }),
        sqlify: vi.fn(),
        columnList: vi.fn(),
        tableList: vi.fn(),
        whiteListCheck: vi.fn(),
        exprToSQL: vi.fn(),
        astify: vi.fn(),
      }
      wrapper.vm.parser = mockParser;


      const { buildSearch } = wrapper.vm;
      const searchRequest = buildSearch();


      expect(searchRequest.query.sql).toEqual('select * from "default_2"');
      expect(searchRequest.query.start_time).toEqual(wrapper.vm.searchObj.data.datetime.startTime);
      expect(searchRequest.query.end_time).toEqual(wrapper.vm.searchObj.data.datetime.endTime);
      expect(searchRequest.query.from).toEqual(0);
      expect(searchRequest.query.size).toEqual(50);
      expect(searchRequest.query.quick_mode).toEqual(false);

    });
  });

  describe("refreshPartitionPagination", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      wrapper.vm.searchObj = {
        meta: {
          jobId: "",
          resultGrid: {
            rowsPerPage: 50,
          },
          sqlMode: false,
          showHistogram: false,
        },
        data: {
          resultGrid: {
            currentPage: 1,
          },
          stream: {
            selectedStream: ["default"],
          },
          queryResults: {
            total: 10,
            aggs: null,
            partitionDetail: {
              partitions: [
                [1714732800000000, 1714736400000000],
                [1714736400000000, 1714740000000000]
                  ],
              partitionTotal: [10, 22],
              paginations: [
                [
                  {
                    startTime: 1714732800000000,
                    endTime: 1714736400000000,
                    from: 0,
                    size: 50,
                  }
                ],
                [
                  {
                    startTime: 1714736400000000,
                    endTime: 1714740000000000,
                    from: 0,
                    size: 50,
                  }
                ]
              ],
            },
          },
        },
        loadingHistogram: false,
      };
    });
    afterEach(() => {
      wrapper.vm.searchObj = undefined
    });

    it("should correctly generate paginations for given partitions and calculate total", () => {

      console.log(wrapper.vm.searchObj.data.queryResults,'wrapper.vm.searchObj.data.queryResults')
      wrapper.vm.refreshPartitionPagination(false, false);

      const { paginations, partitionTotal } =
        wrapper.vm.searchObj.data.queryResults.partitionDetail;
      const { total } = wrapper.vm.searchObj.data.queryResults;


      expect(paginations).toHaveLength(2);

      // Page 1: 50 records from partition 1
      console.log(paginations,'paginatoins')

      expect(paginations[0]).toEqual([
        {
          startTime: 1714732800000000,
          endTime: 1714736400000000,
          from: 0,
          size: 50
        }
      ])

      expect(paginations[1]).toEqual([
        {
          startTime: 1714736400000000,
          endTime: 1714740000000000,
          from: 0,
          size: 50
        }
      ])
    });

  });

  describe("restoreUrlQueryParams", () => {
    beforeEach(() => {
      vi.mock('vue-router', () => ({
        useRouter: () => ({
          currentRoute: {
            name: "logs1",
            value: {
              query: {
                stream:"",
                from:"",
                to:""
              }
            }
          },
          push: vi.fn()
        })
      }));
  
    });
  
    afterEach(() => {
      wrapper.vm.searchObj = undefined;
      wrapper.vm.router.currentRoute.value.query = {};
    });
  
    it("should handle empty query params", async () => {
      const { restoreUrlQueryParams } = wrapper.vm;
      await restoreUrlQueryParams();
  
      await nextTick();
  
      expect(wrapper.vm.searchObj.shouldIgnoreWatcher).toBe(false);
      expect(wrapper.vm.router.push).not.toHaveBeenCalled();
    });
  
    it("should restore stream and datetime parameters", async () => {
      wrapper.vm.router.currentRoute.value.query = {
        stream: "stream1,stream2",
        from: "1614556800008",
        to: "1614643200000"
      };
  
      const { restoreUrlQueryParams } = wrapper.vm;
      await restoreUrlQueryParams();
  
      await nextTick();
  
      expect(wrapper.vm.searchObj.data.datetime).toEqual({
        startTime: 1614556800008,
        endTime: 1614643200000,
        relativeTimePeriod: null,
        type: "absolute"
      });
    });
  
    it("should handle relative time period", async () => {
      wrapper.vm.router.currentRoute.value.query = {
        stream: "stream1,stream2",
        period: "15m"
      };
  
      const { restoreUrlQueryParams } = wrapper.vm;
      await restoreUrlQueryParams();
      await nextTick();
  
      expect(wrapper.vm.searchObj.data.datetime.type).toBe("relative");
      expect(wrapper.vm.searchObj.data.datetime.relativeTimePeriod).toBe("15m");
    });
  
    it("should handle SQL mode and encoded query", async () => {
      const encodedQuery = btoa("SELECT * FROM logs");
      wrapper.vm.router.currentRoute.value.query = {
        stream: "stream1,stream2",
        sql_mode: "true",
        query: encodedQuery
      };
  
      const { restoreUrlQueryParams } = wrapper.vm;
      await restoreUrlQueryParams();
      await nextTick();
  
      expect(wrapper.vm.searchObj.meta.sqlMode).toBe(true);
      expect(wrapper.vm.searchObj.data.editorValue).toBe("SELECT * FROM logs");
      expect(wrapper.vm.searchObj.data.query).toBe("SELECT * FROM logs");
    });
  });
  
  describe("refreshData", () => {
    let notifySpy: any;
    beforeEach(() => {
      // Mock store
      wrapper.vm.store = {
        state: {
          refreshIntervalID: null
        },
        dispatch: vi.fn()
      };

      // Mock getQueryData
      wrapper.vm.getQueryData = vi.fn();
      notifySpy = vi.spyOn(wrapper.vm.$q, 'notify');


      // Mock clearInterval and setInterval
      vi.spyOn(global, 'clearInterval');
      const mockIntervalId = setInterval(() => {}, 1000);
      vi.spyOn(global, 'setInterval').mockReturnValue(mockIntervalId);
    });

    afterEach(() => {
      vi.clearAllMocks();
      wrapper.vm.searchObj = undefined;
    });

    it("should enable refresh interval when conditions are met", async () => {
      wrapper.vm.searchObj.meta.refreshInterval = 5; // 5 seconds
      wrapper.vm.searchObj.loading = false;
      wrapper.vm.router.currentRoute.value.name = "logs";
      wrapper.vm.searchObj.loadingHistogram = false;


      const { refreshData } = wrapper.vm;
      refreshData();

      await nextTick();
      vi.useFakeTimers();
      await flushPromises();

      await wrapper.vm.$nextTick();

      expect(notifySpy).toHaveBeenCalledWith({
        message: `Live mode is enabled. Only top ${wrapper.vm.searchObj.meta.resultGrid.rowsPerPage} results are shown.`,
        color: "positive",
        position: "top",
        timeout: 1000,
      });


    });

    it("should not enable refresh if not on logs page", () => {
      wrapper.vm.router.currentRoute.value.name = "not-logs";
      wrapper.vm.searchObj.meta.refreshInterval = 5;

      const { refreshData } = wrapper.vm;
      refreshData();
      expect(global.setInterval).not.toHaveBeenCalled();

      expect(notifySpy).not.toHaveBeenCalled();
    });
  });

  describe("getPageCount", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      // Mock getHistogramTitle
      wrapper.vm.getHistogramTitle = vi.fn().mockReturnValue("Test Histogram");
    });

    afterEach(() => {
      wrapper.vm.searchObj = undefined;
    });

    it("should successfully get page count and update partition totals", async () => {
      wrapper.vm.searchObj = {
        organizationIdentifier: "test-org",
        meta: {
          jobId: "",
          resultGrid: {
            rowsPerPage: 50
          }
        },
        data: {
          stream: {
            streamType: "logs"
          },
          queryResults: {
            scan_size: 0,
            took: 0,
            partitionDetail: {
              partitions: [[1000, 2000]],
              partitionTotal: [-1],
              paginations: [[{
                startTime: 1000,
                endTime: 2000,
                from: 0,
                size: 50
              }]]
            }
          },
          countErrorMsg: "",
          isOperationCancelled: false,
          histogram: {
            chartParams: {
              title: ""
            }
          }
        },
        loading: false,
        loadingCounter: false
      };
      // Mock search service response
      vi.mocked(searchService.search).mockImplementationOnce(() =>
        Promise.resolve({
          data: {
            hits: [],
            total: 100,
            scan_size: 1000,
            took: 50
          },
          status: 200,
          statusText: "OK",
          headers: {},
          config: {}
        } as AxiosResponse)
      );

      const queryReq = {
        query: {
          sql: "SELECT * FROM logs",
          start_time: 1000,
          end_time: 2000,
          from: 0,
          size: 50,
          quick_mode: true,
          streaming_output: false
        }
      };

      const { getPageCount } = wrapper.vm;
      await getPageCount(queryReq);

      // Verify search service was called with correct parameters
      expect(searchService.search).toHaveBeenCalledWith({
        org_identifier: "test-org",
        query: {
          sql: "SELECT * FROM logs",
          start_time: 1000,
          end_time: 2000,
          size: 0,
          sql_mode: "full",
          track_total_hits: true
        },
        page_type: "logs",
        traceparent: expect.any(String)
      }, "ui");

      // Verify state updates

      console.log(wrapper.vm.searchObj.data.queryResults,'wrapper.vm.searchObj.data.queryResults')
      expect(wrapper.vm.searchObj.data.queryResults.scan_size).toBe(1000);
      expect(wrapper.vm.searchObj.data.queryResults.took).toBe(50);
      expect(wrapper.vm.searchObj.data.queryResults.partitionDetail.partitionTotal[0]).toBe(100);
      expect(wrapper.vm.searchObj.loadingCounter).toBe(false);
      expect(wrapper.vm.searchObj.data.histogram.chartParams.title).toBe("Test Histogram");
    });

  });

});

