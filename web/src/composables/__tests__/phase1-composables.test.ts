/**
 * Phase 1 Composables Integration Test
 * 
 * Tests the basic functionality and integration of the first three composables:
 * - useLogsStateManagement
 * - useLogsURLManagement  
 * - useLogsStreamManagement
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

// Mock external dependencies
vi.mock('vuex', () => ({
  useStore: () => ({
    state: {
      selectedOrganization: { identifier: 'test-org' },
      zoConfig: {
        timestamp_column: '_timestamp',
        super_cluster_enabled: false,
        query_on_stream_selection: true,
        min_auto_refresh_interval: 5
      },
      refreshIntervalID: null,
      organizationData: {
        functions: [],
        actions: []
      },
      logs: {
        isInitialized: false
      }
    },
    dispatch: vi.fn(),
    getters: {
      'logs/getLogs': {}
    }
  })
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({
    currentRoute: {
      value: {
        query: {
          stream: 'test-stream',
          period: '15m'
        }
      }
    },
    push: vi.fn()
  })
}));

vi.mock('@/utils/zincutils', () => ({
  useLocalWrapContent: () => 'false',
  useLocalLogFilterField: () => ({ value: {} }),
  useLocalInterestingFields: () => ({ value: {} }),
  useLocalTimezone: vi.fn(),
  b64EncodeUnicode: (str: string) => btoa(str),
  b64DecodeUnicode: (str: string) => atob(str)
}));

vi.mock('@/composables/useFunctions', () => ({
  default: () => ({
    getAllFunctions: vi.fn().mockResolvedValue([])
  })
}));

vi.mock('@/composables/useActions', () => ({
  default: () => ({
    getAllActions: vi.fn().mockResolvedValue([])
  })
}));

vi.mock('@/composables/useNotifications', () => ({
  default: () => ({
    showErrorNotification: vi.fn()
  })
}));

vi.mock('@/composables/useStreams', () => ({
  default: () => ({
    getStreams: vi.fn().mockResolvedValue({ list: [] }),
    getStream: vi.fn().mockResolvedValue({}),
    isStreamExists: vi.fn().mockReturnValue(true),
    isStreamFetched: vi.fn().mockReturnValue(true)
  })
}));

vi.mock('@/composables/useSuggestions', () => ({
  default: () => ({
    updateFieldKeywords: vi.fn()
  })
}));

describe('Phase 1 Composables Integration', () => {
  let mockSearchObj: any;

  beforeEach(() => {
    // Create a mock search object that matches the interface
    mockSearchObj = ref({
      organizationIdentifier: 'test-org',
      loading: false,
      loadingHistogram: false,
      loadingStream: false,
      shouldIgnoreWatcher: false,
      communicationMethod: 'http',
      meta: {
        refreshInterval: 0,
        sqlMode: false,
        showHistogram: true,
        quickMode: true,
        pageType: 'logs',
        logsVisualizeToggle: 'logs',
        useUserDefinedSchemas: 'user_defined_schema',
        hasUserDefinedSchemas: false,
        regions: [],
        clusters: []
      },
      data: {
        query: '',
        stream: {
          streamType: 'logs',
          selectedStream: ['test-stream'],
          streamLists: [],
          selectedStreamFields: [],
          interestingFieldList: []
        },
        datetime: {
          type: 'relative',
          relativeTimePeriod: '15m',
          startTime: Date.now() - 900000,
          endTime: Date.now()
        },
        queryResults: {
          hits: []
        },
        streamResults: {
          list: [{
            name: 'test-stream',
            schema: [
              { name: 'field1', type: 'text', ftsKey: false },
              { name: 'field2', type: 'number', ftsKey: true }
            ],
            stats: { doc_time_max: Date.now() }
          }]
        },
        tempFunctionContent: '',
        transformType: 'function',
        resultGrid: {
          colOrder: {}
        }
      }
    });
  });

  describe('useLogsStateManagement', () => {
    it('should initialize with default state', async () => {
      const { default: useLogsStateManagement } = await import('../useLogsStateManagement');
      
      const stateManagement = useLogsStateManagement();
      
      expect(stateManagement).toBeDefined();
      expect(stateManagement.searchObj).toBeDefined();
      expect(stateManagement.clearSearchObj).toBeTypeOf('function');
      expect(stateManagement.resetSearchObj).toBeTypeOf('function');
      expect(stateManagement.initialLogsState).toBeTypeOf('function');
    });

    it('should clear search object correctly', async () => {
      const { default: useLogsStateManagement } = await import('../useLogsStateManagement');
      
      const stateManagement = useLogsStateManagement();
      
      // Set some values
      stateManagement.searchObj.loading = true;
      stateManagement.searchObj.meta.refreshInterval = 30;
      
      // Clear the object
      stateManagement.clearSearchObj();
      
      expect(stateManagement.searchObj.loading).toBe(false);
      expect(stateManagement.searchObj.meta.refreshInterval).toBe(0);
    });

    it('should reset search object while maintaining structure', async () => {
      const { default: useLogsStateManagement } = await import('../useLogsStateManagement');
      
      const stateManagement = useLogsStateManagement();
      
      // Set some values
      stateManagement.searchObj.data.query = 'test query';
      stateManagement.searchObj.data.errorMsg = 'test error';
      
      // Reset the object
      stateManagement.resetSearchObj();
      
      expect(stateManagement.searchObj.data.query).toBe('');
      expect(stateManagement.searchObj.data.errorMsg).toBe('');
      expect(stateManagement.searchObj.data.stream.streamLists).toEqual([]);
    });
  });

  describe('useLogsURLManagement', () => {
    it('should initialize URL management correctly', async () => {
      const { default: useLogsURLManagement } = await import('../useLogsURLManagement');
      
      const urlManagement = useLogsURLManagement(mockSearchObj);
      
      expect(urlManagement).toBeDefined();
      expect(urlManagement.generateURLQuery).toBeTypeOf('function');
      expect(urlManagement.updateUrlQueryParams).toBeTypeOf('function');
      expect(urlManagement.restoreUrlQueryParams).toBeTypeOf('function');
    });

    it('should generate URL query parameters correctly', async () => {
      const { default: useLogsURLManagement } = await import('../useLogsURLManagement');
      
      const urlManagement = useLogsURLManagement(mockSearchObj);
      
      const query = urlManagement.generateURLQuery();
      
      expect(query).toBeDefined();
      expect(query.stream_type).toBe('logs');
      expect(query.stream).toBe('test-stream');
      expect(query.period).toBe('15m');
      expect(query.quick_mode).toBe(true);
      expect(query.show_histogram).toBe(true);
    });

    it('should encode and decode visualization config correctly', async () => {
      const { default: useLogsURLManagement } = await import('../useLogsURLManagement');
      
      const urlManagement = useLogsURLManagement(mockSearchObj);
      
      const testConfig = { chart: 'bar', field: 'test' };
      const encoded = urlManagement.encodeVisualizationConfig(testConfig);
      const decoded = urlManagement.decodeVisualizationConfig(encoded);
      
      expect(decoded).toEqual(testConfig);
    });

    it('should extract timestamps from period strings correctly', async () => {
      const { default: useLogsURLManagement } = await import('../useLogsURLManagement');
      
      const urlManagement = useLogsURLManagement(mockSearchObj);
      
      const result = urlManagement.extractTimestamps('15m');
      
      expect(result).toBeDefined();
      expect(result.from).toBeTypeOf('number');
      expect(result.to).toBeTypeOf('number');
      expect(result.to).toBeGreaterThan(result.from);
    });
  });

  describe('useLogsStreamManagement', () => {
    it('should initialize stream management correctly', async () => {
      const { default: useLogsStreamManagement } = await import('../useLogsStreamManagement');
      
      const streamManagement = useLogsStreamManagement(mockSearchObj);
      
      expect(streamManagement).toBeDefined();
      expect(streamManagement.getStreamList).toBeTypeOf('function');
      expect(streamManagement.extractFields).toBeTypeOf('function');
      expect(streamManagement.onStreamChange).toBeTypeOf('function');
    });

    it('should provide computed properties correctly', async () => {
      const { default: useLogsStreamManagement } = await import('../useLogsStreamManagement');
      
      const streamManagement = useLogsStreamManagement(mockSearchObj);
      
      expect(streamManagement.streamLists.value).toEqual([]);
      expect(streamManagement.selectedStreams.value).toEqual(['test-stream']);
      expect(streamManagement.streamType.value).toBe('logs');
    });

    it('should load stream lists correctly', async () => {
      const { default: useLogsStreamManagement } = await import('../useLogsStreamManagement');
      
      const streamManagement = useLogsStreamManagement(mockSearchObj);
      
      await streamManagement.loadStreamLists();
      
      expect(mockSearchObj.value.data.stream.streamLists.length).toBeGreaterThan(0);
      expect(mockSearchObj.value.data.stream.streamLists[0]).toEqual({
        label: 'test-stream',
        value: 'test-stream'
      });
    });

    it('should extract FTS fields correctly', async () => {
      const { default: useLogsStreamManagement } = await import('../useLogsStreamManagement');
      
      const streamManagement = useLogsStreamManagement(mockSearchObj);
      
      // Set up mock data
      mockSearchObj.value.data.stream.selectedStreamFields = [
        { name: 'field1', ftsKey: false },
        { name: 'field2', ftsKey: true }
      ];
      
      streamManagement.extractFTSFields();
      
      expect(streamManagement.ftsFields.value).toContain('field2');
      expect(streamManagement.ftsFields.value).not.toContain('field1');
    });
  });

  describe('Composables Integration', () => {
    it('should work together correctly', async () => {
      const { default: useLogsStateManagement } = await import('../useLogsStateManagement');
      const { default: useLogsURLManagement } = await import('../useLogsURLManagement');
      const { default: useLogsStreamManagement } = await import('../useLogsStreamManagement');
      
      // Initialize composables
      const stateManagement = useLogsStateManagement();
      const urlManagement = useLogsURLManagement(stateManagement.searchObj);
      const streamManagement = useLogsStreamManagement(stateManagement.searchObj);
      
      // Test that they can work together
      expect(stateManagement.searchObj).toBeDefined();
      expect(urlManagement.generateURLQuery()).toBeDefined();
      expect(streamManagement.streamType.value).toBe('logs');
      
      // Test state updates flow through
      stateManagement.searchObj.data.stream.streamType = 'metrics';
      expect(streamManagement.streamType.value).toBe('metrics');
    });

    it('should handle URL restoration with stream management', async () => {
      const { default: useLogsStateManagement } = await import('../useLogsStateManagement');
      const { default: useLogsURLManagement } = await import('../useLogsURLManagement');
      const { default: useLogsStreamManagement } = await import('../useLogsStreamManagement');
      
      const stateManagement = useLogsStateManagement();
      const urlManagement = useLogsURLManagement(stateManagement.searchObj);
      const streamManagement = useLogsStreamManagement(stateManagement.searchObj);
      
      // Restore from URL should update stream selection
      await urlManagement.restoreUrlQueryParams();
      
      expect(stateManagement.searchObj.data.stream.selectedStream).toContain('test-stream');
      expect(streamManagement.selectedStreams.value).toContain('test-stream');
    });
  });
});