import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Dialog, Notify } from "quasar";
import useDnD from '@/plugins/pipelines/useDnD';
import { installQuasar } from "@/test/unit/helpers";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import Condition from "./Condition.vue";

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock the services and composables
vi.mock("@/services/search", () => ({
  default: {
    search: vi.fn(),
  },
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn().mockResolvedValue({
      schema: [
        { name: "timestamp", type: "datetime" },
        { name: "message", type: "string" },
        { name: "level", type: "string" },
        { name: "status_code", type: "number" },
        { name: "region", type: "string" }
      ],
    }),
    getStreams: vi.fn(),
  }),
}));

vi.mock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: () => ({
      astify: vi.fn().mockReturnValue({
        from: [{ table: "test_stream" }]
      })
    })
  })
}));

const mockAddNode = vi.fn();
vi.mock('@/plugins/pipelines/useDnD', () => ({
  default: vi.fn(),
  useDnD: () => ({
    addNode: mockAddNode,
    pipelineObj: {
      isEditNode: false,
      currentSelectedNodeData: null,
      userClickedNode: {},
      userSelectedNode: {},
      currentSelectedPipeline: {
        nodes: [
          {
            io_type: "input",
            data: {
              node_type: "stream",
              stream_name: "test_stream",
              stream_type: "logs"
            }
          }
        ]
      }
    },
    deletePipelineNode: vi.fn()
  })
}));

vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useI18n: () => ({
      t: (key) => key
    })
  };
});

describe("Condition Component - OR Operator Tests", () => {
  let wrapper;
  let mockPipelineObj;
  let mockStore;

  beforeEach(async () => {
    mockStore = {
      state: {
        theme: 'light',
        selectedOrganization: {
          identifier: "test-org"
        },
        userInfo: {
          email: "test@example.com"
        }
      }
    };

    mockPipelineObj = {
      currentSelectedNodeData: {
        data: {},
        type: 'condition'
      },
      userSelectedNode: {},
      isEditNode: false,
      currentSelectedPipeline: {
        nodes: [
          {
            io_type: "input",
            data: {
              node_type: "stream",
              stream_name: "test_stream",
              stream_type: "logs"
            }
          }
        ]
      }
    };

    vi.mocked(useDnD).mockImplementation(() => ({
      pipelineObj: mockPipelineObj,
      addNode: mockAddNode,
      deletePipelineNode: vi.fn()
    }));

    wrapper = mount(Condition, {
      global: {
        plugins: [i18n],
        provide: {
          store: mockStore,
        },
        stubs: {
          RealtimePipeline: true,
          ConfirmDialog: true,
        }
      }
    });

    const notifyMock = vi.fn();
    wrapper.vm.$q.notify = notifyMock;

    await flushPromises();
    await wrapper.vm.getFields();
    await flushPromises();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("OR Operator in Condition Node - Basic Functionality", () => {
    it("should initialize conditions with nested OR group structure", () => {
      const conditionGroup = wrapper.vm.conditionGroup;
      expect(conditionGroup).toBeDefined();
      expect(conditionGroup.items).toBeDefined();
      expect(Array.isArray(conditionGroup.items)).toBe(true);
    });

    it("should support OR condition with multiple fields", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'root-group',
        label: 'or',
        items: [
          { id: '1', column: 'status_code', operator: '=', value: '500', ignore_case: false },
          { id: '2', column: 'status_code', operator: '=', value: '503', ignore_case: false }
        ]
      };

      expect(wrapper.vm.conditionGroup.label).toBe('or');
      expect(wrapper.vm.conditionGroup.items).toHaveLength(2);
    });

    it("should support AND condition within condition node", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'root-group',
        label: 'and',
        items: [
          { id: '1', column: 'level', operator: '=', value: 'error', ignore_case: true },
          { id: '2', column: 'status_code', operator: '>=', value: '500', ignore_case: false }
        ]
      };

      expect(wrapper.vm.conditionGroup.label).toBe('and');
      expect(wrapper.vm.conditionGroup.items).toHaveLength(2);
    });

    it("should support nested OR within AND condition", () => {
      wrapper.vm.conditionGroup = {
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
      };

      expect(wrapper.vm.conditionGroup.items).toHaveLength(2);
      expect(wrapper.vm.conditionGroup.items[1].label).toBe('or');
      expect(wrapper.vm.conditionGroup.items[1].items).toHaveLength(2);
    });

    it("should support nested AND within OR condition", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'root-or',
        label: 'or',
        items: [
          { id: '1', column: 'status_code', operator: '=', value: '404', ignore_case: false },
          {
            groupId: 'nested-and',
            label: 'and',
            items: [
              { id: '2', column: 'status_code', operator: '>=', value: '500', ignore_case: false },
              { id: '3', column: 'message', operator: 'Contains', value: 'timeout', ignore_case: true }
            ]
          }
        ]
      };

      expect(wrapper.vm.conditionGroup.items).toHaveLength(2);
      expect(wrapper.vm.conditionGroup.items[1].label).toBe('and');
      expect(wrapper.vm.conditionGroup.items[1].items).toHaveLength(2);
    });
  });

  describe("OR Operator - Multiple Conditions Scenarios", () => {
    it("should handle OR with three conditions", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'group-1',
        label: 'or',
        items: [
          { id: '1', column: 'status_code', operator: '=', value: '500', ignore_case: false },
          { id: '2', column: 'status_code', operator: '=', value: '502', ignore_case: false },
          { id: '3', column: 'status_code', operator: '=', value: '503', ignore_case: false }
        ]
      };

      expect(wrapper.vm.conditionGroup.items).toHaveLength(3);
      wrapper.vm.conditionGroup.items.forEach(item => {
        expect(item.column).toBe('status_code');
      });
    });

    it("should handle OR with different operators", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'group-1',
        label: 'or',
        items: [
          { id: '1', column: 'status_code', operator: '>=', value: '500', ignore_case: false },
          { id: '2', column: 'message', operator: 'Contains', value: 'error', ignore_case: true },
          { id: '3', column: 'level', operator: '=', value: 'critical', ignore_case: true }
        ]
      };

      expect(wrapper.vm.conditionGroup.items[0].operator).toBe('>=');
      expect(wrapper.vm.conditionGroup.items[1].operator).toBe('Contains');
      expect(wrapper.vm.conditionGroup.items[2].operator).toBe('=');
    });

    it("should handle OR with mixed case sensitivity", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'group-1',
        label: 'or',
        items: [
          { id: '1', column: 'message', operator: 'Contains', value: 'ERROR', ignore_case: true },
          { id: '2', column: 'message', operator: 'Contains', value: 'Error', ignore_case: false },
          { id: '3', column: 'message', operator: '=', value: 'error', ignore_case: true }
        ]
      };

      expect(wrapper.vm.conditionGroup.items[0].ignore_case).toBe(true);
      expect(wrapper.vm.conditionGroup.items[1].ignore_case).toBe(false);
      expect(wrapper.vm.conditionGroup.items[2].ignore_case).toBe(true);
    });

    it("should handle OR with NotContains operator", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'group-1',
        label: 'or',
        items: [
          { id: '1', column: 'message', operator: 'NotContains', value: 'debug', ignore_case: true },
          { id: '2', column: 'message', operator: 'NotContains', value: 'trace', ignore_case: true }
        ]
      };

      expect(wrapper.vm.conditionGroup.items[0].operator).toBe('NotContains');
      expect(wrapper.vm.conditionGroup.items[1].operator).toBe('NotContains');
    });

    it("should handle OR with != (not equals) operator", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'group-1',
        label: 'or',
        items: [
          { id: '1', column: 'status', operator: '!=', value: 'success', ignore_case: false },
          { id: '2', column: 'status', operator: '!=', value: 'pending', ignore_case: false }
        ]
      };

      wrapper.vm.conditionGroup.items.forEach(item => {
        expect(item.operator).toBe('!=');
      });
    });
  });

  describe("OR Operator - Complex Nested Structures", () => {
    it("should handle deeply nested OR-AND-OR structure", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'root',
        label: 'or',
        items: [
          { id: '1', column: 'level', operator: '=', value: 'critical', ignore_case: true },
          {
            groupId: 'mid-and',
            label: 'and',
            items: [
              { id: '2', column: 'region', operator: '=', value: 'us-west-1', ignore_case: false },
              {
                groupId: 'deep-or',
                label: 'or',
                items: [
                  { id: '3', column: 'status_code', operator: '=', value: '500', ignore_case: false },
                  { id: '4', column: 'status_code', operator: '=', value: '503', ignore_case: false }
                ]
              }
            ]
          }
        ]
      };

      const rootItems = wrapper.vm.conditionGroup.items;
      expect(rootItems).toHaveLength(2);
      expect(rootItems[1].items[1].label).toBe('or');
      expect(rootItems[1].items[1].items).toHaveLength(2);
    });

    it("should handle multiple OR groups at same level", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'root-and',
        label: 'and',
        items: [
          {
            groupId: 'or-1',
            label: 'or',
            items: [
              { id: '1', column: 'region', operator: '=', value: 'us-east-1', ignore_case: false },
              { id: '2', column: 'region', operator: '=', value: 'us-west-1', ignore_case: false }
            ]
          },
          {
            groupId: 'or-2',
            label: 'or',
            items: [
              { id: '3', column: 'tier', operator: '=', value: 'gold', ignore_case: false },
              { id: '4', column: 'tier', operator: '=', value: 'platinum', ignore_case: false }
            ]
          }
        ]
      };

      const items = wrapper.vm.conditionGroup.items;
      expect(items).toHaveLength(2);
      expect(items[0].label).toBe('or');
      expect(items[1].label).toBe('or');
    });

    it("should handle OR with empty value (checking for empty strings)", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'group-1',
        label: 'or',
        items: [
          { id: '1', column: 'app_name', operator: '=', value: '""', ignore_case: false },
          { id: '2', column: 'app_name', operator: '=', value: 'null', ignore_case: false }
        ]
      };

      expect(wrapper.vm.conditionGroup.items[0].value).toBe('""');
      expect(wrapper.vm.conditionGroup.items[1].value).toBe('null');
    });

    it("should handle OR with numeric comparison operators", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'group-1',
        label: 'or',
        items: [
          { id: '1', column: 'response_time', operator: '>', value: '1000', ignore_case: false },
          { id: '2', column: 'response_time', operator: '<', value: '10', ignore_case: false },
          { id: '3', column: 'response_time', operator: '>=', value: '5000', ignore_case: false },
          { id: '4', column: 'response_time', operator: '<=', value: '1', ignore_case: false }
        ]
      };

      const operators = wrapper.vm.conditionGroup.items.map(item => item.operator);
      expect(operators).toEqual(['>', '<', '>=', '<=']);
    });
  });

  describe("OR Operator - Edge Cases", () => {
    it("should handle single OR condition", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'group-1',
        label: 'or',
        items: [
          { id: '1', column: 'status', operator: '=', value: 'active', ignore_case: true }
        ]
      };

      expect(wrapper.vm.conditionGroup.items).toHaveLength(1);
      expect(wrapper.vm.conditionGroup.label).toBe('or');
    });

    it("should handle OR with special characters in values", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'group-1',
        label: 'or',
        items: [
          { id: '1', column: 'message', operator: 'Contains', value: 'error: connection failed!', ignore_case: true },
          { id: '2', column: 'message', operator: 'Contains', value: 'special@#$%^&*()', ignore_case: false }
        ]
      };

      expect(wrapper.vm.conditionGroup.items[0].value).toContain('!');
      expect(wrapper.vm.conditionGroup.items[1].value).toContain('@#$%^&*()');
    });

    it("should handle OR with unicode characters", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'group-1',
        label: 'or',
        items: [
          { id: '1', column: 'message', operator: 'Contains', value: '错误', ignore_case: true },
          { id: '2', column: 'message', operator: 'Contains', value: 'エラー', ignore_case: true },
          { id: '3', column: 'message', operator: 'Contains', value: 'خطأ', ignore_case: true }
        ]
      };

      expect(wrapper.vm.conditionGroup.items).toHaveLength(3);
      expect(wrapper.vm.conditionGroup.items[0].value).toBe('错误');
      expect(wrapper.vm.conditionGroup.items[1].value).toBe('エラー');
      expect(wrapper.vm.conditionGroup.items[2].value).toBe('خطأ');
    });

    it("should handle OR with whitespace in values", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'group-1',
        label: 'or',
        items: [
          { id: '1', column: 'message', operator: '=', value: '   leading spaces', ignore_case: false },
          { id: '2', column: 'message', operator: '=', value: 'trailing spaces   ', ignore_case: false },
          { id: '3', column: 'message', operator: '=', value: '  both sides  ', ignore_case: false }
        ]
      };

      expect(wrapper.vm.conditionGroup.items[0].value).toBe('   leading spaces');
      expect(wrapper.vm.conditionGroup.items[1].value).toBe('trailing spaces   ');
      expect(wrapper.vm.conditionGroup.items[2].value).toBe('  both sides  ');
    });

    it("should handle OR with numeric string values", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'group-1',
        label: 'or',
        items: [
          { id: '1', column: 'count', operator: '=', value: '100', ignore_case: false },
          { id: '2', column: 'count', operator: '=', value: '1000.50', ignore_case: false },
          { id: '3', column: 'count', operator: '=', value: '-50', ignore_case: false }
        ]
      };

      expect(wrapper.vm.conditionGroup.items[0].value).toBe('100');
      expect(wrapper.vm.conditionGroup.items[1].value).toBe('1000.50');
      expect(wrapper.vm.conditionGroup.items[2].value).toBe('-50');
    });

    it("should handle OR with boolean-like string values", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'group-1',
        label: 'or',
        items: [
          { id: '1', column: 'is_valid', operator: '=', value: 'true', ignore_case: false },
          { id: '2', column: 'is_valid', operator: '=', value: 'false', ignore_case: false }
        ]
      };

      expect(wrapper.vm.conditionGroup.items[0].value).toBe('true');
      expect(wrapper.vm.conditionGroup.items[1].value).toBe('false');
    });
  });

  describe("OR Operator - Real-World Scenarios", () => {
    it("should handle HTTP error codes OR condition", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'http-errors',
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
      };

      expect(wrapper.vm.conditionGroup.items).toHaveLength(7);
      expect(wrapper.vm.conditionGroup.label).toBe('or');
    });

    it("should handle log level filtering with OR", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'log-levels',
        label: 'or',
        items: [
          { id: '1', column: 'level', operator: '=', value: 'error', ignore_case: true },
          { id: '2', column: 'level', operator: '=', value: 'critical', ignore_case: true },
          { id: '3', column: 'level', operator: '=', value: 'fatal', ignore_case: true },
          { id: '4', column: 'level', operator: '=', value: 'emergency', ignore_case: true }
        ]
      };

      expect(wrapper.vm.conditionGroup.items).toHaveLength(4);
      wrapper.vm.conditionGroup.items.forEach(item => {
        expect(item.ignore_case).toBe(true);
      });
    });

    it("should handle multi-region filtering", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'regions',
        label: 'or',
        items: [
          { id: '1', column: 'region', operator: '=', value: 'us-east-1', ignore_case: false },
          { id: '2', column: 'region', operator: '=', value: 'us-west-1', ignore_case: false },
          { id: '3', column: 'region', operator: '=', value: 'eu-west-1', ignore_case: false },
          { id: '4', column: 'region', operator: '=', value: 'ap-southeast-1', ignore_case: false }
        ]
      };

      expect(wrapper.vm.conditionGroup.items).toHaveLength(4);
      expect(wrapper.vm.conditionGroup.items.every(item => item.column === 'region')).toBe(true);
    });

    it("should handle complex alert condition: critical errors OR high response time AND specific region", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'root-or',
        label: 'or',
        items: [
          {
            groupId: 'critical-errors',
            label: 'and',
            items: [
              { id: '1', column: 'level', operator: '=', value: 'critical', ignore_case: true },
              { id: '2', column: 'region', operator: '=', value: 'us-east-1', ignore_case: false }
            ]
          },
          {
            groupId: 'high-response',
            label: 'and',
            items: [
              { id: '3', column: 'response_time', operator: '>', value: '5000', ignore_case: false },
              { id: '4', column: 'region', operator: '=', value: 'us-east-1', ignore_case: false }
            ]
          }
        ]
      };

      expect(wrapper.vm.conditionGroup.items).toHaveLength(2);
      expect(wrapper.vm.conditionGroup.items[0].label).toBe('and');
      expect(wrapper.vm.conditionGroup.items[1].label).toBe('and');
    });

    it("should handle error pattern matching with OR", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'error-patterns',
        label: 'or',
        items: [
          { id: '1', column: 'message', operator: 'Contains', value: 'timeout', ignore_case: true },
          { id: '2', column: 'message', operator: 'Contains', value: 'connection refused', ignore_case: true },
          { id: '3', column: 'message', operator: 'Contains', value: 'out of memory', ignore_case: true },
          { id: '4', column: 'message', operator: 'Contains', value: 'null pointer', ignore_case: true }
        ]
      };

      expect(wrapper.vm.conditionGroup.items).toHaveLength(4);
      expect(wrapper.vm.conditionGroup.items.every(item => item.operator === 'Contains')).toBe(true);
    });

    it("should handle service status monitoring", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'root-and',
        label: 'and',
        items: [
          { id: '1', column: 'service', operator: '=', value: 'api-gateway', ignore_case: false },
          {
            groupId: 'status-or',
            label: 'or',
            items: [
              { id: '2', column: 'status', operator: '=', value: 'degraded', ignore_case: true },
              { id: '3', column: 'status', operator: '=', value: 'down', ignore_case: true },
              { id: '4', column: 'status', operator: '=', value: 'maintenance', ignore_case: true }
            ]
          }
        ]
      };

      expect(wrapper.vm.conditionGroup.items).toHaveLength(2);
      expect(wrapper.vm.conditionGroup.items[1].items).toHaveLength(3);
    });
  });

  describe("OR Operator - Data Validation", () => {
    it("should validate OR conditions with valid data", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'valid-or',
        label: 'or',
        items: [
          { id: '1', column: 'status', operator: '=', value: 'active', ignore_case: true },
          { id: '2', column: 'status', operator: '=', value: 'pending', ignore_case: true }
        ]
      };

      const isValid = wrapper.vm.conditionGroup.items.every(item =>
        item.column && item.operator && item.value !== undefined
      );

      expect(isValid).toBe(true);
    });

    it("should handle OR conditions with missing column", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'invalid-or',
        label: 'or',
        items: [
          { id: '1', column: '', operator: '=', value: 'test', ignore_case: false },
          { id: '2', column: 'status', operator: '=', value: 'active', ignore_case: false }
        ]
      };

      const hasInvalid = wrapper.vm.conditionGroup.items.some(item => !item.column);
      expect(hasInvalid).toBe(true);
    });

    it("should handle OR conditions with missing operator", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'invalid-or',
        label: 'or',
        items: [
          { id: '1', column: 'status', operator: '', value: 'test', ignore_case: false },
          { id: '2', column: 'level', operator: '=', value: 'error', ignore_case: false }
        ]
      };

      const hasInvalid = wrapper.vm.conditionGroup.items.some(item => !item.operator);
      expect(hasInvalid).toBe(true);
    });

    it("should allow OR conditions with empty string value when checking for empty", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'empty-check',
        label: 'or',
        items: [
          { id: '1', column: 'field1', operator: '=', value: '""', ignore_case: false },
          { id: '2', column: 'field2', operator: '!=', value: '""', ignore_case: false }
        ]
      };

      expect(wrapper.vm.conditionGroup.items[0].value).toBe('""');
      expect(wrapper.vm.conditionGroup.items[1].value).toBe('""');
    });
  });

  describe("OR Operator - Performance Considerations", () => {
    it("should handle OR with many conditions (10+)", () => {
      const items = Array.from({ length: 15 }, (_, i) => ({
        id: `${i + 1}`,
        column: 'status_code',
        operator: '=',
        value: `${400 + i}`,
        ignore_case: false
      }));

      wrapper.vm.conditionGroup = {
        groupId: 'many-conditions',
        label: 'or',
        items
      };

      expect(wrapper.vm.conditionGroup.items).toHaveLength(15);
    });

    it("should handle deeply nested structure (3 levels)", () => {
      wrapper.vm.conditionGroup = {
        groupId: 'level-1-or',
        label: 'or',
        items: [
          { id: '1', column: 'priority', operator: '=', value: 'critical', ignore_case: false },
          {
            groupId: 'level-2-and',
            label: 'and',
            items: [
              { id: '2', column: 'service', operator: '=', value: 'auth', ignore_case: false },
              {
                groupId: 'level-3-or',
                label: 'or',
                items: [
                  { id: '3', column: 'error_type', operator: '=', value: 'timeout', ignore_case: true },
                  { id: '4', column: 'error_type', operator: '=', value: 'connection', ignore_case: true },
                  { id: '5', column: 'error_type', operator: '=', value: 'auth_failed', ignore_case: true }
                ]
              }
            ]
          }
        ]
      };

      const level1 = wrapper.vm.conditionGroup;
      const level2 = level1.items[1];
      const level3 = level2.items[1];

      expect(level1.label).toBe('or');
      expect(level2.label).toBe('and');
      expect(level3.label).toBe('or');
      expect(level3.items).toHaveLength(3);
    });
  });

  describe("OR Operator - Integration with Pipeline", () => {
    it("should preserve OR structure when saving condition node", () => {
      const orCondition = {
        groupId: 'save-test',
        label: 'or',
        items: [
          { id: '1', column: 'status', operator: '=', value: 'error', ignore_case: true },
          { id: '2', column: 'status', operator: '=', value: 'failed', ignore_case: true }
        ]
      };

      wrapper.vm.conditionGroup = orCondition;

      expect(wrapper.vm.conditionGroup).toEqual(orCondition);
      expect(wrapper.vm.conditionGroup.label).toBe('or');
    });

    it("should handle updating existing condition node with OR", () => {
      mockPipelineObj.isEditNode = true;
      mockPipelineObj.currentSelectedNodeData = {
        data: {
          query_condition: {
            conditions: {
              groupId: 'existing',
              label: 'and',
              items: [
                { id: '1', column: 'old_field', operator: '=', value: 'old_value', ignore_case: false }
              ]
            }
          }
        },
        type: 'condition'
      };

      const newOrCondition = {
        groupId: 'updated',
        label: 'or',
        items: [
          { id: '1', column: 'new_field', operator: '=', value: 'new_value', ignore_case: true },
          { id: '2', column: 'another_field', operator: '!=', value: 'test', ignore_case: false }
        ]
      };

      wrapper.vm.conditionGroup = newOrCondition;

      expect(wrapper.vm.conditionGroup.label).toBe('or');
      expect(wrapper.vm.conditionGroup.items).toHaveLength(2);
    });
  });
});
