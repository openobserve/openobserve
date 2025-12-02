import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { Quasar } from 'quasar';
import ImportPipeline from '@/components/pipeline/ImportPipeline.vue';
import store from '@/test/unit/helpers/store';

// Mock the services and composables
vi.mock('@/services/pipelines', () => ({
  default: {
    createPipeline: vi.fn(),
    getPipelineStreams: vi.fn(),
    getPipelines: vi.fn(),
  }
}));

vi.mock('@/services/alert_destination', () => ({
  default: {
    list: vi.fn()
  }
}));

vi.mock('@/services/jstransform', () => ({
  default: {
    list: vi.fn()
  }
}));

vi.mock('@/composables/useStreams', () => ({
  default: () => ({
    getStreams: vi.fn()
  })
}));

vi.mock('@/composables/usePipelines', () => ({
  default: () => ({
    getPipelineDestinations: vi.fn()
  })
}));

vi.mock('axios', () => ({
  default: {
    get: vi.fn()
  }
}));

vi.mock('@/utils/zincutils', () => ({
  getImageURL: vi.fn((path) => `mocked-url/${path}`),
  useLocalOrganization: vi.fn(() => null),
  useLocalCurrentUser: vi.fn(() => null),
  useLocalUserInfo: vi.fn(() => null),
  useLocalTimezone: vi.fn(() => null)
}));

const mockRouter = {
  push: vi.fn(),
  currentRoute: {
    value: {
      query: {}
    }
  }
};

vi.mock('vue-router', () => ({
  useRouter: () => mockRouter,
  useRoute: () => mockRouter.currentRoute.value
}));

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      'pipeline.import': 'Import Pipeline',
      'pipeline.name': 'Pipeline Name'
    }
  }
});

describe('ImportPipeline.vue', () => {
  let wrapper: VueWrapper<any>;
  let mockQuasar: any;

  const createWrapper = (props = {}) => {
    mockQuasar = {
      notify: vi.fn()
    };

    return mount(ImportPipeline, {
      props: {
        destinations: [],
        templates: [],
        alerts: [],
        ...props
      },
      global: {
        plugins: [i18n, Quasar, store],
        provide: {
          $q: mockQuasar
        },
        stubs: {
          BaseImport: {
            template: '<div data-test="base-import"><slot name="output-content" /></div>',
            methods: {
              updateJsonArray: vi.fn(),
            }
          },
          AppTabs: {
            template: '<div data-test="app-tabs"><slot /></div>'
          },
          QueryEditor: {
            template: '<div data-test="query-editor"><slot /></div>'
          }
        }
      }
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store.state.selectedOrganization = {
      identifier: 'test-org',
      label: 'Test Organization'
    };
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
      expect(wrapper.vm.$options.name).toBe('ImportPipeline');
    });

    it('should initialize with default props', () => {
      wrapper = createWrapper();
      expect(wrapper.props('destinations')).toEqual([]);
      expect(wrapper.props('templates')).toEqual([]);
      expect(wrapper.props('alerts')).toEqual([]);
    });

    it('should initialize with provided props', () => {
      const destinations = [{ name: 'dest1' }];
      const templates = [{ name: 'template1' }];
      const alerts = [{ name: 'alert1' }];
      
      wrapper = createWrapper({ destinations, templates, alerts });
      expect(wrapper.props('destinations')).toEqual(destinations);
      expect(wrapper.props('templates')).toEqual(templates);
      expect(wrapper.props('alerts')).toEqual(alerts);
    });
  });

  describe('Reactive Data Properties', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should initialize streamTypes array correctly', () => {
      expect(wrapper.vm.streamTypes).toEqual(['logs', 'metrics', 'traces']);
    });

    it('should initialize destinationStreamTypes array correctly', () => {
      expect(wrapper.vm.destinationStreamTypes).toEqual(['logs', 'metrics', 'traces', 'enrichment_tables']);
    });

    it('should initialize userSelectedPipelineName as empty array', () => {
      expect(wrapper.vm.userSelectedPipelineName).toEqual([]);
    });

    it('should initialize pipelineErrorsToDisplay as empty', () => {
      expect(wrapper.vm.pipelineErrorsToDisplay).toEqual([]);
    });
  });

  describe('Computed Properties', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should compute organizationData correctly', () => {
      store.state.organizations = [
        { identifier: 'org1', label: 'Org 1' },
        { identifier: 'test-org', label: 'Test Org' }
      ];

      const orgData = wrapper.vm.organizationData;
      expect(orgData).toHaveLength(2);
      expect(orgData[0].disable).toBe(true);
      expect(orgData[1].disable).toBe(false);
    });
  });


  describe('updateSqlQuery Function', () => {
    beforeEach(() => {
      wrapper = createWrapper();
      // Mock baseImportRef with jsonArrayOfObj
      wrapper.vm.baseImportRef = {
        jsonArrayOfObj: [{
          source: { query_condition: {} },
          nodes: [
            {
              io_type: 'input',
              data: { query_condition: { type: 'sql' } }
            }
          ]
        }],
        updateJsonArray: vi.fn(),
        isImporting: false
      };
    });

    it('should update sql_query at root level', () => {
      const sqlQuery = 'SELECT * FROM table';
      wrapper.vm.updateSqlQuery(sqlQuery, 0);

      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].sql_query).toBe(sqlQuery);
    });

    it('should update source query_condition sql', () => {
      const sqlQuery = 'SELECT * FROM table';
      wrapper.vm.updateSqlQuery(sqlQuery, 0);

      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].source.query_condition.sql).toBe(sqlQuery);
    });

    it('should update nodes with matching criteria', () => {
      const sqlQuery = 'SELECT * FROM table';
      wrapper.vm.updateSqlQuery(sqlQuery, 0);

      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[0].data.query_condition.sql).toBe(sqlQuery);
    });
  });

  describe('updateStreamFields Function', () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.baseImportRef = {
        jsonArrayOfObj: [{
          source: {},
          nodes: [{ io_type: 'input', data: {} }],
          edges: [{ sourceNode: { data: {} } }]
        }],
        updateJsonArray: vi.fn(),
        isImporting: false
      };
    });

    it('should update stream_name in source', () => {
      const streamName = { value: 'test-stream' };
      wrapper.vm.updateStreamFields(streamName, 0);

      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].source.stream_name).toBe('test-stream');
    });

    it('should update stream_name in nodes', () => {
      const streamName = { value: 'test-stream' };
      wrapper.vm.updateStreamFields(streamName, 0);

      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[0].data.stream_name).toBe('test-stream');
    });

    it('should update stream_name at root level', () => {
      const streamName = { value: 'test-stream' };
      wrapper.vm.updateStreamFields(streamName, 0);

      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].stream_name).toBe('test-stream');
    });
  });

  describe('updatePipelineName Function', () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.baseImportRef = {
        jsonArrayOfObj: [{}],
        updateJsonArray: vi.fn(),
        isImporting: false
      };
    });

    it('should update pipeline name', () => {
      const pipelineName = 'test-pipeline';
      wrapper.vm.updatePipelineName(pipelineName, 0);

      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].name).toBe(pipelineName);
    });
  });

  describe('updateFunctionName Function', () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.baseImportRef = {
        jsonArrayOfObj: [{
          nodes: [
            {
              io_type: 'default',
              data: { node_type: 'function' }
            }
          ]
        }],
        updateJsonArray: vi.fn(),
        isImporting: false
      };
    });

    it('should update function name in correct node', () => {
      const functionName = 'test-function';
      wrapper.vm.updateFunctionName(functionName, 0, 0);

      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[0].data.name).toBe(functionName);
    });

    it('should not update non-function nodes', () => {
      wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[0].data.node_type = 'stream';
      const functionName = 'test-function';
      wrapper.vm.updateFunctionName(functionName, 0, 0);

      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[0].data.name).toBeUndefined();
    });
  });

  describe('updateRemoteDestination Function', () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.baseImportRef = {
        jsonArrayOfObj: [{
          nodes: [
            {
              data: { node_type: 'remote_stream' }
            }
          ]
        }],
        updateJsonArray: vi.fn(),
        isImporting: false
      };
    });

    it('should update remote destination name', () => {
      const remoteDestination = 'remote-dest';
      wrapper.vm.updateRemoteDestination(remoteDestination, 0);

      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[0].data.destination_name).toBe(remoteDestination);
    });
  });

  describe('updateDestinationStreamFields Function', () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.baseImportRef = {
        jsonArrayOfObj: [{
          nodes: [
            { io_type: 'output', data: {} }
          ]
        }],
        updateJsonArray: vi.fn(),
        isImporting: false
      };
    });

    it('should update destination stream name in output nodes', () => {
      const streamName = 'dest-stream';
      wrapper.vm.updateDestinationStreamFields(streamName, 0);

      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[0].data.stream_name).toBe(streamName);
    });
  });

  describe('updateTimezone Function', () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.baseImportRef = {
        jsonArrayOfObj: [{
          source: { trigger_condition: {} },
          nodes: [
            { data: { node_type: 'query', trigger_condition: {} } }
          ]
        }],
        updateJsonArray: vi.fn(),
        isImporting: false
      };
    });

    it('should update timezone in source trigger_condition', () => {
      const timezone = 'UTC';
      wrapper.vm.updateTimezone(timezone, 0);

      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].source.trigger_condition.timezone).toBe(timezone);
    });

    it('should update timezone in query nodes', () => {
      const timezone = 'UTC';
      wrapper.vm.updateTimezone(timezone, 0);

      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[0].data.trigger_condition.timezone).toBe(timezone);
    });
  });

  describe('updateOrgId Function', () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.baseImportRef = {
        jsonArrayOfObj: [{
          source: {},
          nodes: [
            { data: { node_type: 'stream' } },
            { data: { node_type: 'query' } }
          ]
        }],
        updateJsonArray: vi.fn(),
        isImporting: false
      };
    });

    it('should update organization id at root level', () => {
      const orgId = 'new-org';
      wrapper.vm.updateOrgId(orgId, 0);

      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].org).toBe(orgId);
    });

    it('should update organization id in source', () => {
      const orgId = 'new-org';
      wrapper.vm.updateOrgId(orgId, 0);

      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].source.org_id).toBe(orgId);
    });

    it('should update organization id in eligible nodes', () => {
      const orgId = 'new-org';
      wrapper.vm.updateOrgId(orgId, 0);

      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[0].data.org_id).toBe(orgId);
      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[1].data.org_id).toBe(orgId);
    });
  });

  describe('handleDynamicStreamName Function', () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.baseImportRef = {
        jsonArrayOfObj: [{
          source: {},
          nodes: [{ io_type: 'input', data: {} }]
        }],
        updateJsonArray: vi.fn(),
        isImporting: false
      };
    });

    it('should update stream name when provided', () => {
      const streamName = 'dynamic-stream';
      wrapper.vm.handleDynamicStreamName(streamName, 0);

      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].source.stream_name).toBe(streamName);
      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].stream_name).toBe(streamName);
    });

    it('should not update when stream name is empty', () => {
      wrapper.vm.handleDynamicStreamName('', 0);

      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].source.stream_name).toBeUndefined();
    });

    it('should not update when stream name is whitespace', () => {
      wrapper.vm.handleDynamicStreamName('   ', 0);

      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].source.stream_name).toBeUndefined();
    });
  });


  describe('validateNodesForOrg Function', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should return true for valid organization nodes', () => {
      const input = {
        nodes: [
          { data: { node_type: 'function', org_id: 'test-org' } },
          { data: { node_type: 'condition', org_id: 'test-org' } },
          { data: { node_type: 'stream', org_id: 'test-org' } }
        ]
      };
      
      const result = wrapper.vm.validateNodesForOrg(input);
      expect(result).toBe(true);
    });

    it('should return false for invalid organization nodes', () => {
      const input = {
        nodes: [
          { data: { node_type: 'stream', org_id: 'wrong-org' } }
        ]
      };
      
      const result = wrapper.vm.validateNodesForOrg(input);
      expect(result).toBe(false);
    });

    it('should return false for nodes missing org_id', () => {
      const input = {
        nodes: [
          { data: { node_type: 'stream' } }
        ]
      };
      
      const result = wrapper.vm.validateNodesForOrg(input);
      expect(result).toBe(false);
    });
  });

  describe('validateRemoteDestination Function', () => {
    beforeEach(() => {
      wrapper = createWrapper();
      wrapper.vm.pipelineDestinations = ['dest1', 'dest2'];
    });

    it('should return true for valid remote destinations', () => {
      const input = {
        nodes: [
          {
            io_type: 'output',
            data: { node_type: 'remote_stream', destination_name: 'dest1' }
          }
        ]
      };
      
      const result = wrapper.vm.validateRemoteDestination(input);
      expect(result).toBe(true);
    });

    it('should return false for invalid remote destinations', () => {
      const input = {
        nodes: [
          {
            io_type: 'output',
            data: { node_type: 'remote_stream', destination_name: 'invalid-dest' }
          }
        ]
      };
      
      const result = wrapper.vm.validateRemoteDestination(input);
      expect(result).toBe(false);
    });

    it('should return true when no remote stream nodes exist', () => {
      const input = {
        nodes: [
          {
            io_type: 'output',
            data: { node_type: 'stream', destination_name: 'any-dest' }
          }
        ]
      };
      
      const result = wrapper.vm.validateRemoteDestination(input);
      expect(result).toBe(true);
    });
  });

  describe('validateScheduledPipelineNodes Function', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should return true for realtime source type', async () => {
      const input = {
        source: { source_type: 'realtime' }
      };
      
      const result = await wrapper.vm.validateScheduledPipelineNodes(input, 'SELECT * FROM table');
      expect(result).toBe(true);
    });

    it('should validate SQL query consistency in nodes', async () => {
      const sqlQuery = 'SELECT * FROM table';
      const input = {
        source: { source_type: 'scheduled' },
        nodes: [
          {
            io_type: 'input',
            data: {
              query_condition: {
                type: 'sql',
                sql: sqlQuery
              }
            }
          }
        ]
      };
      
      const result = await wrapper.vm.validateScheduledPipelineNodes(input, sqlQuery);
      expect(result).toBe(true);
    });

    it('should return false for mismatched SQL queries', async () => {
      const input = {
        source: { source_type: 'scheduled' },
        nodes: [
          {
            io_type: 'input',
            data: {
              query_condition: {
                type: 'sql',
                sql: 'different query'
              }
            }
          }
        ]
      };
      
      const result = await wrapper.vm.validateScheduledPipelineNodes(input, 'SELECT * FROM table');
      expect(result).toBe(false);
    });
  });


  describe('Component Emits', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should define update:pipelines emit', () => {
      const emits = wrapper.vm.$options.emits;
      expect(emits).toContain('update:pipelines');
    });
  });


  describe('Exposed Internal Functions', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should expose processJsonObject function', () => {
      expect(typeof wrapper.vm.processJsonObject).toBe('function');
    });

    it('should expose validatePipelineInputs function', () => {
      expect(typeof wrapper.vm.validatePipelineInputs).toBe('function');
    });

    it('should expose validateSourceStream function', () => {
      expect(typeof wrapper.vm.validateSourceStream).toBe('function');
    });

    it('should expose validateDestinationStream function', () => {
      expect(typeof wrapper.vm.validateDestinationStream).toBe('function');
    });

    it('should expose createPipeline function', () => {
      expect(typeof wrapper.vm.createPipeline).toBe('function');
    });

    it('should expose getFunctions function', () => {
      expect(typeof wrapper.vm.getFunctions).toBe('function');
    });

    it('should expose getAlertDestinations function', () => {
      expect(typeof wrapper.vm.getAlertDestinations).toBe('function');
    });

    it('should expose getScheduledPipelines function', () => {
      expect(typeof wrapper.vm.getScheduledPipelines).toBe('function');
    });

    it('should expose getSourceStreamsList function', () => {
      expect(typeof wrapper.vm.getSourceStreamsList).toBe('function');
    });

    it('should expose getDestinationStreamsList function', () => {
      expect(typeof wrapper.vm.getDestinationStreamsList).toBe('function');
    });

    it('should expose getOutputStreamsList function', () => {
      expect(typeof wrapper.vm.getOutputStreamsList).toBe('function');
    });

    it('should expose importJson function', () => {
      expect(typeof wrapper.vm.importJson).toBe('function');
    });
  });

  describe('Additional Data Properties', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should initialize pipelineCreators as empty array', () => {
      expect(wrapper.vm.pipelineCreators).toEqual([]);
    });

    it('should initialize streamList as empty array', () => {
      expect(wrapper.vm.streamList).toEqual([]);
    });

    it('should initialize streamData as empty array', () => {
      expect(wrapper.vm.streamData).toEqual([]);
    });

    it('should initialize existingFunctions as empty array', () => {
      expect(wrapper.vm.existingFunctions).toEqual([]);
    });

    it('should initialize pipelineDestinations as empty array', () => {
      expect(wrapper.vm.pipelineDestinations).toEqual([]);
    });

    it('should initialize alertDestinations as empty array', () => {
      expect(wrapper.vm.alertDestinations).toEqual([]);
    });

    it('should initialize scheduledPipelines as empty array', () => {
      expect(wrapper.vm.scheduledPipelines).toEqual([]);
    });

    it('should initialize userSelectedTimezone as empty array', () => {
      expect(wrapper.vm.userSelectedTimezone).toEqual([]);
    });

    it('should initialize userSelectedSqlQuery as empty array', () => {
      expect(wrapper.vm.userSelectedSqlQuery).toEqual([]);
    });

    it('should initialize userSelectedFunctionName as empty array', () => {
      expect(wrapper.vm.userSelectedFunctionName).toEqual([]);
    });

    it('should initialize userSelectedOrgId as empty array', () => {
      expect(wrapper.vm.userSelectedOrgId).toEqual([]);
    });

    it('should initialize userSelectedRemoteDestination as empty array', () => {
      expect(wrapper.vm.userSelectedRemoteDestination).toEqual([]);
    });

    it('should initialize userSelectedStreamName as empty array', () => {
      expect(wrapper.vm.userSelectedStreamName).toEqual([]);
    });

    it('should initialize userSelectedDestinationStreamName as empty array', () => {
      expect(wrapper.vm.userSelectedDestinationStreamName).toEqual([]);
    });

    it('should initialize userSelectedStreamType as empty array', () => {
      expect(wrapper.vm.userSelectedStreamType).toEqual([]);
    });

    it('should initialize userSelectedDestinationStreamType as empty array', () => {
      expect(wrapper.vm.userSelectedDestinationStreamType).toEqual([]);
    });
  });

  describe('Timezone Options', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should have timezoneOptions available', () => {
      expect(Array.isArray(wrapper.vm.timezoneOptions)).toBe(true);
      expect(wrapper.vm.timezoneOptions.length).toBeGreaterThan(0);
    });

    it('should include UTC in timezoneOptions', () => {
      expect(wrapper.vm.timezoneOptions).toContain('UTC');
    });

    it('should include Browser Time in timezoneOptions', () => {
      const browserTimeOption = wrapper.vm.timezoneOptions.find((tz: string) => 
        tz.startsWith('Browser Time')
      );
      expect(browserTimeOption).toBeDefined();
    });
  });

  describe('Store Integration', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should have access to store state through global store', () => {
      expect(store.state).toBeDefined();
      expect(store.state.selectedOrganization).toBeDefined();
    });

    it('should have access to selectedOrganization from global store', () => {
      expect(store.state.selectedOrganization.identifier).toBe('test-org');
    });

    it('should have access to router', () => {
      expect(wrapper.vm.router).toBeDefined();
    });

    it('should have access to quasar instance', () => {
      expect(wrapper.vm.q).toBeDefined();
    });
  });

  describe('Complex Integration Tests', () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it('should handle complete pipeline data structure', () => {
      const pipelineData = {
        name: 'test-pipeline',
        source: {
          stream_name: 'test-stream',
          stream_type: 'logs',
          source_type: 'realtime',
          query_condition: {
            sql: 'SELECT * FROM table'
          }
        },
        nodes: [],
        edges: []
      };

      wrapper.vm.baseImportRef = {
        jsonArrayOfObj: [pipelineData],
        updateJsonArray: vi.fn(),
        isImporting: false
      };
      wrapper.vm.updatePipelineName('updated-pipeline', 0);

      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].name).toBe('updated-pipeline');
    });

    it('should handle multiple pipeline objects', () => {
      const pipelines = [
        { name: 'pipeline1', source: {}, nodes: [] },
        { name: 'pipeline2', source: {}, nodes: [] }
      ];

      wrapper.vm.baseImportRef = {
        jsonArrayOfObj: pipelines,
        updateJsonArray: vi.fn(),
        isImporting: false
      };
      wrapper.vm.updatePipelineName('updated-pipeline1', 0);
      wrapper.vm.updatePipelineName('updated-pipeline2', 1);

      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].name).toBe('updated-pipeline1');
      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[1].name).toBe('updated-pipeline2');
    });

    it('should maintain data consistency across updates', () => {
      const pipelineData = {
        name: 'test-pipeline',
        source: { stream_name: 'old-stream' },
        stream_name: 'old-stream',
        nodes: [{ io_type: 'input', data: { stream_name: 'old-stream' } }],
        edges: [{ sourceNode: { data: { stream_name: 'old-stream' } } }]
      };

      wrapper.vm.baseImportRef = {
        jsonArrayOfObj: [pipelineData],
        updateJsonArray: vi.fn(),
        isImporting: false
      };
      wrapper.vm.updateStreamFields({ value: 'new-stream' }, 0);

      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].source.stream_name).toBe('new-stream');
      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].stream_name).toBe('new-stream');
      expect(wrapper.vm.baseImportRef.jsonArrayOfObj[0].nodes[0].data.stream_name).toBe('new-stream');
    });
  });
});