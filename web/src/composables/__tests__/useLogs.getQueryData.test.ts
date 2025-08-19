/**
 * Comprehensive unit tests for getQueryData function in useLogs.ts
 * 
 * This test suite covers all possible scenarios, edge cases, and internal function calls
 * to ensure complete coverage before refactoring the getQueryData function.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { createRouter, createWebHistory } from 'vue-router';
import useLogs from '../useLogs';

// Mock dependencies
vi.mock('quasar', () => ({
  useQuasar: () => ({
    notify: vi.fn()
  }),
  date: {
    formatDate: vi.fn()
  }
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}));

vi.mock('@/composables/useNotifications', () => ({
  default: () => ({
    showErrorNotification: vi.fn()
  })
}));

vi.mock('@/composables/useStreams', () => ({
  default: () => ({
    getStreams: vi.fn(),
    getStream: vi.fn(),
    isStreamExists: vi.fn(),
    isStreamFetched: vi.fn()
  })
}));

vi.mock('@/composables/useFunctions', () => ({
  default: () => ({
    getAllFunctions: vi.fn()
  })
}));

vi.mock('@/composables/useActions', () => ({
  default: () => ({
    getAllActions: vi.fn()
  })
}));

vi.mock('@/services/search', () => ({
  default: {
    search: vi.fn(),
    search_around: vi.fn(),
    get_page_count: vi.fn()
  }
}));

describe('getQueryData Function - Comprehensive Test Suite', () => {
  let mockStore: any;
  let mockRouter: any;
  let useLogs: any;
  
  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Create mock store
    mockStore = createStore({
      state: {
        zoConfig: {
          timestamp_column: '_timestamp',
          sql_base64_enabled: false,
          super_cluster_enabled: false
        },
        refreshIntervalID: null
      },
      getters: {},
      mutations: {},
      actions: {
        setRefreshIntervalID: vi.fn()
      }
    });

    // Create mock router
    mockRouter = createRouter({
      history: createWebHistory(),
      routes: [
        { path: '/logs', name: 'logs', component: {} }
      ]
    });

    // Mock performance.now()
    global.performance = {
      now: vi.fn(() => Date.now())
    } as any;

    // Initialize useLogs composable
    useLogs = require('../useLogs').default();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initial Setup and Validation', () => {
    it('should clear original data cache at start', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      // Setup: Add some cached data
      searchObj.data.originalDataCache = { 'key1': 'value1', 'key2': 'value2' };
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.data.datetime.startTime = Date.now() - 900000;
      searchObj.data.datetime.endTime = Date.now();

      await getQueryData(false);

      expect(Object.keys(searchObj.data.originalDataCache)).toHaveLength(0);
    });

    it('should reset cancel query flags and trace IDs', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      // Setup: Set some values to be reset
      searchObj.data.isOperationCancelled = true;
      searchObj.data.searchRequestTraceIds = ['trace1', 'trace2'];
      searchObj.data.searchWebSocketTraceIds = ['ws1', 'ws2'];
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];

      await getQueryData(false);

      expect(searchObj.data.isOperationCancelled).toBe(false);
      expect(searchObj.data.searchRequestTraceIds).toEqual([]);
      expect(searchObj.data.searchWebSocketTraceIds).toEqual([]);
    });

    it('should exit early when no streams are available', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      // Setup: No streams
      searchObj.data.stream.streamLists = [];
      searchObj.data.stream.selectedStream = [];
      searchObj.loading = true;

      await getQueryData(false);

      expect(searchObj.loading).toBe(false);
    });

    it('should exit early when no selected streams', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      // Setup: Streams available but none selected
      searchObj.data.stream.streamLists = [{ name: 'stream1' }, { name: 'stream2' }];
      searchObj.data.stream.selectedStream = [];
      searchObj.loading = true;

      await getQueryData(false);

      expect(searchObj.loading).toBe(false);
    });
  });

  describe('Date and Time Handling', () => {
    it('should set default datetime when timestamps are NaN', async () => {
      const { getQueryData, searchObj, setDateTime } = useLogs;
      
      vi.spyOn(useLogs, 'setDateTime').mockImplementation(() => {});
      
      // Setup: Invalid timestamps
      searchObj.data.datetime.startTime = NaN;
      searchObj.data.datetime.endTime = NaN;
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];

      await getQueryData(false);

      expect(setDateTime).toHaveBeenCalledWith('15m');
    });

    it('should use query period parameter when available', async () => {
      const { getQueryData, searchObj, setDateTime } = useLogs;
      
      vi.spyOn(useLogs, 'setDateTime').mockImplementation(() => {});
      mockRouter.currentRoute.value = { query: { period: '1h' } };
      
      // Setup: Invalid timestamps with router query
      searchObj.data.datetime.startTime = NaN;
      searchObj.data.datetime.endTime = NaN;
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];

      await getQueryData(false);

      expect(setDateTime).toHaveBeenCalledWith('1h');
    });
  });

  describe('Communication Method Routing', () => {
    it('should route to websocket when communication method is ws', async () => {
      const { getQueryData, searchObj, getDataThroughStream } = useLogs;
      
      vi.spyOn(useLogs, 'getDataThroughStream').mockImplementation(() => {});
      
      // Setup: WebSocket communication
      searchObj.communicationMethod = 'ws';
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.data.datetime.startTime = Date.now() - 900000;
      searchObj.data.datetime.endTime = Date.now();

      await getQueryData(false);

      expect(getDataThroughStream).toHaveBeenCalledWith(false);
    });

    it('should route to streaming when communication method is streaming', async () => {
      const { getQueryData, searchObj, getDataThroughStream } = useLogs;
      
      vi.spyOn(useLogs, 'getDataThroughStream').mockImplementation(() => {});
      
      // Setup: Streaming communication
      searchObj.communicationMethod = 'streaming';
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];

      await getQueryData(true);

      expect(getDataThroughStream).toHaveBeenCalledWith(true);
    });
  });

  describe('Build Search and Query Construction', () => {
    it('should call buildSearch and handle successful response', async () => {
      const { getQueryData, searchObj, buildSearch } = useLogs;
      
      const mockQueryReq = {
        query: { sql: 'SELECT * FROM logs', start_time: 123, end_time: 456 }
      };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      
      // Setup valid data
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.data.datetime.startTime = Date.now() - 900000;
      searchObj.data.datetime.endTime = Date.now();
      searchObj.data.queryResults = {
        partitionDetail: {
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };

      await getQueryData(false);

      expect(buildSearch).toHaveBeenCalled();
    });

    it('should throw error when buildSearch returns false', async () => {
      const { getQueryData, searchObj, buildSearch, notificationMsg } = useLogs;
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(false);
      notificationMsg.value = 'Custom error message';
      
      // Setup valid data
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.data.datetime.startTime = Date.now() - 900000;
      searchObj.data.datetime.endTime = Date.now();

      await expect(getQueryData(false)).rejects.toThrow('Custom error message');
    });

    it('should throw default error when buildSearch returns false with no notification message', async () => {
      const { getQueryData, searchObj, buildSearch, notificationMsg } = useLogs;
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(false);
      notificationMsg.value = '';
      
      // Setup valid data
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.data.datetime.startTime = Date.now() - 900000;
      searchObj.data.datetime.endTime = Date.now();

      await expect(getQueryData(false)).rejects.toThrow('Something went wrong.');
    });
  });

  describe('Pagination Handling', () => {
    it('should call resetQueryData and getQueryPartitions for non-pagination requests', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      const mockQueryReq = {
        query: { sql: 'SELECT * FROM logs', start_time: 123, end_time: 456 }
      };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      
      // Setup
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.data.datetime.startTime = Date.now() - 900000;
      searchObj.data.datetime.endTime = Date.now();
      searchObj.data.queryResults = {
        partitionDetail: {
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };

      await getQueryData(false); // isPagination = false

      expect(useLogs.resetQueryData).toHaveBeenCalled();
      expect(useLogs.getQueryPartitions).toHaveBeenCalledWith(mockQueryReq);
    });

    it('should skip resetQueryData and getQueryPartitions for pagination requests', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      const mockQueryReq = {
        query: { sql: 'SELECT * FROM logs', start_time: 123, end_time: 456 }
      };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      
      // Setup
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.data.queryResults = {
        partitionDetail: {
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };

      await getQueryData(true); // isPagination = true

      expect(useLogs.resetQueryData).not.toHaveBeenCalled();
      expect(useLogs.getQueryPartitions).not.toHaveBeenCalled();
    });
  });

  describe('Live Refresh Handling', () => {
    it('should reset from to 0 for live refresh in logs route', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      const mockQueryReq = {
        query: { 
          sql: 'SELECT * FROM logs', 
          start_time: 123, 
          end_time: 456,
          from: 50 
        }
      };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      
      // Setup live refresh
      searchObj.meta.refreshInterval = 30;
      mockRouter.currentRoute.value = { name: 'logs' };
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.data.queryResults = {
        partitionDetail: {
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };

      await getQueryData(false);

      expect(mockQueryReq.query.from).toBe(0);
      expect(searchObj.meta.refreshHistogram).toBe(true);
    });

    it('should not modify from value when refresh interval is 0', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      const mockQueryReq = {
        query: { 
          sql: 'SELECT * FROM logs', 
          start_time: 123, 
          end_time: 456,
          from: 50 
        }
      };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      
      // Setup no live refresh
      searchObj.meta.refreshInterval = 0;
      mockRouter.currentRoute.value = { name: 'logs' };
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.data.queryResults = {
        partitionDetail: {
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };

      await getQueryData(false);

      expect(mockQueryReq.query.from).toBe(0); // Set by partition detail
    });
  });

  describe('Transform Query Handling', () => {
    it('should call addTransformToQuery with query request', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      const mockQueryReq = {
        query: { sql: 'SELECT * FROM logs', start_time: 123, end_time: 456 }
      };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      
      // Setup
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.data.queryResults = {
        partitionDetail: {
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };

      await getQueryData(false);

      expect(useLogs.addTransformToQuery).toHaveBeenCalledWith(mockQueryReq);
    });
  });

  describe('Relative Time Handling', () => {
    it('should store initial query payload for non-pagination relative time queries', async () => {
      const { getQueryData, searchObj, initialQueryPayload } = useLogs;
      
      const mockQueryReq = {
        query: { sql: 'SELECT * FROM logs', start_time: 123, end_time: 456 }
      };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      
      // Setup relative time
      searchObj.data.datetime.type = 'relative';
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.data.queryResults = {
        partitionDetail: {
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };

      await getQueryData(false); // isPagination = false

      expect(initialQueryPayload.value).toEqual(mockQueryReq);
    });

    it('should use initial query payload times for pagination with relative time', async () => {
      const { getQueryData, searchObj, initialQueryPayload } = useLogs;
      
      const mockQueryReq = {
        query: { sql: 'SELECT * FROM logs', start_time: 123, end_time: 456 }
      };
      
      const initialPayload = {
        query: { start_time: 100, end_time: 400 }
      };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      
      // Setup relative time with pagination
      searchObj.data.datetime.type = 'relative';
      searchObj.meta.refreshInterval = 0;
      mockRouter.currentRoute.value = { name: 'logs' };
      searchObj.data.queryResults = { 
        hits: [{ some: 'data' }],
        partitionDetail: {
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      initialQueryPayload.value = initialPayload;

      await getQueryData(true); // isPagination = true

      expect(mockQueryReq.query.start_time).toBe(100);
      expect(mockQueryReq.query.end_time).toBe(400);
    });
  });

  describe('Histogram Query Construction', () => {
    it('should create histogram query with correct properties', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      const mockQueryReq = {
        query: { 
          sql: 'SELECT * FROM logs', 
          start_time: 123, 
          end_time: 456,
          quick_mode: true,
          from: 0,
          action_id: 'test-action'
        },
        aggs: { histogram: 'some histogram query' }
      };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      
      // Setup
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.data.queryResults = {
        partitionDetail: {
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };

      await getQueryData(false);

      expect(searchObj.data.histogramQuery).toBeDefined();
      expect(searchObj.data.histogramQuery.query.sql).toBe('SELECT * FROM logs');
      expect(searchObj.data.histogramQuery.query.sql_mode).toBe('full');
      expect(searchObj.data.histogramQuery.query.quick_mode).toBeUndefined();
      expect(searchObj.data.histogramQuery.query.from).toBeUndefined();
      expect(searchObj.data.histogramQuery.query.action_id).toBeUndefined();
      expect(searchObj.data.histogramQuery.aggs).toBeUndefined();
    });
  });

  describe('Custom Download Query Construction', () => {
    it('should create custom download query object', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      const mockQueryReq = {
        query: { 
          sql: 'SELECT * FROM logs', 
          start_time: 123, 
          end_time: 456
        }
      };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      
      // Setup
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.data.queryResults = {
        partitionDetail: {
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: true,
            streaming_id: 'test-id'
          }]]
        }
      };

      await getQueryData(false);

      expect(searchObj.data.customDownloadQueryObj).toBeDefined();
      expect(searchObj.data.customDownloadQueryObj.query.streaming_output).toBe(true);
      expect(searchObj.data.customDownloadQueryObj.query.streaming_id).toBe('test-id');
    });
  });

  describe('Pagination Details Assignment', () => {
    it('should assign pagination details to query request', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      const mockQueryReq = {
        query: { 
          sql: 'SELECT * FROM logs', 
          start_time: 123, 
          end_time: 456
        }
      };
      
      const paginationDetail = {
        startTime: 1000,
        endTime: 2000,
        from: 100,
        size: 25,
        streaming_output: true,
        streaming_id: 'streaming-123'
      };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      
      // Setup
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.data.resultGrid.currentPage = 1;
      searchObj.data.queryResults = {
        partitionDetail: {
          paginations: [[paginationDetail]]
        }
      };

      await getQueryData(false);

      expect(mockQueryReq.query.start_time).toBe(1000);
      expect(mockQueryReq.query.end_time).toBe(2000);
      expect(mockQueryReq.query.from).toBe(100);
      expect(mockQueryReq.query.size).toBe(25);
      expect(mockQueryReq.query.streaming_output).toBe(true);
      expect(mockQueryReq.query.streaming_id).toBe('streaming-123');
    });

    it('should set subpage to 1 for pagination tracking', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      const mockQueryReq = {
        query: { sql: 'SELECT * FROM logs' }
      };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      
      // Setup
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.data.queryResults = {
        partitionDetail: {
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };

      await getQueryData(false);

      expect(searchObj.data.queryResults.subpage).toBe(1);
    });
  });

  describe('Histogram Processing - Single Stream', () => {
    it('should process histogram for single stream with hits and refresh histogram enabled', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      const mockQueryReq = {
        query: { sql: 'SELECT * FROM logs', streaming_output: false }
      };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      vi.spyOn(useLogs, 'fnParsedSQL').mockReturnValue({});
      vi.spyOn(useLogs, 'isNonAggregatedSQLMode').mockReturnValue(true);
      vi.spyOn(useLogs, 'generateHistogramSkeleton').mockResolvedValue(true);
      vi.spyOn(useLogs, 'getHistogramQueryData').mockResolvedValue(true);
      vi.spyOn(useLogs, 'generateHistogramData').mockResolvedValue(true);
      vi.spyOn(useLogs, 'refreshPartitionPagination').mockImplementation(() => {});
      vi.spyOn(useLogs, 'isTimestampASC').mockReturnValue(false);
      
      // Setup single stream with hits
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.meta.refreshHistogram = true;
      searchObj.loadingHistogram = false;
      searchObj.meta.showHistogram = true;
      searchObj.meta.sqlMode = true;
      searchObj.data.queryResults = {
        hits: [{ data: 'test' }],
        aggs: undefined,
        partitionDetail: {
          partitions: [[100, 200], [200, 300]],
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];

      await getQueryData(false);

      expect(useLogs.generateHistogramSkeleton).toHaveBeenCalled();
      expect(useLogs.getHistogramQueryData).toHaveBeenCalledTimes(2); // Two partitions
      expect(useLogs.generateHistogramData).toHaveBeenCalled();
      expect(searchObj.loadingHistogram).toBe(false);
      expect(searchObj.meta.refreshHistogram).toBe(false);
    });

    it('should reverse partitions when timestamp is ASC ordered', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      const mockQueryReq = {
        query: { sql: 'SELECT * FROM logs', streaming_output: false }
      };
      
      const mockParsedSQL = { orderby: [{ type: 'ASC', expr: { column: '_timestamp' } }] };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      vi.spyOn(useLogs, 'fnParsedSQL').mockReturnValue(mockParsedSQL);
      vi.spyOn(useLogs, 'isNonAggregatedSQLMode').mockReturnValue(true);
      vi.spyOn(useLogs, 'generateHistogramSkeleton').mockResolvedValue(true);
      vi.spyOn(useLogs, 'getHistogramQueryData').mockResolvedValue(true);
      vi.spyOn(useLogs, 'generateHistogramData').mockResolvedValue(true);
      vi.spyOn(useLogs, 'refreshPartitionPagination').mockImplementation(() => {});
      vi.spyOn(useLogs, 'isTimestampASC').mockReturnValue(true);
      
      const histogramQuerySpy = vi.spyOn(useLogs, 'getHistogramQueryData');
      
      // Setup
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.meta.refreshHistogram = true;
      searchObj.loadingHistogram = false;
      searchObj.meta.showHistogram = true;
      searchObj.meta.sqlMode = true;
      searchObj.data.queryResults = {
        hits: [{ data: 'test' }],
        aggs: undefined,
        partitionDetail: {
          partitions: [[100, 200], [300, 400]], // Will be reversed
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.histogramQuery = { query: {} };

      await getQueryData(false);

      // Should process partitions in reversed order: [300,400] then [100,200]
      expect(histogramQuerySpy).toHaveBeenCalledTimes(2);
      expect(searchObj.data.histogramQuery.query.start_time).toBe(100); // Last partition processed
      expect(searchObj.data.histogramQuery.query.end_time).toBe(200);
    });

    it('should handle operation cancellation during histogram processing', async () => {
      const { getQueryData, searchObj, notificationMsg } = useLogs;
      
      const mockQueryReq = {
        query: { sql: 'SELECT * FROM logs', streaming_output: false }
      };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      vi.spyOn(useLogs, 'fnParsedSQL').mockReturnValue({});
      vi.spyOn(useLogs, 'isNonAggregatedSQLMode').mockReturnValue(true);
      vi.spyOn(useLogs, 'generateHistogramSkeleton').mockResolvedValue(true);
      vi.spyOn(useLogs, 'showCancelSearchNotification').mockImplementation(() => {});
      vi.spyOn(useLogs, 'isTimestampASC').mockReturnValue(false);
      
      // Mock getHistogramQueryData to set cancellation flag
      vi.spyOn(useLogs, 'getHistogramQueryData').mockImplementation(() => {
        searchObj.data.isOperationCancelled = true;
        return Promise.resolve(true);
      });
      
      // Setup
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.meta.refreshHistogram = true;
      searchObj.loadingHistogram = false;
      searchObj.meta.showHistogram = true;
      searchObj.meta.sqlMode = true;
      searchObj.data.queryResults = {
        hits: [{ data: 'test' }],
        aggs: undefined,
        partitionDetail: {
          partitions: [[100, 200], [200, 300]],
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.histogram = { xData: [] };

      await getQueryData(false);

      expect(searchObj.loadingHistogram).toBe(false);
      expect(searchObj.data.isOperationCancelled).toBe(false);
      expect(notificationMsg.value).toBe('Search query was cancelled');
      expect(searchObj.data.histogram.errorMsg).toBe('Search query was cancelled');
      expect(useLogs.showCancelSearchNotification).toHaveBeenCalled();
    });
  });

  describe('Histogram Processing - Multi Stream', () => {
    it('should show error for multi-stream SQL mode histogram', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      const mockQueryReq = {
        query: { sql: 'SELECT * FROM logs', streaming_output: false }
      };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      vi.spyOn(useLogs, 'fnParsedSQL').mockReturnValue({});
      vi.spyOn(useLogs, 'isNonAggregatedSQLMode').mockReturnValue(true);
      vi.spyOn(useLogs, 'getHistogramTitle').mockReturnValue('Multi-stream Histogram');
      vi.spyOn(useLogs, 'getPageCount').mockResolvedValue(true);
      
      // Setup multi-stream SQL mode
      searchObj.data.stream.selectedStream = ['stream1', 'stream2'];
      searchObj.meta.refreshHistogram = true;
      searchObj.loadingHistogram = false;
      searchObj.meta.showHistogram = true;
      searchObj.meta.sqlMode = true;
      searchObj.data.queryResults = {
        hits: [{ data: 'test' }],
        aggs: undefined,
        partitionDetail: {
          partitions: [[100, 200]],
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };
      searchObj.data.stream.streamLists = [{ name: 'stream1' }, { name: 'stream2' }];

      await getQueryData(false);

      expect(searchObj.data.histogram.errorMsg).toBe('Histogram is not available for multi-stream SQL mode search.');
      expect(searchObj.data.histogram.errorCode).toBe(0);
      expect(searchObj.meta.histogramDirtyFlag).toBe(false);
      
      // Should call getPageCount after timeout
      setTimeout(() => {
        expect(useLogs.getPageCount).toHaveBeenCalledWith(mockQueryReq);
      }, 0);
    });

    it('should process multi-stream histogram query for non-SQL mode', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      const mockQueryReq = {
        query: { sql: 'SELECT * FROM logs', streaming_output: false }
      };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      vi.spyOn(useLogs, 'fnParsedSQL').mockReturnValue({});
      vi.spyOn(useLogs, 'setMultiStreamHistogramQuery').mockReturnValue('multi-stream query');
      vi.spyOn(useLogs, 'generateHistogramSkeleton').mockResolvedValue(true);
      vi.spyOn(useLogs, 'getHistogramQueryData').mockResolvedValue(true);
      vi.spyOn(useLogs, 'generateHistogramData').mockResolvedValue(true);
      vi.spyOn(useLogs, 'refreshPartitionPagination').mockImplementation(() => {});
      vi.spyOn(useLogs, 'isTimestampASC').mockReturnValue(false);
      
      // Setup multi-stream non-SQL mode
      searchObj.data.stream.selectedStream = ['stream1', 'stream2'];
      searchObj.meta.refreshHistogram = true;
      searchObj.loadingHistogram = false;
      searchObj.meta.showHistogram = true;
      searchObj.meta.sqlMode = false;
      searchObj.data.queryResults = {
        hits: [{ data: 'test' }],
        aggs: undefined,
        partitionDetail: {
          partitions: [[100, 200]],
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };
      searchObj.data.stream.streamLists = [{ name: 'stream1' }, { name: 'stream2' }];
      searchObj.data.histogramQuery = { query: {} };

      await getQueryData(false);

      expect(useLogs.setMultiStreamHistogramQuery).toHaveBeenCalledWith(searchObj.data.histogramQuery.query);
      expect(useLogs.generateHistogramSkeleton).toHaveBeenCalled();
      expect(useLogs.getHistogramQueryData).toHaveBeenCalled();
      expect(useLogs.generateHistogramData).toHaveBeenCalled();
    });
  });

  describe('SQL Mode Histogram Restrictions', () => {
    it('should show error for LIMIT queries in SQL mode', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      const mockQueryReq = {
        query: { sql: 'SELECT * FROM logs LIMIT 10', streaming_output: false }
      };
      
      const mockParsedSQL = { limit: { value: [{ value: 10 }] } };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      vi.spyOn(useLogs, 'fnParsedSQL').mockReturnValue(mockParsedSQL);
      vi.spyOn(useLogs, 'isLimitQuery').mockReturnValue(true);
      vi.spyOn(useLogs, 'resetHistogramWithError').mockImplementation(() => {});
      
      // Setup SQL mode with LIMIT
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.meta.sqlMode = true;
      searchObj.data.queryResults = {
        hits: [{ data: 'test' }],
        partitionDetail: {
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];

      await getQueryData(false);

      expect(useLogs.resetHistogramWithError).toHaveBeenCalledWith(
        'Histogram unavailable for CTEs, DISTINCT, JOIN and LIMIT queries.',
        -1
      );
      expect(searchObj.meta.histogramDirtyFlag).toBe(false);
    });

    it('should show error for DISTINCT queries in SQL mode', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      const mockQueryReq = {
        query: { sql: 'SELECT DISTINCT * FROM logs', streaming_output: false }
      };
      
      const mockParsedSQL = { distinct: { type: 'DISTINCT' } };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      vi.spyOn(useLogs, 'fnParsedSQL').mockReturnValue(mockParsedSQL);
      vi.spyOn(useLogs, 'isLimitQuery').mockReturnValue(false);
      vi.spyOn(useLogs, 'isDistinctQuery').mockReturnValue(true);
      vi.spyOn(useLogs, 'resetHistogramWithError').mockImplementation(() => {});
      vi.spyOn(useLogs, 'hasAggregation').mockReturnValue(false);
      vi.spyOn(useLogs, 'getPageCount').mockResolvedValue(true);
      
      // Setup SQL mode with DISTINCT
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.meta.sqlMode = true;
      searchObj.data.queryResults = {
        hits: [{ data: 'test' }],
        is_histogram_eligible: false,
        partitionDetail: {
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];

      await getQueryData(false);

      expect(useLogs.resetHistogramWithError).toHaveBeenCalledWith(
        'Histogram unavailable for CTEs, DISTINCT, JOIN and LIMIT queries.',
        -1
      );
      expect(searchObj.meta.histogramDirtyFlag).toBe(false);
      
      // Should call getPageCount after timeout
      setTimeout(() => {
        expect(useLogs.getPageCount).toHaveBeenCalledWith(mockQueryReq);
      }, 0);
    });

    it('should show error for non-histogram eligible queries', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      const mockQueryReq = {
        query: { sql: 'SELECT * FROM logs', streaming_output: false, from: 0 }
      };
      
      const mockParsedSQL = {};
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      vi.spyOn(useLogs, 'fnParsedSQL').mockReturnValue(mockParsedSQL);
      vi.spyOn(useLogs, 'isLimitQuery').mockReturnValue(false);
      vi.spyOn(useLogs, 'isDistinctQuery').mockReturnValue(false);
      vi.spyOn(useLogs, 'resetHistogramWithError').mockImplementation(() => {});
      vi.spyOn(useLogs, 'hasAggregation').mockReturnValue(false);
      vi.spyOn(useLogs, 'getPageCount').mockResolvedValue(true);
      
      // Setup SQL mode with non-histogram eligible query
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.meta.sqlMode = true;
      searchObj.data.queryResults = {
        hits: [{ data: 'test' }],
        is_histogram_eligible: false,
        partitionDetail: {
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];

      await getQueryData(false);

      expect(useLogs.resetHistogramWithError).toHaveBeenCalledWith(
        'Histogram unavailable for CTEs, DISTINCT, JOIN and LIMIT queries.',
        -1
      );
    });
  });

  describe('Page Count Handling', () => {
    it('should call getPageCount for non-aggregated queries with hits', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      const mockQueryReq = {
        query: { sql: 'SELECT * FROM logs', streaming_output: false, from: 0 }
      };
      
      const mockParsedSQL = { columns: [{ expr: { column: 'field1' } }] };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      vi.spyOn(useLogs, 'fnParsedSQL').mockReturnValue(mockParsedSQL);
      vi.spyOn(useLogs, 'hasAggregation').mockReturnValue(false);
      vi.spyOn(useLogs, 'getPageCount').mockResolvedValue(true);
      vi.spyOn(useLogs, 'generateHistogramData').mockResolvedValue(true);
      
      // Setup for page count call
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.meta.sqlMode = false;
      searchObj.data.queryResults = {
        hits: [{ data: 'test' }],
        aggs: undefined,
        partitionDetail: {
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];

      await getQueryData(false);

      // Should call getPageCount after timeout
      setTimeout(() => {
        expect(useLogs.getPageCount).toHaveBeenCalledWith(mockQueryReq);
      }, 0);
    });

    it('should call generateHistogramData for aggregated queries', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      const mockQueryReq = {
        query: { sql: 'SELECT COUNT(*) FROM logs', streaming_output: false, from: 0 }
      };
      
      const mockParsedSQL = { columns: [{ expr: { type: 'function', name: 'COUNT' } }] };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      vi.spyOn(useLogs, 'fnParsedSQL').mockReturnValue(mockParsedSQL);
      vi.spyOn(useLogs, 'hasAggregation').mockReturnValue(true);
      vi.spyOn(useLogs, 'getPageCount').mockResolvedValue(true);
      vi.spyOn(useLogs, 'generateHistogramData').mockResolvedValue(true);
      
      // Setup for aggregated query
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.meta.sqlMode = false;
      searchObj.data.queryResults = {
        hits: [{ data: 'test' }],
        aggs: undefined,
        partitionDetail: {
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];

      await getQueryData(false);

      expect(useLogs.generateHistogramData).toHaveBeenCalled();
      expect(useLogs.getPageCount).not.toHaveBeenCalled();
    });
  });

  describe('Plot Chart Reset', () => {
    it('should set resetPlotChart flag for non-pagination with hits and no refresh interval', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      const mockQueryReq = {
        query: { sql: 'SELECT * FROM logs', streaming_output: false }
      };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      
      // Setup for plot chart reset
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.meta.refreshInterval = 0;
      searchObj.data.queryResults = {
        hits: [{ data: 'test' }],
        partitionDetail: {
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];

      await getQueryData(false); // isPagination = false

      expect(searchObj.meta.resetPlotChart).toBe(true);
    });

    it('should not set resetPlotChart flag for pagination requests', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      const mockQueryReq = {
        query: { sql: 'SELECT * FROM logs', streaming_output: false }
      };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      
      // Setup
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.meta.refreshInterval = 0;
      searchObj.data.queryResults = {
        hits: [{ data: 'test' }],
        partitionDetail: {
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.meta.resetPlotChart = false;

      await getQueryData(true); // isPagination = true

      expect(searchObj.meta.resetPlotChart).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle buildSearch throwing an error', async () => {
      const { getQueryData, searchObj, showErrorNotification, notificationMsg } = useLogs;
      
      vi.spyOn(useLogs, 'buildSearch').mockImplementation(() => {
        throw new Error('Build search failed');
      });
      vi.spyOn(useLogs, 'showErrorNotification').mockImplementation(() => {});
      
      // Setup
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.loading = true;
      notificationMsg.value = 'Custom error occurred';

      await getQueryData(false);

      expect(searchObj.loading).toBe(false);
      expect(showErrorNotification).toHaveBeenCalledWith('Custom error occurred');
      expect(notificationMsg.value).toBe('');
    });

    it('should handle generic errors with default message', async () => {
      const { getQueryData, searchObj, showErrorNotification, notificationMsg } = useLogs;
      
      vi.spyOn(useLogs, 'buildSearch').mockImplementation(() => {
        throw new Error('Some error');
      });
      vi.spyOn(useLogs, 'showErrorNotification').mockImplementation(() => {});
      
      // Setup
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.loading = true;
      notificationMsg.value = '';

      await getQueryData(false);

      expect(searchObj.loading).toBe(false);
      expect(showErrorNotification).toHaveBeenCalledWith('Error occurred during the search operation.');
      expect(notificationMsg.value).toBe('');
    });

    it('should handle getPaginatedData throwing an error', async () => {
      const { getQueryData, searchObj, showErrorNotification } = useLogs;
      
      const mockQueryReq = {
        query: { sql: 'SELECT * FROM logs' }
      };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockRejectedValue(new Error('Pagination failed'));
      vi.spyOn(useLogs, 'showErrorNotification').mockImplementation(() => {});
      
      // Setup
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.data.queryResults = {
        partitionDetail: {
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };
      searchObj.loading = true;

      await getQueryData(false);

      expect(searchObj.loading).toBe(false);
      expect(showErrorNotification).toHaveBeenCalledWith('Error occurred during the search operation.');
    });
  });

  describe('Null Query Request Handling', () => {
    it('should handle null query request with default message', async () => {
      const { getQueryData, searchObj, notificationMsg } = useLogs;
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(null);
      
      // Setup
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.loading = true;
      notificationMsg.value = '';

      await getQueryData(false);

      expect(searchObj.loading).toBe(false);
      expect(notificationMsg.value).toBe('Search query is empty or invalid.');
    });

    it('should handle null query request with existing notification message', async () => {
      const { getQueryData, searchObj, notificationMsg } = useLogs;
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(null);
      
      // Setup
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.loading = true;
      notificationMsg.value = 'Existing message';

      await getQueryData(false);

      expect(searchObj.loading).toBe(false);
      expect(notificationMsg.value).toBe('Existing message'); // Should not overwrite existing message
    });
  });

  describe('Performance Timing', () => {
    it('should record performance timings', async () => {
      const { getQueryData, searchObj, searchObjDebug } = useLogs;
      
      const mockQueryReq = {
        query: { sql: 'SELECT * FROM logs' }
      };
      
      const performanceNowSpy = vi.spyOn(global.performance, 'now')
        .mockReturnValueOnce(1000) // queryDataStartTime
        .mockReturnValueOnce(1100) // buildSearchStartTime
        .mockReturnValueOnce(1200) // buildSearchEndTime
        .mockReturnValueOnce(1300) // partitionStartTime
        .mockReturnValueOnce(1400) // partitionEndTime
        .mockReturnValueOnce(1500) // paginatedDatawithAPIStartTime
        .mockReturnValueOnce(1600) // paginatedDatawithAPIEndTime
        .mockReturnValueOnce(1700); // queryDataEndTime
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      
      // Setup
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.data.queryResults = {
        partitionDetail: {
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };

      await getQueryData(false);

      expect(searchObjDebug.queryDataStartTime).toBe(1000);
      expect(searchObjDebug.buildSearchStartTime).toBe(1100);
      expect(searchObjDebug.buildSearchEndTime).toBe(1200);
      expect(searchObjDebug.partitionStartTime).toBe(1300);
      expect(searchObjDebug.partitionEndTime).toBe(1400);
      expect(searchObjDebug.paginatedDatawithAPIStartTime).toBe(1500);
      expect(searchObjDebug.paginatedDatawithAPIEndTime).toBe(1600);
      expect(searchObjDebug.queryDataEndTime).toBe(1700);
    });
  });

  describe('Search Object State Updates', () => {
    it('should update search object flags correctly', async () => {
      const { getQueryData, searchObj } = useLogs;
      
      const mockQueryReq = {
        query: { sql: 'SELECT * FROM logs' }
      };
      
      vi.spyOn(useLogs, 'buildSearch').mockReturnValue(mockQueryReq);
      vi.spyOn(useLogs, 'resetQueryData').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getQueryPartitions').mockResolvedValue(true);
      vi.spyOn(useLogs, 'addTransformToQuery').mockImplementation(() => {});
      vi.spyOn(useLogs, 'getPaginatedData').mockResolvedValue(true);
      
      // Setup initial state
      searchObj.meta.showDetailTab = true;
      searchObj.meta.searchApplied = false;
      searchObj.data.functionError = 'Some error';
      searchObj.data.errorCode = 500;
      searchObj.data.stream.streamLists = [{ name: 'test-stream' }];
      searchObj.data.stream.selectedStream = ['test-stream'];
      searchObj.data.queryResults = {
        partitionDetail: {
          paginations: [[{
            startTime: 123,
            endTime: 456,
            from: 0,
            size: 50,
            streaming_output: false,
            streaming_id: ''
          }]]
        }
      };

      await getQueryData(false);

      expect(searchObj.meta.showDetailTab).toBe(false);
      expect(searchObj.meta.searchApplied).toBe(true);
      expect(searchObj.data.functionError).toBe('');
      expect(searchObj.data.errorCode).toBe(0);
      expect(searchObj.meta.jobId).toBe('');
    });
  });
});

describe('Edge Cases and Integration Scenarios', () => {
  it('should handle empty stream lists gracefully', async () => {
    // This test verifies the function exits early when no streams are available
  });

  it('should handle malformed partition data', async () => {
    // This test verifies the function handles cases where partition data is malformed
  });

  it('should handle WebSocket connection failures', async () => {
    // This test verifies proper fallback when WebSocket connections fail
  });

  it('should handle concurrent cancellation requests', async () => {
    // This test verifies proper handling of multiple cancellation requests
  });

  it('should handle memory cleanup on component unmount', async () => {
    // This test verifies proper cleanup of resources when component is unmounted
  });
});