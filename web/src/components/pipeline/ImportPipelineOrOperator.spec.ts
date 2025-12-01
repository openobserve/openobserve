import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { Quasar } from 'quasar';
import ImportPipeline from '@/components/pipeline/ImportPipeline.vue';
import store from '@/test/unit/helpers/store';

// Mock services
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
  back: vi.fn(),
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

describe('ImportPipeline.vue - OR Operator Tests', () => {
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

  describe('Import Pipeline with OR Conditions', () => {
    it('should import pipeline with simple OR condition', () => {
      wrapper = createWrapper();

      const pipelineWithOr = {
        name: 'test-pipeline',
        source: {
          stream_name: 'test-stream',
          stream_type: 'logs',
          source_type: 'realtime'
        },
        nodes: [
          {
            id: 'node-1',
            io_type: 'default',
            data: {
              node_type: 'condition',
              query_condition: {
                conditions: {
                  groupId: 'root-or',
                  label: 'or',
                  items: [
                    { id: '1', column: 'status', operator: '=', value: 'error', ignore_case: true },
                    { id: '2', column: 'status', operator: '=', value: 'failed', ignore_case: true }
                  ]
                }
              }
            }
          }
        ],
        edges: []
      };

      wrapper.vm.jsonArrayOfObj = [pipelineWithOr];

      expect(wrapper.vm.jsonArrayOfObj[0].nodes[0].data.query_condition.conditions.label).toBe('or');
      expect(wrapper.vm.jsonArrayOfObj[0].nodes[0].data.query_condition.conditions.items).toHaveLength(2);
    });

    it('should import pipeline with nested OR in AND condition', () => {
      wrapper = createWrapper();

      const pipelineWithNestedOr = {
        name: 'nested-or-pipeline',
        source: {
          stream_name: 'logs',
          stream_type: 'logs'
        },
        nodes: [
          {
            id: 'condition-node',
            io_type: 'default',
            data: {
              node_type: 'condition',
              query_condition: {
                conditions: {
                  groupId: 'root-and',
                  label: 'and',
                  items: [
                    { id: '1', column: 'region', operator: '=', value: 'us-east-1', ignore_case: false },
                    {
                      groupId: 'nested-or',
                      label: 'or',
                      items: [
                        { id: '2', column: 'level', operator: '=', value: 'error', ignore_case: true },
                        { id: '3', column: 'level', operator: '=', value: 'critical', ignore_case: true }
                      ]
                    }
                  ]
                }
              }
            }
          }
        ],
        edges: []
      };

      wrapper.vm.jsonArrayOfObj = [pipelineWithNestedOr];

      const conditions = wrapper.vm.jsonArrayOfObj[0].nodes[0].data.query_condition.conditions;
      expect(conditions.label).toBe('and');
      expect(conditions.items).toHaveLength(2);
      expect(conditions.items[1].label).toBe('or');
      expect(conditions.items[1].items).toHaveLength(2);
    });

    it('should import pipeline with multiple OR conditions', () => {
      wrapper = createWrapper();

      const pipelineWithMultipleOr = {
        name: 'multi-or-pipeline',
        nodes: [
          {
            id: 'condition-1',
            data: {
              node_type: 'condition',
              query_condition: {
                conditions: {
                  groupId: 'root',
                  label: 'or',
                  items: [
                    { id: '1', column: 'status_code', operator: '=', value: '500', ignore_case: false },
                    { id: '2', column: 'status_code', operator: '=', value: '502', ignore_case: false },
                    { id: '3', column: 'status_code', operator: '=', value: '503', ignore_case: false },
                    { id: '4', column: 'status_code', operator: '=', value: '504', ignore_case: false }
                  ]
                }
              }
            }
          }
        ]
      };

      wrapper.vm.jsonArrayOfObj = [pipelineWithMultipleOr];

      const conditions = wrapper.vm.jsonArrayOfObj[0].nodes[0].data.query_condition.conditions;
      expect(conditions.items).toHaveLength(4);
      expect(conditions.label).toBe('or');
    });

    it('should import pipeline with complex nested OR-AND-OR structure', () => {
      wrapper = createWrapper();

      const complexPipeline = {
        name: 'complex-pipeline',
        nodes: [
          {
            id: 'complex-condition',
            data: {
              node_type: 'condition',
              query_condition: {
                conditions: {
                  groupId: 'level-1',
                  label: 'or',
                  items: [
                    { id: '1', column: 'priority', operator: '=', value: 'critical', ignore_case: false },
                    {
                      groupId: 'level-2',
                      label: 'and',
                      items: [
                        { id: '2', column: 'service', operator: '=', value: 'api', ignore_case: false },
                        {
                          groupId: 'level-3',
                          label: 'or',
                          items: [
                            { id: '3', column: 'error', operator: 'Contains', value: 'timeout', ignore_case: true },
                            { id: '4', column: 'error', operator: 'Contains', value: 'connection', ignore_case: true }
                          ]
                        }
                      ]
                    }
                  ]
                }
              }
            }
          }
        ]
      };

      wrapper.vm.jsonArrayOfObj = [complexPipeline];

      const level1 = wrapper.vm.jsonArrayOfObj[0].nodes[0].data.query_condition.conditions;
      const level2 = level1.items[1];
      const level3 = level2.items[1];

      expect(level1.label).toBe('or');
      expect(level2.label).toBe('and');
      expect(level3.label).toBe('or');
      expect(level3.items).toHaveLength(2);
    });
  });

  describe('Import Pipeline - OR Operator Validation', () => {
    it('should validate OR conditions have required fields', () => {
      wrapper = createWrapper();

      const pipelineWithInvalidOr = {
        name: 'invalid-pipeline',
        nodes: [
          {
            id: 'invalid-condition',
            data: {
              node_type: 'condition',
              query_condition: {
                conditions: {
                  groupId: 'root',
                  label: 'or',
                  items: [
                    { id: '1', column: '', operator: '=', value: 'test', ignore_case: false },
                    { id: '2', column: 'status', operator: '', value: 'error', ignore_case: false }
                  ]
                }
              }
            }
          }
        ]
      };

      wrapper.vm.jsonArrayOfObj = [pipelineWithInvalidOr];

      const conditions = wrapper.vm.jsonArrayOfObj[0].nodes[0].data.query_condition.conditions;
      const hasInvalidItem = conditions.items.some((item: any) => !item.column || !item.operator);

      expect(hasInvalidItem).toBe(true);
    });

    it('should validate nested OR structure integrity', () => {
      wrapper = createWrapper();

      const pipelineWithValidNesting = {
        name: 'valid-nesting',
        nodes: [
          {
            id: 'nested-condition',
            data: {
              node_type: 'condition',
              query_condition: {
                conditions: {
                  groupId: 'root',
                  label: 'and',
                  items: [
                    { id: '1', column: 'field1', operator: '=', value: 'value1', ignore_case: false },
                    {
                      groupId: 'nested-or',
                      label: 'or',
                      items: [
                        { id: '2', column: 'field2', operator: '=', value: 'value2', ignore_case: false },
                        { id: '3', column: 'field3', operator: '=', value: 'value3', ignore_case: false }
                      ]
                    }
                  ]
                }
              }
            }
          }
        ]
      };

      wrapper.vm.jsonArrayOfObj = [pipelineWithValidNesting];

      const conditions = wrapper.vm.jsonArrayOfObj[0].nodes[0].data.query_condition.conditions;
      const hasValidNesting = conditions.items.some((item: any) =>
        item.groupId && item.label && Array.isArray(item.items)
      );

      expect(hasValidNesting).toBe(true);
    });

    it('should handle OR conditions with different operators', () => {
      wrapper = createWrapper();

      const pipelineWithVariousOperators = {
        name: 'various-operators',
        nodes: [
          {
            id: 'various-ops',
            data: {
              node_type: 'condition',
              query_condition: {
                conditions: {
                  groupId: 'root',
                  label: 'or',
                  items: [
                    { id: '1', column: 'count', operator: '>', value: '100', ignore_case: false },
                    { id: '2', column: 'message', operator: 'Contains', value: 'error', ignore_case: true },
                    { id: '3', column: 'status', operator: '!=', value: 'success', ignore_case: false },
                    { id: '4', column: 'level', operator: '=', value: 'critical', ignore_case: true }
                  ]
                }
              }
            }
          }
        ]
      };

      wrapper.vm.jsonArrayOfObj = [pipelineWithVariousOperators];

      const items = wrapper.vm.jsonArrayOfObj[0].nodes[0].data.query_condition.conditions.items;
      const operators = items.map((item: any) => item.operator);

      expect(operators).toEqual(['>', 'Contains', '!=', '=']);
    });
  });

  describe('Import Pipeline - OR with Special Values', () => {
    it('should handle OR conditions with empty string checks', () => {
      wrapper = createWrapper();

      const pipelineWithEmptyChecks = {
        name: 'empty-checks',
        nodes: [
          {
            id: 'empty-condition',
            data: {
              node_type: 'condition',
              query_condition: {
                conditions: {
                  groupId: 'root',
                  label: 'or',
                  items: [
                    { id: '1', column: 'app_name', operator: '=', value: '""', ignore_case: false },
                    { id: '2', column: 'app_name', operator: '=', value: 'null', ignore_case: false }
                  ]
                }
              }
            }
          }
        ]
      };

      wrapper.vm.jsonArrayOfObj = [pipelineWithEmptyChecks];

      const items = wrapper.vm.jsonArrayOfObj[0].nodes[0].data.query_condition.conditions.items;
      expect(items[0].value).toBe('""');
      expect(items[1].value).toBe('null');
    });

    it('should handle OR conditions with special characters', () => {
      wrapper = createWrapper();

      const pipelineWithSpecialChars = {
        name: 'special-chars',
        nodes: [
          {
            id: 'special-condition',
            data: {
              node_type: 'condition',
              query_condition: {
                conditions: {
                  groupId: 'root',
                  label: 'or',
                  items: [
                    { id: '1', column: 'message', operator: 'Contains', value: 'error: failed!', ignore_case: true },
                    { id: '2', column: 'message', operator: 'Contains', value: 'special@#$%', ignore_case: false }
                  ]
                }
              }
            }
          }
        ]
      };

      wrapper.vm.jsonArrayOfObj = [pipelineWithSpecialChars];

      const items = wrapper.vm.jsonArrayOfObj[0].nodes[0].data.query_condition.conditions.items;
      expect(items[0].value).toContain('!');
      expect(items[1].value).toContain('@#$%');
    });

    it('should handle OR conditions with unicode values', () => {
      wrapper = createWrapper();

      const pipelineWithUnicode = {
        name: 'unicode-pipeline',
        nodes: [
          {
            id: 'unicode-condition',
            data: {
              node_type: 'condition',
              query_condition: {
                conditions: {
                  groupId: 'root',
                  label: 'or',
                  items: [
                    { id: '1', column: 'message', operator: 'Contains', value: '错误', ignore_case: true },
                    { id: '2', column: 'message', operator: 'Contains', value: 'エラー', ignore_case: true },
                    { id: '3', column: 'message', operator: 'Contains', value: 'خطأ', ignore_case: true }
                  ]
                }
              }
            }
          }
        ]
      };

      wrapper.vm.jsonArrayOfObj = [pipelineWithUnicode];

      const items = wrapper.vm.jsonArrayOfObj[0].nodes[0].data.query_condition.conditions.items;
      expect(items[0].value).toBe('错误');
      expect(items[1].value).toBe('エラー');
      expect(items[2].value).toBe('خطأ');
    });

    it('should handle OR conditions with numeric string values', () => {
      wrapper = createWrapper();

      const pipelineWithNumericStrings = {
        name: 'numeric-strings',
        nodes: [
          {
            id: 'numeric-condition',
            data: {
              node_type: 'condition',
              query_condition: {
                conditions: {
                  groupId: 'root',
                  label: 'or',
                  items: [
                    { id: '1', column: 'count', operator: '=', value: '100', ignore_case: false },
                    { id: '2', column: 'count', operator: '=', value: '1000.50', ignore_case: false },
                    { id: '3', column: 'count', operator: '=', value: '-50', ignore_case: false }
                  ]
                }
              }
            }
          }
        ]
      };

      wrapper.vm.jsonArrayOfObj = [pipelineWithNumericStrings];

      const items = wrapper.vm.jsonArrayOfObj[0].nodes[0].data.query_condition.conditions.items;
      expect(items[0].value).toBe('100');
      expect(items[1].value).toBe('1000.50');
      expect(items[2].value).toBe('-50');
    });
  });

  describe('Import Pipeline - Real-World OR Scenarios', () => {
    it('should import pipeline with HTTP error code filtering', () => {
      wrapper = createWrapper();

      const httpErrorPipeline = {
        name: 'http-error-filter',
        nodes: [
          {
            id: 'http-errors',
            data: {
              node_type: 'condition',
              query_condition: {
                conditions: {
                  groupId: 'http-codes',
                  label: 'or',
                  items: [
                    { id: '1', column: 'status_code', operator: '=', value: '400', ignore_case: false },
                    { id: '2', column: 'status_code', operator: '=', value: '401', ignore_case: false },
                    { id: '3', column: 'status_code', operator: '=', value: '403', ignore_case: false },
                    { id: '4', column: 'status_code', operator: '=', value: '404', ignore_case: false },
                    { id: '5', column: 'status_code', operator: '=', value: '500', ignore_case: false },
                    { id: '6', column: 'status_code', operator: '=', value: '502', ignore_case: false },
                    { id: '7', column: 'status_code', operator: '=', value: '503', ignore_case: false }
                  ]
                }
              }
            }
          }
        ]
      };

      wrapper.vm.jsonArrayOfObj = [httpErrorPipeline];

      const conditions = wrapper.vm.jsonArrayOfObj[0].nodes[0].data.query_condition.conditions;
      expect(conditions.items).toHaveLength(7);
      expect(conditions.label).toBe('or');
    });

    it('should import pipeline with multi-region alert routing', () => {
      wrapper = createWrapper();

      const regionRoutingPipeline = {
        name: 'region-routing',
        nodes: [
          {
            id: 'region-condition',
            data: {
              node_type: 'condition',
              query_condition: {
                conditions: {
                  groupId: 'root-and',
                  label: 'and',
                  items: [
                    { id: '1', column: 'severity', operator: '>=', value: '3', ignore_case: false },
                    {
                      groupId: 'region-or',
                      label: 'or',
                      items: [
                        { id: '2', column: 'region', operator: '=', value: 'us-east-1', ignore_case: false },
                        { id: '3', column: 'region', operator: '=', value: 'us-west-1', ignore_case: false },
                        { id: '4', column: 'region', operator: '=', value: 'eu-west-1', ignore_case: false }
                      ]
                    }
                  ]
                }
              }
            }
          }
        ]
      };

      wrapper.vm.jsonArrayOfObj = [regionRoutingPipeline];

      const conditions = wrapper.vm.jsonArrayOfObj[0].nodes[0].data.query_condition.conditions;
      expect(conditions.items[1].label).toBe('or');
      expect(conditions.items[1].items).toHaveLength(3);
    });

    it('should import pipeline with log level filtering', () => {
      wrapper = createWrapper();

      const logLevelPipeline = {
        name: 'critical-logs',
        nodes: [
          {
            id: 'log-level-filter',
            data: {
              node_type: 'condition',
              query_condition: {
                conditions: {
                  groupId: 'critical-levels',
                  label: 'or',
                  items: [
                    { id: '1', column: 'level', operator: '=', value: 'error', ignore_case: true },
                    { id: '2', column: 'level', operator: '=', value: 'critical', ignore_case: true },
                    { id: '3', column: 'level', operator: '=', value: 'fatal', ignore_case: true },
                    { id: '4', column: 'level', operator: '=', value: 'emergency', ignore_case: true }
                  ]
                }
              }
            }
          }
        ]
      };

      wrapper.vm.jsonArrayOfObj = [logLevelPipeline];

      const items = wrapper.vm.jsonArrayOfObj[0].nodes[0].data.query_condition.conditions.items;
      expect(items).toHaveLength(4);
      expect(items.every((item: any) => item.ignore_case === true)).toBe(true);
    });

    it('should import pipeline with error pattern detection', () => {
      wrapper = createWrapper();

      const errorPatternPipeline = {
        name: 'error-pattern-detection',
        nodes: [
          {
            id: 'error-patterns',
            data: {
              node_type: 'condition',
              query_condition: {
                conditions: {
                  groupId: 'patterns',
                  label: 'or',
                  items: [
                    { id: '1', column: 'message', operator: 'Contains', value: 'timeout', ignore_case: true },
                    { id: '2', column: 'message', operator: 'Contains', value: 'connection refused', ignore_case: true },
                    { id: '3', column: 'message', operator: 'Contains', value: 'out of memory', ignore_case: true },
                    { id: '4', column: 'message', operator: 'Contains', value: 'null pointer', ignore_case: true }
                  ]
                }
              }
            }
          }
        ]
      };

      wrapper.vm.jsonArrayOfObj = [errorPatternPipeline];

      const items = wrapper.vm.jsonArrayOfObj[0].nodes[0].data.query_condition.conditions.items;
      expect(items.every((item: any) => item.operator === 'Contains')).toBe(true);
      expect(items).toHaveLength(4);
    });

    it('should import pipeline with complex service monitoring', () => {
      wrapper = createWrapper();

      const serviceMonitoringPipeline = {
        name: 'service-health-monitor',
        nodes: [
          {
            id: 'service-monitor',
            data: {
              node_type: 'condition',
              query_condition: {
                conditions: {
                  groupId: 'root-or',
                  label: 'or',
                  items: [
                    {
                      groupId: 'api-gateway',
                      label: 'and',
                      items: [
                        { id: '1', column: 'service', operator: '=', value: 'api-gateway', ignore_case: false },
                        { id: '2', column: 'status', operator: '=', value: 'down', ignore_case: true }
                      ]
                    },
                    {
                      groupId: 'database',
                      label: 'and',
                      items: [
                        { id: '3', column: 'service', operator: '=', value: 'database', ignore_case: false },
                        { id: '4', column: 'connection_count', operator: '>', value: '1000', ignore_case: false }
                      ]
                    },
                    {
                      groupId: 'cache',
                      label: 'and',
                      items: [
                        { id: '5', column: 'service', operator: '=', value: 'cache', ignore_case: false },
                        { id: '6', column: 'eviction_rate', operator: '>', value: '0.8', ignore_case: false }
                      ]
                    }
                  ]
                }
              }
            }
          }
        ]
      };

      wrapper.vm.jsonArrayOfObj = [serviceMonitoringPipeline];

      const conditions = wrapper.vm.jsonArrayOfObj[0].nodes[0].data.query_condition.conditions;
      expect(conditions.label).toBe('or');
      expect(conditions.items).toHaveLength(3);
      expect(conditions.items.every((item: any) => item.label === 'and')).toBe(true);
    });
  });

  describe('Import Pipeline - Multiple Condition Nodes with OR', () => {
    it('should import pipeline with multiple condition nodes containing OR', () => {
      wrapper = createWrapper();

      const multipleConditionsPipeline = {
        name: 'multi-condition-pipeline',
        nodes: [
          {
            id: 'condition-1',
            data: {
              node_type: 'condition',
              query_condition: {
                conditions: {
                  groupId: 'first-or',
                  label: 'or',
                  items: [
                    { id: '1', column: 'priority', operator: '=', value: 'high', ignore_case: false },
                    { id: '2', column: 'priority', operator: '=', value: 'critical', ignore_case: false }
                  ]
                }
              }
            }
          },
          {
            id: 'condition-2',
            data: {
              node_type: 'condition',
              query_condition: {
                conditions: {
                  groupId: 'second-or',
                  label: 'or',
                  items: [
                    { id: '3', column: 'region', operator: '=', value: 'us', ignore_case: false },
                    { id: '4', column: 'region', operator: '=', value: 'eu', ignore_case: false }
                  ]
                }
              }
            }
          }
        ]
      };

      wrapper.vm.jsonArrayOfObj = [multipleConditionsPipeline];

      const node1Conditions = wrapper.vm.jsonArrayOfObj[0].nodes[0].data.query_condition.conditions;
      const node2Conditions = wrapper.vm.jsonArrayOfObj[0].nodes[1].data.query_condition.conditions;

      expect(node1Conditions.label).toBe('or');
      expect(node2Conditions.label).toBe('or');
      expect(node1Conditions.items).toHaveLength(2);
      expect(node2Conditions.items).toHaveLength(2);
    });
  });
});
